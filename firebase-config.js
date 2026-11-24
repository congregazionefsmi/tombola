/**
 * firebase-config.js
 * Real-time game sync adapter for "Tombola Studentato 1 - Christmas Edition".
 * - Uses Firebase Realtime Database when FIREBASE_CONFIG is populated.
 * - Falls back seamlessly to a localStorage + BroadcastChannel store if unconfigured,
 *   allowing immediate local multi-tab testing before hooking up a live Firebase project.
 */

(function (global) {
  "use strict";

  // Replace these placeholder values with your own Firebase Realtime Database config
  // from the Firebase Console -> Project Settings -> Your apps -> Web app.
  const FIREBASE_CONFIG = {
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  };

  const LOCAL_DB_KEY = "studentato1_tombola_local_db_v1";
  const CHANNEL_NAME = "studentato1_tombola_sync_v1";

  const PRIZE_STAGES = ["AMBO", "TERNA", "QUATERNA", "QUINTINA", "TOMBOLA"];

  function isFirebaseConfigured() {
    return Boolean(
      FIREBASE_CONFIG &&
        typeof FIREBASE_CONFIG.databaseURL === "string" &&
        FIREBASE_CONFIG.databaseURL.trim().length > 0 &&
        FIREBASE_CONFIG.apiKey &&
        FIREBASE_CONFIG.apiKey.trim().length > 0
    );
  }

  function normalizeCode(code) {
    return String(code || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "-");
  }

  function createEmptyGameRecord(code) {
    return {
      code,
      status: "active", // "active" | "ended"
      createdAt: Date.now(),
      drawnNumbers: [],
      currentStageIndex: 0, // 0=AMBO, 1=TERNA, 2=QUATERNA, 3=QUINTINA, 4=TOMBOLA
      winners: {
        AMBO: [],
        TERNA: [],
        QUATERNA: [],
        QUINTINA: [],
        TOMBOLA: []
      },
      players: {} // { [playerId]: { id, name, cards: [cardId1, cardId2], joinedAt } }
    };
  }

  // =========================================================================
  // Local Storage + BroadcastChannel Fallback Store (Instant Testing)
  // =========================================================================
  const localStore = (function () {
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;
    const subscribers = new Map(); // code -> Set<callback>

    function readDb() {
      try {
        const raw = localStorage.getItem(LOCAL_DB_KEY);
        return raw ? JSON.parse(raw) : { games: {} };
      } catch (err) {
        return { games: {} };
      }
    }

    function writeDb(db) {
      localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
      if (channel) {
        channel.postMessage({ type: "DB_UPDATED", timestamp: Date.now() });
      }
    }

    function notifyCode(code) {
      const db = readDb();
      const game = db.games[code] || null;
      const callbacks = subscribers.get(code);
      if (callbacks) {
        callbacks.forEach((cb) => cb(game));
      }
    }

    function notifyAll() {
      subscribers.forEach((_, code) => notifyCode(code));
    }

    if (channel) {
      channel.onmessage = function () {
        notifyAll();
      };
    }

    window.addEventListener("storage", function (e) {
      if (e.key === LOCAL_DB_KEY) {
        notifyAll();
      }
    });

    return {
      async createGame(rawCode) {
        const code = normalizeCode(rawCode);
        if (!code) {
          return { ok: false, error: "Please enter a valid Game Name or Code." };
        }
        const db = readDb();
        const existing = db.games[code];
        if (existing && existing.status === "active") {
          return {
            ok: false,
            error: `Game code "${code}" is already active. Choose a unique name or end the active game first.`
          };
        }
        const game = createEmptyGameRecord(code);
        db.games[code] = game;
        writeDb(db);
        notifyCode(code);
        return { ok: true, code, game };
      },

      async getGame(rawCode) {
        const code = normalizeCode(rawCode);
        if (!code) return null;
        const db = readDb();
        return db.games[code] || null;
      },

      subscribeGame(rawCode, callback) {
        const code = normalizeCode(rawCode);
        if (!subscribers.has(code)) {
          subscribers.set(code, new Set());
        }
        subscribers.get(code).add(callback);

        // Emit initial state immediately
        const db = readDb();
        callback(db.games[code] || null);

        return function unsubscribe() {
          const set = subscribers.get(code);
          if (set) {
            set.delete(callback);
            if (set.size === 0) subscribers.delete(code);
          }
        };
      },

      async updateGame(rawCode, updaterFn) {
        const code = normalizeCode(rawCode);
        const db = readDb();
        const current = db.games[code];
        if (!current) {
          return { ok: false, error: "Game not found." };
        }
        const result = await updaterFn(current);
        if (result && result.abort) {
          return { ok: false, error: result.error || "Update rejected." };
        }
        const nextGame = result && result.game ? result.game : current;
        db.games[code] = nextGame;
        writeDb(db);
        notifyCode(code);
        return { ok: true, game: nextGame };
      },

      async endGame(rawCode) {
        const code = normalizeCode(rawCode);
        const db = readDb();
        if (db.games[code]) {
          db.games[code].status = "ended";
          db.games[code].endedAt = Date.now();
          writeDb(db);
          notifyCode(code);
        }
        return { ok: true };
      }
    };
  })();

  // =========================================================================
  // Firebase Realtime Database Adapter
  // =========================================================================
  let fbDb = null;
  let fbInitPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureFirebaseDb() {
    if (!isFirebaseConfigured()) return null;
    if (fbDb) return fbDb;
    if (fbInitPromise) return fbInitPromise;

    fbInitPromise = (async () => {
      await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js");

      if (!global.firebase.apps.length) {
        global.firebase.initializeApp(FIREBASE_CONFIG);
      }
      fbDb = global.firebase.database();
      return fbDb;
    })();

    return fbInitPromise;
  }

  const firebaseStore = {
    async createGame(rawCode) {
      const code = normalizeCode(rawCode);
      if (!code) {
        return { ok: false, error: "Please enter a valid Game Name or Code." };
      }
      const db = await ensureFirebaseDb();
      const ref = db.ref(`games/${code}`);
      let conflict = false;

      await ref.transaction((current) => {
        if (current && current.status === "active") {
          conflict = true;
          return; // Abort transaction
        }
        return createEmptyGameRecord(code);
      });

      if (conflict) {
        return {
          ok: false,
          error: `Game code "${code}" is already active. Please choose another name.`
        };
      }

      const snap = await ref.get();
      return { ok: true, code, game: snap.val() };
    },

    async getGame(rawCode) {
      const code = normalizeCode(rawCode);
      if (!code) return null;
      const db = await ensureFirebaseDb();
      const snap = await db.ref(`games/${code}`).get();
      return snap.exists() ? snap.val() : null;
    },

    subscribeGame(rawCode, callback) {
      const code = normalizeCode(rawCode);
      let active = true;
      let ref = null;
      let listener = null;

      ensureFirebaseDb()
        .then((db) => {
          if (!active || !db) return;
          ref = db.ref(`games/${code}`);
          listener = (snap) => {
            if (!active) return;
            callback(snap.exists() ? snap.val() : null);
          };
          ref.on("value", listener);
        })
        .catch(() => {
          if (active) callback(null);
        });

      return function unsubscribe() {
        active = false;
        if (ref && listener) {
          ref.off("value", listener);
        }
      };
    },

    async updateGame(rawCode, updaterFn) {
      const code = normalizeCode(rawCode);
      const db = await ensureFirebaseDb();
      const ref = db.ref(`games/${code}`);
      let abortReason = null;

      await ref.transaction((current) => {
        if (!current) {
          abortReason = "Game not found.";
          return;
        }
        const clone = JSON.parse(JSON.stringify(current));
        const res = updaterFn(clone);
        if (res && res.abort) {
          abortReason = res.error || "Update rejected.";
          return;
        }
        return res && res.game ? res.game : clone;
      });

      if (abortReason) {
        return { ok: false, error: abortReason };
      }

      const snap = await ref.get();
      return { ok: true, game: snap.val() };
    },

    async endGame(rawCode) {
      const code = normalizeCode(rawCode);
      const db = await ensureFirebaseDb();
      await db.ref(`games/${code}`).update({
        status: "ended",
        endedAt: Date.now()
      });
      return { ok: true };
    }
  };

  function getBackend() {
    return isFirebaseConfigured() ? firebaseStore : localStore;
  }

  global.TombolaSync = {
    PRIZE_STAGES,
    normalizeCode,
    isFirebaseConfigured,
    createGame: (code) => getBackend().createGame(code),
    getGame: (code) => getBackend().getGame(code),
    subscribeGame: (code, cb) => getBackend().subscribeGame(code, cb),
    updateGame: (code, fn) => getBackend().updateGame(code, fn),
    endGame: (code) => getBackend().endGame(code)
  };
})(window);
