"use strict";

const MEMBER_TOKEN_KEY = "sandro_member_token";
const MEMBER_NAME_KEY = "sandro_member_name";

const memberLogin = document.getElementById("memberLogin");
const memberUsername = document.getElementById("memberUsername");
const memberPassword = document.getElementById("memberPassword");
const loginMember = document.getElementById("loginMember");
const registerMember = document.getElementById("registerMember");
const logoutMember = document.getElementById("logoutMember");
const memberMessage = document.getElementById("memberMessage");
const startButton = document.getElementById("start");
const capacityMessage = document.getElementById("capacityMessage");

let memberToken = localStorage.getItem(MEMBER_TOKEN_KEY);
let memberHeartbeat = null;
let playerJoined = false;
let registerMode = false;

window.memberReady = false;

function showMemberMessage(text, error = false) {
    memberMessage.textContent = text;
    memberMessage.style.color = error ? "#ff7777" : "#7dff9a";
}

function request(url, options = {}) {
    return fetch(url, {
        credentials: "same-origin",
        ...options
    });
}

function setRegisterMode(enabled) {
    registerMode = enabled;

    document.getElementById("memberFormTitle").textContent =
        enabled ? "Buat Akun Member" : "Login Member";

    loginMember.textContent =
        enabled ? "DAFTAR MEMBER" : "LOGIN MEMBER";

    registerMember.textContent =
        enabled ? "KEMBALI KE LOGIN" : "BUAT AKUN MEMBER";

    memberPassword.placeholder =
        enabled ? "Password minimal 6 karakter" : "Password";
}

function setMemberReady(token, username) {
    memberToken = token;

    localStorage.setItem(MEMBER_TOKEN_KEY, token);
    localStorage.setItem(MEMBER_NAME_KEY, username);

    window.memberReady = true;
    startButton.disabled = false;
    memberLogin.classList.remove("active");

    startMemberHeartbeat();
}

async function loginOrRegister() {
    const username = memberUsername.value.trim();
    const password = memberPassword.value;

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        showMemberMessage(
            "Username harus 3-20 karakter: huruf, angka, atau underscore.",
            true
        );
        return;
    }

    if (password.length < 6) {
        showMemberMessage(
            "Password minimal terdiri dari 6 karakter.",
            true
        );
        return;
    }

    loginMember.disabled = true;
    registerMember.disabled = true;
    showMemberMessage("Memproses...");

    const endpoint = registerMode
        ? "/api/member/register"
        : "/api/member/login";

    try {
        const response = await request(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username,
                password
            })
        });

        const result = await response.json();

        if (!response.ok) {
            showMemberMessage(result.error || "Permintaan gagal.", true);
            return;
        }

        setMemberReady(result.token, result.username);

        memberUsername.value = "";
        memberPassword.value = "";

        if (registerMode) {
            setRegisterMode(false);
        }

        await joinPlayer();
    } catch {
        showMemberMessage("Server tidak dapat dihubungi.", true);
    } finally {
        loginMember.disabled = false;
        registerMember.disabled = false;
    }
}

async function restoreMemberSession() {
    if (!memberToken) return;

    try {
        const response = await request("/api/member/session", {
            headers: {
                "X-Member-Token": memberToken
            }
        });

        const result = await response.json();

        if (!response.ok || !result.loggedIn) {
            throw new Error("Sesi member tidak valid");
        }

        setMemberReady(result.token, result.username);
        await joinPlayer();
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
            capacityMessage.textContent = result.error;
            return;
        }

        playerJoined = true;
    } catch {
        capacityMessage.textContent = "Server tidak dapat dihubungi.";
    }
}

function startMemberHeartbeat() {
    clearInterval(memberHeartbeat);

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
}

async function logoutMemberAccount(showLogin = true) {
    clearInterval(memberHeartbeat);

    if (memberToken) {
        await request("/api/member/logout", {
            method: "POST",
            headers: {
                "X-Member-Token": memberToken
            }
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
        showMemberMessage("Anda telah logout.");
    }
}

loginMember.addEventListener("click", loginOrRegister);

registerMember.addEventListener("click", () => {
    setRegisterMode(!registerMode);
    showMemberMessage("");
});

memberUsername.addEventListener("keydown", event => {
    if (event.key === "Enter") loginOrRegister();
});

memberPassword.addEventListener("keydown", event => {
    if (event.key === "Enter") loginOrRegister();
});

logoutMember.addEventListener("click", () => {
    logoutMemberAccount(true);
});

window.addEventListener("beforeunload", () => {
    if (!memberToken) return;

    navigator.sendBeacon(
        "/api/member/logout",
        new Blob([], {
            type: "application/json"
        })
    );
});

restoreMemberSession();