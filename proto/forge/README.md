# FORGE — package

Open any `.dc.html` file in a browser (serve the folder over http for the service worker / offline install).

- `FORGE.dc.html` — the app prototype (latest: single-drill sessions, drill tabs, pause/discard flow)
- `FORGE Coach Console.dc.html` — coach-side console
- `FORGE Build Spec.dc.html` — build spec (printable)
- `build/forge-math.js` — pure scoring module; every constant in `CAL` (MEASURED / ESTIMATED / GUESS)
- `build/forge-math.test.js` — 50 hand-computed fixtures: `node build/forge-math.test.js`
- `support.js`, `doc-page.js` — runtime for the .dc.html files
- `sw.js`, `manifest.webmanifest` — PWA offline + install
- `assets/` — images

Open guesses still to fit against real players: `yardsPerShot`, ATG constants, Putt 18 calibration.
