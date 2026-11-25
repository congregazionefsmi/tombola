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

    const roomId = toGameRoomId(name);

    if (!roomId) {
        setText("hostSetupMessage", "Please choose a game name containing letters or numbers.");
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

        const now = firebase.database.ServerValue.TIMESTAMP;
        const game = {
            code: roomId,
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

        // Use the normalized game name as the room path. This reads and
        // writes only games/{roomId}; it never queries the /games root.
        // The transaction prevents two hosts from claiming the same name.
        const result = await database
            .ref(gamePath(roomId))
            .transaction(currentData => {
                if (currentData === null) return game;
                return undefined;
            });

        if (!result.committed) {
            throw new Error("A game room with this name already exists. Choose another name or delete the previous room first.");
        }

        hostGameCode = roomId;
        hostGameData = result.snapshot.val() || game;

        listenToHostGame();
        navigateTo("ballsGamePage");
        showToast("Game created successfully! Your game name is also its room code.", "success");

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

            // Keep the Host on the game screen after End Game so the
            // official board, final winners, players, and room controls
            // remain available until the Host explicitly returns home.
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

    if (!window.hostRouletteAnimationActive) {
    setText(
        "latestDrawNumber",
        game.latestNumber ?? "--"
    );
}

    const gameEnded = game.status === "ended";
    const drawButton = $("drawNextButton");
    const rouletteBall = $("rouletteBall");
    const endButton = $("endGameButton");
    const returnButton = $("hostReturnHomeButton");
    const endedNotice = $("hostEndedNotice");

    if (drawButton) drawButton.disabled = gameEnded;
    if (rouletteBall) rouletteBall.disabled = gameEnded;
    if (endButton) endButton.hidden = gameEnded;
    if (returnButton) returnButton.hidden = !gameEnded;
    if (endedNotice) endedNotice.hidden = !gameEnded;

    if (gameEnded) {
        setText("rouletteCaption", "The game has finished.");
    } else {
        setText("rouletteCaption", "Click the ball to draw the next number");
    }

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
   CHRISTMAS ROULETTE — ANIMATION AND SOUND
========================================================= */

window.hostRouletteAnimationActive = false;
window.hostRouletteSoundEnabled = true;
window.hostRouletteAudioContext = null;
window.hostRouletteStopSound = null;


/* =========================================================
   SOUND — START CINEMATIC ROULETTE
========================================================= */

function startChristmasRouletteSound() {

    if (!window.hostRouletteSoundEnabled) return;

    try {

        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) return;

        let audio = window.hostRouletteAudioContext;

        if (!audio || audio.state === "closed") {
            audio = new AudioContextClass();
            window.hostRouletteAudioContext = audio;
        }

        if (audio.state === "suspended") {
            audio.resume();
        }

        const noiseBuffer = audio.createBuffer(
            1,
            audio.sampleRate * 2,
            audio.sampleRate
        );

        const noiseData = noiseBuffer.getChannelData(0);

        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = Math.random() * 2 - 1;
        }

        const noise = audio.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;

        const filter = audio.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 900;

        const noiseGain = audio.createGain();
        noiseGain.gain.setValueAtTime(
            0.0001,
            audio.currentTime
        );

        noiseGain.gain.exponentialRampToValueAtTime(
            0.055,
            audio.currentTime + 1
        );

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(audio.destination);

        const bass = audio.createOscillator();
        const bassGain = audio.createGain();

        bass.type = "triangle";
        bass.frequency.value = 58;

        bassGain.gain.value = 0.025;

        bass.connect(bassGain);
        bassGain.connect(audio.destination);

        noise.start();
        bass.start();

        window.hostRouletteStopSound = function () {

            try {

                noiseGain.gain.cancelScheduledValues(
                    audio.currentTime
                );

                noiseGain.gain.setTargetAtTime(
                    0.0001,
                    audio.currentTime,
                    0.08
                );

                bassGain.gain.setTargetAtTime(
                    0.0001,
                    audio.currentTime,
                    0.05
                );

                noise.stop(audio.currentTime + 0.3);
                bass.stop(audio.currentTime + 0.3);

            } catch (error) {
                console.warn("Roulette sound stop:", error);
            }

            window.hostRouletteStopSound = null;
        };

    } catch (error) {

        console.warn("Roulette sound unavailable:", error);

    }
}


/* =========================================================
   SOUND — FINAL NUMBER REVEAL
========================================================= */

