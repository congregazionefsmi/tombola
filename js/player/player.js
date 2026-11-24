function toGameRoomId(value) {
    return String(value || "")
        .trim()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[.#$\[\]\/]/g, "-")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "");
}


async function findGameByCodeOrName(value) {
    const search = String(value || "").trim();
    if (!search) return null;

    // First preserve compatibility with existing rooms that used random
    // uppercase six-character codes.
    const legacyCode = search.toUpperCase();
    const legacySnapshot = await database
        .ref(gamePath(legacyCode))
        .once("value");

    if (legacySnapshot.exists()) {
        const legacyGame = legacySnapshot.val();
        if (legacyGame?.status === "active") {
            return { code: legacyCode, game: legacyGame };
        }
    }

    // New rooms use the normalized game name as their Firebase key.
    // This is a direct read of games/{roomId}, not a query on /games.
    const roomId = toGameRoomId(search);
    if (!roomId) return null;

    const nameSnapshot = await database
        .ref(gamePath(roomId))
        .once("value");

    if (!nameSnapshot.exists()) return null;

    const game = nameSnapshot.val();
    if (game?.status !== "active") return null;

    return { code: roomId, game };
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
   Read reservations from the game room.
   Each reservation contains the owner's UID.
========================================================= */

async function renderPlayerCardSelection() {

    const container = $("cardSelectionGrid");

    if (!container || !playerGameCode) return;

    const snapshot = await database
        .ref(gamePath(playerGameCode))
        .once("value");

    if (!snapshot.exists()) {
        showToast("This game no longer exists.", "error");
        return;
    }

    const game = snapshot.val();

    if (game.status !== "active") {
        showToast("This game is no longer active.", "warning");
        return;
    }

    playerData = game;

    const takenCards = game.takenCards || {};
    const players = game.players || {};

    container.innerHTML = Array.from(
        { length: TOTAL_CARDS },
        (_, index) => {

            const number = index + 1;

            // Reservation value is the owner's UID.
            const ownerUid = takenCards[number] || null;

            const isMine = ownerUid === playerId;

            const isTaken = Boolean(ownerUid) && !isMine;

            const selected =
                playerSelectedCards.includes(number);

            const ownerName = ownerUid
                ? players[ownerUid]?.name || "Player"
                : "";

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

            /*
             * IMPORTANT:
             * A taken card remains clickable if this
             * player previously selected it.
             *
             * This allows the player to remove it.
             */

            const disabled = isTaken && !selected;

            let status = "AVAILABLE";

            if (selected && isTaken) {
                status =
                    `TAKEN — ${escapeHTML(ownerName)} — TAP TO REMOVE`;
            } else if (selected) {
                status = "SELECTED — TAP TO REMOVE";
            } else if (isMine) {
                status = "YOUR CARD";
            } else if (isTaken) {
                status = `TAKEN — ${escapeHTML(ownerName)}`;
            }

            return `
                <button
                    type="button"
                    class="card-choice
                        ${isTaken ? "taken" : ""}
                        ${selected ? "selected" : ""}"
                    data-card-number="${number}"
                    ${disabled ? "disabled" : ""}
                >
                    <strong>CARD #${number}</strong>

                    <div class="mini-card">
                        ${preview}
                    </div>

                    <span class="card-choice-status">
                        ${status}
                    </span>
                </button>
            `;
        }
    ).join("");

    container.querySelectorAll("[data-card-number]")
        .forEach(button => {

            button.addEventListener("click", () => {

                togglePlayerCardSelection(
                    Number(button.dataset.cardNumber)
                );

            });

        });

    updatePlayerSelectionSummary();
}


/* =========================================================
   PLAYER — TOGGLE CARD SELECTION
========================================================= */

function togglePlayerCardSelection(number) {

    // Always allow removal of a previously selected card.

    if (playerSelectedCards.includes(number)) {

        playerSelectedCards =
            playerSelectedCards.filter(card => card !== number);

    } else {

        if (playerSelectedCards.length >= CARDS_PER_PLAYER) {

            showToast(
                "You can select only two cards.",
                "warning"
            );

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
        button.disabled = count !== CARDS_PER_PLAYER;
    }
}


/* =========================================================
   28. PLAYER — RESERVE TWO CARDS
   Each card is reserved individually using Firebase
   transactions, respecting the existing security rules.
========================================================= */

async function confirmPlayerCards() {

    if (
        playerSelectedCards.length !== CARDS_PER_PLAYER ||
        !playerGameCode ||
        !playerId
    ) {
        return;
    }

    const selected = [
        ...new Set(playerSelectedCards.map(Number))
    ].sort((a, b) => a - b);

    if (
        selected.length !== CARDS_PER_PLAYER ||
        selected.some(number =>
            !Number.isInteger(number) ||
            number < 1 ||
            number > TOTAL_CARDS
        )
    ) {
        showToast(
            "Choose two different valid cards.",
            "warning"
        );
        return;
    }

    const button = $("confirmCardsButton");

    if (button) {
        button.disabled = true;
        button.textContent = "RESERVING...";
    }

    const newlyReserved = [];

    try {

        await ensureAuthenticated();

        requireDatabase();

        const roomReference = database.ref(
            gamePath(playerGameCode)
        );

        // Verify the room and player still exist.

        const roomSnapshot = await roomReference.once("value");

        if (!roomSnapshot.exists()) {
            throw new Error("This game no longer exists.");
        }

        const game = roomSnapshot.val();

        if (game.status !== "active") {
            throw new Error("This game is no longer active.");
        }

        const player = game.players?.[playerId];

        if (!player) {
            throw new Error(
                "Your player registration was not found. Please join again."
            );
        }

        // Reserve each card independently.

        for (const number of selected) {

            const cardReference = database.ref(
                `${gamePath(playerGameCode)}/takenCards/${number}`
            );

            const result = await cardReference.transaction(
                currentOwner => {

                    // Available card: reserve it for this player.
                    if (currentOwner === null) {
                        return currentUser.uid;
                    }

                    // Already owned by this player: keep it.
                    if (currentOwner === currentUser.uid) {
                        return currentOwner;
                    }

                    // Another player owns it: abort.
                    return undefined;
                }
            );

            if (!result.committed) {

                throw new Error(
                    `Card #${number} has just been taken. Please choose another card.`
                );
            }

            if (
                result.snapshot.val() === currentUser.uid &&
                game.takenCards?.[number] !== currentUser.uid
            ) {
                newlyReserved.push(number);
            }
        }

        // Save the two cards in this player's own record.

        await database.ref(
            playerPath(playerGameCode, playerId)
        ).update({

            cards: selected,

            updatedAt:
                firebase.database.ServerValue.TIMESTAMP
        });

        // Release previous cards that are no longer selected.

        const oldCards = Array.isArray(player.cards)
            ? player.cards
            : [];

        for (const oldNumber of oldCards) {

            const number = Number(oldNumber);

            if (selected.includes(number)) continue;

            const oldReference = database.ref(
                `${gamePath(playerGameCode)}/takenCards/${number}`
            );

            const oldSnapshot = await oldReference.once("value");

            if (oldSnapshot.val() === currentUser.uid) {
                await oldReference.remove();
            }
        }

        // Refresh local game information.

        const updatedSnapshot = await roomReference.once("value");

        playerData = updatedSnapshot.val();

        playerSelectedCards = selected;

        savePlayerSession();

        initializePlayerMarks();

        listenToPlayerGame();

        navigateTo("playerGamePage");

        showToast(
            "Your two cards are reserved!",
            "success"
        );

    } catch (error) {

        console.error("Card reservation error:", error);

        // Release only reservations created by this attempt.

        for (const number of newlyReserved) {

            try {

                const reference = database.ref(
                    `${gamePath(playerGameCode)}/takenCards/${number}`
                );

                const snapshot = await reference.once("value");

                if (snapshot.val() === currentUser.uid) {
                    await reference.remove();
                }

            } catch (releaseError) {

                console.error(
                    `Could not release card #${number}:`,
                    releaseError
                );
            }
        }

        setText(
            "cardSelectionMessage",
            error.message || "Could not reserve your cards."
        );

        // Refresh the grid.
        // Cards taken by other players will be shown as unavailable,
        // but previously selected cards remain removable.

        try {
            await renderPlayerCardSelection();
        } catch (refreshError) {
            console.error(
                "Could not refresh card availability:",
                refreshError
            );
        }

    } finally {

        if (button) {
            button.disabled =
                playerSelectedCards.length !== CARDS_PER_PLAYER;

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

                const snapshot = await roomReference.once("value");

                if (!snapshot.exists()) {
                    throw new Error("This game no longer exists.");
                }

                const game = snapshot.val();

                if (game.status !== "active") {
                    throw new Error("This game is no longer active.");
                }

                const oldCards = Array.isArray(game.players?.[id]?.cards)
                    ? game.players[id].cards
                    : [];

                // Release only cards owned by this player.

                for (const number of oldCards) {

                    const reference = database.ref(
                        `${gamePath(code)}/takenCards/${number}`
                    );

                    const cardSnapshot = await reference.once("value");

                    if (cardSnapshot.val() === id) {
                        await reference.remove();
                    }
                }

                // Delete only this player's own record.

                await database.ref(
                    playerPath(code, id)
                ).remove();

                if (playerGameListener) {

                    roomReference.off(
                        "value",
                        playerGameListener
                    );

                    playerGameListener = null;
                }

                clearPlayerSession();

                playerMarks = {};

                returnHome();

                showToast("You have left the game.", "success");

            } catch (error) {

                console.error(error);

                showToast(
                    error.message || "Could not leave the game.",
                    "error"
                );
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

