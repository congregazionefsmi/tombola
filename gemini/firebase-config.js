
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
   Firebase Compat 10.14.1
========================================================= */

"use strict";


/* =========================================================
   1. FIREBASE CONFIGURATION
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

    appId: "1:169251307885:web:0150298ce78bfd9b2a64"

};

window.firebaseConfig = firebaseConfig;


/* =========================================================
   2. INITIALIZE FIREBASE
========================================================= */

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}


/* =========================================================
   3. FIREBASE SERVICES
========================================================= */

const database = firebase.database();

const auth = firebase.auth();


/* =========================================================
   4. AUTHENTICATION
========================================================= */

let currentUser = null;

let authInitializationPromise = null;


function initializeAuthentication() {

    if (authInitializationPromise) {
        return authInitializationPromise;
    }

    authInitializationPromise = new Promise(
        (resolve, reject) => {

            const unsubscribe = auth.onAuthStateChanged(

                async user => {

                    try {

                        if (user) {

                            currentUser = user;

                            unsubscribe();

                            resolve(user);

                            return;
                        }

                        const credential =
                            await auth.signInAnonymously();

                        currentUser = credential.user;

                        unsubscribe();

                        resolve(currentUser);

                    } catch (error) {

                        unsubscribe();

                        console.error(
                            "Firebase authentication failed:",
                            error
                        );

                        reject(error);
                    }

                },

                error => {

                    unsubscribe();

                    console.error(
                        "Firebase authentication error:",
                        error
                    );

                    reject(error);
                }

            );

        }
    );

    return authInitializationPromise;

}


const authReady = initializeAuthentication();


/* =========================================================
   5. DATABASE REFERENCE HELPERS
========================================================= */

function databaseRef(path) {

    return database.ref(path);

}


function gameRef(gameCode) {

    return database.ref(`games/${gameCode}`);

}


function playerRef(gameCode, playerId) {

    return database.ref(
        `games/${gameCode}/players/${playerId}`
    );

}


function cardSelectionRef(gameCode, cardNumber) {

    return database.ref(
        `games/${gameCode}/takenCards/${cardNumber}`
    );

}


/* =========================================================
   6. DATABASE OPERATIONS
========================================================= */

async function databaseGet(path) {

    await authReady;

    const snapshot = await database.ref(path).once("value");

    return snapshot.exists()
        ? snapshot.val()
        : null;

}


async function databaseSet(path, value) {

    await authReady;

    await database.ref(path).set(value);

}


async function databaseUpdate(path, value) {

    await authReady;

    await database.ref(path).update(value);

}


async function databaseRemove(path) {

    await authReady;

    await database.ref(path).remove();

}


async function databasePush(path, value) {

    await authReady;

    const newReference = database.ref(path).push();

    await newReference.set(value);

    return newReference.key;

}


/* =========================================================
   7. REAL-TIME DATABASE LISTENERS
========================================================= */

function listenToDatabase(path, callback) {

    const reference = database.ref(path);

    const listener = snapshot => {

        callback(
            snapshot.exists()
                ? snapshot.val()
                : null
        );

    };

    const errorListener = error => {

        console.error(
            "Realtime Database listener error:",
            error
        );

    };

    reference.on("value", listener, errorListener);

    // Return an individual unsubscribe function.
    return () => {

        reference.off("value", listener);

    };

}


function stopDatabaseListener(path) {

    database.ref(path).off("value");

}


/* =========================================================
   8. DATABASE TRANSACTIONS
========================================================= */

async function databaseTransaction(path, updateFunction) {

    await authReady;

    const result = await database.ref(path).transaction(
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

    return firebase.database.ServerValue.TIMESTAMP;

}


/* =========================================================
   10. EXPORTS
========================================================= */

window.TombolaFirebase = {

    firebaseApp: firebase.app(),

    database,

    auth,

    get currentUser() {
        return currentUser;
    },

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
