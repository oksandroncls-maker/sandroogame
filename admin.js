"use strict";

const MAX_PLAYERS = 20;

const adminLogin = document.getElementById("memberLogin");
const openAdmin = document.getElementById("openAdmin");
const saveSettings = document.getElementById("saveSettings");
const runningText = document.getElementById("runningText");
const runningEffect = document.getElementById("runningEffect");
const adminMessage = document.getElementById("adminMessage");
const gameTitle = document.getElementById("gameTitle");
const onlinePlayers = document.getElementById("onlinePlayers");
const capacityMessage = document.getElementById("capacityMessage");

let settingsStream = null;
let reconnectTimer = null;
let isSaving = false;

function request(url, options = {}) {
    return fetch(url, {
        credentials: "same-origin",
        ...options
    });
}

function showAdminMessage(message, error = false) {
    adminMessage.textContent = message;
    adminMessage.style.color = error ? "#ff7777" : "#7dff9a";
}

function updateOnlinePlayers(data) {
    const count = Number(data.count || 0);
    const max = Number(data.max || MAX_PLAYERS);

    onlinePlayers.textContent = `Pemain online: ${count}/${max}`;

    if (count >= max) {
        capacityMessage.textContent =
            "Server penuh. Tunggu pemain lain keluar.";
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
    }
}

async function loadSettings() {
    try {
        const response = await request("/api/settings");

        if (response.ok) {
            applySettings(await response.json());
        }
    } catch {
        showAdminMessage("Pengaturan gagal dimuat.", true);
    }
}

async function loadAdminSettings() {
    try {
        const response = await request("/api/settings");

        if (!response.ok) {
            showAdminMessage("Sesi admin tidak valid.", true);
            return;
        }

        applySettings(await response.json(), true);
    } catch {
        showAdminMessage("Server tidak dapat dihubungi.", true);
    }
}

function connectSettingsStream() {
    if (settingsStream) {
        settingsStream.close();
    }

    settingsStream = new EventSource("/api/settings/stream");

    settingsStream.addEventListener("settings", event => {
        applySettings(JSON.parse(event.data));
    });

    settingsStream.onmessage = event => {
        updateOnlinePlayers(JSON.parse(event.data));
    };

    settingsStream.onerror = () => {
        settingsStream.close();
        clearTimeout(reconnectTimer);

        reconnectTimer = setTimeout(() => {
            connectSettingsStream();
        }, 3000);
    };
}

openAdmin.addEventListener("click", () => {
    adminLogin.classList.add("active");

    const role = document.getElementById("authRole");
    role.value = "admin";
    role.dispatchEvent(new Event("change"));

    document.getElementById("memberUsername").focus();
});

saveSettings.addEventListener("click", async () => {
    if (isSaving) return;

    const title = runningText.value.trim();
    const effect = runningEffect.value;

    if (!title) {
        showAdminMessage("Teks tidak boleh kosong.", true);
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
                effect
            })
        });

        const result = await response.json();

        if (!response.ok) {
            showAdminMessage(result.error || "Gagal menyimpan.", true);
            return;
        }

        applySettings(result.settings, true);
        showAdminMessage("Pengaturan berhasil dikirim ke semua pemain.");
    } catch {
        showAdminMessage("Server tidak dapat dihubungi.", true);
    } finally {
        isSaving = false;
        saveSettings.disabled = false;
    }
});

loadSettings();
connectSettingsStream();

window.loadAdminSettings = loadAdminSettings;