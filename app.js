
/* =========================================================
   TOMBOLA STUDENTATO 1 — CHRISTMAS EDITION
   app.js

   Four independent sections:
   1. BALLS              Online host game
   2. PLAYER             Online player game
   3. MANUAL             Offline personal cards
   4. HOST NUMBER TABLE  Independent offline number tracker

   Firebase SDK: Compat 10.14.1
========================================================= */

"use strict";


/* =========================================================
   1. CONFIGURATION AND GLOBAL STATE
========================================================= */

const PRIZES = [
    { id: "ambo", name: "AMBO", amount: 2 },
    { id: "terna", name: "TERNA", amount: 3 },
    { id: "quaterna", name: "QUATERNA", amount: 4 },
    { id: "quintina", name: "QUINTINA", amount: 5 },
    { id: "tombola", name: "TOMBOLA", amount: 15 }
];

const TOTAL_NUMBERS = 90;
const TOTAL_CARDS = 100;
const CARDS_PER_PLAYER = 2;

const STORAGE_KEYS = {
    manualCards: "tombola_manual_cards",
    manualMarks: "tombola_manual_marks",
    tableMarks: "tombola_physical_table_marks",
    playerSession: "tombola_player_session",
    playerMarks: "tombola_player_marks"
};

let database = null;
let auth = null;
let currentUser = null;

let currentPage = "mainMenu";

let hostGameCode = null;
let hostGameData = null;
let hostGameListener = null;

let playerGameCode = null;
let playerData = null;
let playerId = null;
let playerSelectedCards = [];
let playerGameListener = null;

let manualSelectedCards = [];
let manualMarks = {};

let physicalTableMarks = [];
let physicalTableLatest = null;

let dialogCallback = null;
let toastTimeout = null;

let hostBusy = false;
let playerBusy = false;


/* =========================================================
   2. DOM HELPERS
========================================================= */

function $(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = $(id);

    if (element) {
        element.textContent = value;
    }
}

function show(element) {
    if (element) {
        element.hidden = false;
    }
}

function hide(element) {
    if (element) {
        element.hidden = true;
    }
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function randomCode(length = 6) {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let result = "";

    for (let i = 0; i < length; i++) {
        result += characters[
            Math.floor(Math.random() * characters.length)
        ];
    }

    return result;
}

function normalizeGameName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getCard(cardNumber) {
    if (
        typeof TOMBOLA_CARDS === "undefined" ||
        !Array.isArray(TOMBOLA_CARDS)
    ) {
        throw new Error("cards.js has not loaded correctly.");
    }

    return TOMBOLA_CARDS.find(
        card => Number(card.id) === Number(cardNumber)
    ) || null;
}

function getAllDrawnNumbers(game) {
    return Array.isArray(game?.drawnNumbers)
        ? game.drawnNumbers
        : [];
}

function getCurrentPrizeIndex(game) {
    const index = Number(game?.currentPrizeIndex ?? 0);

    return Math.max(0, Math.min(index, PRIZES.length));
}

function getCurrentPrize(game) {
    const index = getCurrentPrizeIndex(game);

    return index < PRIZES.length
        ? PRIZES[index]
        : null;
}

function getRemainingNumbers(game) {
    return TOTAL_NUMBERS - getAllDrawnNumbers(game).length;
}


/* =========================================================
   3. NAVIGATION
========================================================= */

function navigateTo(pageId) {
    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active");
    });

    const target = $(pageId);

    if (!target) {
        console.error("Page not found:", pageId);
        return;
    }

    target.classList.add("active");

    currentPage = pageId;

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function returnHome() {
    navigateTo("mainMenu");
}

function goBackFromHostSetup() {
    navigateTo("mainMenu");
}

function goBackFromPlayerJoin() {
    navigateTo("mainMenu");
}

function goBackFromCardSelection() {
    navigateTo("playerJoinPage");
}

function goBackFromManual() {
    navigateTo("mainMenu");
}

function goBackFromNumberTable() {
    navigateTo("mainMenu");
}

function goBackFromHostGame() {
    if (!hostGameCode) {
        returnHome();
        return;
    }

    showToast(
        "The host game is still active. End the game to close the room.",
        "warning"
    );
}


/* =========================================================
   4. TOAST NOTIFICATIONS
========================================================= */

function showToast(message, type = "info") {
    const container = $("toastContainer");

    if (!container) {
        alert(message);
        return;
    }

    const toast = document.createElement("div");

    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    clearTimeout(toastTimeout);

    setTimeout(() => {
        toast.classList.add("show");
    }, 10);

    setTimeout(() => {
        toast.classList.remove("show");

        setTimeout(() => toast.remove(), 300);
    }, 3500);
}


/* =========================================================
   5. CONFIRMATION DIALOG
========================================================= */

function showConfirmation({
    title = "Are you sure?",
    message = "Please confirm this action.",
    icon = "⚠️",
    confirmText = "Confirm",
    onConfirm = null
}) {
    const dialog = $("confirmationDialog");

    if (!dialog) {
        if (confirm(message) && onConfirm) {
            onConfirm();
        }

        return;
    }

    setText("dialogTitle", title);
    setText("dialogMessage", message);
    setText("dialogIcon", icon);
    setText("dialogConfirmButton", confirmText);

    dialogCallback = onConfirm;

    if (!dialog.open) {
        dialog.showModal();
    }
}

function closeConfirmation() {
    const dialog = $("confirmationDialog");

    if (dialog?.open) {
        dialog.close();
    }

    dialogCallback = null;
}


/* =========================================================
   6. FULLSCREEN
========================================================= */

async function toggleFullscreen() {
    try {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }
    } catch (error) {
        showToast("Fullscreen is not available.", "warning");
    }
}


/* =========================================================
   7. FIREBASE INITIALIZATION
========================================================= */

function initializeFirebase() {
    if (typeof firebase === "undefined") {
        console.error("Firebase SDK has not loaded.");

        showToast("Firebase could not be loaded.", "error");
        return false;
    }

    if (!window.firebaseConfig) {
        console.error(
            "window.firebaseConfig is missing. Check firebase-config.js."
        );

        showToast("Firebase configuration is missing.", "error");
        return false;
    }

    try {
        const app = firebase.apps.length
            ? firebase.app()
            : firebase.initializeApp(window.firebaseConfig);

        database = firebase.database(app);
        auth = firebase.auth(app);

        return true;

    } catch (error) {
        console.error("Firebase initialization error:", error);

        showToast("Could not initialize Firebase.", "error");
        return false;
    }
}


async function ensureAuthenticated() {
    if (!auth) {
        throw new Error("Firebase is not initialized.");
    }

    if (auth.currentUser) {
        currentUser = auth.currentUser;
        return currentUser;
    }

    const credential = await auth.signInAnonymously();

    currentUser = credential.user;

    return currentUser;
}


