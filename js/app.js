
/* =========================================================
   48. READ GAME CODE FROM URL
========================================================= */

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

    input.value = code.toUpperCase().trim();

    navigateTo("playerJoinPage");
}


/* =========================================================
   49. EVENT LISTENERS
========================================================= */

function initializeEvents() {

    initializeNavigation();


    // HOST

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


    // PLAYER

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


    // MANUAL OFFLINE TOMBOLA

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


    // OFFLINE PHYSICAL NUMBER TABLE

    $("clearNumberTableButton")?.addEventListener(
        "click",
        clearPhysicalNumberTable
    );


    // CONFIRMATION DIALOG

    $("dialogCancelButton")?.addEventListener(
        "click",
        closeConfirmation
    );

    $("dialogConfirmButton")?.addEventListener(
        "click",
        () => {

            const callback = dialogCallback;

            closeConfirmation();

            if (callback) {
                callback();
            }

        }
    );

}


/* =========================================================
   50. APPLICATION STARTUP
========================================================= */

async function initializeApplication() {

    // Initialize application navigation.
    initializeEvents();


    // Load offline data first.
    // These functions do not require Firebase.

    loadManualStorage();

    loadPhysicalTableStorage();


    // Initialize Firebase.

    if (!initializeFirebase()) {

        showToast(
            "Offline features are available. Online games need Firebase.",
            "warning"
        );

        return;

    }


    // Authenticate the user before accessing Firebase.

    try {

        await ensureAuthenticated();

        console.info(
            "Tombola Studentato 1 connected to Firebase."
        );


        // Restore an existing player session.

        await restorePlayerSession();


        // Process invitation link only when appropriate.

        if (currentPage === "mainMenu") {

            applyGameCodeFromURL();

        }


    } catch (error) {

        console.error(
            "Application startup error:",
            error
        );

        showToast(
            "Online connection unavailable. Offline modes still work.",
            "warning"
        );

    }

}


/* =========================================================
   51. START APPLICATION
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        initializeApplication();

    }
);
