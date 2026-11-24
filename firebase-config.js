
/* =========================================================
   TOMBOLA STUDENTATO 1 — CHRISTMAS EDITION
   firebase-config.js

   Firebase project:
   tombola-studentato-1

   Database:
   Europe (europe-west1)

   Authentication:
   Anonymous Authentication

   SDK:
   Firebase 11.10.0
========================================================= */


/* =========================================================
   1. FIREBASE IMPORTS
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
   2. FIREBASE CONFIGURATION
========================================================= */

const firebaseConfig = {

    apiKey: "AIzaSyAoQ9KT25QMtKE0wFXwTCZ71DARdDJvsOE",

    authDomain: "tombola-studentato-1.firebaseapp.com",

    databaseURL:
        "https://tombola-studentato-1-default-rtdb.europe-west1.firebasedatabase.app",

    projectId: "tombola-studentato-1",

    storageBucket:
        "tombola-studentato-1.firebasestorage.app",

    messagingSenderId: "169251307885",

    appId: "1:169251307885:web:0150298ce78bfd9b2b9a64"

};

// Optional global access for other scripts
window.firebaseConfig = firebaseConfig;


/* =========================================================
   3. INITIALIZE FIREBASE
========================================================= */

const firebaseApp = initializeApp(firebaseConfig);

const database = getDatabase(firebaseApp);

const auth = getAuth(firebaseApp);


/* =========================================================
   4. AUTHENTICATION
========================================================= */

let currentUser = null;

let authInitializationStarted = false;

let unsubscribeAuth = () => {};

const authReady = new Promise((resolve, reject) => {

    unsubscribeAuth = onAuthStateChanged(

        auth,

        async user => {

            // Existing authenticated user
            if (user) {

                currentUser = user;

                unsubscribeAuth();

                resolve(user);

                return;
            }

            // Avoid starting authentication more than once
            if (authInitializationStarted) {
                return;
            }

            authInitializationStarted = true;

            try {

                const credential = await signInAnonymously(auth);

                currentUser = credential.user;

                unsubscribeAuth();

                resolve(currentUser);

            } catch (error) {

                unsubscribeAuth();

                console.error(
                    "Firebase authentication failed:",
                    error
                );

                reject(error);
            }
        },

        error => {

            unsubscribeAuth();

            console.error(
                "Firebase authentication error:",
                error
            );

            reject(error);
        }
    );

});


async function initializeAuthentication() {

    return await authReady;

}


/* =========================================================
   5. DATABASE REFERENCE HELPERS
========================================================= */

function databaseRef(path) {

    return ref(database, path);

}


function gameRef(gameCode) {

    return ref(
        database,
        `games/${gameCode}`
    );

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
   6. DATABASE OPERATIONS
========================================================= */

async function databaseGet(path) {

    await authReady;

    const snapshot = await get(databaseRef(path));

    return snapshot.exists()
        ? snapshot.val()
        : null;

}


async function databaseSet(path, value) {

    await authReady;

    await set(databaseRef(path), value);

}


async function databaseUpdate(path, value) {

    await authReady;

    await update(databaseRef(path), value);

}


async function databaseRemove(path) {

    await authReady;

    await remove(databaseRef(path));

}


async function databasePush(path, value) {

    await authReady;

    const newReference = push(databaseRef(path));

    await set(newReference, value);

    return newReference.key;

}


/* =========================================================
   7. REAL-TIME DATABASE LISTENERS
========================================================= */

function listenToDatabase(path, callback) {

    const reference = databaseRef(path);

    return onValue(

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

}


// Stops all value listeners attached to this path.
// Prefer the unsubscribe function returned by
// listenToDatabase() when stopping an individual listener.

function stopDatabaseListener(path) {

    off(databaseRef(path), "value");

}


/* =========================================================
   8. DATABASE TRANSACTIONS
========================================================= */

async function databaseTransaction(path, updateFunction) {

    await authReady;

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
   9. SERVER TIMESTAMP
========================================================= */

function getServerTimestamp() {

    return serverTimestamp();

}


/* =========================================================
   10. EXPORTS
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