function requireDatabase() {
    if (!database || !currentUser) {
        throw new Error(
            "Please wait for Firebase authentication."
        );
    }
}


/* =========================================================
   8. FIREBASE PATHS
========================================================= */

function gamePath(code) {
    return `games/${code}`;
}

function playerPath(code, id) {
    return `games/${code}/players/${id}`;
}

function cardPath(code, number) {
    return `games/${code}/takenCards/${number}`;
}


/* =========================================================
   9. MAIN MENU EVENTS
========================================================= */

function initializeNavigation() {
    $("homeButton")?.addEventListener("click", () => {
        if (hostGameCode) {
            goBackFromHostGame();
        } else {
            returnHome();
        }
    });

    $("openBallsButton")?.addEventListener("click", () => {
        navigateTo("ballsSetupPage");
    });

    $("openPlayerButton")?.addEventListener("click", () => {
        navigateTo("playerJoinPage");
    });

    $("openManualButton")?.addEventListener("click", () => {
        openManualMode();
    });

    $("openNumberTableButton")?.addEventListener("click", () => {
        openPhysicalNumberTable();
    });

    $("ballsSetupBack")?.addEventListener(
        "click",
        goBackFromHostSetup
    );

    $("hostGameBack")?.addEventListener(
        "click",
        goBackFromHostGame
    );

    $("playerJoinBack")?.addEventListener(
        "click",
        goBackFromPlayerJoin
    );

    $("cardSelectionBack")?.addEventListener(
        "click",
        goBackFromCardSelection
    );

    $("manualBack")?.addEventListener(
        "click",
        goBackFromManual
    );

    $("numberTableBack")?.addEventListener(
        "click",
        goBackFromNumberTable
    );

    $("returnHomeButton")?.addEventListener("click", () => {
        hostGameCode = null;
        hostGameData = null;

        playerGameCode = null;
        playerData = null;
        playerId = null;

        clearPlayerSession();

        returnHome();
    });

    $("fullscreenButton")?.addEventListener(
        "click",
        toggleFullscreen
    );

    $("hostFullscreenButton")?.addEventListener(
        "click",
        toggleFullscreen
    );
}


/* =========================================================
   10. HOST — CREATE GAME
========================================================= */

async function createHostGame(event) {
    event.preventDefault();

    if (hostBusy) return;

    const name = $("hostGameName")?.value.trim();

    if (!name) {
        setText("hostSetupMessage", "Please enter a game name.");
        return;
    }

    if (name.length > 40) {
        setText("hostSetupMessage", "Game name is too long.");
        return;
    }

    hostBusy = true;

    const button = $("createGameButton");

    if (button) {
        button.disabled = true;
        button.textContent = "CREATING...";
    }

    try {
        requireDatabase();
        await ensureAuthenticated();

        const gamesSnapshot = await database.ref("games").once("value");

        const games = gamesSnapshot.val() || {};

        const normalizedName = normalizeGameName(name);

        const duplicate = Object.values(games).some(game =>
            game &&
            game.status === "active" &&
            normalizeGameName(game.name) === normalizedName
        );

        if (duplicate) {
            throw new Error(
                "An active game with this name already exists."
            );
        }

        let code = randomCode();

        while (games[code]) {
            code = randomCode();
        }

        const now = firebase.database.ServerValue.TIMESTAMP;

        const game = {
            code,
            name,
            normalizedName,
            status: "active",

            hostUid: currentUser.uid,

            createdAt: now,
            updatedAt: now,

            drawnNumbers: [],
            latestNumber: null,

            currentPrizeIndex: 0,
            winners: {},

            players: {},
            takenCards: {}
        };

        await database.ref(gamePath(code)).set(game);

        hostGameCode = code;
        hostGameData = game;

        listenToHostGame();

        navigateTo("ballsGamePage");

        showToast("Game created successfully!", "success");

    } catch (error) {
        console.error(error);

        setText(
            "hostSetupMessage",
            error.message || "Could not create the game."
        );

    } finally {
        hostBusy = false;

        if (button) {
            button.disabled = false;
            button.textContent = "CREATE GAME";
        }
    }
}


/* =========================================================
   11. HOST — REAL-TIME GAME LISTENER
========================================================= */

function listenToHostGame() {
    if (!hostGameCode || !database) return;

    if (hostGameListener) {
        hostGameListener();
    }

    hostGameListener = database
        .ref(gamePath(hostGameCode))
        .on("value", snapshot => {
            if (!snapshot.exists()) {
                showToast("This game no longer exists.", "error");

                hostGameCode = null;
                hostGameData = null;

                returnHome();
                return;
            }

            hostGameData = snapshot.val();

            if (hostGameData.status === "ended") {
                showGameEnded(
                    hostGameData,
                    "The host has ended this game."
                );

                return;
            }

            renderHostGame();
        }, error => {
            console.error("Host listener error:", error);
            showToast("Connection problem with the game.", "error");
        });
}


/* =========================================================
   12. HOST — RENDER GAME
========================================================= */

function renderHostGame() {
    const game = hostGameData;

    if (!game) return;

    setText("hostRoomName", game.name);
    setText("hostRoomCode", game.code);
    setText("hostInviteCode", game.code);

    const drawn = getAllDrawnNumbers(game);
    const players = Object.values(game.players || {});
    const currentPrize = getCurrentPrize(game);

    setText("hostPlayerCount", players.length);
    setText("hostDrawnCount", drawn.length);
    setText("hostRemainingCount", TOTAL_NUMBERS - drawn.length);

    setText(
        "hostCurrentPrize",
        currentPrize ? currentPrize.name : "FINISHED"
    );

    setText(
        "latestDrawNumber",
        game.latestNumber ?? "--"
    );

    renderNumberGrid(
        "hostNumberGrid",
        drawn,
        game.latestNumber,
        false
    );

    renderHostPrizeList(game);
    renderHostWinners(game);
    renderHostPlayerCards(game);
    renderQRCode(game.code);
}


/* =========================================================
   13. HOST — OFFICIAL NUMBER BOARD
========================================================= */

function renderNumberGrid(
    elementId,
    markedNumbers,
    latestNumber = null,
    interactive = false,
    callback = null
) {
    const container = $(elementId);

    if (!container) return;

    const marked = new Set(markedNumbers || []);

    let html = "";

    for (let number = 1; number <= 90; number++) {
        const isMarked = marked.has(number);
        const isLatest = Number(latestNumber) === number;

        const classes = [
            "number-cell",
            isMarked ? "drawn" : "",
            isLatest ? "latest" : ""
        ].filter(Boolean).join(" ");

        html += `
            <button
                type="button"
                class="${classes}"
                data-number="${number}"
                ${interactive ? "" : "disabled"}
                aria-label="Number ${number}${isMarked ? ", marked" : ""}"
                aria-pressed="${isMarked}"
            >${number}</button>
        `;
    }

    container.innerHTML = html;

    if (interactive && callback) {
        container.querySelectorAll("[data-number]").forEach(button => {
            button.addEventListener("click", () => {
                callback(Number(button.dataset.number));
            });
        });
    }
}


