"use strict";

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;
const SESSION_TIMEOUT = 30 * 1000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "sandro";

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    throw new Error("DATABASE_URL dan SESSION_SECRET wajib diatur.");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const memberSessions = new Map();
const players = new Map();
const gameTickets = new Map();
const settingsClients = new Set();

const allowedEffects = ["rgb", "glow", "none"];

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));

app.use(session({
    store: new pgSession({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false
});

function token() {
    return crypto.randomBytes(32).toString("hex");
}

function cleanData() {
    const now = Date.now();

    for (const [key, value] of memberSessions) {
        if (now - value.lastSeen > SESSION_TIMEOUT) {
            memberSessions.delete(key);
            players.delete(key);
        }
    }

    for (const [key, value] of gameTickets) {
        if (now - value.createdAt > 60 * 60 * 1000) {
            gameTickets.delete(key);
        }
    }
}

function memberFromRequest(req) {
    cleanData();

    const memberToken = String(req.headers["x-member-token"] || "");
    const member = memberSessions.get(memberToken);

    if (!member) return null;

    member.lastSeen = Date.now();

    return {
        token: memberToken,
        ...member
    };
}

function broadcastPlayers() {
    const message = `data: ${JSON.stringify({
        count: players.size,
        max: MAX_PLAYERS
    })}\n\n`;

    for (const client of settingsClients) {
        client.write(message);
    }
}

function broadcastSettings(settings) {
    const message =
        `event: settings\n` +
        `data: ${JSON.stringify(settings)}\n\n`;

    for (const client of settingsClients) {
        client.write(message);
    }
}

async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS member_accounts (
            id SERIAL PRIMARY KEY,
            username VARCHAR(20) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS game_settings (
            setting_key VARCHAR(50) PRIMARY KEY,
            setting_value TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS high_scores (
            member_id INTEGER PRIMARY KEY REFERENCES member_accounts(id)
                ON DELETE CASCADE,
            best_score INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    const password = process.env.ADMIN_PASSWORD;

    if (!password || password.length < 12) {
        throw new Error("ADMIN_PASSWORD wajib minimal 12 karakter.");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
        `INSERT INTO users (username, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (username)
         DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [ADMIN_USERNAME, passwordHash]
    );

    await pool.query(`
        INSERT INTO game_settings (setting_key, setting_value)
        VALUES
            ('title', 'SANDRO GAME'),
            ('effect', 'rgb')
        ON CONFLICT (setting_key) DO NOTHING
    `);
}

async function getSettings() {
    const result = await pool.query(
        "SELECT setting_key, setting_value FROM game_settings"
    );

    const settings = {
        title: "SANDRO GAME",
        effect: "rgb"
    };

    for (const row of result.rows) {
        settings[row.setting_key] = row.setting_value;
    }

    return settings;
}

function requireAdmin(req, res, next) {
    if (
        !req.session.adminId ||
        req.session.username !== ADMIN_USERNAME
    ) {
        return res.status(401).json({
            error: "Akses admin diperlukan."
        });
    }

    next();
}

/* Member */

app.post("/api/member/register", loginLimiter, async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({
                error: "Username harus 3-20 karakter."
            });
        }

        if (password.length < 6 || password.length > 100) {
            return res.status(400).json({
                error: "Password harus 6-100 karakter."
            });
        }

        const exists = await pool.query(
            `SELECT id FROM member_accounts
             WHERE LOWER(username) = LOWER($1)`,
            [username]
        );

        if (exists.rowCount) {
            return res.status(409).json({
                error: "Username sudah terdaftar."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO member_accounts (username, password_hash)
             VALUES ($1, $2)
             RETURNING id, username`,
            [username, passwordHash]
        );

        const account = result.rows[0];
        const memberToken = token();

        memberSessions.set(memberToken, {
            id: account.id,
            username: account.username,
            lastSeen: Date.now()
        });

        res.status(201).json({
            success: true,
            token: memberToken,
            username: account.username
        });
    } catch {
        res.status(500).json({
            error: "Pendaftaran member gagal."
        });
    }
});

app.post("/api/member/login", loginLimiter, async (req, res) => {
    try {
        cleanData();

        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        const result = await pool.query(
            `SELECT id, username, password_hash
             FROM member_accounts
             WHERE LOWER(username) = LOWER($1)`,
            [username]
        );

        const account = result.rows[0];

        if (
            !account ||
            !(await bcrypt.compare(password, account.password_hash))
        ) {
            return res.status(401).json({
                error: "Username atau password salah."
            });
        }

        for (const active of memberSessions.values()) {
            if (
                active.username.toLowerCase() ===
                account.username.toLowerCase()
            ) {
                return res.status(409).json({
                    error: "Akun sedang digunakan di perangkat lain."
                });
            }
        }

        if (players.size >= MAX_PLAYERS) {
            return res.status(429).json({
                error: "Server penuh.",
                count: players.size,
                max: MAX_PLAYERS
            });
        }

        const memberToken = token();

        memberSessions.set(memberToken, {
            id: account.id,
            username: account.username,
            lastSeen: Date.now()
        });

        res.json({
            success: true,
            token: memberToken,
            username: account.username
        });
    } catch {
        res.status(500).json({
            error: "Login member gagal."
        });
    }
});

app.get("/api/member/session", (req, res) => {
    const member = memberFromRequest(req);

    if (!member) {
        return res.status(401).json({ loggedIn: false });
    }

    res.json({
        loggedIn: true,
        token: member.token,
        username: member.username
    });
});

app.post("/api/member/heartbeat", (req, res) => {
    const member = memberFromRequest(req);

    if (!member) {
        return res.status(401).json({
            error: "Sesi member berakhir."
        });
    }

    res.json({ success: true });
});

app.post("/api/member/logout", (req, res) => {
    const memberToken = String(req.headers["x-member-token"] || "");

    memberSessions.delete(memberToken);
    players.delete(memberToken);

    broadcastPlayers();

    res.json({ success: true });
});

/* Pemain online */

app.post("/api/players/join", (req, res) => {
    const memberToken = String(req.body.token || "");
    const member = memberSessions.get(memberToken);

    cleanData();

    if (!member) {
        return res.status(401).json({
            error: "Login member diperlukan."
        });
    }

    if (!players.has(memberToken) && players.size >= MAX_PLAYERS) {
        return res.status(429).json({
            error: "Server penuh.",
            count: players.size,
            max: MAX_PLAYERS
        });
    }

    member.lastSeen = Date.now();
    players.set(memberToken, Date.now());

    broadcastPlayers();

    res.json({
        allowed: true,
        count: players.size,
        max: MAX_PLAYERS
    });
});

app.post("/api/players/heartbeat", (req, res) => {
    const memberToken = String(req.body.token || "");
    const member = memberSessions.get(memberToken);

    cleanData();

    if (!member || !players.has(memberToken)) {
        return res.status(401).json({
            error: "Sesi pemain berakhir."
        });
    }

    member.lastSeen = Date.now();
    players.set(memberToken, Date.now());

    res.json({
        count: players.size,
        max: MAX_PLAYERS
    });
});

app.post("/api/players/leave", (req, res) => {
    players.delete(String(req.body.token || ""));
    broadcastPlayers();
    res.json({ success: true });
});

app.get("/api/players", (req, res) => {
    cleanData();

    res.json({
        count: players.size,
        max: MAX_PLAYERS
    });
});

/* High score aman per akun */

app.post("/api/highscore/start", (req, res) => {
    const member = memberFromRequest(req);

    if (!member) {
        return res.status(401).json({
            error: "Login member diperlukan."
        });
    }

    const ticket = token();

    gameTickets.set(ticket, {
        memberId: member.id,
        createdAt: Date.now()
    });

    res.json({ ticket });
});

app.get("/api/highscore/me", async (req, res) => {
    const member = memberFromRequest(req);

    if (!member) {
        return res.status(401).json({
            error: "Login member diperlukan."
        });
    }

    const result = await pool.query(
        `SELECT best_score
         FROM high_scores
         WHERE member_id = $1`,
        [member.id]
    );

    res.json({
        username: member.username,
        highScore: result.rows[0]?.best_score || 0
    });
});

app.post("/api/highscore/submit", async (req, res) => {
    const member = memberFromRequest(req);
    const score = Number(req.body.score);
    const ticket = String(req.body.ticket || "");

    if (!member) {
        return res.status(401).json({
            error: "Login member diperlukan."
        });
    }

    if (
        !Number.isInteger(score) ||
        score < 0 ||
        score > 100000 ||
        !ticket
    ) {
        return res.status(400).json({
            error: "Data skor tidak valid."
        });
    }

    const game = gameTickets.get(ticket);

    if (
        !game ||
        game.memberId !== member.id ||
        Date.now() - game.createdAt < 1000
    ) {
        return res.status(403).json({
            error: "Tiket permainan tidak valid."
        });
    }

    /*
     * Batas kasar berdasarkan waktu permainan.
     * Ini mencegah pengiriman skor sangat besar secara langsung.
     */
    const elapsedSeconds = (Date.now() - game.createdAt) / 1000;
    const maximumReasonableScore =
        Math.min(100000, Math.ceil(elapsedSeconds * 8) + 5);

    if (score > maximumReasonableScore) {
        return res.status(400).json({
            error: "Skor tidak sesuai durasi permainan."
        });
    }

    gameTickets.delete(ticket);

    const result = await pool.query(
        `INSERT INTO high_scores (member_id, best_score)
         VALUES ($1, $2)
         ON CONFLICT (member_id)
         DO UPDATE SET
            best_score = GREATEST(high_scores.best_score, EXCLUDED.best_score),
            updated_at = NOW()
         RETURNING best_score`,
        [member.id, score]
    );

    res.json({
        success: true,
        highScore: result.rows[0].best_score
    });
});

/* Streaming setting dan online player */

app.get("/api/settings/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    settingsClients.add(res);

    try {
        res.write(
            `event: settings\n` +
            `data: ${JSON.stringify(await getSettings())}\n\n`
        );

        res.write(
            `data: ${JSON.stringify({
                count: players.size,
                max: MAX_PLAYERS
            })}\n\n`
        );
    } catch {
        res.end();
    }

    const keepAlive = setInterval(() => {
        res.write(": keep-alive\n\n");
    }, 15000);

    req.on("close", () => {
        clearInterval(keepAlive);
        settingsClients.delete(res);
    });
});

/* Admin */

app.post("/api/login", loginLimiter, async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        const result = await pool.query(
            `SELECT id, username, password_hash
             FROM users
             WHERE LOWER(username) = LOWER($1)`,
            [username]
        );

        const admin = result.rows[0];

        if (
            !admin ||
            admin.username !== ADMIN_USERNAME ||
            !(await bcrypt.compare(password, admin.password_hash))
        ) {
            return res.status(401).json({
                error: "Username atau password admin salah."
            });
        }

        req.session.regenerate(error => {
            if (error) {
                return res.status(500).json({
                    error: "Gagal membuat sesi admin."
                });
            }

            req.session.adminId = admin.id;
            req.session.username = admin.username;

            res.json({
                success: true,
                username: admin.username,
                role: "admin"
            });
        });
    } catch {
        res.status(500).json({
            error: "Login admin gagal."
        });
    }
});

