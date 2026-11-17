# Zenith Rush Demo (play money)

A crash game that runs entirely in the browser. It is a static site, so it deploys on Vercel with no settings.

- Play money only ("demo coins", 1000 to start, saved in this browser). No deposits, withdrawals or wallet.
- The other pilots in the table are simulated.
- Crash points use the same formula as the PHP server (HMAC-SHA256 seed, 1 in 25 rounds crash at 1.00x) and the
  fairness panel verifies the seed hash in the browser.

## Files
- `index.html`, `style.css`, `game.js`: page and drawing
- `demo-engine.js`: the game loop (replaces the PHP/Workerman server)

## Deploy on Vercel
1. On github.com create a NEW repository (for example `zenith-rush-demo`) and upload these files so `index.html`
   is at the top level (not inside another folder).
2. On vercel.com choose **Add New, Project**, import that repository.
3. Framework Preset: **Other**. Leave all other settings empty. Click **Deploy**.

## Run locally
```
python3 -m http.server 8000
```
then open http://localhost:8000