/* =========================================================
   14. HOST — DRAW NEXT NUMBER
========================================================= */

async function drawNextNumber() {
    if (hostBusy || !hostGameCode || !hostGameData) return;

    if (hostGameData.status !== "active") {
        showToast("This game is no longer active.", "warning");
        return;
    }

    const drawn = getAllDrawnNumbers(hostGameData);

    if (drawn.length >= TOTAL_NUMBERS) {
        showToast("All 90 numbers have been drawn.", "warning");
        return;
    }

    hostBusy = true;

    const drawButton = $("drawNextButton");
    const ball = $("rouletteBall");

    if (drawButton) drawButton.disabled = true;
    if (ball) ball.disabled = true;

    try {
        const gameReference = database.ref(gamePath(hostGameCode));

        const transaction = await gameReference.transaction(game => {
            if (!game || game.status !== "active") {
                return;
            }

            const currentDraws = game.drawnNumbers || [];

            if (currentDraws.length >= 90) {
                return;
            }

            const available = [];

            for (let n = 1; n <= 90; n++) {
                if (!currentDraws.includes(n)) {
                    available.push(n);
                }
            }

            const nextNumber = available[
                Math.floor(Math.random() * available.length)
            ];

            game.drawnNumbers = [
                ...currentDraws,
                nextNumber
            ];

            game.latestNumber = nextNumber;

            game.updatedAt =
                firebase.database.ServerValue.TIMESTAMP;

            return game;
        });

        if (!transaction.committed) {
            showToast("The number could not be drawn.", "error");
            return;
        }

        const updatedGame = transaction.snapshot.val();

        if (updatedGame) {
            await calculateAndSaveWinners(updatedGame);
        }

    } catch (error) {
        console.error("Draw error:", error);
        showToast("Could not draw the next number.", "error");

    } finally {
        hostBusy = false;

        if (drawButton) drawButton.disabled = false;
        if (ball) ball.disabled = false;
    }
}


/* =========================================================
   15. HOST — WINNER CALCULATION

   IMPORTANT:
   - Uses official drawn numbers only.
   - Does not use players' manual markings.
   - Checks every player's cards before advancing a prize.
   - Supports multiple winners on the same draw.
========================================================= */

function findWinnersForPrize(game, prize) {
    const drawn = new Set(getAllDrawnNumbers(game));
    const players = game.players || {};

    const winners = [];

    for (const [id, player] of Object.entries(players)) {
        if (!Array.isArray(player.cards)) continue;

        for (const cardNumber of player.cards) {
            const card = getCard(Number(cardNumber));

            if (!card) continue;

            if (prize.id === "tombola") {
                const complete = card.numbers.every(number =>
                    drawn.has(number)
                );

                if (complete) {
                    winners.push({
                        playerId: id,
                        playerName: player.name,
                        cardNumber: Number(cardNumber),
                        prize: prize.name
                    });
                }

                continue;
            }

            let won = false;

            for (const row of card.rows) {
                const rowNumbers = row.filter(
                    number => number !== null
                );

                const markedCount = rowNumbers.filter(number =>
                    drawn.has(number)
                ).length;

                if (markedCount >= prize.amount) {
                    won = true;
                    break;
                }
            }

            if (won) {
                winners.push({
                    playerId: id,
                    playerName: player.name,
                    cardNumber: Number(cardNumber),
                    prize: prize.name
                });
            }
        }
    }

    return winners;
}


async function calculateAndSaveWinners(game) {
    if (!hostGameCode || !game) return;

    const index = getCurrentPrizeIndex(game);

    if (index >= PRIZES.length) return;

    const prize = PRIZES[index];

    const winners = findWinnersForPrize(game, prize);

    if (winners.length === 0) return;

    const reference = database.ref(gamePath(hostGameCode));

    await reference.transaction(current => {
        if (!current || current.status !== "active") {
            return;
        }

        const currentIndex = getCurrentPrizeIndex(current);

        if (currentIndex !== index) {
            return;
        }

        const existingWinners = current.winners || {};

        if (existingWinners[prize.id]) {
            return;
        }

        /*
         * Recalculate inside the transaction from the latest
         * official draws and player cards.
         */

        const verifiedWinners = findWinnersForPrize(
            current,
            prize
        );

        if (verifiedWinners.length === 0) {
            return;
        }

        current.winners = {
            ...existingWinners,
            [prize.id]: {
                name: prize.name,
                drawNumber: current.latestNumber,
                players: verifiedWinners,
                timestamp:
                    firebase.database.ServerValue.TIMESTAMP
            }
        };

        current.currentPrizeIndex = index + 1;

        current.updatedAt =
            firebase.database.ServerValue.TIMESTAMP;

        return current;
    });
}


/* =========================================================
   16. HOST — PRIZE LIST
========================================================= */

function renderHostPrizeList(game) {
    const container = $("hostPrizeList");

    if (!container) return;

    const currentIndex = getCurrentPrizeIndex(game);
    const winners = game.winners || {};

    container.querySelectorAll(".prize-item").forEach(item => {
        const prizeId = item.dataset.prize;

        const index = PRIZES.findIndex(
            prize => prize.id === prizeId
        );

        const status = item.querySelector(".prize-status");

        item.classList.remove("active", "completed");

        if (winners[prizeId]) {
            item.classList.add("completed");

            if (status) {
                status.textContent = "WON";
            }

        } else if (index === currentIndex) {
            item.classList.add("active");

            if (status) {
                status.textContent = "CURRENT";
            }

        } else if (status) {
            status.textContent = "";
        }
    });
}


/* =========================================================
   17. HOST — WINNERS DISPLAY
========================================================= */

function renderHostWinners(game) {
    const container = $("hostWinnersList");

    if (!container) return;

    const winners = game.winners || {};

    const entries = PRIZES
        .filter(prize => winners[prize.id])
        .map(prize => ({
            prize,
            data: winners[prize.id]
        }));

    if (!entries.length) {
        container.innerHTML =
            '<p class="empty-state">No winners yet.</p>';

        return;
    }

    container.innerHTML = entries.map(({ prize, data }) => {
        const names = (data.players || []).map(winner => `
            <li>
                <strong>${escapeHTML(winner.playerName)}</strong>
                <span>Card #${winner.cardNumber}</span>
            </li>
        `).join("");

        return `
            <div class="winner-entry">
                <h4>🏆 ${prize.name}</h4>
                <ul>${names}</ul>
            </div>
        `;
    }).join("");
}


/* =========================================================
   18. HOST — PLAYER CARD OVERVIEW
========================================================= */