app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ success: true });
    });
});

app.get("/api/me", (req, res) => {
    res.json({
        loggedIn: Boolean(req.session.adminId),
        username: req.session.username || null,
        role: req.session.username === ADMIN_USERNAME ? "admin" : null
    });
});

app.get("/api/settings", async (req, res) => {
    try {
        res.json(await getSettings());
    } catch {
        res.status(500).json({
            error: "Gagal mengambil pengaturan."
        });
    }
});

app.put("/api/settings", requireAdmin, async (req, res) => {
    try {
        const title = String(req.body.title || "")
            .trim()
            .slice(0, 60);

        const effect = String(req.body.effect || "");

        if (!title || !allowedEffects.includes(effect)) {
            return res.status(400).json({
                error: "Teks atau efek tidak valid."
            });
        }

        await pool.query(
            `UPDATE game_settings
             SET setting_value = $1, updated_at = NOW()
             WHERE setting_key = 'title'`,
            [title]
        );

        await pool.query(
            `UPDATE game_settings
             SET setting_value = $1, updated_at = NOW()
             WHERE setting_key = 'effect'`,
            [effect]
        );

        const settings = await getSettings();
        broadcastSettings(settings);

        res.json({
            success: true,
            settings
        });
    } catch {
        res.status(500).json({
            error: "Gagal menyimpan pengaturan."
        });
    }
});

app.use(express.static(path.join(__dirname)));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

initDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Sandro Game berjalan di port ${PORT}`);
        });
    })
    .catch(error => {
        console.error("Database gagal disiapkan:", error.message);
        process.exit(1);
    });