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
const SESSION_TIMEOUT = 30000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false
});

const memberSessions = new Map();
const players = new Map();
const settingsClients = new Set();

const allowedEffects = ["rgb", "glow", "none"];

app.set("trust proxy", 1);

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(express.json({ limit: "20kb" }));

app.use(session({
    store: new pgSession({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || "ganti-session-secret-di-railway",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 8
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false
});

function createToken() {
    return crypto.randomBytes(32).toString("hex");
}

function cleanSessions() {
    const now = Date.now();

    for (const [token, data] of memberSessions) {
        if (now - data.lastSeen > SESSION_TIMEOUT) {
            memberSessions.delete(token);
            players.delete(token);
        }
    }

    for (const [token, lastSeen] of players) {
        if (now - lastSeen > SESSION_TIMEOUT) {
            players.delete(token);
        }
    }
}

function getMemberToken(req) {
    return String(req.headers["x-member-token"] || "").trim();
}

function getMemberSession(req) {
    cleanSessions();

    const token = getMemberToken(req);
    const sessionData = memberSessions.get(token);

    if (!sessionData) return null;

    sessionData.lastSeen = Date.now();

    return {
        token,
        ...sessionData
    };
}

function activePlayerCount() {
    cleanSessions();
    return players.size;
}

function broadcastPlayers() {
    const data = `data: ${JSON.stringify({
        count: activePlayerCount(),
        max: MAX_PLAYERS
    })}\n\n`;

    for (const client of settingsClients) {
        client.write(data);
    }
}

function broadcastSettings(settings) {
    const data =
        `event: settings\n` +
        `data: ${JSON.stringify(settings)}\n\n`;

    for (const client of settingsClients) {
        client.write(data);
    }
}

async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL belum diatur.");
    }

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

    const adminUsername = process.env.ADMIN_USERNAME || "sandro";
    const adminPassword = process.env.ADMIN_PASSWORD || "sandro011021";
    const adminHash = await bcrypt.hash(adminPassword, 12);

    await pool.query(
        `INSERT INTO users (username, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (username) DO NOTHING`,
        [adminUsername, adminHash]
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
    if (!req.session.adminId || req.session.username !== "sandro") {
        return res.status(401).json({
            error: "Akses khusus admin diperlukan."
        });
    }

    next();
}

/* Registrasi member */
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

        const existing = await pool.query(
            `SELECT id FROM member_accounts
             WHERE LOWER(username) = LOWER($1)`,
            [username]
        );

        if (existing.rowCount > 0) {
            return res.status(409).json({
                error: "Username sudah terdaftar."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        await pool.query(
            `INSERT INTO member_accounts (username, password_hash)
             VALUES ($1, $2)`,
            [username, passwordHash]
        );

        const token = createToken();

        memberSessions.set(token, {
            username,
            lastSeen: Date.now()
        });

        res.status(201).json({
            success: true,
            token,
            username
        });
    } catch {
        res.status(500).json({
            error: "Pendaftaran member gagal."
        });
    }
});

/* Login member: satu username hanya satu sesi aktif */
app.post("/api/member/login", loginLimiter, async (req, res) => {
    try {
        cleanSessions();

        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        const result = await pool.query(
            `SELECT id, username, password_hash
             FROM member_accounts
             WHERE LOWER(username) = LOWER($1)`,
            [username]
        );

        const account = result.rows[0];

        if (!account || !(await bcrypt.compare(password, account.password_hash))) {
            return res.status(401).json({
                error: "Username atau password salah."
            });
        }

        for (const data of memberSessions.values()) {
            if (data.username.toLowerCase() === account.username.toLowerCase()) {
                return res.status(409).json({
                    error: "Username sedang digunakan orang lain."
                });
            }
        }

        if (players.size >= MAX_PLAYERS) {
            return res.status(429).json({
                error: "Server penuh. Maksimal 20 pemain online.",
                count: players.size,
                max: MAX_PLAYERS
            });
        }

        const token = createToken();

        memberSessions.set(token, {
            username: account.username,
            lastSeen: Date.now()
        });

        res.json({
            success: true,
            token,
            username: account.username
        });
    } catch {
        res.status(500).json({
            error: "Login member gagal."
        });
    }
});

app.get("/api/member/session", (req, res) => {
    const member = getMemberSession(req);

    if (!member) {
        return res.status(401).json({
            loggedIn: false
        });
    }

    res.json({
        loggedIn: true,
        token: member.token,
        username: member.username
    });
});

app.post("/api/member/heartbeat", (req, res) => {
    const member = getMemberSession(req);

    if (!member) {
        return res.status(401).json({
            error: "Sesi member telah berakhir."
        });
    }

    res.json({
        success: true,
        username: member.username
    });
});

app.post("/api/member/logout", (req, res) => {
    const token = getMemberToken(req);

    memberSessions.delete(token);
    players.delete(token);
    broadcastPlayers();

    res.json({
        success: true
    });
});

/* Pemain online maksimal 20 */
app.post("/api/players/join", (req, res) => {
    const token = String(req.body.token || "").trim();
    const member = memberSessions.get(token);

    cleanSessions();

    if (!member) {
        return res.status(401).json({
            error: "Login member diperlukan."
        });
    }

    if (!players.has(token) && players.size >= MAX_PLAYERS) {
        return res.status(429).json({
            error: "Server penuh. Maksimal 20 pemain online.",
            count: players.size,
            max: MAX_PLAYERS
        });
    }

    member.lastSeen = Date.now();
    players.set(token, Date.now());

    broadcastPlayers();

    res.json({
        allowed: true,
        count: players.size,
        max: MAX_PLAYERS
    });
});

app.post("/api/players/heartbeat", (req, res) => {
    const token = String(req.body.token || "").trim();
    const member = memberSessions.get(token);

    cleanSessions();

    if (!member || !players.has(token)) {
        return res.status(401).json({
            error: "Sesi pemain telah berakhir."
        });
    }

    member.lastSeen = Date.now();
    players.set(token, Date.now());

    res.json({
        count: activePlayerCount(),
        max: MAX_PLAYERS
    });
});

app.post("/api/players/leave", (req, res) => {
    const token = String(req.body.token || "").trim();

    players.delete(token);
    broadcastPlayers();

    res.json({
        success: true
    });
});

app.get("/api/players", (req, res) => {
    res.json({
        count: activePlayerCount(),
        max: MAX_PLAYERS
    });
});

/* Real-time pengaturan admin */
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
                count: activePlayerCount(),
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

/* Login khusus admin */
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
        const valid = admin
            ? await bcrypt.compare(password, admin.password_hash)
            : false;

        if (!valid || admin.username !== "sandro") {
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
        role: req.session.username === "sandro"
            ? "admin"
            : null
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

        const effect = String(req.body.effect || "rgb");

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