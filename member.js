"use strict";

const MEMBER_TOKEN_KEY = "sandro_member_token";
const MEMBER_NAME_KEY = "sandro_member_name";

const memberLogin = document.getElementById("memberLogin");
const authTitle = document.getElementById("authTitle");
const authRole = document.getElementById("authRole");
const memberUsername = document.getElementById("memberUsername");
const memberPassword = document.getElementById("memberPassword");
const loginMember = document.getElementById("loginMember");
const registerMember = document.getElementById("registerMember");
const logoutMember = document.getElementById("logoutMember");
const memberMessage = document.getElementById("memberMessage");
const startButton = document.getElementById("start");
const capacityMessage = document.getElementById("capacityMessage");

const adminPanel = document.getElementById("adminPanel");
const logoutAdmin = document.getElementById("logoutAdmin");

let memberToken = localStorage.getItem(MEMBER_TOKEN_KEY);
let memberHeartbeat = null;
let playerHeartbeat = null;
let playerJoined = false;
let registerMode = false;
let adminLoggedIn = false;

window.memberReady = false;

function request(url, options = {}) {
    return fetch(url, {
        credentials: "same-origin",
        ...options
    });
}

function showMessage(message, error = false) {
    memberMessage.textContent = message;
    memberMessage.style.color = error ? "#ff7777" : "#7dff9a";
}

function setAuthMode() {
    const isAdmin = authRole.value === "admin";

    authTitle.textContent = isAdmin
        ? "Login Admin"
        : registerMode
            ? "Buat Akun Member"
            : "Login Member";

    loginMember.textContent = isAdmin
        ? "LOGIN ADMIN"
        : registerMode
            ? "DAFTAR MEMBER"
            : "MASUK";

    registerMember.textContent = isAdmin
        ? "MASUK SEBAGAI MEMBER"
        : registerMode
            ? "KEMBALI KE LOGIN"
            : "BUAT AKUN";

    memberPassword.placeholder = isAdmin
        ? "Password admin"
        : registerMode
            ? "Password minimal 6 karakter"
            : "Password";
}

function setMemberReady(token, username) {
    memberToken = token;

    localStorage.setItem(MEMBER_TOKEN_KEY, token);
    localStorage.setItem(MEMBER_NAME_KEY, username);

    window.memberReady = true;
    startButton.disabled = false;
    memberLogin.classList.remove("active");

    startMemberHeartbeat();
    joinPlayer();
}

async function loginMemberAccount() {
    const username = memberUsername.value.trim();
    const password = memberPassword.value;

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        showMessage(
            "Username harus 3-20 karakter: huruf, angka, atau underscore.",
            true
        );
        return;
    }

    if (password.length < 6) {
        showMessage("Password minimal terdiri dari 6 karakter.", true);
        return;
    }

    const endpoint = registerMode
        ? "/api/member/register"
        : "/api/member/login";

    loginMember.disabled = true;
    registerMember.disabled = true;
    showMessage("Memproses...");

    try {
        const response = await request(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (!response.ok) {
            showMessage(result.error || "Login gagal.", true);
            return;
        }

        setMemberReady(result.token, result.username);

        memberUsername.value = "";
        memberPassword.value = "";
        registerMode = false;
        setAuthMode();
    } catch {
        showMessage("Server tidak dapat dihubungi.", true);
    } finally {
        loginMember.disabled = false;
        registerMember.disabled = false;
    }
}

async function loginAdminAccount() {
    const username = memberUsername.value.trim();
    const password = memberPassword.value;

    loginMember.disabled = true;
    registerMember.disabled = true;
    showMessage("Memproses login admin...");

    try {
        const response = await request("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (!response.ok) {
            showMessage(result.error || "Login admin gagal.", true);
            return;
        }

        adminLoggedIn = true;
        memberLogin.classList.remove("active");
        adminPanel.classList.add("active");
        memberUsername.value = "";
        memberPassword.value = "";

        if (typeof loadAdminSettings === "function") {
            loadAdminSettings();
        }
    } catch {
        showMessage("Server tidak dapat dihubungi.", true);
    } finally {
        loginMember.disabled = false;
        registerMember.disabled = false;
    }
}

