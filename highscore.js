"use strict";

const HIGH_SCORE_TOKEN_KEY = "sandro_highscore_ticket";

const overPanel = document.getElementById("over");
const gameScore = document.getElementById("score");

const highScoreBox = document.createElement("p");
highScoreBox.id = "accountHighScore";
highScoreBox.textContent = "High score akun: 0";
overPanel.appendChild(highScoreBox);

function memberHeaders() {
    const memberToken = localStorage.getItem("sandro_member_token");

    return memberToken
        ? { "X-Member-Token": memberToken }
        : {};
}

async function startHighScoreTicket() {
    const response = await fetch("/api/highscore/start", {
        method: "POST",
        credentials: "same-origin",
        headers: memberHeaders()
    });

    if (!response.ok) return;

    const result = await response.json();
    localStorage.setItem(HIGH_SCORE_TOKEN_KEY, result.ticket);
}

async function loadHighScore() {
    try {
        const response = await fetch("/api/highscore/me", {
            credentials: "same-origin",
            headers: memberHeaders()
        });

        if (!response.ok) return;

        const result = await response.json();

        highScoreBox.textContent =
            `High score ${result.username}: ${result.highScore}`;
    } catch {
        highScoreBox.textContent = "High score gagal dimuat.";
    }
}

async function submitHighScore() {
    const ticket = localStorage.getItem(HIGH_SCORE_TOKEN_KEY);

    if (!ticket) return;

    const scoreText = gameScore.textContent.match(/Score\s*:\s*(\d+)/i);
    const currentScore = scoreText ? Number(scoreText[1]) : 0;

    try {
        const response = await fetch("/api/highscore/submit", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                ...memberHeaders()
            },
            body: JSON.stringify({
                ticket,
                score: currentScore
            })
        });

        const result = await response.json();

        if (response.ok) {
            highScoreBox.textContent =
                `High score akun: ${result.highScore}`;
        }
    } finally {
        localStorage.removeItem(HIGH_SCORE_TOKEN_KEY);
    }
}

function watchGameOver() {
    const observer = new MutationObserver(() => {
        if (overPanel.style.display === "flex") {
            submitHighScore();
            loadHighScore();
        }
    });

    observer.observe(overPanel, {
        attributes: true,
        attributeFilter: ["style"]
    });
}

document.addEventListener("DOMContentLoaded", () => {
    startHighScoreTicket();
    loadHighScore();
    watchGameOver();
});