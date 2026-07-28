"use strict";

const MAX_PLAYERS = 20;
const PLAYER_TOKEN_KEY = "sandro_player_token";

const adminLogin = document.getElementById("adminLogin");
const adminPanel = document.getElementById("adminPanel");
const openAdmin = document.getElementById("openAdmin");
const closeAdminLogin = document.getElementById("closeAdminLogin");
const loginAdmin = document.getElementById("loginAdmin");
const logoutAdmin = document.getElementById("logoutAdmin");
const saveSettings = document.getElementById("saveSettings");

const usernameInput = document.getElementById("adminUsername");
const passwordInput = document.getElementById("adminPassword");
const runningText = document.getElementById("runningText");
const runningEffect = document.getElementById("runningEffect");

const loginMessage = document.getElementById("loginMessage");
const adminMessage = document.getElementById("adminMessage");
const gameTitle = document.getElementById("gameTitle");
const onlinePlayers = document.getElementById("onlinePlayers");
const capacityMessage = document.getElementById("capacityMessage");

let playerToken = localStorage.getItem(PLAYER_TOKEN_KEY);
let playerJoined = false;
let heartbeatTimer = null;
let settingsStream = null;
let streamReconnectTimer = null;
let isSaving = false;
let formChanged = false;

function showMessage(element, message, error = false) {
    if (!element) return;

    element.textContent = message;
    element.style.color = error ? "#ff7777" : "#7dff9a";
}

async function request(url, options = {}) {
    return fetch(url, {
        credentials: "same-origin",
        ...options
    });
}

function updateOnlinePlayers(data) {
    const count = Number(data.count || 0);
    const max = Number(data.max || MAX_PLAYERS);

    onlinePlayers.textContent = `Pemain online: ${count}/${max}`;

    if (count >= max && !playerJoined) {
        capacityMessage.textContent =
            "Server penuh. Tunggu pemain lain keluar.";
    } else if (playerJoined) {
        capacityMessage.textContent = "";
    }
}

function applySettings(settings, updateForm = false) {
    const title = String(settings.title || "SANDRO GAME");
    const effect = ["rgb", "glow", "none"].includes(settings.effect)
        ? settings.effect
        : "rgb";

    gameTitle.textContent = title;
    gameTitle.classList.remove(
        "effect-rgb",
        "effect-glow",
        "effect-none"
    );
    gameTitle.classList.add(`effect-${effect}`);

    if (updateForm) {
        runningText.value = title;
        runningEffect.value = effect;
        formChanged = false;
    }
}

function connectSettingsStream() {
    if (settingsStream) settingsStream.close();

    settingsStream = new EventSource("/api/settings/stream");

    settingsStream.addEventListener("settings", event => {
        const settings = JSON.parse(event.data);
        applySettings(settings, !adminPanel.classList.contains("active"));
    });

    settingsStream.onmessage = event => {
        updateOnlinePlayers(JSON.parse(event.data));
    };

    settingsStream.onerror = () => {
        settingsStream.close();
        clearTimeout(streamReconnectTimer);

        streamReconnectTimer = setTimeout(() => {
            connectSettingsStream();
        }, 3000);
    };
}

async function loadSettings() {
    try {
        const response = await request("/api/settings");
        if (response.ok) applySettings(await response.json());
    } catch {
        console.error("Pengaturan gagal dimuat.");
    }
}

async function joinAsPlayer() {
    if (!window.memberReady) return;

    const memberToken = localStorage.getItem("sandro_member_token");

    if (!memberToken) return;

    playerToken = memberToken;
    localStorage.setItem(PLAYER_TOKEN_KEY, playerToken);

    try {
        const response = await request("/api/players/join", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                token: playerToken
            })
        });

        const result = await response.json();
        updateOnlinePlayers(result);

        if (!response.ok) {
            capacityMessage.textContent = result.error;
            return;
        }

        playerJoined = true;
        startHeartbeat();
    } catch {
        capacityMessage.textContent = "Server tidak dapat dihubungi.";
    }
}

function startHeartbeat() {
    clearInterval(heartbeatTimer);

    heartbeatTimer = setInterval(async () => {
        if (!playerJoined) return;

        try {
            const response = await request("/api/players/heartbeat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    token: playerToken
                })
            });

            if (!response.ok) {
                playerJoined = false;
                clearInterval(heartbeatTimer);
                return;
            }

            updateOnlinePlayers(await response.json());
        } catch {
            // Koneksi sementara tidak langsung mengeluarkan pemain.
        }
    }, 10000);
}

function leavePlayer() {
    if (!playerJoined) return;

    navigator.sendBeacon(
        "/api/players/leave",
        new Blob([JSON.stringify({
            token: playerToken
        })], {
            type: "application/json"
        })
    );
}

openAdmin.addEventListener("click", async () => {
    adminLogin.classList.add("active");

    const response = await request("/api/me");
    const account = await response.json();

    if (account.loggedIn && account.username === "sandro") {
        adminLogin.classList.remove("active");
        adminPanel.classList.add("active");
        loadAdminSettings();
    }
});

closeAdminLogin.addEventListener("click", () => {
    adminLogin.classList.remove("active");
});

loginAdmin.addEventListener("click", async () => {
    if (loginAdmin.disabled) return;

    loginAdmin.disabled = true;
    showMessage(loginMessage, "Memproses...");

    try {
        const response = await request("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: usernameInput.value.trim(),
                password: passwordInput.value
            })
        });

        const result = await response.json();

        if (!response.ok || result.username !== "sandro") {
            showMessage(
                loginMessage,
                result.error || "Akun admin tidak valid.",
                true
            );
            return;
        }

        usernameInput.value = "";
        passwordInput.value = "";
        adminLogin.classList.remove("active");
        adminPanel.classList.add("active");

        loadAdminSettings();
    } catch {
        showMessage(loginMessage, "Server tidak dapat dihubungi.", true);
    } finally {
        loginAdmin.disabled = false;
    }
});

async function loadAdminSettings() {
    const response = await request("/api/settings");
    const settings = await response.json();

    if (response.ok) applySettings(settings, true);
}

saveSettings.addEventListener("click", async () => {
    if (isSaving) return;

    const title = runningText.value.trim();

    if (!title) {
        showMessage(adminMessage, "Teks tidak boleh kosong.", true);
        return;
    }

    isSaving = true;
    saveSettings.disabled = true;

    try {
        const response = await request("/api/settings", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                title,
                effect: runningEffect.value
            })
        });

        const result = await response.json();

        if (!response.ok) {
            showMessage(adminMessage, result.error, true);
            return;
        }

        applySettings(result.settings, true);
        showMessage(adminMessage, "Perubahan dikirim ke semua pemain.");
    } finally {
        isSaving = false;
        saveSettings.disabled = false;
    }
});

logoutAdmin.addEventListener("click", async () => {
    await request("/api/logout", {
        method: "POST"
    });

    adminPanel.classList.remove("active");
    adminLogin.classList.add("active");
});

window.addEventListener("beforeunload", leavePlayer);

loadSettings();
connectSettingsStream();

const waitForMember = setInterval(() => {
    if (window.memberReady) {
        clearInterval(waitForMember);
        joinAsPlayer();
    }
}, 300);