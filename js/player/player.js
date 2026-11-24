async function findGameByCodeOrName(value) {
    const search = String(value || "").trim();
    if (!search) return null;

    const upperCode = search.toUpperCase();

    // Room-code lookup reads only the requested room.
    const codeSnapshot = await database.ref(gamePath(upperCode)).once("value");
    if (codeSnapshot.exists()) {
        const game = codeSnapshot.val();
        if (game?.status === "active") {
            return { code: upperCode, game };
        }
    }

    // Name lookup uses an indexed query. Add .indexOn: ["normalizedName"]
    // under the /games rules in Firebase Realtime Database.
    const normalized = normalizeGameName(search);
    const nameSnapshot = await database.ref("games")
        .orderByChild("normalizedName")
        .equalTo(normalized)
        .limitToFirst(10)
        .once("value");

    const matches = nameSnapshot.val() || {};
    for (const [code, game] of Object.entries(matches)) {
        if (game?.status === "active") return { code, game };
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
        await ensureAuthenticated();
        requireDatabase();
        

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
        playerSelectedCards.length !== CARDS_PER_PLAYER ||
        !playerGameCode ||
        !playerId
    ) return;

    const selected = [...new Set(playerSelectedCards.map(Number))].sort((a, b) => a - b);
    if (
        selected.length !== CARDS_PER_PLAYER ||
        selected.some(number => !Number.isInteger(number) || number < 1 || number > TOTAL_CARDS)
    ) {
        showToast("Choose two different valid cards.", "warning");
        return;
    }

    const button = $("confirmCardsButton");
    if (button) {
        button.disabled = true;
        button.textContent = "RESERVING...";
    }

    try {
        requireDatabase();
        const roomReference = database.ref(gamePath(playerGameCode));
        const result = await roomReference.transaction(game => {
            if (!game || game.status !== "active") return;
            if (!game.players || !game.players[playerId]) return;

            const reservations = game.takenCards || {};
            for (const number of selected) {
                const reservation = reservations[number];
                if (reservation && reservation.playerId !== playerId) return;
            }

            // Release this player's previous cards, then reserve the new pair
            // inside the same atomic room transaction.
            for (const [number, reservation] of Object.entries(reservations)) {
                if (reservation?.playerId === playerId) delete reservations[number];
            }

            const player = game.players[playerId];
            for (const number of selected) {
                reservations[number] = {
                    playerId,
                    playerName: player.name || "Player"
                };
            }

            player.cards = selected;
            player.updatedAt = firebase.database.ServerValue.TIMESTAMP;
            game.takenCards = reservations;
            game.updatedAt = firebase.database.ServerValue.TIMESTAMP;
            return game;
        });

        if (!result.committed) {
            throw new Error("One or more cards are unavailable, or the game is no longer active. Please choose again.");
        }

        playerData = result.snapshot.val();
        playerSelectedCards = selected;
        savePlayerSession();
        initializePlayerMarks();
        listenToPlayerGame();
        navigateTo("playerGamePage");
        showToast("Your two cards are reserved!", "success");

    } catch (error) {
        console.error(error);
        setText("cardSelectionMessage", error.message || "Could not reserve your cards.");
        try { await renderPlayerCardSelection(); } catch (refreshError) {
            console.error("Could not refresh card availability:", refreshError);
        }
    } finally {
        if (button) {
            button.disabled = playerSelectedCards.length !== CARDS_PER_PLAYER;
            button.textContent = "CONFIRM TWO CARDS";
        }
    }
}


/* =========================================================
   29. PLAYER — SESSION STORAGE
========================================================= */

function savePlayerSession() {
    if (!playerGameCode || !playerId) return;

    try {
        localStorage.setItem(STORAGE_KEYS.playerSession, JSON.stringify({
            gameCode: playerGameCode,
            playerId,
            uid: currentUser?.uid || null
        }));
    } catch (error) {
        console.error("Could not save player session:", error);
    }
}


function clearPlayerSession() {
    try {
        localStorage.removeItem(STORAGE_KEYS.playerSession);
    } catch (error) {
        console.error("Could not clear player session:", error);
    }

    playerGameCode = null;
    playerData = null;
    playerId = null;
    playerSelectedCards = [];
}


async function restorePlayerSession() {
    if (!database) return;

    try {
        const saved = localStorage.getItem(STORAGE_KEYS.playerSession);
        if (!saved) return;
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
    playerMarks = {};
    if (!saved) return;

    try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            playerMarks = parsed;
        }
    } catch {
        playerMarks = {};
    }
}

let playerMarks = {};


function savePlayerMarks() {
    if (!playerGameCode || !playerId) return;

    try {
        localStorage.setItem(getPlayerMarksKey(), JSON.stringify(playerMarks));
    } catch (error) {
        console.error("Could not save player marks locally:", error);
        showToast("Browser storage is unavailable. Your marks may not be saved.", "warning");
    }
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
            // The Host has deleted the room. Return connected players
            // directly to the main menu and clear their saved session.
            if (playerGameListener && playerGameCode) {
                reference.off("value", playerGameListener);
                playerGameListener = null;
            }

            clearPlayerSession();
            navigateTo("mainMenu");
            showToast("The host deleted this game room. You have been returned to the main menu.", "info");
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
        message: "Your cards will be released and another player may select them.",
        icon: "🚪",
        confirmText: "LEAVE GAME",
        onConfirm: async () => {
            try {
                if (!playerGameCode || !playerId || !database) return;

                const code = playerGameCode;
                const id = playerId;
                const roomReference = database.ref(gamePath(code));

                const result = await roomReference.transaction(game => {
                    if (!game) return;
                    if (game.takenCards) {
                        for (const [number, reservation] of Object.entries(game.takenCards)) {
                            if (reservation?.playerId === id) delete game.takenCards[number];
                        }
                    }
                    if (game.players) delete game.players[id];
                    game.updatedAt = firebase.database.ServerValue.TIMESTAMP;
                    return game;
                });

                if (!result.committed) throw new Error("Could not update the game room.");

                if (playerGameListener) {
                    roomReference.off("value", playerGameListener);
                    playerGameListener = null;
                }

                clearPlayerSession();
                playerMarks = {};
                returnHome();
                showToast("You have left the game.", "success");
            } catch (error) {
                console.error(error);
                showToast(error.message || "Could not leave the game.", "error");
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

