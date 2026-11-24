function loadPhysicalTableStorage() {
    try {
        physicalTableMarks = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.tableMarks)
        ) || [];
    } catch {
        physicalTableMarks = [];
    }

    physicalTableMarks = [...new Set(
        physicalTableMarks.filter(number =>
            Number.isInteger(number) &&
            number >= 1 &&
            number <= 90
        )
    )];

    physicalTableLatest =
        physicalTableMarks.length
            ? physicalTableMarks[physicalTableMarks.length - 1]
            : null;
}


function savePhysicalTableStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.tableMarks, JSON.stringify(physicalTableMarks));
    } catch (error) {
        console.error("Could not save the offline number table:", error);
        showToast("Browser storage is unavailable. The number table may not be saved.", "warning");
    }
}


/* =========================================================
   43. HOST NUMBER TABLE — OPEN
========================================================= */

function openPhysicalNumberTable() {
    loadPhysicalTableStorage();

    navigateTo("hostNumberTablePage");

    renderPhysicalNumberTable();
}


/* =========================================================
   44. HOST NUMBER TABLE — RENDER
========================================================= */

function renderPhysicalNumberTable() {
    const markedCount = physicalTableMarks.length;

    setText(
        "tableLatestNumber",
        physicalTableLatest ?? "--"
    );

    setText("tableMarkedCount", markedCount);
    setText("tableRemainingCount", 90 - markedCount);
    setText("tableHistoryCount", `${markedCount} numbers`);

    renderNumberGrid(
        "hostManualNumberGrid",
        physicalTableMarks,
        physicalTableLatest,
        true,
        togglePhysicalTableNumber
    );

    renderPhysicalTableHistory();
}


/* =========================================================
   45. HOST NUMBER TABLE — MARK / UNMARK
========================================================= */

function togglePhysicalTableNumber(number) {
    if (physicalTableMarks.includes(number)) {
        physicalTableMarks =
            physicalTableMarks.filter(value => value !== number);

    } else {
        physicalTableMarks.push(number);
    }

    physicalTableLatest =
        physicalTableMarks.length
            ? physicalTableMarks[physicalTableMarks.length - 1]
            : null;

    savePhysicalTableStorage();

    renderPhysicalNumberTable();
}


/* =========================================================
   46. HOST NUMBER TABLE — HISTORY
========================================================= */

function renderPhysicalTableHistory() {
    const container = $("tableDrawHistory");

    if (!container) return;

    if (!physicalTableMarks.length) {
        container.innerHTML = `
            <p class="empty-state">No numbers marked yet.</p>
        `;

        return;
    }

    container.innerHTML = [...physicalTableMarks]
        .reverse()
        .map((number, index) => `
            <span class="history-number ${index === 0 ? "latest" : ""}">
                ${number}
            </span>
        `)
        .join("");
}


/* =========================================================
   47. HOST NUMBER TABLE — CLEAR
========================================================= */

function clearPhysicalNumberTable() {
    showConfirmation({
        title: "Clear the number table?",
        message:
            "All manually recorded numbers will be removed. This does not affect any online game.",
        icon: "↻",
        confirmText: "CLEAR TABLE",

        onConfirm: () => {
            physicalTableMarks = [];
            physicalTableLatest = null;

            savePhysicalTableStorage();

            renderPhysicalNumberTable();

            showToast("Number table cleared.", "success");
        }
    });
}


/* =========================================================
   48. URL — AUTOMATIC GAME CODE
========================================================= */