async function loginOrRegister() {
    if (authRole.value === "admin") {
        await loginAdminAccount();
    } else {
        await loginMemberAccount();
    }
}

async function restoreMemberSession() {
    if (!memberToken) {
        window.memberReady = false;
        return;
    }

    try {
        const response = await request("/api/member/session", {
            headers: {
                "X-Member-Token": memberToken
            }
        });

        const result = await response.json();

        if (!response.ok || !result.loggedIn) {
            throw new Error("Sesi tidak valid");
        }

        setMemberReady(result.token, result.username);
    } catch {
        memberToken = null;
        localStorage.removeItem(MEMBER_TOKEN_KEY);
        localStorage.removeItem(MEMBER_NAME_KEY);
    }
}

async function joinPlayer() {
    if (!memberToken || playerJoined) return;

    try {
        const response = await request("/api/players/join", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                token: memberToken
            })
        });

        const result = await response.json();

        if (!response.ok) {
            capacityMessage.textContent = result.error || "Server penuh.";
            return;
        }

        playerJoined = true;
        capacityMessage.textContent = "";
    } catch {
        capacityMessage.textContent = "Server tidak dapat dihubungi.";
    }
}

function startMemberHeartbeat() {
    clearInterval(memberHeartbeat);
    clearInterval(playerHeartbeat);

    memberHeartbeat = setInterval(async () => {
        if (!memberToken) return;

        try {
            const response = await request("/api/member/heartbeat", {
                method: "POST",
                headers: {
                    "X-Member-Token": memberToken
                }
            });

            if (!response.ok) {
                await logoutMemberAccount(true);
            }
        } catch {
            // Koneksi sementara tidak langsung menghapus sesi.
        }
    }, 10000);

    playerHeartbeat = setInterval(async () => {
        if (!memberToken || !playerJoined) return;

        try {
            await request("/api/players/heartbeat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    token: memberToken
                })
            });
        } catch {
            // Sesi tetap aktif sampai timeout server.
        }
    }, 10000);
}

async function logoutMemberAccount(showLogin = true) {
    clearInterval(memberHeartbeat);
    clearInterval(playerHeartbeat);

    if (memberToken) {
        await request("/api/member/logout", {
            method: "POST",
            headers: {
                "X-Member-Token": memberToken
            },
            keepalive: true
        }).catch(() => {});
    }

    memberToken = null;
    playerJoined = false;
    window.memberReady = false;

    localStorage.removeItem(MEMBER_TOKEN_KEY);
    localStorage.removeItem(MEMBER_NAME_KEY);

    startButton.disabled = true;

    if (showLogin) {
        memberLogin.classList.add("active");
        authRole.value = "member";
        registerMode = false;
        setAuthMode();
        showMessage("Anda telah logout.");
    }
}

authRole.addEventListener("change", () => {
    registerMode = false;
    setAuthMode();
    showMessage("");
});

loginMember.addEventListener("click", loginOrRegister);

registerMember.addEventListener("click", () => {
    if (authRole.value === "admin") {
        authRole.value = "member";
        registerMode = false;
    } else {
        registerMode = !registerMode;
    }

    setAuthMode();
    showMessage("");
});

[memberUsername, memberPassword].forEach(input => {
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") loginOrRegister();
    });
});

logoutMember.addEventListener("click", () => {
    logoutMemberAccount(true);
});

logoutAdmin.addEventListener("click", async () => {
    await request("/api/logout", {
        method: "POST",
        keepalive: true
    });

    adminLoggedIn = false;
    adminPanel.classList.remove("active");
    memberLogin.classList.add("active");
    authRole.value = "admin";
    registerMode = false;
    setAuthMode();
    showMessage("Admin telah logout.");
});

window.addEventListener("beforeunload", () => {
    if (!memberToken) return;

    request("/api/players/leave", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            token: memberToken
        }),
        keepalive: true
    }).catch(() => {});
});

setAuthMode();
restoreMemberSession();