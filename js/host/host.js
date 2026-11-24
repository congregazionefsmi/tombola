
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

        await ensureAuthenticated();

        requireDatabase();

        // Create the game without reading the entire /games collection.
        // Try a new random code if the generated code already exists.

        let code = null;
        let game = null;
        let created = false;

        const now = firebase.database.ServerValue.TIMESTAMP;

        for (let attempt = 0; attempt < 10; attempt++) {

            code = randomCode();

            game = {
                code,
                name,

                normalizedName: normalizeGameName(name),

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

            const result = await database
                .ref(gamePath(code))
                .transaction(currentData => {

                    // Only create the game if this code is unused.
                    if (currentData === null) {
                        return game;
                    }

                    // Abort if the code already exists.
                    return undefined;

                });

            if (result.committed) {
                created = true;
                break;
            }

        }

        if (!created) {
            throw new Error(
                "Could not generate a unique game code. Please try again."
            );
        }

        hostGameCode = code;

        hostGameData = game;

        listenToHostGame();

        navigateTo("ballsGamePage");

        showToast(
            "Game created successfully!",
            "success"
        );

    } catch (error) {

        console.error("Create game error:", error);

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

                const nameInput = $("hostGameName");
                if (nameInput) nameInput.value = "";

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