function renderHostPlayerCards(game) {
    const container = $("hostPlayerCardsGrid");

    if (!container) return;

    const players = Object.entries(game.players || {});

    if (!players.length) {
        container.innerHTML = `
            <div class="empty-state">
                Waiting for players to join...
            </div>
        `;

        return;
    }

    const drawn = new Set(getAllDrawnNumbers(game));

    container.innerHTML = players.map(([id, player]) => {
        const cardsHTML = (player.cards || []).map(cardNumber =>
            renderTombolaCard(cardNumber, drawn, null, false)
        ).join("");

        return `
            <article class="host-player-card">
                <div class="host-player-heading">
                    <strong>${escapeHTML(player.name)}</strong>
                    <span>${(player.cards || []).length} cards</span>
                </div>

                <div class="host-player-cards">
                    ${cardsHTML}
                </div>
            </article>
        `;
    }).join("");
}


/* =========================================================
   19. SHARED — RENDER TOM​BOLA CARD
========================================================= */

function renderTombolaCard(
    cardNumber,
    officialDraws = new Set(),
    manualMarksSet = null,
    interactive = false
) {
    const card = getCard(Number(cardNumber));

    if (!card) {
        return "";
    }

    const official = officialDraws instanceof Set
        ? officialDraws
        : new Set(officialDraws || []);

    const personal = manualMarksSet instanceof Set
        ? manualMarksSet
        : new Set(manualMarksSet || []);

    const cells = card.rows.map(row => {
        return row.map(number => {
            if (number === null) {
                return `<div class="tombola-cell empty"></div>`;
            }

            const isOfficial = official.has(number);
            const isPersonal = personal.has(number);

            const classes = [
                "tombola-cell",
                isOfficial ? "official-drawn" : "",
                isPersonal ? "marked" : ""
            ].filter(Boolean).join(" ");

            return `
                <button
                    type="button"
                    class="${classes}"
                    data-card="${cardNumber}"
                    data-number="${number}"
                    ${interactive ? "" : "disabled"}
                    aria-pressed="${isPersonal}"
                >${number}</button>
            `;
        }).join("");
    }).join("");

    return `
        <article class="tombola-card" data-card-number="${cardNumber}">
            <div class="tombola-card-header">
                <strong>CARD #${cardNumber}</strong>
            </div>

            <div class="tombola-card-grid">
                ${cells}
            </div>
        </article>
    `;
}


/* =========================================================
   20. HOST — QR CODE
========================================================= */

