/**
 * app.js
 * Core state & UI controller for "Tombola Studentato 1 - Christmas Edition".
 */

(function () {
  "use strict";

  const { FIXED_CARDS, getCardById } = window.TombolaCards;
  const { PRIZE_STAGES, normalizeCode, createGame, getGame, subscribeGame, updateGame, endGame } =
    window.TombolaSync;

  const STORAGE_KEYS = {
    HOST_SESSION: "studentato1_host_session_v1",
    PLAYER_SESSION: "studentato1_player_session_v1",
    MANUAL_STATE: "studentato1_manual_state_v1"
  };

  // =========================================================================
  // Application State
  // =========================================================================
  const state = {
    currentView: "menu",

    // Host ("Balls") state
    hostGameCode: null,
    hostGameData: null,
    hostUnsubscribe: null,
    isDrawing: false,

    // Online Player state
    playerId: null,
    playerName: "",
    playerGameCode: null,
    playerGameData: null,
    playerSelectedCardIds: [],
    playerCatalogFilter: "",
    playerUnsubscribe: null,

    // Offline Manual state
    manualDraftCardIds: [],
    manualActiveCardIds: [],
    manualMarkedNumbers: new Set(),
    manualCatalogFilter: ""
  };

  // =========================================================================
  // Utility Helpers
  // =========================================================================
  function $(id) {
    return document.getElementById(id);
  }

  function showLoading(message) {
    $("loading-text").textContent = message || "Loading...";
    $("loading-overlay").classList.remove("hidden");
  }

  function hideLoading() {
    $("loading-overlay").classList.add("hidden");
  }

  let toastTimer = null;
  function showToast(message, durationMs = 3200) {
    const banner = $("toast-banner");
    banner.textContent = message;
    banner.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      banner.classList.add("hidden");
    }, durationMs);
  }

  function generatePlayerId() {
    return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function readJsonStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeJsonStorage(key, value) {
    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (_) {
      // Ignore storage quota errors
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // =========================================================================
  // View Navigation & Session Memory
  // =========================================================================
  function switchView(viewName) {
    state.currentView = viewName;
    document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
    const target = $(`view-${viewName}`);
    if (target) {
      target.classList.add("active");
    }
    window.scrollTo({ top: 0, behavior: "instant" });

    if (viewName === "menu") {
      refreshMenuRejoinBanner();
    }
  }

  async function refreshMenuRejoinBanner() {
    const banner = $("rejoin-banner");
    const summary = $("rejoin-summary");

    const hostSession = readJsonStorage(STORAGE_KEYS.HOST_SESSION);
    if (hostSession && hostSession.gameCode) {
      const game = await getGame(hostSession.gameCode);
      if (game && game.status === "active") {
        summary.textContent = `Host Room: ${game.code} (${(game.drawnNumbers || []).length}/90 balls drawn)`;
        banner.dataset.role = "host";
        banner.dataset.code = game.code;
        banner.classList.remove("hidden");
        return;
      } else {
        writeJsonStorage(STORAGE_KEYS.HOST_SESSION, null);
      }
    }

    const playerSession = readJsonStorage(STORAGE_KEYS.PLAYER_SESSION);
    if (playerSession && playerSession.gameCode && playerSession.playerId) {
      const game = await getGame(playerSession.gameCode);
      if (game && game.status === "active") {
        summary.textContent = `Player: ${playerSession.playerName} in Game "${game.code}"`;
        banner.dataset.role = "player";
        banner.dataset.code = game.code;
        banner.classList.remove("hidden");
        return;
      } else {
        writeJsonStorage(STORAGE_KEYS.PLAYER_SESSION, null);
      }
    }

    banner.classList.add("hidden");
  }

  // =========================================================================
  // Prize Evaluation Logic (AMBO -> TERNA -> QUATERNA -> QUINTINA -> TOMBOLA)
  // =========================================================================
  /**
   * Checks whether a given card satisfies the required prize stage against drawnSet.
   * - AMBO: 2 numbers on the same row
   * - TERNA: 3 numbers on the same row
   * - QUATERNA: 4 numbers on the same row
   * - QUINTINA: 5 numbers on the same row
   * - TOMBOLA: All 10 numbers (both rows) on the card
   */
  function cardMatchesStage(card, drawnSet, stageName) {
    if (!card) return false;
    const row1Hits = card.rows[0].filter((n) => drawnSet.has(n)).length;
    const row2Hits = card.rows[1].filter((n) => drawnSet.has(n)).length;

    switch (stageName) {
      case "AMBO":
        return row1Hits >= 2 || row2Hits >= 2;
      case "TERNA":
        return row1Hits >= 3 || row2Hits >= 3;
      case "QUATERNA":
        return row1Hits >= 4 || row2Hits >= 4;
      case "QUINTINA":
        return row1Hits >= 5 || row2Hits >= 5;
      case "TOMBOLA":
        return row1Hits + row2Hits === 10;
      default:
        return false;
    }
  }

  /**
   * Evaluates all joined players for the current active stage.
   * Only the first player(s) on the current draw claim the stage, then stage advances.
   */
  function evaluateStageWinners(game) {
    const stageIdx = Number(game.currentStageIndex || 0);
    if (stageIdx >= PRIZE_STAGES.length) {
      return [];
    }

    const currentStage = PRIZE_STAGES[stageIdx];
    const winnersObj = game.winners || {};
    const existingStageWinners = Array.isArray(winnersObj[currentStage]) ? winnersObj[currentStage] : [];

    // Already claimed
    if (existingStageWinners.length > 0) {
      return [];
    }

    const drawnSet = new Set(game.drawnNumbers || []);
    const players = Object.values(game.players || {});
    const newWinners = [];

    players.forEach((player) => {
      if (!player || !Array.isArray(player.cards)) return;
      const wonThisCard = player.cards.some((cid) => cardMatchesStage(getCardById(cid), drawnSet, currentStage));
      if (wonThisCard) {
        newWinners.push(player.name);
      }
    });

    if (newWinners.length > 0) {
      if (!game.winners) game.winners = {};
      game.winners[currentStage] = newWinners;
      game.currentStageIndex = Math.min(stageIdx + 1, PRIZE_STAGES.length);
    }

    return newWinners;
  }

  function renderWinnersHtml(game) {
    const winners = (game && game.winners) || {};
    return PRIZE_STAGES.map((stage) => {
      const list = Array.isArray(winners[stage]) ? winners[stage] : [];
      const namesText = list.length > 0 ? escapeHtml(list.join(", ")) : "—";
      return `<span class="winner-tag"><strong>${stage}:</strong> ${namesText}</span>`;
    }).join("");
  }

  // =========================================================================
  // Card HTML Renderer (Strict 2 rows x 5 columns)
  // =========================================================================
  function renderCardGridHtml(card, markedSet, options = {}) {
    const miniClass = options.mini ? " mini-grid" : "";
    const cellClassExtra = options.manualInteractive ? " manual-card-cell" : "";
    const cellsHtml = [];

    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 5; c++) {
        const num = card.rows[r][c];
        const isMarked = markedSet && markedSet.has(num);
        const markedClass = isMarked ? " marked" : "";
        const dataAttr = options.manualInteractive ? ` data-num="${num}"` : "";
        cellsHtml.push(
          `<div class="card-num-cell${markedClass}${cellClassExtra}"${dataAttr}>${num}</div>`
        );
      }
    }

    return `<div class="tombola-card-grid${miniClass}">${cellsHtml.join("")}</div>`;
  }

  // =========================================================================
  // VIEW 1: BALLS PAGE (HOST & ROULETTE)
  // =========================================================================
  function buildMasterBoardSkeleton() {
    const board = $("master-board-grid");
    if (board.children.length > 0) return;
    const fragments = [];
    for (let n = 1; n <= 90; n++) {
      fragments.push(`<div class="board-cell" id="board-num-${n}">${n}</div>`);
    }
    board.innerHTML = fragments.join("");
  }

  async function openBallsView() {
    switchView("balls");
    buildMasterBoardSkeleton();
    $("balls-setup-error").classList.add("hidden");

    const savedHost = readJsonStorage(STORAGE_KEYS.HOST_SESSION);
    if (savedHost && savedHost.gameCode) {
      showLoading("Restoring active host game...");
      const existing = await getGame(savedHost.gameCode);
      hideLoading();
      if (existing && existing.status === "active") {
        enterActiveHostRoom(existing.code);
        return;
      }
      writeJsonStorage(STORAGE_KEYS.HOST_SESSION, null);
    }

    $("balls-setup-panel").classList.remove("hidden");
    $("balls-active-panel").classList.add("hidden");
    $("host-game-code").value = "";
  }

  function enterActiveHostRoom(gameCode) {
    if (state.hostUnsubscribe) {
      state.hostUnsubscribe();
      state.hostUnsubscribe = null;
    }

    state.hostGameCode = gameCode;
    writeJsonStorage(STORAGE_KEYS.HOST_SESSION, { gameCode, role: "host" });

    $("balls-setup-panel").classList.add("hidden");
    $("balls-active-panel").classList.remove("hidden");
    $("host-display-code").textContent = gameCode;

    state.hostUnsubscribe = subscribeGame(gameCode, (game) => {
      if (!game || game.status !== "active") {
        // Game was ended
        if (state.hostUnsubscribe) {
          state.hostUnsubscribe();
          state.hostUnsubscribe = null;
        }
        state.hostGameCode = null;
        state.hostGameData = null;
        writeJsonStorage(STORAGE_KEYS.HOST_SESSION, null);
        if (state.currentView === "balls") {
          $("balls-setup-panel").classList.remove("hidden");
          $("balls-active-panel").classList.add("hidden");
        }
        return;
      }

      state.hostGameData = game;
      renderHostDashboard(game);
    });
  }

  function renderHostDashboard(game) {
    const drawn = Array.isArray(game.drawnNumbers) ? game.drawnNumbers : [];
    const drawnSet = new Set(drawn);
    const latestNum = drawn.length > 0 ? drawn[drawn.length - 1] : null;
    const stageIdx = Number(game.currentStageIndex || 0);
    const allPrizesDone = stageIdx >= PRIZE_STAGES.length;
    const activeStageName = allPrizesDone ? "COMPLETED" : PRIZE_STAGES[stageIdx];

    // 1. Top Prize Pills
    document.querySelectorAll("#prize-stages-bar .prize-pill").forEach((pill, idx) => {
      pill.classList.remove("active-stage", "completed-stage");
      if (idx < stageIdx) {
        pill.classList.add("completed-stage");
      } else if (idx === stageIdx) {
        pill.classList.add("active-stage");
      }
    });

    // 2. Winners Strip
    $("winners-display").innerHTML = renderWinnersHtml(game);

    // 3. Master 1-90 Board
    for (let n = 1; n <= 90; n++) {
      const cell = $(`board-num-${n}`);
      if (!cell) continue;
      cell.classList.toggle("drawn", drawnSet.has(n));
      cell.classList.toggle("latest-drawn", n === latestNum);
    }
    $("drawn-count-badge").textContent = `${drawn.length} / 90 Drawn`;

    // 4. Right 1/3 Roulette Dispenser
    $("active-target-label").textContent = allPrizesDone
      ? "All Prizes Won!"
      : `Target: ${activeStageName}`;
    $("remaining-balls-label").textContent = `${90 - drawn.length} left`;
    $("current-drawn-number").textContent = latestNum !== null ? String(latestNum) : "—";

    const recentSlice = drawn.slice(-5).reverse();
    $("last-drawn-sequence").textContent = recentSlice.length > 0 ? recentSlice.join(" • ") : "—";

    const drawBtn = $("btn-draw-ball");
    drawBtn.disabled = state.isDrawing || drawn.length >= 90 || allPrizesDone;

    // 5. Bottom 3-Column Players Monitor
    const players = Object.values(game.players || {}).sort(
      (a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)
    );
    $("player-count-badge").textContent = `${players.length} Player${players.length === 1 ? "" : "s"}`;

    const grid = $("host-players-grid");
    if (players.length === 0) {
      grid.innerHTML = `<p class="panel-desc" style="grid-column: 1 / -1; text-align: center;">Waiting for players to join using code <strong>${escapeHtml(
        game.code
      )}</strong>...</p>`;
      return;
    }

    grid.innerHTML = players
      .map((player) => {
        const cardIds = Array.isArray(player.cards) ? player.cards : [];
        const cardsHtml = cardIds
          .map((cid) => {
            const cardObj = getCardById(cid);
            if (!cardObj) return "";
            return `
              <div class="mini-card-wrapper">
                <div class="mini-card-title">Card #${cardObj.id}</div>
                ${renderCardGridHtml(cardObj, drawnSet, { mini: true })}
              </div>
            `;
          })
          .join("");

        return `
          <div class="host-player-box">
            <div class="host-player-header">
              <span class="host-player-name">${escapeHtml(player.name)}</span>
              <span class="pill-counter">Cards ${cardIds.map((id) => "#" + id).join(", ")}</span>
            </div>
            <div class="host-player-mini-cards">
              ${cardsHtml}
            </div>
          </div>
        `;
      })
      .join("");
  }

  async function handleCreateGameSubmit(e) {
    e.preventDefault();
    const rawCode = $("host-game-code").value;
    const errorEl = $("balls-setup-error");
    errorEl.classList.add("hidden");

    showLoading("Creating game room...");
    const res = await createGame(rawCode);
    hideLoading();

    if (!res.ok) {
      errorEl.textContent = res.error;
      errorEl.classList.remove("hidden");
      return;
    }

    enterActiveHostRoom(res.code);
    showToast(`Game "${res.code}" started! Share this code with players.`);
  }

  async function handleDrawBall() {
    if (!state.hostGameCode || state.isDrawing) return;
    state.isDrawing = true;
    $("btn-draw-ball").disabled = true;

    let drawnNumber = null;
    let announcedWinners = [];
    let wonStageName = "";

    try {
      const res = await updateGame(state.hostGameCode, (game) => {
        if (game.status !== "active") {
          return { abort: true, error: "Game has already ended." };
        }
        const drawn = Array.isArray(game.drawnNumbers) ? game.drawnNumbers : [];
        if (drawn.length >= 90) {
          return { abort: true, error: "All 90 numbers have been drawn." };
        }
        const stageIdx = Number(game.currentStageIndex || 0);
        if (stageIdx >= PRIZE_STAGES.length) {
          return { abort: true, error: "Tombola has already been won!" };
        }

        const drawnSet = new Set(drawn);
        const remaining = [];
        for (let n = 1; n <= 90; n++) {
          if (!drawnSet.has(n)) remaining.push(n);
        }

        const picked = remaining[Math.floor(Math.random() * remaining.length)];
        drawn.push(picked);
        game.drawnNumbers = drawn;
        drawnNumber = picked;

        const stageBefore = PRIZE_STAGES[stageIdx];
        const newWinners = evaluateStageWinners(game);
        if (newWinners.length > 0) {
          announcedWinners = newWinners;
          wonStageName = stageBefore;
        }

        return { game };
      });

      if (!res.ok && res.error) {
        showToast(res.error);
      } else if (announcedWinners.length > 0) {
        showToast(`🎉 ${wonStageName} won by: ${announcedWinners.join(", ")}!`, 5000);
      } else if (drawnNumber !== null) {
        // Subtle tactile feedback on ball draw
        const ballBtn = $("btn-draw-ball");
        ballBtn.style.transform = "scale(1.08)";
        setTimeout(() => {
          ballBtn.style.transform = "";
        }, 140);
      }
    } finally {
      state.isDrawing = false;
      if (state.hostGameData) {
        renderHostDashboard(state.hostGameData);
      }
    }
  }

  async function handleEndGame() {
    if (!state.hostGameCode) return;
    const confirmed = window.confirm(
      `End game "${state.hostGameCode}" and return to the Main Menu? All players will be disconnected.`
    );
    if (!confirmed) return;

    showLoading("Ending game...");
    await endGame(state.hostGameCode);
    hideLoading();

    if (state.hostUnsubscribe) {
      state.hostUnsubscribe();
      state.hostUnsubscribe = null;
    }
    state.hostGameCode = null;
    state.hostGameData = null;
    writeJsonStorage(STORAGE_KEYS.HOST_SESSION, null);

    showToast("Game ended.");
    switchView("menu");
  }

  // =========================================================================
  // VIEW 2: PLAYER PAGE (ONLINE AUTO-MARKED & STRICT CARD LOCKING)
  // =========================================================================
  function getTakenCardsMap(game) {
    // Returns Map<cardId, playerName>
    const map = new Map();
    if (!game || !game.players) return map;
    Object.values(game.players).forEach((p) => {
      if (!p || !Array.isArray(p.cards)) return;
      p.cards.forEach((cid) => {
        map.set(Number(cid), p.name || "Player");
      });
    });
    return map;
  }

  async function openPlayerView() {
    switchView("player");
    $("player-join-error").classList.add("hidden");
    $("player-select-error").classList.add("hidden");

    const savedPlayer = readJsonStorage(STORAGE_KEYS.PLAYER_SESSION);
    if (savedPlayer && savedPlayer.gameCode && savedPlayer.playerId) {
      showLoading("Checking saved player session...");
      const game = await getGame(savedPlayer.gameCode);
      hideLoading();

      if (game && game.status === "active") {
        state.playerId = savedPlayer.playerId;
        state.playerName = savedPlayer.playerName;
        state.playerGameCode = game.code;

        const existingRecord = game.players && game.players[state.playerId];
        if (existingRecord && Array.isArray(existingRecord.cards) && existingRecord.cards.length === 2) {
          subscribePlayerToGame(game.code, "play");
          return;
        } else {
          state.playerSelectedCardIds = [];
          subscribePlayerToGame(game.code, "select");
          return;
        }
      } else {
        writeJsonStorage(STORAGE_KEYS.PLAYER_SESSION, null);
      }
    }

    $("player-join-panel").classList.remove("hidden");
    $("player-select-panel").classList.add("hidden");
    $("player-play-panel").classList.add("hidden");
  }

  async function handlePlayerJoinSubmit(e) {
    e.preventDefault();
    const rawCode = $("player-game-code").value;
    const rawName = $("player-name-input").value.trim();
    const errorEl = $("player-join-error");
    errorEl.classList.add("hidden");

    const code = normalizeCode(rawCode);
    if (!code || !rawName) {
      errorEl.textContent = "Please enter both a Game Code and your Player Name.";
      errorEl.classList.remove("hidden");
      return;
    }

    showLoading("Connecting to game...");
    const game = await getGame(code);
    hideLoading();

    if (!game) {
      errorEl.textContent = `No game found with code "${code}". Check the code on the host screen.`;
      errorEl.classList.remove("hidden");
      return;
    }

    if (game.status !== "active") {
      errorEl.textContent = `Game "${code}" has already ended.`;
      errorEl.classList.remove("hidden");
      return;
    }

    // Check if this device/player already exists in this game
    const saved = readJsonStorage(STORAGE_KEYS.PLAYER_SESSION);
    let playerId =
      saved && saved.gameCode === code && saved.playerId ? saved.playerId : generatePlayerId();

    // Also match by exact player name if reconnecting from same name
    const existingEntry = Object.values(game.players || {}).find(
      (p) => p && p.name && p.name.trim().toLowerCase() === rawName.toLowerCase()
    );
    if (existingEntry) {
      playerId = existingEntry.id;
    }

    state.playerId = playerId;
    state.playerName = existingEntry ? existingEntry.name : rawName;
    state.playerGameCode = code;
    state.playerSelectedCardIds = [];
    state.playerCatalogFilter = "";
    $("player-card-search").value = "";

    writeJsonStorage(STORAGE_KEYS.PLAYER_SESSION, {
      gameCode: code,
      playerId: state.playerId,
      playerName: state.playerName
    });

    if (existingEntry && Array.isArray(existingEntry.cards) && existingEntry.cards.length === 2) {
      subscribePlayerToGame(code, "play");
      showToast(`Welcome back, ${state.playerName}!`);
    } else {
      subscribePlayerToGame(code, "select");
    }
  }

  function subscribePlayerToGame(gameCode, initialStep) {
    if (state.playerUnsubscribe) {
      state.playerUnsubscribe();
      state.playerUnsubscribe = null;
    }

    if (initialStep === "select") {
      $("player-join-panel").classList.add("hidden");
      $("player-select-panel").classList.remove("hidden");
      $("player-play-panel").classList.add("hidden");
      $("select-game-code-label").textContent = gameCode;
      $("select-player-name-label").textContent = state.playerName;
    } else {
      $("player-join-panel").classList.add("hidden");
      $("player-select-panel").classList.add("hidden");
      $("player-play-panel").classList.remove("hidden");
    }

    state.playerUnsubscribe = subscribeGame(gameCode, (game) => {
      if (!game || game.status !== "active") {
        if (state.playerUnsubscribe) {
          state.playerUnsubscribe();
          state.playerUnsubscribe = null;
        }
        writeJsonStorage(STORAGE_KEYS.PLAYER_SESSION, null);
        state.playerGameCode = null;
        state.playerGameData = null;
        if (state.currentView === "player") {
          showToast("The host has ended the game.", 4500);
          $("player-join-panel").classList.remove("hidden");
          $("player-select-panel").classList.add("hidden");
          $("player-play-panel").classList.add("hidden");
        }
        return;
      }

      state.playerGameData = game;
      const myRecord = game.players && game.players[state.playerId];

      if (myRecord && Array.isArray(myRecord.cards) && myRecord.cards.length === 2) {
        $("player-join-panel").classList.add("hidden");
        $("player-select-panel").classList.add("hidden");
        $("player-play-panel").classList.remove("hidden");
        renderPlayerActiveScreen(game, myRecord);
      } else {
        // Still selecting cards: remove any drafted card that someone else just locked
        const takenMap = getTakenCardsMap(game);
        state.playerSelectedCardIds = state.playerSelectedCardIds.filter(
          (cid) => !takenMap.has(cid)
        );
        renderPlayerCardCatalog(game);
      }
    });
  }

  function renderPlayerCardCatalog(game) {
    const takenMap = getTakenCardsMap(game);
    const filterVal = String(state.playerCatalogFilter || "").trim();
    const selectedSet = new Set(state.playerSelectedCardIds);

    $("player-picked-counter").textContent = `Selected: ${state.playerSelectedCardIds.length} / 2`;
    $("btn-confirm-player-cards").disabled = state.playerSelectedCardIds.length !== 2;

    const cardsToRender = filterVal
      ? FIXED_CARDS.filter((c) => String(c.id) === filterVal || String(c.id).includes(filterVal))
      : FIXED_CARDS;

    const catalogEl = $("player-card-catalog");
    if (cardsToRender.length === 0) {
      catalogEl.innerHTML = `<p class="panel-desc">No card matches #${escapeHtml(filterVal)}.</p>`;
      return;
    }

    catalogEl.innerHTML = cardsToRender
      .map((card) => {
        const takenBy = takenMap.get(card.id);
        const isTaken = Boolean(takenBy);
        const isSelected = selectedSet.has(card.id);

        let statusBadge = "";
        if (isTaken) {
          statusBadge = `<span class="taken-badge">TAKEN by ${escapeHtml(takenBy)}</span>`;
        } else if (isSelected) {
          statusBadge = `<span class="selected-badge">SELECTED</span>`;
        }

        const classes = ["catalog-card-item"];
        if (isTaken) classes.push("taken-card");
        if (isSelected) classes.push("selected-card");

        return `
          <div class="${classes.join(" ")}" data-card-id="${card.id}" role="button" tabindex="${
          isTaken ? "-1" : "0"
        }" aria-disabled="${isTaken}">
            <div class="catalog-card-top">
              <span class="card-number-badge">Card #${card.id}</span>
              ${statusBadge}
            </div>
            ${renderCardGridHtml(card, null)}
          </div>
        `;
      })
      .join("");
  }

  function handlePlayerCatalogClick(e) {
    const item = e.target.closest(".catalog-card-item");
    if (!item || item.classList.contains("taken-card")) return;

    const cardId = Number(item.dataset.cardId);
    if (!cardId) return;

    const takenMap = getTakenCardsMap(state.playerGameData);
    if (takenMap.has(cardId)) {
      showToast(`Card #${cardId} was just taken by ${takenMap.get(cardId)}.`);
      renderPlayerCardCatalog(state.playerGameData);
      return;
    }

    const idx = state.playerSelectedCardIds.indexOf(cardId);
    if (idx !== -1) {
      state.playerSelectedCardIds.splice(idx, 1);
    } else {
      if (state.playerSelectedCardIds.length >= 2) {
        showToast("You can only select 2 cards. Tap a selected card to unselect it first.");
        return;
      }
      state.playerSelectedCardIds.push(cardId);
    }

    renderPlayerCardCatalog(state.playerGameData);
  }

  async function handleConfirmPlayerCards() {
    if (state.playerSelectedCardIds.length !== 2 || !state.playerGameCode) return;

    const chosen = state.playerSelectedCardIds.slice().sort((a, b) => a - b);
    const errorEl = $("player-select-error");
    errorEl.classList.add("hidden");

    showLoading("Locking your 2 cards...");
    const res = await updateGame(state.playerGameCode, (game) => {
      if (game.status !== "active") {
        return { abort: true, error: "This game has ended." };
      }

      if (!game.players) game.players = {};
      const takenMap = getTakenCardsMap(game);

      for (const cid of chosen) {
        const owner = takenMap.get(cid);
        if (owner && game.players[state.playerId]?.name !== owner) {
          return {
            abort: true,
            error: `Card #${cid} was just claimed by ${owner}. Please pick another card.`
          };
        }
      }

      game.players[state.playerId] = {
        id: state.playerId,
        name: state.playerName,
        cards: chosen,
        joinedAt: Date.now()
      };

      return { game };
    });
    hideLoading();

    if (!res.ok) {
      errorEl.textContent = res.error;
      errorEl.classList.remove("hidden");
      if (state.playerGameData) {
        renderPlayerCardCatalog(state.playerGameData);
      }
      return;
    }

    writeJsonStorage(STORAGE_KEYS.PLAYER_SESSION, {
      gameCode: state.playerGameCode,
      playerId: state.playerId,
      playerName: state.playerName,
      cards: chosen
    });

    showToast(`Cards #${chosen[0]} & #${chosen[1]} locked in!`);
  }

  function renderPlayerActiveScreen(game, myRecord) {
    const drawn = Array.isArray(game.drawnNumbers) ? game.drawnNumbers : [];
    const drawnSet = new Set(drawn);
    const latestNum = drawn.length > 0 ? drawn[drawn.length - 1] : null;
    const stageIdx = Number(game.currentStageIndex || 0);
    const currentPrize =
      stageIdx >= PRIZE_STAGES.length ? "ALL WON" : PRIZE_STAGES[stageIdx];

    $("player-active-code").textContent = game.code;
    $("player-active-name").textContent = myRecord.name;
    $("player-current-prize").textContent = currentPrize;
    $("player-last-ball").textContent = latestNum !== null ? String(latestNum) : "—";
    $("player-winners-summary").innerHTML = renderWinnersHtml(game);

    // Check if this player won any stage
    const myWonStages = PRIZE_STAGES.filter((st) => {
      const list = (game.winners && game.winners[st]) || [];
      return list.includes(myRecord.name);
    });

    const winAlert = $("player-win-alert");
    if (myWonStages.length > 0) {
      winAlert.textContent = `🎉 Congratulations ${myRecord.name}! You won: ${myWonStages.join(", ")}!`;
      winAlert.classList.remove("hidden");
    } else {
      winAlert.classList.add("hidden");
    }

    const cardsContainer = $("player-active-cards");
    cardsContainer.innerHTML = myRecord.cards
      .map((cid) => {
        const card = getCardById(cid);
        if (!card) return "";
        const hits = card.numbers.filter((n) => drawnSet.has(n)).length;
        return `
          <div class="play-card-box">
            <div class="play-card-header">
              <span>Card #${card.id}</span>
              <span class="pill-counter">${hits} / 10 Marked</span>
            </div>
            ${renderCardGridHtml(card, drawnSet)}
          </div>
        `;
      })
      .join("");
  }

  function handlePlayerLeaveSession() {
    const confirmed = window.confirm(
      "Leave this game on your screen? (You can rejoin later with the same Game Code and Name if it is still active.)"
    );
    if (!confirmed) return;

    if (state.playerUnsubscribe) {
      state.playerUnsubscribe();
      state.playerUnsubscribe = null;
    }
    writeJsonStorage(STORAGE_KEYS.PLAYER_SESSION, null);
    state.playerGameCode = null;
    state.playerGameData = null;
    switchView("menu");
  }

  // =========================================================================
  // VIEW 3: MANUAL CARDS PAGE (OFFLINE TAP-TO-MARK)
  // =========================================================================
  function openManualView() {
    switchView("manual");

    const savedManual = readJsonStorage(STORAGE_KEYS.MANUAL_STATE);
    if (
      savedManual &&
      Array.isArray(savedManual.cards) &&
      savedManual.cards.length === 2
    ) {
      state.manualActiveCardIds = savedManual.cards;
      state.manualMarkedNumbers = new Set(savedManual.marked || []);
      $("manual-select-panel").classList.add("hidden");
      $("manual-play-panel").classList.remove("hidden");
      renderManualPlayCards();
      return;
    }

    state.manualDraftCardIds = [];
    state.manualCatalogFilter = "";
    $("manual-card-search").value = "";
    $("manual-select-panel").classList.remove("hidden");
    $("manual-play-panel").classList.add("hidden");
    renderManualCatalog();
  }

  function renderManualCatalog() {
    const filterVal = String(state.manualCatalogFilter || "").trim();
    const selectedSet = new Set(state.manualDraftCardIds);

    $("manual-picked-counter").textContent = `Selected: ${state.manualDraftCardIds.length} / 2`;
    $("btn-confirm-manual-cards").disabled = state.manualDraftCardIds.length !== 2;

    const cardsToRender = filterVal
      ? FIXED_CARDS.filter((c) => String(c.id) === filterVal || String(c.id).includes(filterVal))
      : FIXED_CARDS;

    const catalogEl = $("manual-card-catalog");
    if (cardsToRender.length === 0) {
      catalogEl.innerHTML = `<p class="panel-desc">No card matches #${escapeHtml(filterVal)}.</p>`;
      return;
    }

    catalogEl.innerHTML = cardsToRender
      .map((card) => {
        const isSelected = selectedSet.has(card.id);
        return `
          <div class="catalog-card-item${isSelected ? " selected-card" : ""}" data-card-id="${card.id}" role="button" tabindex="0">
            <div class="catalog-card-top">
              <span class="card-number-badge">Card #${card.id}</span>
              ${isSelected ? `<span class="selected-badge">SELECTED</span>` : ""}
            </div>
            ${renderCardGridHtml(card, null)}
          </div>
        `;
      })
      .join("");
  }

  function handleManualCatalogClick(e) {
    const item = e.target.closest(".catalog-card-item");
    if (!item) return;

    const cardId = Number(item.dataset.cardId);
    if (!cardId) return;

    const idx = state.manualDraftCardIds.indexOf(cardId);
    if (idx !== -1) {
      state.manualDraftCardIds.splice(idx, 1);
    } else {
      if (state.manualDraftCardIds.length >= 2) {
        showToast("You already selected 2 cards. Tap one to unselect it first.");
        return;
      }
      state.manualDraftCardIds.push(cardId);
    }

    renderManualCatalog();
  }

  function handleConfirmManualCards() {
    if (state.manualDraftCardIds.length !== 2) return;
    state.manualActiveCardIds = state.manualDraftCardIds.slice().sort((a, b) => a - b);
    state.manualMarkedNumbers = new Set();

    persistManualState();
    $("manual-select-panel").classList.add("hidden");
    $("manual-play-panel").classList.remove("hidden");
    renderManualPlayCards();
  }

  function persistManualState() {
    writeJsonStorage(STORAGE_KEYS.MANUAL_STATE, {
      cards: state.manualActiveCardIds,
      marked: Array.from(state.manualMarkedNumbers)
    });
  }

  function renderManualPlayCards() {
    const container = $("manual-active-cards");
    container.innerHTML = state.manualActiveCardIds
      .map((cid) => {
        const card = getCardById(cid);
        if (!card) return "";
        const hits = card.numbers.filter((n) => state.manualMarkedNumbers.has(n)).length;
        return `
          <div class="play-card-box">
            <div class="play-card-header">
              <span>Card #${card.id}</span>
              <span class="pill-counter">${hits} / 10 Marked</span>
            </div>
            ${renderCardGridHtml(card, state.manualMarkedNumbers, { manualInteractive: true })}
          </div>
        `;
      })
      .join("");
  }

  function handleManualCellTap(e) {
    const cell = e.target.closest(".manual-card-cell");
    if (!cell) return;
    const num = Number(cell.dataset.num);
    if (!num) return;

    if (state.manualMarkedNumbers.has(num)) {
      state.manualMarkedNumbers.delete(num);
    } else {
      state.manualMarkedNumbers.add(num);
    }

    persistManualState();
    renderManualPlayCards();
  }

  // =========================================================================
  // Event Wiring & Boot
  // =========================================================================
  function initEventListeners() {
    // Main Menu navigation
    $("btn-go-balls").addEventListener("click", openBallsView);
    $("btn-go-player").addEventListener("click", openPlayerView);
    $("btn-go-manual").addEventListener("click", openManualView);

    document.querySelectorAll(".btn-back-menu").forEach((btn) => {
      btn.addEventListener("click", () => switchView("menu"));
    });

    // Rejoin banner buttons
    $("btn-rejoin-game").addEventListener("click", () => {
      const role = $("rejoin-banner").dataset.role;
      if (role === "host") {
        openBallsView();
      } else if (role === "player") {
        openPlayerView();
      }
    });

    $("btn-clear-session").addEventListener("click", () => {
      writeJsonStorage(STORAGE_KEYS.HOST_SESSION, null);
      writeJsonStorage(STORAGE_KEYS.PLAYER_SESSION, null);
      $("rejoin-banner").classList.add("hidden");
    });

    // Balls (Host) events
    $("form-create-game").addEventListener("submit", handleCreateGameSubmit);
    $("btn-draw-ball").addEventListener("click", handleDrawBall);
    $("btn-end-game").addEventListener("click", handleEndGame);

    // Player (Online) events
    $("form-join-game").addEventListener("submit", handlePlayerJoinSubmit);
    $("player-card-catalog").addEventListener("click", handlePlayerCatalogClick);
    $("btn-confirm-player-cards").addEventListener("click", handleConfirmPlayerCards);
    $("btn-player-leave-session").addEventListener("click", handlePlayerLeaveSession);

    $("player-card-search").addEventListener("input", (e) => {
      state.playerCatalogFilter = e.target.value;
      if (state.playerGameData) {
        renderPlayerCardCatalog(state.playerGameData);
      }
    });

    $("btn-clear-player-filter").addEventListener("click", () => {
      state.playerCatalogFilter = "";
      $("player-card-search").value = "";
      if (state.playerGameData) {
        renderPlayerCardCatalog(state.playerGameData);
      }
    });

    // Manual (Offline) events
    $("manual-card-catalog").addEventListener("click", handleManualCatalogClick);
    $("btn-confirm-manual-cards").addEventListener("click", handleConfirmManualCards);
    $("manual-active-cards").addEventListener("click", handleManualCellTap);

    $("manual-card-search").addEventListener("input", (e) => {
      state.manualCatalogFilter = e.target.value;
      renderManualCatalog();
    });

    $("btn-clear-manual-filter").addEventListener("click", () => {
      state.manualCatalogFilter = "";
      $("manual-card-search").value = "";
      renderManualCatalog();
    });

    $("btn-manual-reset-marks").addEventListener("click", () => {
      state.manualMarkedNumbers.clear();
      persistManualState();
      renderManualPlayCards();
      showToast("All marks cleared.");
    });

    $("btn-manual-change-cards").addEventListener("click", () => {
      writeJsonStorage(STORAGE_KEYS.MANUAL_STATE, null);
      state.manualDraftCardIds = state.manualActiveCardIds.slice();
      $("manual-play-panel").classList.add("hidden");
      $("manual-select-panel").classList.remove("hidden");
      renderManualCatalog();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initEventListeners();
    refreshMenuRejoinBanner();
  });
})();
