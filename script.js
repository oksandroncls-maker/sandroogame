"use strict";

const sky = document.getElementById("sky");
const player = document.getElementById("p");
const score = document.getElementById("score");
const levelUp = document.getElementById("levelUp");
const menu = document.getElementById("menu");
const over = document.getElementById("over");
const levelSelect = document.getElementById("levelSelect");

const startBtn = document.getElementById("start");
const restartBtn = document.getElementById("restart");
const pickLevelBtn = document.getElementById("pickLevel");
const leftBtn = document.getElementById("l");
const rightBtn = document.getElementById("r");

const MAX_LEVEL = 30;

const game = {
    running: false,
    score: 0,
    level: 1,
    startLevel: 1,
    playerX: window.innerWidth / 2,
    playerWidth: 100,
    playerSpeed: 7,
    moveLeft: false,
    moveRight: false,
    bombSpeed: 4,
    bombSize: 46,
    spawnDelay: 700,
    lastSpawn: 0,
    bombs: [],
    clouds: [],
    stars: [],
    animationId: null
};

function enterFullscreen() {
    if (document.fullscreenElement) return;

    const element = document.documentElement;
    const request = element.requestFullscreen ||
        element.webkitRequestFullscreen ||
        element.msRequestFullscreen;

    if (request) {
        Promise.resolve(request.call(element)).catch(() => {});
    }
}

document.addEventListener("touchstart", enterFullscreen, {
    passive: true
});

function updateHUD() {
    score.textContent =
        "Score : " + game.score + " | Level : " + game.level;
}

function showLevelUp() {
    levelUp.classList.remove("show");
    void levelUp.offsetWidth;
    levelUp.classList.add("show");

    setTimeout(() => {
        levelUp.classList.remove("show");
    }, 1000);
}

function applyLevel(level) {
    game.level = Math.min(MAX_LEVEL, Math.max(1, level));
    game.bombSpeed = 4 + (game.level - 1) * 0.8;
    game.spawnDelay = Math.max(180, 700 - (game.level - 1) * 18);
}

function updateLevel() {
    const newLevel = Math.min(
        MAX_LEVEL,
        game.startLevel + Math.floor(game.score / 10)
    );

    if (newLevel !== game.level) {
        applyLevel(newLevel);
        showLevelUp();
        updateHUD();
    }
}

function updatePlayer() {
    if (game.moveLeft) game.playerX -= game.playerSpeed;
    if (game.moveRight) game.playerX += game.playerSpeed;

    const half = game.playerWidth / 2;
    const maxX = window.innerWidth - half;

    game.playerX = Math.max(half, Math.min(maxX, game.playerX));
    player.style.left = game.playerX + "px";
}

function removeObjects(objects) {
    objects.forEach(item => {
        if (item.element) item.element.remove();
    });
}

function resetGame() {
    game.score = 0;
    game.running = false;
    game.playerX = window.innerWidth / 2;
    game.moveLeft = false;
    game.moveRight = false;
    game.lastSpawn = 0;

    if (game.animationId !== null) {
        cancelAnimationFrame(game.animationId);
        game.animationId = null;
    }

    removeObjects(game.bombs);
    removeObjects(game.clouds);

    game.bombs = [];
    game.clouds = [];

    player.style.left = game.playerX + "px";
    levelUp.classList.remove("show");
    updateHUD();
}

function createBomb() {
    const element = document.createElement("div");
    element.className = "a";
    element.textContent = "💣";
    element.style.fontSize = game.bombSize + "px";

    const bomb = {
        x: Math.random() * (window.innerWidth - game.bombSize),
        y: -60,
        size: game.bombSize,
        speed: game.bombSpeed,
        element
    };

    element.style.left = bomb.x + "px";
    element.style.top = bomb.y + "px";

    sky.appendChild(element);
    game.bombs.push(bomb);
}

function createCloud() {
    const element = document.createElement("div");
    element.className = "cloud";

    const width = 70 + Math.random() * 90;
    const cloud = {
        x: -180,
        y: 40 + Math.random() * 220,
        speed: 0.4 + Math.random() * 1.2,
        width,
        element
    };

    element.style.width = width + "px";
    element.style.height = width * 0.38 + "px";
    element.style.top = cloud.y + "px";
    element.style.left = cloud.x + "px";
    element.style.opacity = (0.45 + Math.random() * 0.35).toFixed(2);

    sky.appendChild(element);
    game.clouds.push(cloud);
}