function renderQRCode(code) {
    const container = $("hostQRCode");

    if (!container) return;

    container.innerHTML = "";

    if (typeof QRCode === "undefined") {
        container.textContent = "QR unavailable";
        return;
    }

    const joinURL = new URL(
        window.location.href
    );

    joinURL.searchParams.set("game", code);

    new QRCode(container, {
        text: joinURL.toString(),
        width: 160,
        height: 160,
        colorDark: "#123c2b",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
}


/* =========================================================
   21. HOST — COPY INVITATION LINK
========================================================= */

async function copyInvitationLink() {
    if (!hostGameCode) return;

    const url = new URL(window.location.href);

    url.searchParams.set("game", hostGameCode);

    try {
        await navigator.clipboard.writeText(url.toString());

        showToast("Invitation link copied!", "success");

    } catch (error) {
        showToast("Could not copy the link.", "error");
    }
}


/* =========================================================
   22. HOST — END GAME
========================================================= */

function endHostGame() {
    if (!hostGameCode) return;

    showConfirmation({
        title: "End this game?",
        message:
            "All players will be notified. The room will no longer accept new players.",
        icon: "🏁",
        confirmText: "END GAME",

        onConfirm: async () => {
            try {
                await database.ref(gamePath(hostGameCode)).update({
                    status: "ended",
                    endedAt:
                        firebase.database.ServerValue.TIMESTAMP
                });

                showToast("Game ended.", "success");

            } catch (error) {
                console.error(error);
                showToast("Could not end the game.", "error");
            }
        }
    });
}


/* =========================================================
   23. HOST — RESET GAME
========================================================= */

function resetHostGame() {
    if (!hostGameCode) return;

    showConfirmation({
        title: "Reset the game?",
        message:
            "This will clear all drawn numbers and prize results. Players and their card reservations will remain.",
        icon: "↻",
        confirmText: "RESET GAME",

        onConfirm: async () => {
            try {
                await database.ref(gamePath(hostGameCode)).update({
                    drawnNumbers: [],
                    latestNumber: null,
                    currentPrizeIndex: 0,
                    winners: {},
                    updatedAt:
                        firebase.database.ServerValue.TIMESTAMP
                });

                showToast("Game reset.", "success");

            } catch (error) {
                console.error(error);
                showToast("Could not reset the game.", "error");
            }
        }
    });
}


/* =========================================================
   24. HOST — START NEW GAME
========================================================= */

function startNewHostGame() {
    showConfirmation({
        title: "Start a new game?",
        message:
            "The current game will be ended. You can create another room.",
        icon: "🎄",
        confirmText: "NEW GAME",

        onConfirm: async () => {
            try {
                if (hostGameCode) {
                    await database.ref(gamePath(hostGameCode)).update({
                        status: "ended",
                        endedAt:
                            firebase.database.ServerValue.TIMESTAMP
                    });
                }

                if (hostGameListener) {
                    database.ref(gamePath(hostGameCode))
                        .off("value", hostGameListener);

                    hostGameListener = null;
                }

                hostGameCode = null;
                hostGameData = null;

                $("hostGameName").value = "";

                navigateTo("ballsSetupPage");

            } catch (error) {
                console.error(error);
                showToast("Could not start a new game.", "error");
            }
        }
    });
}


/* =========================================================
   25. PLAYER — FIND GAME
========================================================= */

async function findGameByCodeOrName(value) {
    const search = String(value || "").trim();

    if (!search) return null;

    const snapshot = await database.ref("games").once("value");

    const games = snapshot.val() || {};

    const normalized = normalizeGameName(search);
    const upperCode = search.toUpperCase();

    for (const [code, game] of Object.entries(games)) {
        if (!game || game.status !== "active") continue;

        if (
            code.toUpperCase() === upperCode ||
            normalizeGameName(game.name) === normalized
        ) {
            return {
                code,
                game
            };
        }
    }

    return null;
}


/* =========================================================
   26. PLAYER — JOIN GAME
========================================================= */

async function joinGame(event) {
    event.preventDefault();

    if (playerBusy) return;

    const search = $("playerGameCode")?.value.trim();
    const name = $("playerName")?.value.trim();

    if (!search || !name) {
        setText("playerJoinMessage", "Complete all fields.");
        return;
    }

    playerBusy = true;

    const button = $("joinGameButton");

    if (button) {
        button.disabled = true;
        button.textContent = "JOINING...";
    }

    try {
        requireDatabase();
        await ensureAuthenticated();

        const result = await findGameByCodeOrName(search);

        if (!result) {
            throw new Error("No active game found with those details.");
        }

        const { code, game } = result;

        if (game.status !== "active") {
            throw new Error("This game has already ended.");
        }

        playerGameCode = code;
        playerData = game;
        playerId = currentUser.uid;

        const existingPlayer = game.players?.[playerId];

        if (existingPlayer) {
            if (existingPlayer.name !== name) {
                throw new Error(
                    "This device is already registered with another player name."
                );
            }

            playerSelectedCards = existingPlayer.cards || [];

            savePlayerSession();

            navigateTo("playerGamePage");

            listenToPlayerGame();

            return;
        }

        await database.ref(playerPath(code, playerId)).set({
            name,
            uid: currentUser.uid,
            cards: [],
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        });

        playerSelectedCards = [];

        savePlayerSession();

        setText("selectionPlayerName", name);
        setText("selectionGameName", game.name);

        await renderPlayerCardSelection();

        navigateTo("playerCardSelectionPage");

    } catch (error) {
        console.error(error);

        setText(
            "playerJoinMessage",
            error.message || "Could not join the game."
        );

    } finally {
        playerBusy = false;

        if (button) {
            button.disabled = false;
            button.textContent = "JOIN GAME";
        }
    }
}


/* =========================================================
   27. PLAYER — CARD SELECTION
========================================================= */

async function renderPlayerCardSelection() {
    const container = $("cardSelectionGrid");

    if (!container || !playerGameCode) return;

    const snapshot = await database
        .ref(`${gamePath(playerGameCode)}/takenCards`)
        .once("value");

    const takenCards = snapshot.val() || {};

    container.innerHTML = Array.from(
        { length: TOTAL_CARDS },
        (_, index) => {
            const number = index + 1;

            const reservation = takenCards[number];

            const isMine =
                reservation?.playerId === playerId;

            const isTaken =
                Boolean(reservation) && !isMine;

            const selected =
                playerSelectedCards.includes(number);

            const card = getCard(number);

            const preview = card
                ? card.rows.map(row => `
                    <div class="mini-card-row">
                        ${row.map(value =>
                            value === null
                                ? `<span class="mini-empty"></span>`
                                : `<span>${value}</span>`
                        ).join("")}
                    </div>
                `).join("")
                : "";

            return `
                <button
                    type="button"
                    class="card-choice
                        ${isTaken ? "taken" : ""}
                        ${selected ? "selected" : ""}"
                    data-card-number="${number}"
                    ${isTaken ? "disabled" : ""}
                >
                    <strong>CARD #${number}</strong>

                    <div class="mini-card">
                        ${preview}
                    </div>

                    <span class="card-choice-status">
                        ${isTaken
                            ? `TAKEN by ${escapeHTML(reservation.playerName || "Player")}`
                            : selected
                                ? "SELECTED"
                                : isMine
                                    ? "YOUR CARD"
                                    : "AVAILABLE"}
                    </span>
                </button>
            `;
        }
    ).join("");

    container.querySelectorAll("[data-card-number]").forEach(button => {
        button.addEventListener("click", () => {
            togglePlayerCardSelection(
                Number(button.dataset.cardNumber)
            );
        });
    });

    updatePlayerSelectionSummary();
}


function togglePlayerCardSelection(number) {
    if (playerSelectedCards.includes(number)) {
        playerSelectedCards =
            playerSelectedCards.filter(card => card !== number);

    } else {
        if (playerSelectedCards.length >= CARDS_PER_PLAYER) {
            showToast("You can select only two cards.", "warning");
            return;
        }

        playerSelectedCards.push(number);
    }

    playerSelectedCards.sort((a, b) => a - b);

    updatePlayerSelectionSummary();

    renderPlayerCardSelection();
}


function updatePlayerSelectionSummary() {
    const count = playerSelectedCards.length;

    setText("selectedCardCount", `${count} / 2`);

    setText(
        "selectedCardSummary",
        count
            ? `Selected cards: ${playerSelectedCards.map(n => `#${n}`).join(", ")}`
            : "No cards selected."
    );

    const button = $("confirmCardsButton");

    if (button) {
        button.disabled = count !== 2;
    }
}


/* =========================================================
   28. PLAYER — RESERVE TWO CARDS
   Uses a transaction on the room's card reservations.
========================================================= */

async function confirmPlayerCards() {
    if (
        playerSelectedCards.length !== 2 ||
        !playerGameCode ||
        !playerId
    ) {
        return;
    }

    const button = $("confirmCardsButton");

    if (button) {
        button.disabled = true;
        button.textContent = "RESERVING...";
    }

    try {
        const selected = [...playerSelectedCards];

        const takenReference = database.ref(
            `${gamePath(playerGameCode)}/takenCards`
        );

        const result = await takenReference.transaction(current => {
            current = current || {};

            const players = playerData?.players || {};

            const existingPlayer = players[playerId];

            for (const number of selected) {
                const reservation = current[number];

                if (
                    reservation &&
                    reservation.playerId !== playerId
                ) {
                    return;
                }
            }

            /*
             * Remove the player's old reservations before
             * writing the newly selected pair.
             */

            for (const [number, reservation] of Object.entries(current)) {
                if (reservation?.playerId === playerId) {
                    delete current[number];
                }
            }

            for (const number of selected) {
                current[number] = {
                    playerId,
                    playerName:
                        existingPlayer?.name ||
                        $("playerName")?.value.trim() ||
                        "Player"
                };
            }

            return current;
        });

        if (!result.committed) {
            throw new Error(
                "One or more cards have just been taken. Please choose again."
            );
        }

        await database.ref(playerPath(playerGameCode, playerId))
            .update({
                cards: selected,
                updatedAt: firebase.database.ServerValue.TIMESTAMP
            });

        playerSelectedCards = selected;

        savePlayerSession();

        initializePlayerMarks();

        listenToPlayerGame();

        navigateTo("playerGamePage");

        showToast("Your two cards are reserved!", "success");

    } catch (error) {
        console.error(error);

        setText(
            "cardSelectionMessage",
            error.message || "Could not reserve your cards."
        );

        await renderPlayerCardSelection();

    } finally {
        if (button) {
            button.disabled = playerSelectedCards.length !== 2;
            button.textContent = "CONFIRM TWO CARDS";
        }
    }
}


/* =========================================================
   29. PLAYER — SESSION STORAGE
========================================================= */

function savePlayerSession() {
    if (!playerGameCode || !playerId) return;

    localStorage.setItem(
        STORAGE_KEYS.playerSession,
        JSON.stringify({
            gameCode: playerGameCode,
            playerId,
            uid: currentUser?.uid || null
        })
    );
}


function clearPlayerSession() {
    localStorage.removeItem(STORAGE_KEYS.playerSession);

    playerGameCode = null;
    playerData = null;
    playerId = null;
    playerSelectedCards = [];
}


async function restorePlayerSession() {
    const saved = localStorage.getItem(
        STORAGE_KEYS.playerSession
    );

    if (!saved || !database) return;

    try {
        const session = JSON.parse(saved);

        await ensureAuthenticated();

        if (session.uid && session.uid !== currentUser.uid) {
            clearPlayerSession();
            return;
        }

        const snapshot = await database
            .ref(gamePath(session.gameCode))
            .once("value");

        if (!snapshot.exists()) {
            clearPlayerSession();
            return;
        }

        const game = snapshot.val();

        if (game.status !== "active") {
            clearPlayerSession();
            return;
        }

        const player = game.players?.[currentUser.uid];

        if (!player) {
            clearPlayerSession();
            return;
        }

        playerGameCode = session.gameCode;
        playerId = currentUser.uid;
        playerData = game;
        playerSelectedCards = player.cards || [];

        if (playerSelectedCards.length === 2) {
            initializePlayerMarks();
            listenToPlayerGame();
            navigateTo("playerGamePage");
        }

    } catch (error) {
        console.error("Could not restore player session:", error);
    }
}


/* =========================================================
   30. PLAYER — MANUAL MARK STORAGE
========================================================= */

function getPlayerMarksKey() {
    return `${STORAGE_KEYS.playerMarks}_${playerGameCode}_${playerId}`;
}


function initializePlayerMarks() {
    if (!playerGameCode || !playerId) return;

    const saved = localStorage.getItem(getPlayerMarksKey());

    if (!saved) return;

    try {
        playerMarks = JSON.parse(saved) || {};
    } catch {
        playerMarks = {};
    }
}

let playerMarks = {};


function savePlayerMarks() {
    if (!playerGameCode || !playerId) return;

    localStorage.setItem(
        getPlayerMarksKey(),
        JSON.stringify(playerMarks)
    );
}


/* =========================================================
   31. PLAYER — REAL-TIME GAME LISTENER
========================================================= */

function listenToPlayerGame() {
    if (!playerGameCode || !database) return;

    if (playerGameListener) {
        database.ref(gamePath(playerGameCode))
            .off("value", playerGameListener);

        playerGameListener = null;
    }

    const reference = database.ref(gamePath(playerGameCode));

    playerGameListener = reference.on("value", snapshot => {
        if (!snapshot.exists()) {
            showGameEnded(null, "The game room no longer exists.");
            return;
        }

        playerData = snapshot.val();

        if (playerData.status === "ended") {
            showGameEnded(
                playerData,
                "The host has ended this game."
            );

            return;
        }

        const player = playerData.players?.[playerId];

        if (!player) {
            showGameEnded(
                playerData,
                "Your player registration is no longer available."
            );

            return;
        }

        playerSelectedCards = player.cards || [];

        renderPlayerGame();

    }, error => {
        console.error("Player listener error:", error);
        showToast("Connection problem.", "error");
    });
}


/* =========================================================
   32. PLAYER — RENDER ACTIVE GAME
========================================================= */

function renderPlayerGame() {
    const game = playerData;

    if (!game) return;

    const player = game.players?.[playerId];

    if (!player) return;

    const drawn = getAllDrawnNumbers(game);
    const currentPrize = getCurrentPrize(game);

    setText("playerGameTitle", game.name);
    setText("activePlayerName", player.name);
    setText("playerRoomCode", game.code);

    setText(
        "playerLatestBall",
        game.latestNumber ?? "--"
    );

    setText("playerDrawnCount", drawn.length);
    setText("playerRemainingCount", 90 - drawn.length);

    setText(
        "playerCurrentPrize",
        currentPrize ? currentPrize.name : "FINISHED"
    );

    setText("playerHistoryCount", `${drawn.length} numbers`);

    renderPlayerWinners(game);
    renderPlayerHistory(drawn);
    renderPlayerCards(game, player);
}


function renderPlayerWinners(game) {
    const container = $("playerWinnersList");

    if (!container) return;

    const winners = game.winners || {};

    const entries = PRIZES.filter(
        prize => winners[prize.id]
    );

    if (!entries.length) {
        container.innerHTML = "<p>No winners yet.</p>";
        return;
    }

    container.innerHTML = entries.map(prize => {
        const names = (winners[prize.id].players || [])
            .map(winner => escapeHTML(winner.playerName))
            .join(", ");

        return `
            <div class="player-winner-entry">
                <strong>${prize.name}</strong>
                <span>${names}</span>
            </div>
        `;
    }).join("");
}


function renderPlayerHistory(numbers) {
    const container = $("playerDrawHistory");

    if (!container) return;

    if (!numbers.length) {
        container.innerHTML =
            '<p class="empty-state">No numbers drawn yet.</p>';

        return;
    }

    container.innerHTML = [...numbers].reverse().map(number => `
        <span class="history-number ${number === numbers[numbers.length - 1] ? "latest" : ""}">
            ${number}
        </span>
    `).join("");
}


function renderPlayerCards(game, player) {
    const container = $("playerPersonalCardsGrid");

    if (!container) return;

    const official = new Set(getAllDrawnNumbers(game));

    container.innerHTML = (player.cards || []).map(cardNumber => {
        const marks = new Set(
            playerMarks[cardNumber] || []
        );

        return renderTombolaCard(
            cardNumber,
            official,
            marks,
            true
        );
    }).join("");

    container.querySelectorAll(
        ".tombola-cell[data-number]"
    ).forEach(button => {
        button.addEventListener("click", () => {
            togglePlayerMark(
                Number(button.dataset.card),
                Number(button.dataset.number)
            );
        });
    });
}


/* =========================================================
   33. PLAYER — MANUAL MARKING
   These marks are stored locally.
   They are NOT written to Firebase.
========================================================= */

function togglePlayerMark(cardNumber, number) {
    if (!playerMarks[cardNumber]) {
        playerMarks[cardNumber] = [];
    }

    const marks = playerMarks[cardNumber];

    if (marks.includes(number)) {
        playerMarks[cardNumber] = marks.filter(
            value => value !== number
        );
    } else {
        marks.push(number);
    }

    savePlayerMarks();

    if (playerData) {
        renderPlayerCards(
            playerData,
            playerData.players[playerId]
        );
    }
}


/* =========================================================
   34. PLAYER — LEAVE GAME
========================================================= */

function leavePlayerGame() {
    showConfirmation({
        title: "Leave this game?",
        message:
            "Your cards will be released and another player may select them.",
        icon: "🚪",
        confirmText: "LEAVE GAME",

        onConfirm: async () => {
            try {
                if (playerGameListener) {
                    database.ref(gamePath(playerGameCode))
                        .off("value", playerGameListener);

                    playerGameListener = null;
                }

                const reference = database.ref(
                    `${gamePath(playerGameCode)}/takenCards`
                );

                await reference.transaction(current => {
                    current = current || {};

                    for (const [number, reservation] of Object.entries(current)) {
                        if (reservation?.playerId === playerId) {
                            delete current[number];
                        }
                    }

                    return current;
                });

                await database.ref(
                    playerPath(playerGameCode, playerId)
                ).remove();

                clearPlayerSession();

                returnHome();

                showToast("You have left the game.", "success");

            } catch (error) {
                console.error(error);
                showToast("Could not leave the game.", "error");
            }
        }
    });
}


/* =========================================================
   35. GAME ENDED PAGE
========================================================= */

function showGameEnded(game, message) {
    if (playerGameListener && playerGameCode) {
        database.ref(gamePath(playerGameCode))
            .off("value", playerGameListener);

        playerGameListener = null;
    }

    if (hostGameListener && hostGameCode) {
        database.ref(gamePath(hostGameCode))
            .off("value", hostGameListener);

        hostGameListener = null;
    }

    setText("gameEndedMessage", message);

    const container = $("finalWinnersList");

    if (container) {
        const winners = game?.winners || {};

        container.innerHTML = PRIZES
            .filter(prize => winners[prize.id])
            .map(prize => {
                const names = (winners[prize.id].players || [])
                    .map(winner => `
                        <li>${escapeHTML(winner.playerName)}</li>
                    `)
                    .join("");

                return `
                    <div class="final-winner-entry">
                        <h3>🏆 ${prize.name}</h3>
                        <ul>${names}</ul>
                    </div>
                `;
            }).join("");
    }

    clearPlayerSession();

    navigateTo("gameEndedPage");
}


/* =========================================================
   36. MANUAL MODE — OPEN
========================================================= */

function openManualMode() {
    loadManualStorage();

    navigateTo("manualPage");

    renderManualMode();
}


function loadManualStorage() {
    try {
        manualSelectedCards = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.manualCards)
        ) || [];

        manualMarks = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.manualMarks)
        ) || {};

    } catch {
        manualSelectedCards = [];
        manualMarks = {};
    }
}


