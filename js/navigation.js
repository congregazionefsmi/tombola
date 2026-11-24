function navigateTo(pageId, options = {}) {
    const target = $(pageId);

    if (!target) {
        console.error("Page not found:", pageId);
        return;
    }

    if (pageId === currentPage && !options.force) return;

    if (!options.skipHistory && window.history) {
        window.history.pushState(
            { tombolaApp: true, pageId },
            "",
            window.location.href
        );
    }

    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active");
    });

    target.classList.add("active");
    currentPage = pageId;

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function returnHome() {
    navigateTo("mainMenu");
}

function goBackFromHostSetup() {
    navigateTo("mainMenu");
}

function goBackFromPlayerJoin() {
    navigateTo("mainMenu");
}

function goBackFromCardSelection() {
    navigateTo("playerJoinPage");
}

function goBackFromManual() {
    navigateTo("mainMenu");
}

function goBackFromNumberTable() {
    navigateTo("mainMenu");
}

function goBackFromHostGame() {
    if (!hostGameCode) {
        returnHome();
        return;
    }

    showToast(
        "The host game is still active. End the game to close the room.",
        "warning"
    );
}


/* =========================================================
   4. TOAST NOTIFICATIONS
========================================================= */

function initializeNavigation() {
    // Keep Android/browser Back inside the single-page application.
    // The home screen is a protected history boundary: Back at home
    // returns to the home screen instead of leaving the website.
    if (!window.history.state || window.history.state.tombolaApp !== true) {
        window.history.replaceState(
            { tombolaApp: true, pageId: currentPage },
            "",
            window.location.href
        );
    }

    window.addEventListener("popstate", event => {
        const destination = event.state && event.state.tombolaApp
            ? event.state.pageId
            : "mainMenu";

        if (destination === "mainMenu" && currentPage === "mainMenu") {
            window.history.pushState(
                { tombolaApp: true, pageId: "mainMenu" },
                "",
                window.location.href
            );
            return;
        }

        navigateTo(destination || "mainMenu", { skipHistory: true });
    });

    $("homeButton")?.addEventListener("click", () => {
        if (hostGameCode) {
            goBackFromHostGame();
        } else {
            returnHome();
        }
    });

    $("openBallsButton")?.addEventListener("click", () => {
        navigateTo("ballsSetupPage");
    });

    $("openPlayerButton")?.addEventListener("click", () => {
        navigateTo("playerJoinPage");
    });

    $("openManualButton")?.addEventListener("click", () => {
        openManualMode();
    });

    $("openNumberTableButton")?.addEventListener("click", () => {
        openPhysicalNumberTable();
    });

    $("ballsSetupBack")?.addEventListener(
        "click",
        goBackFromHostSetup
    );

    $("hostGameBack")?.addEventListener(
        "click",
        goBackFromHostGame
    );

    $("playerJoinBack")?.addEventListener(
        "click",
        goBackFromPlayerJoin
    );

    $("cardSelectionBack")?.addEventListener(
        "click",
        goBackFromCardSelection
    );

    $("manualBack")?.addEventListener(
        "click",
        goBackFromManual
    );

    $("numberTableBack")?.addEventListener(
        "click",
        goBackFromNumberTable
    );

    $("returnHomeButton")?.addEventListener("click", () => {
        hostGameCode = null;
        hostGameData = null;

        playerGameCode = null;
        playerData = null;
        playerId = null;

        clearPlayerSession();

        returnHome();
    });

    $("fullscreenButton")?.addEventListener(
        "click",
        toggleFullscreen
    );

    $("hostFullscreenButton")?.addEventListener(
        "click",
        toggleFullscreen
    );
}


/* =========================================================
   10. HOST — CREATE GAME
========================================================= */