function playChristmasRouletteRevealSound() {

    if (!window.hostRouletteSoundEnabled) return;

    try {

        const audio = window.hostRouletteAudioContext;

        if (!audio || audio.state !== "running") return;

        const notes = [659.25, 783.99, 987.77];

        notes.forEach((frequency, index) => {

            const oscillator = audio.createOscillator();
            const gain = audio.createGain();

            const startTime =
                audio.currentTime + (index * 0.14);

            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(
                frequency,
                startTime
            );

            gain.gain.setValueAtTime(0.0001, startTime);

            gain.gain.exponentialRampToValueAtTime(
                0.16,
                startTime + 0.035
            );

            gain.gain.exponentialRampToValueAtTime(
                0.0001,
                startTime + 0.65
            );

            oscillator.connect(gain);
            gain.connect(audio.destination);

            oscillator.start(startTime);
            oscillator.stop(startTime + 0.7);

        });

    } catch (error) {

        console.warn("Reveal sound unavailable:", error);

    }
}


/* =========================================================
   SOUND — ON/OFF BUTTON
========================================================= */

function updateRouletteSoundButton() {

    const button = $("hostRouletteSoundButton");

    if (!button) return;

    const enabled = window.hostRouletteSoundEnabled;

    button.textContent = enabled
        ? "🔊 SOUND ON"
        : "🔇 SOUND OFF";

    button.setAttribute(
        "aria-pressed",
        String(enabled)
    );
}


function toggleHostRouletteSound() {

    window.hostRouletteSoundEnabled =
        !window.hostRouletteSoundEnabled;

    if (!window.hostRouletteSoundEnabled) {

        if (window.hostRouletteStopSound) {
            window.hostRouletteStopSound();
        }

    } else if (window.hostRouletteAnimationActive) {

        startChristmasRouletteSound();

    }

    updateRouletteSoundButton();
}


/* =========================================================
   ANIMATION — 15-SECOND CINEMATIC NUMBER DRAW
========================================================= */

function runChristmasRouletteAnimation() {

    return new Promise(resolve => {

        const ball = $("rouletteBall");
        const numberDisplay = $("latestDrawNumber");
        const caption = $("rouletteCaption");

        if (!ball || !numberDisplay || !caption) {
            resolve();
            return;
        }

        const DURATION = 10000;

        const startTime = performance.now();

        let lastNumberChange = 0;

        ball.classList.remove("is-revealed");
        ball.classList.add("is-drawing");

        caption.classList.add("is-drawing");

        caption.textContent = "🎄 DRAWING YOUR LUCKY NUMBER...";

        numberDisplay.textContent = "00";

        startChristmasRouletteSound();

        function animate(currentTime) {

            const elapsed = currentTime - startTime;

            const progress = Math.min(
                elapsed / DURATION,
                1
            );

            /*
             * Fast numbers at the beginning.
             * Gradually slow down toward the reveal.
             */

            let changeInterval;

            if (progress < 0.60) {

                changeInterval = 55;

            } else if (progress < 0.82) {

                changeInterval = 110;

            } else if (progress < 0.94) {

                changeInterval = 240;

            } else {

                changeInterval = 500;

            }

            if (
                elapsed - lastNumberChange >= changeInterval &&
                progress < 1
            ) {

                const randomNumber =
                    Math.floor(Math.random() * 90) + 1;

                numberDisplay.textContent =
                    String(randomNumber).padStart(2, "0");

                lastNumberChange = elapsed;
            }

            if (progress < 1) {

                requestAnimationFrame(animate);

            } else {

                finishAnimation();

            }
        }


        function finishAnimation() {

            if (window.hostRouletteStopSound) {
                window.hostRouletteStopSound();
            }

            ball.classList.remove("is-drawing");

            caption.classList.remove("is-drawing");

            /*
             * The animated numbers are only visual.
             * Firebase will select the actual official number.
             */

            numberDisplay.textContent = "…";

            caption.textContent = "✨ REVEALING YOUR NUMBER...";

            ball.classList.remove("is-revealed");

            // Restart the reveal animation.
            void ball.offsetWidth;

            ball.classList.add("is-revealed");

            playChristmasRouletteRevealSound();

            resolve();
        }

        requestAnimationFrame(animate);

    });

}


/* =========================================================
   INITIALIZE SOUND CONTROL
========================================================= */

const rouletteSoundButton = $("hostRouletteSoundButton");

