
/* =========================================================
   TOMBOLA STUDENTATO 1 — CHRISTMAS EDITION
   app.js

   Four independent sections:
   1. BALLS              Online host game
   2. PLAYER             Online player game
   3. MANUAL             Offline personal cards
   4. HOST NUMBER TABLE  Independent offline number tracker

   Firebase SDK: Compat 10.14.1
   Corrected: atomic room/card updates, scoped room lookup,
   offline storage guards, and physical-table data validation.
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