function saveManualStorage() {
    localStorage.setItem(
        STORAGE_KEYS.manualCards,
        JSON.stringify(manualSelectedCards)
    );

    localStorage.setItem(
        STORAGE_KEYS.manualMarks,
        JSON.stringify(manualMarks)
    );
}


/* =========================================================
   37. MANUAL MODE — CARD SELECTOR
========================================================= */

function renderManualMode() {
    setText(
        "manualCardCount",
        `${manualSelectedCards.length} / 2`
    );

    const selectionArea = $("manualCardSelectionArea");
    const cardsArea = $("manualCardsArea");

    if (manualSelectedCards.length === 2) {
        hide(selectionArea);
        show(cardsArea);

        renderManualCards();

    } else {
        show(selectionArea);
        hide(cardsArea);

        renderManualCardSelection();
    }
}


function renderManualCardSelection() {
    const container = $("manualCardSelectionGrid");

    if (!container) return;

    container.innerHTML = Array.from(
        { length: 100 },
        (_, index) => {
            const number = index + 1;
            const card = getCard(number);

            const selected =
                manualSelectedCards.includes(number);

            const preview = card.rows.map(row => `
                <div class="mini-card-row">
                    ${row.map(value =>
                        value === null
                            ? `<span class="mini-empty"></span>`
                            : `<span>${value}</span>`
                    ).join("")}
                </div>
            `).join("");

            return `
                <button
                    type="button"
                    class="card-choice ${selected ? "selected" : ""}"
                    data-manual-card="${number}"
                >
                    <strong>CARD #${number}</strong>

                    <div class="mini-card">${preview}</div>

                    <span>
                        ${selected ? "SELECTED" : "AVAILABLE"}
                    </span>
                </button>
            `;
        }
    ).join("");

    container.querySelectorAll("[data-manual-card]").forEach(button => {
        button.addEventListener("click", () => {
            toggleManualCard(
                Number(button.dataset.manualCard)
            );
        });
    });

    setText(
        "manualSelectedCardSummary",
        manualSelectedCards.length
            ? `Selected: ${manualSelectedCards.map(n => `#${n}`).join(", ")}`
            : "No cards selected."
    );

    const confirmButton = $("manualConfirmCardsButton");

    if (confirmButton) {
        confirmButton.disabled =
            manualSelectedCards.length !== 2;
    }
}


