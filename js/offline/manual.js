function openManualMode() {
    loadManualStorage();

    navigateTo("manualPage");

    renderManualMode();
}


function loadManualStorage() {
    try {
        manualSelectedCards = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.manualCards)
        ) || [];

        manualMarks = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.manualMarks)
        ) || {};

    } catch {
        manualSelectedCards = [];
        manualMarks = {};
    }
}


function saveManualStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.manualCards, JSON.stringify(manualSelectedCards));
        localStorage.setItem(STORAGE_KEYS.manualMarks, JSON.stringify(manualMarks));
    } catch (error) {
        console.error("Could not save manual cards locally:", error);
        showToast("Browser storage is unavailable. Your changes may not be saved.", "warning");
    }
}


/* =========================================================
   37. MANUAL MODE — CARD SELECTOR
========================================================= */

function renderManualMode() {
    setText(
        "manualCardCount",
        `${manualSelectedCards.length} / 2`
    );

    const selectionArea = $("manualCardSelectionArea");
    const cardsArea = $("manualCardsArea");

    if (manualSelectedCards.length === 2) {
        hide(selectionArea);
        show(cardsArea);

        renderManualCards();

    } else {
        show(selectionArea);
        hide(cardsArea);

        renderManualCardSelection();
    }
}


function renderManualCardSelection() {
    const container = $("manualCardSelectionGrid");

    if (!container) return;

    container.innerHTML = Array.from(
        { length: 100 },
        (_, index) => {
            const number = index + 1;
            const card = getCard(number);

            const selected =
                manualSelectedCards.includes(number);

            const preview = card.rows.map(row => `
                <div class="mini-card-row">
                    ${row.map(value =>
                        value === null
                            ? `<span class="mini-empty"></span>`
                            : `<span>${value}</span>`
                    ).join("")}
                </div>
            `).join("");

            return `
                <button
                    type="button"
                    class="card-choice ${selected ? "selected" : ""}"
                    data-manual-card="${number}"
                >
                    <strong>CARD #${number}</strong>

                    <div class="mini-card">${preview}</div>

                    <span>
                        ${selected ? "SELECTED" : "AVAILABLE"}
                    </span>
                </button>
            `;
        }
    ).join("");

    container.querySelectorAll("[data-manual-card]").forEach(button => {
        button.addEventListener("click", () => {
            toggleManualCard(
                Number(button.dataset.manualCard)
            );
        });
    });

    setText(
        "manualSelectedCardSummary",
        manualSelectedCards.length
            ? `Selected: ${manualSelectedCards.map(n => `#${n}`).join(", ")}`
            : "No cards selected."
    );

    const confirmButton = $("manualConfirmCardsButton");

    if (confirmButton) {
        confirmButton.disabled =
            manualSelectedCards.length !== 2;
    }
}


function toggleManualCard(number) {
    if (manualSelectedCards.includes(number)) {
        manualSelectedCards =
            manualSelectedCards.filter(n => n !== number);

    } else {
        if (manualSelectedCards.length >= 2) {
            showToast("Choose only two cards.", "warning");
            return;
        }

        manualSelectedCards.push(number);
    }

    manualSelectedCards.sort((a, b) => a - b);

    renderManualCardSelection();
}


/* =========================================================
   38. MANUAL MODE — CONFIRM CARDS
========================================================= */

function confirmManualCards() {
    if (manualSelectedCards.length !== 2) return;

    manualMarks = {};

    manualSelectedCards.forEach(number => {
        manualMarks[number] = [];
    });

    saveManualStorage();

    renderManualMode();

    showToast("Your two cards are ready!", "success");
}


/* =========================================================
   39. MANUAL MODE — RENDER CARDS
========================================================= */

function renderManualCards() {
    const container = $("manualPersonalCardsGrid");

    if (!container) return;

    container.innerHTML = manualSelectedCards.map(cardNumber => {
        const marks = new Set(manualMarks[cardNumber] || []);

        return renderTombolaCard(
            cardNumber,
            new Set(),
            marks,
            true
        );
    }).join("");

    container.querySelectorAll(
        ".tombola-cell[data-number]"
    ).forEach(button => {
        button.addEventListener("click", () => {
            toggleManualMark(
                Number(button.dataset.card),
                Number(button.dataset.number)
            );
        });
    });
}


function toggleManualMark(cardNumber, number) {
    if (!manualMarks[cardNumber]) {
        manualMarks[cardNumber] = [];
    }

    const marks = manualMarks[cardNumber];

    if (marks.includes(number)) {
        manualMarks[cardNumber] = marks.filter(
            value => value !== number
        );
    } else {
        marks.push(number);
    }

    saveManualStorage();
    renderManualCards();
}


/* =========================================================
   40. MANUAL MODE — CLEAR MARKS
========================================================= */

function clearManualMarks() {
    showConfirmation({
        title: "Clear all marks?",
        message: "All personal marks on your two cards will be removed.",
        icon: "↻",
        confirmText: "CLEAR MARKS",

        onConfirm: () => {
            manualMarks = {};

            manualSelectedCards.forEach(number => {
                manualMarks[number] = [];
            });

            saveManualStorage();
            renderManualCards();

            showToast("All marks cleared.", "success");
        }
    });
}


/* =========================================================
   41. MANUAL MODE — CHANGE CARDS
========================================================= */

function changeManualCards() {
    showConfirmation({
        title: "Change your cards?",
        message:
            "Your current card selections and personal marks will be cleared.",
        icon: "🃏",
        confirmText: "CHANGE CARDS",

        onConfirm: () => {
            manualSelectedCards = [];
            manualMarks = {};

            saveManualStorage();

            renderManualMode();
        }
    });
}


/* =========================================================
   42. HOST NUMBER TABLE — OFFLINE STORAGE

   This section is intentionally independent:
   - No Firebase calls.
   - No game room.
   - No online player.
   - No official online draw.
========================================================= */

