
/* =========================================================
   TOMBOLA STUDENTATO 1 — CHRISTMAS EDITION
   firebase-config.js

   Firebase project:
   tombola-studentato-1

   Database:
   Europe (europe-west1)

   Authentication:
   Anonymous Authentication
========================================================= */

import { initializeApp } from
    "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
    getDatabase,
    ref,
    get,
    set,
    update,
    remove,
    push,
    onValue,
    off,
    runTransaction,
    serverTimestamp
} from
    "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

import {
    getAuth,
    signInAnonymously,
    onAuthStateChanged
} from
    "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";


/* =========================================================
   1. FIREBASE CONFIGURATION
========================================================= */


/* Firebase configuration — Compat SDK */

window.firebaseConfig = {
    apiKey: "AIzaSyAoQ9KT25QMtKE0wFXwTCZ71DARdDJvsOE",
    authDomain: "tombola-studentato-1.firebaseapp.com",
    projectId: "tombola-studentato-1",
    storageBucket: "tombola-studentato-1.firebasestorage.app",
    messagingSenderId: "169251307885",
    appId: "1:169251307885:web:0150298ce78bfd9b2b9a64",
    databaseURL: "https://tombola-studentato-1-default-rtdb.europe-west1.firebasedatabase.app"
};



/* =========================================================
   2. INITIALIZE FIREBASE
========================================================= */

const firebaseApp = initializeApp(firebaseConfig);

const database = getDatabase(firebaseApp);

const auth = getAuth(firebaseApp);


/* =========================================================
   3. AUTHENTICATION
========================================================= */

let currentUser = null;

const authReady = new Promise((resolve, reject) => {

    const unsubscribe = onAuthStateChanged(
        auth,

        user => {
            if (user) {
                currentUser = user;
                unsubscribe();
                resolve(user);
            }
        },

        error => {
            unsubscribe();
            reject(error);
        }
    );
});


async function initializeAuthentication() {
    try {
        if (!auth.currentUser) {
            await signInAnonymously(auth);
        }

        currentUser = auth.currentUser;

        if (!currentUser) {
            currentUser = await authReady;
        }

        return currentUser;

    } catch (error) {
        console.error(
            "Firebase authentication failed:",
            error
        );

        throw error;
    }
}


/* =========================================================
   4. DATABASE REFERENCE HELPERS
========================================================= */

function databaseRef(path) {
    return ref(database, path);
}


function gameRef(gameCode) {
    return ref(database, `games/${gameCode}`);
}


function playerRef(gameCode, playerId) {
    return ref(
        database,
        `games/${gameCode}/players/${playerId}`
    );
}


function cardSelectionRef(gameCode, cardNumber) {
    return ref(
        database,
        `games/${gameCode}/takenCards/${cardNumber}`
    );
}


/* =========================================================
   5. DATABASE OPERATIONS
========================================================= */

async function databaseGet(path) {
    const snapshot = await get(databaseRef(path));

    return snapshot.exists()
        ? snapshot.val()
        : null;
}


async function databaseSet(path, value) {
    await set(databaseRef(path), value);
}


async function databaseUpdate(path, value) {
    await update(databaseRef(path), value);
}


async function databaseRemove(path) {
    await remove(databaseRef(path));
}


async function databasePush(path, value) {
    const newReference = push(databaseRef(path));

    await set(newReference, value);

    return newReference.key;
}


/* =========================================================
   6. REAL-TIME LISTENERS
========================================================= */

function listenToDatabase(path, callback) {
    const reference = databaseRef(path);

    const unsubscribe = onValue(
        reference,

        snapshot => {
            callback(
                snapshot.exists()
                    ? snapshot.val()
                    : null
            );
        },

        error => {
            console.error(
                "Realtime Database listener error:",
                error
            );
        }
    );

    return unsubscribe;
}


function stopDatabaseListener(path) {
    off(databaseRef(path));
}


/* =========================================================
   7. TRANSACTIONS
========================================================= */

async function databaseTransaction(path, updateFunction) {
    const result = await runTransaction(
        databaseRef(path),
        updateFunction
    );

    return {
        committed: result.committed,

        value: result.snapshot.exists()
            ? result.snapshot.val()
            : null
    };
}


/* =========================================================
   8. SERVER TIMESTAMP
========================================================= */

function getServerTimestamp() {
    return serverTimestamp();
}


/* =========================================================
   9. EXPORTS
========================================================= */

export {
    firebaseApp,
    database,
    auth,

    currentUser,
    authReady,
    initializeAuthentication,

    databaseRef,
    gameRef,
    playerRef,
    cardSelectionRef,

    databaseGet,
    databaseSet,
    databaseUpdate,
    databaseRemove,
    databasePush,

    listenToDatabase,
    stopDatabaseListener,

    databaseTransaction,
    getServerTimestamp
};
