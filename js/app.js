function readGameCodeFromURL() {
    const parameters = new URLSearchParams(
        window.location.search
    );

    return parameters.get("game");
}


function applyGameCodeFromURL() {
    const code = readGameCodeFromURL();

    if (!code) return;

    const input = $("playerGameCode");
    if (!input) return;

    input.value = code;
    navigateTo("playerJoinPage");
}


/* =========================================================
   49. EVENT LISTENERS
========================================================= */

function initializeEvents() {
    initializeNavigation();

    $("createGameForm")?.addEventListener(
        "submit",
        createHostGame
    );

    $("drawNextButton")?.addEventListener(
        "click",
        drawNextNumber
    );

    $("rouletteBall")?.addEventListener(
        "click",
        drawNextNumber
    );

    $("endGameButton")?.addEventListener(
        "click",
        endHostGame
    );

    $("hostResetGameButton")?.addEventListener(
        "click",
        resetHostGame
    );

    $("hostNewGameButton")?.addEventListener(
        "click",
        startNewHostGame
    );

    $("copyInviteLinkButton")?.addEventListener(
        "click",
        copyInvitationLink
    );

    $("joinGameForm")?.addEventListener(
        "submit",
        joinGame
    );

    $("confirmCardsButton")?.addEventListener(
        "click",
        confirmPlayerCards
    );

    $("playerLeaveGameButton")?.addEventListener(
        "click",
        leavePlayerGame
    );

    $("manualConfirmCardsButton")?.addEventListener(
        "click",
        confirmManualCards
    );

    $("manualChangeCardsButton")?.addEventListener(
        "click",
        changeManualCards
    );

    $("manualChangeCardsButtonBottom")?.addEventListener(
        "click",
        changeManualCards
    );

    $("manualClearMarksButton")?.addEventListener(
        "click",
        clearManualMarks
    );

    $("manualClearMarksButtonBottom")?.addEventListener(
        "click",
        clearManualMarks
    );

    $("clearNumberTableButton")?.addEventListener(
        "click",
        clearPhysicalNumberTable
    );

    $("dialogCancelButton")?.addEventListener(
        "click",
        closeConfirmation
    );

    $("dialogConfirmButton")?.addEventListener("click", () => {
        const callback = dialogCallback;

        closeConfirmation();

        if (callback) {
            callback();
        }
    });
}


/* =========================================================
   50. APPLICATION STARTUP
========================================================= */

async function initializeApplication() {
    initializeEvents();

    loadManualStorage();
    loadPhysicalTableStorage();

    if (!initializeFirebase()) {
        /*
         * Offline features remain available even if Firebase
         * is unavailable.
         */
        showToast(
            "Offline features are available. Online games need Firebase.",
            "warning"
        );

        return;
    }

    try {
        await ensureAuthenticated();

        console.info(
            "Tombola Studentato 1 connected to Firebase."
        );

        await restorePlayerSession();

        if (currentPage === "mainMenu") {
            applyGameCodeFromURL();
        }

    } catch (error) {
        console.error("Application startup error:", error);

        showToast(
            "Online connection unavailable. Offline modes still work.",
            "warning"
        );
    }
}


/* =========================================================
   51. START
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    initializeApplication();
});