function toggleManualCard(number) {
    if (manualSelectedCards.includes(number)) {
        manualSelectedCards =
            manualSelectedCards.filter(n => n !== number);

    } else {
        if (manualSelectedCards.length >= 2) {
            showToast("Choose only two cards.", "warning");
            return;
        }

        manualSelectedCards.push(number);
    }

    manualSelectedCards.sort((a, b) => a - b);

    renderManualCardSelection();
}


/* =========================================================
   38. MANUAL MODE — CONFIRM CARDS
========================================================= */

function confirmManualCards() {
    if (manualSelectedCards.length !== 2) return;

    manualMarks = {};

    manualSelectedCards.forEach(number => {
        manualMarks[number] = [];
    });

    saveManualStorage();

    renderManualMode();

    showToast("Your two cards are ready!", "success");
}


/* =========================================================
   39. MANUAL MODE — RENDER CARDS
========================================================= */

function renderManualCards() {
    const container = $("manualPersonalCardsGrid");

    if (!container) return;

    container.innerHTML = manualSelectedCards.map(cardNumber => {
        const marks = new Set(manualMarks[cardNumber] || []);

        return renderTombolaCard(
            cardNumber,
            new Set(),
            marks,
            true
        );
    }).join("");

    container.querySelectorAll(
        ".tombola-cell[data-number]"
    ).forEach(button => {
        button.addEventListener("click", () => {
            toggleManualMark(
                Number(button.dataset.card),
                Number(button.dataset.number)
            );
        });
    });
}


function toggleManualMark(cardNumber, number) {
    if (!manualMarks[cardNumber]) {
        manualMarks[cardNumber] = [];
    }

    const marks = manualMarks[cardNumber];

    if (marks.includes(number)) {
        manualMarks[cardNumber] = marks.filter(
            value => value !== number
        );
    } else {
        marks.push(number);
    }

    saveManualStorage();
    renderManualCards();
}


/* =========================================================
   40. MANUAL MODE — CLEAR MARKS
========================================================= */

function clearManualMarks() {
    showConfirmation({
        title: "Clear all marks?",
        message: "All personal marks on your two cards will be removed.",
        icon: "↻",
        confirmText: "CLEAR MARKS",

        onConfirm: () => {
            manualMarks = {};

            manualSelectedCards.forEach(number => {
                manualMarks[number] = [];
            });

            saveManualStorage();
            renderManualCards();

            showToast("All marks cleared.", "success");
        }
    });
}


/* =========================================================
   41. MANUAL MODE — CHANGE CARDS
========================================================= */