if (rouletteSoundButton) {

    rouletteSoundButton.addEventListener(
        "click",
        toggleHostRouletteSound
    );

}

updateRouletteSoundButton();


/* =========================================================
   14. HOST — DRAW NEXT NUMBER

   CHRISTMAS CINEMATIC ANIMATION:
   - 15-second animation before the official draw.
   - Animation numbers are visual only.
   - Firebase transaction selects the official number.
   - Existing prize and winner logic remains unchanged.
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

    window.hostRouletteAnimationActive = true;

    try {

        /* =========================================
           STEP 1 — CINEMATIC ANIMATION
        ========================================= */

        await runChristmasRouletteAnimation();

        window.hostRouletteAnimationActive = false;


        /* =========================================
           STEP 2 — OFFICIAL FIREBASE DRAW

           Original transaction logic preserved.
        ========================================= */

        const gameReference = database.ref(
            gamePath(hostGameCode)
        );

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


        /* =========================================
           STEP 3 — CHECK TRANSACTION
        ========================================= */

        if (!transaction.committed) {

            setText(
                "latestDrawNumber",
                hostGameData?.latestNumber ?? "--"
            );

            setText(
                "rouletteCaption",
                "Click the ball to draw the next number"
            );

            showToast(
                "The number could not be drawn.",
                "error"
            );

            return;
        }


        /* =========================================
           STEP 4 — OFFICIAL NUMBER REVEAL
        ========================================= */

        const updatedGame = transaction.snapshot.val();

        if (updatedGame) {

            setText(
                "latestDrawNumber",
                updatedGame.latestNumber ?? "--"
            );

            setText(
                "rouletteCaption",
                "🎄 Your lucky number is revealed!"
            );

            /* =====================================
               STEP 5 — EXISTING WINNER CALCULATION

               No changes to winner logic.
            ===================================== */

            await calculateAndSaveWinners(updatedGame);

        }

    } catch (error) {

        console.error("Draw error:", error);

        showToast(
            "Could not draw the next number.",
            "error"
        );

    } finally {

        window.hostRouletteAnimationActive = false;

        if (ball) {
            ball.classList.remove("is-drawing");
        }

        const caption = $("rouletteCaption");

        if (caption) {
            caption.classList.remove("is-drawing");
        }

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
   23. HOST — DELETE FINISHED ROOM AND RETURN HOME

   End Game deliberately does not delete anything. This separate
   action first publishes a deleted status so connected players can
   react, then removes the complete /games/{code} room and its data.
========================================================= */

function deleteFinishedHostGameAndReturnHome() {
    if (!hostGameCode || !hostGameData) return;

    if (hostGameData.status !== "ended") {
        showToast("End the game before returning to the main menu.", "warning");
        return;
    }

    showConfirmation({
        title: "Delete this game room?",
        message:
            "The finished room, player registrations, card reservations, draw history, and winners will be permanently deleted. Connected players will be returned to the main menu.",
        icon: "🗑️",
        confirmText: "DELETE ROOM",

        onConfirm: async () => {
            const code = hostGameCode;
            const reference = database.ref(gamePath(code));
            const button = $("hostReturnHomeButton");

            if (button) {
                button.disabled = true;
                button.textContent = "DELETING...";
            }

            try {
                // Detach the Host listener before changing the room status;
                // otherwise it would interpret "deleted" as a fresh active
                // render while this deletion operation is in progress.
                if (hostGameListener) {
                    reference.off("value", hostGameListener);
                    hostGameListener = null;
                }

                // Removing the room node triggers the existing real-time
                // listener on every connected Player. Their listener shows
                // a deletion notice and returns them to the main menu.
                // The single remove also deletes players, takenCards,
                // draw history, and prize/winner data under this room.
                await reference.remove();

                if (hostGameListener) {
                    reference.off("value", hostGameListener);
                    hostGameListener = null;
                }

                hostGameCode = null;
                hostGameData = null;

                showToast("Game room deleted. Returning to the main menu.", "success");
                returnHome();

            } catch (error) {
                console.error("Could not delete the finished game room:", error);
                showToast("Could not delete the game room. Check Firebase permissions and try again.", "error");

                // If deletion failed, restore the Host's live room listener.
                if (hostGameCode === code && !hostGameListener) {
                    listenToHostGame();
                }

            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = "Return to Main Menu";
                }
            }
        }
    });
}


/* =========================================================
   24. HOST — RESET GAME
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