function createStar() {
    const element = document.createElement("div");
    element.className = "star";

    const size = 2 + Math.random() * 3;

    element.style.left = Math.random() * window.innerWidth + "px";
    element.style.top = Math.random() * window.innerHeight * 0.55 + "px";
    element.style.width = size + "px";
    element.style.height = size + "px";
    element.style.animationDelay = Math.random() * 3 + "s";

    sky.appendChild(element);
    game.stars.push(element);
}

function initStars() {
    game.stars.forEach(star => star.remove());
    game.stars = [];

    for (let i = 0; i < 60; i++) {
        createStar();
    }
}

function hitPlayer(bomb) {
    const rect = player.getBoundingClientRect();

    return (
        bomb.x + bomb.size - 8 > rect.left + 30 &&
        bomb.x + 8 < rect.right - 30 &&
        bomb.y + bomb.size - 8 > rect.top + 25 &&
        bomb.y + 8 < rect.bottom - 15
    );
}

function updateBombs() {
    for (let i = game.bombs.length - 1; i >= 0; i--) {
        const bomb = game.bombs[i];

        bomb.y += bomb.speed;
        bomb.element.style.top = bomb.y + "px";

        if (hitPlayer(bomb)) {
            gameOver();
            return;
        }

        if (bomb.y > window.innerHeight + 60) {
            bomb.element.remove();
            game.bombs.splice(i, 1);
            game.score++;
            updateLevel();
            updateHUD();
        }
    }
}

function updateClouds() {
    for (let i = game.clouds.length - 1; i >= 0; i--) {
        const cloud = game.clouds[i];

        cloud.x += cloud.speed;
        cloud.element.style.left = cloud.x + "px";

        if (cloud.x > window.innerWidth + 220) {
            cloud.element.remove();
            game.clouds.splice(i, 1);
        }
    }
}

function spawnBomb(time) {
    if (time - game.lastSpawn >= game.spawnDelay) {
        game.lastSpawn = time;
        createBomb();
    }
}

function spawnClouds() {
    if (game.clouds.length < 5 && Math.random() < 0.03) {
        createCloud();
    }
}

function gameOver() {
    if (!game.running) return;

    game.running = false;
    over.style.display = "flex";
    menu.style.display = "none";

    if (game.animationId !== null) {
        cancelAnimationFrame(game.animationId);
        game.animationId = null;
    }
}

function gameLoop(time) {
    if (!game.running) return;

    updatePlayer();
    spawnBomb(time);
    spawnClouds();
    updateBombs();
    updateClouds();

    if (game.running) {
        game.animationId = requestAnimationFrame(gameLoop);
    }
}

function startGame() {
    resetGame();
    initStars();

    const selected = parseInt(levelSelect.value, 10);
    game.startLevel = Math.max(1, Math.min(MAX_LEVEL, selected || 1));

    applyLevel(game.startLevel);

    menu.style.display = "none";
    over.style.display = "none";
    game.running = true;

    updateHUD();
    game.animationId = requestAnimationFrame(gameLoop);
}

function openLevelMenu() {
    over.style.display = "none";
    menu.style.display = "flex";
}

function setMove(direction, state) {
    if (direction === "left") game.moveLeft = state;
    if (direction === "right") game.moveRight = state;
}

function bindHoldButton(button, direction) {
    button.addEventListener("pointerdown", event => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        setMove(direction, true);
    });

    ["pointerup", "pointercancel", "pointerleave"].forEach(type => {
        button.addEventListener(type, () => setMove(direction, false));
    });
}

bindHoldButton(leftBtn, "left");
bindHoldButton(rightBtn, "right");

document.addEventListener("keydown", event => {
    if (!game.running) return;

    if (["ArrowLeft", "a", "A"].includes(event.key)) {
        game.moveLeft = true;
    }

    if (["ArrowRight", "d", "D"].includes(event.key)) {
        game.moveRight = true;
    }
});

document.addEventListener("keyup", event => {
    if (["ArrowLeft", "a", "A"].includes(event.key)) {
        game.moveLeft = false;
    }

    if (["ArrowRight", "d", "D"].includes(event.key)) {
        game.moveRight = false;
    }
});

window.addEventListener("blur", () => {
    game.moveLeft = false;
    game.moveRight = false;
});

window.addEventListener("resize", () => {
    const half = game.playerWidth / 2;
    const maxX = window.innerWidth - half;

    game.playerX = Math.max(half, Math.min(maxX, game.playerX));
    player.style.left = game.playerX + "px";
});

startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", startGame);
pickLevelBtn.addEventListener("click", openLevelMenu);

player.style.left = game.playerX + "px";
updateHUD();
initStars();