function changeManualCards() {
    showConfirmation({
        title: "Change your cards?",
        message:
            "Your current card selections and personal marks will be cleared.",
        icon: "🃏",
        confirmText: "CHANGE CARDS",

        onConfirm: () => {
            manualSelectedCards = [];
            manualMarks = {};

            saveManualStorage();

            renderManualMode();
        }
    });
}


/* =========================================================
   42. HOST NUMBER TABLE — OFFLINE STORAGE

   This section is intentionally independent:
   - No Firebase calls.
   - No game room.
   - No online player.
   - No official online draw.
========================================================= */

function loadPhysicalTableStorage() {
    try {
        physicalTableMarks = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.tableMarks)
        ) || [];
    } catch {
        physicalTableMarks = [];
    }

    physicalTableMarks = physicalTableMarks
        .filter(number =>
            Number.isInteger(number) &&
            number >= 1 &&
            number <= 90
        );

    physicalTableLatest =
        physicalTableMarks.length
            ? physicalTableMarks[physicalTableMarks.length - 1]
            : null;
}


function savePhysicalTableStorage() {
    localStorage.setItem(
        STORAGE_KEYS.tableMarks,
        JSON.stringify(physicalTableMarks)
    );
}


/* =========================================================
   43. HOST NUMBER TABLE — OPEN
========================================================= */

function openPhysicalNumberTable() {
    loadPhysicalTableStorage();

    navigateTo("hostNumberTablePage");

    renderPhysicalNumberTable();
}


/* =========================================================
   44. HOST NUMBER TABLE — RENDER
========================================================= */

function renderPhysicalNumberTable() {
    const markedCount = physicalTableMarks.length;

    setText(
        "tableLatestNumber",
        physicalTableLatest ?? "--"
    );

    setText("tableMarkedCount", markedCount);
    setText("tableRemainingCount", 90 - markedCount);
    setText("tableHistoryCount", `${markedCount} numbers`);

    renderNumberGrid(
        "hostManualNumberGrid",
        physicalTableMarks,
        physicalTableLatest,
        true,
        togglePhysicalTableNumber
    );

    renderPhysicalTableHistory();
}


/* =========================================================
   45. HOST NUMBER TABLE — MARK / UNMARK
========================================================= */

function togglePhysicalTableNumber(number) {
    if (physicalTableMarks.includes(number)) {
        physicalTableMarks =
            physicalTableMarks.filter(value => value !== number);

    } else {
        physicalTableMarks.push(number);
    }

    physicalTableLatest =
        physicalTableMarks.length
            ? physicalTableMarks[physicalTableMarks.length - 1]
            : null;

    savePhysicalTableStorage();

    renderPhysicalNumberTable();
}


/* =========================================================
   46. HOST NUMBER TABLE — HISTORY
========================================================= */

function renderPhysicalTableHistory() {
    const container = $("tableDrawHistory");

    if (!container) return;

    if (!physicalTableMarks.length) {
        container.innerHTML = `
            <p class="empty-state">No numbers marked yet.</p>
        `;

        return;
    }

    container.innerHTML = [...physicalTableMarks]
        .reverse()
        .map((number, index) => `
            <span class="history-number ${index === 0 ? "latest" : ""}">
                ${number}
            </span>
        `)
        .join("");
}


/* =========================================================
   47. HOST NUMBER TABLE — CLEAR
========================================================= */

function clearPhysicalNumberTable() {
    showConfirmation({
        title: "Clear the number table?",
        message:
            "All manually recorded numbers will be removed. This does not affect any online game.",
        icon: "↻",
        confirmText: "CLEAR TABLE",

        onConfirm: () => {
            physicalTableMarks = [];
            physicalTableLatest = null;

            savePhysicalTableStorage();

            renderPhysicalNumberTable();

            showToast("Number table cleared.", "success");
        }
    });
}


/* =========================================================
   48. URL — AUTOMATIC GAME CODE
========================================================= */

function readGameCodeFromURL() {
    const parameters = new URLSearchParams(
        window.location.search
    );

    return parameters.get("game");
}


function applyGameCodeFromURL() {
    const code = readGameCodeFromURL();

    if (!code) return;

    $("playerGameCode").value = code;

    navigateTo("playerJoinPage");
}


/* =========================================================
   49. EVENT LISTENERS
========================================================= */

function initializeEvents() {
    initializeNavigation();

    $("createGameForm")?.addEventListener(
        "submit",
        createHostGame
    );

    $("drawNextButton")?.addEventListener(
        "click",
        drawNextNumber
    );

    $("rouletteBall")?.addEventListener(
        "click",
        drawNextNumber
    );

    $("endGameButton")?.addEventListener(
        "click",
        endHostGame
    );

    $("hostResetGameButton")?.addEventListener(
        "click",
        resetHostGame
    );

    $("hostNewGameButton")?.addEventListener(
        "click",
        startNewHostGame
    );

    $("copyInviteLinkButton")?.addEventListener(
        "click",
        copyInvitationLink
    );

    $("joinGameForm")?.addEventListener(
        "submit",
        joinGame
    );

    $("confirmCardsButton")?.addEventListener(
        "click",
        confirmPlayerCards
    );

    $("playerLeaveGameButton")?.addEventListener(
        "click",
        leavePlayerGame
    );

    $("manualConfirmCardsButton")?.addEventListener(
        "click",
        confirmManualCards
    );

    $("manualChangeCardsButton")?.addEventListener(
        "click",
        changeManualCards
    );

    $("manualChangeCardsButtonBottom")?.addEventListener(
        "click",
        changeManualCards
    );

    $("manualClearMarksButton")?.addEventListener(
        "click",
        clearManualMarks
    );

    $("manualClearMarksButtonBottom")?.addEventListener(
        "click",
        clearManualMarks
    );

    $("clearNumberTableButton")?.addEventListener(
        "click",
        clearPhysicalNumberTable
    );

    $("dialogCancelButton")?.addEventListener(
        "click",
        closeConfirmation
    );

    $("dialogConfirmButton")?.addEventListener("click", () => {
        const callback = dialogCallback;

        closeConfirmation();

        if (callback) {
            callback();
        }
    });
}


/* =========================================================
   50. APPLICATION STARTUP
========================================================= */

async function initializeApplication() {
    initializeEvents();

    loadManualStorage();
    loadPhysicalTableStorage();

    if (!initializeFirebase()) {
        /*
         * Offline features remain available even if Firebase
         * is unavailable.
         */
        showToast(
            "Offline features are available. Online games need Firebase.",
            "warning"
        );

        return;
    }

    try {
        await ensureAuthenticated();

        console.info(
            "Tombola Studentato 1 connected to Firebase."
        );

        await restorePlayerSession();

        if (currentPage === "mainMenu") {
            applyGameCodeFromURL();
        }

    } catch (error) {
        console.error("Application startup error:", error);

        showToast(
            "Online connection unavailable. Offline modes still work.",
            "warning"
        );
    }
}


/* =========================================================
   51. START
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    initializeApplication();
});
