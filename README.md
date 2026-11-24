# TOMBOLA STUDENTATO 1 — CHRISTMAS EDITION

This ZIP contains the existing Tombola application source reorganized into smaller JavaScript and CSS files for easier diagnosis.

## Run locally

Because the project uses Firebase and browser modules/APIs, run it through a local HTTP server or publish it on HTTPS (for example GitHub Pages). Opening `index.html` directly with `file://` is not a reliable test method.

## Structure

```text
Tombola-Studentato-1/
├── index.html
├── css/
│   ├── style.css
│   ├── variables.css
│   ├── base.css
│   ├── layout.css
│   ├── components.css
│   ├── host.css
│   ├── player.css
│   ├── offline.css
│   └── responsive.css
├── js/
│   ├── cards.js
│   ├── firebase-config.js
│   ├── core.js
│   ├── navigation.js
│   ├── app.js
│   ├── host/host.js
│   ├── player/player.js
│   └── offline/{manual.js,number-table.js}
└── docs/
```

## Important implementation notes

- The original fixed 100-card generator and application logic have been retained and divided by responsibility.
- Firebase configuration is exposed in `js/firebase-config.js`; Firebase initialization/authentication remain in `js/core.js` to avoid duplicate global declarations.
- Android/browser Back navigation is handled with the History API. It navigates between in-app screens and keeps the main menu as a history boundary. A browser can still be closed by the user or by operating-system/browser controls.
- The Host Number Table and Manual Tombola remain local/offline features and do not use Firebase game state.
- Player card markings remain personal and manual; host prize calculations use official draws and assigned cards.

## Firebase security — NOT YET APPROVED FOR PUBLIC PRODUCTION

The Firebase project uses Anonymous Authentication and the Realtime Database in `europe-west1`. The database rules were previously locked and have not been verified as a secure, working ruleset. This ZIP intentionally does not replace them with permissive public read/write rules.

Before public multiplayer use, the database security model must be reviewed. Anonymous authentication alone does not prove that a client is the legitimate Host. A client-only web application cannot safely protect privileged draw/winner operations merely by hiding controls in JavaScript. A trusted backend or an equivalent server-verified host authorization mechanism is needed for strong enforcement.

Until secure rules and host authorization are implemented and tested, treat online multiplayer as a development build. Offline Manual and Host Number Table do not require Firebase.
