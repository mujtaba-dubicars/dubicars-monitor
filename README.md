# DubiCars Monitor

Automated monitor for DubiCars APIs and a key user journey. Logs response times to
Google Sheets and alerts a Google Chat group only when something is wrong.

## What it checks

**APIs** (each cache-busted; SLOW if > 600 ms; FAIL if non-200 or error body):
- `search` — `/api/v2/search?page=1`
- `homepage` — `/api/v3/homepage`
- `suggestions` — types "toyota" one keystroke at a time (`t`, `to`, ... `toyota`), `ul=KW`
- `items` — pulls 2–3 random item ids from the search response, hits `/api/v3/items/<id>`

**Browser journey** (headless Chromium; SLOW if page load > 4000 ms; FAIL on failed
network requests, console errors, or missing expected element):
1. Land on `https://www.dubicars.com/`
2. Search "Nissan Navara"
3. Open an ad from the results

Every journey step records load time **and** checks all network requests.

## Run locally

```bash
npm install
npx playwright install chromium

# Verify against live endpoints without needing Google/Chat credentials:
npm run dry

# Unit tests:
npm test
```

## Full run (writes to Sheets)

Logging uses an Apps Script Web App bound to the target sheet (see
`apps-script/Code.gs` and deploy steps below). Set:

- `SHEETS_WEBAPP_URL` — the deployed Web App `/exec` URL
- `SHEETS_WEBAPP_SECRET` — optional shared secret (only if you set one in the script)

```bash
SHEETS_WEBAPP_URL='https://script.google.com/macros/s/…/exec' npm start
```

The Web App auto-creates the tabs `API_Log`, `Journey_Log`, `Network_Errors`
with headers on first write.

### Deploy the Apps Script sink

1. Open the sheet → **Extensions → Apps Script**.
2. Replace the default code with `apps-script/Code.gs`.
3. **Deploy → New deployment → Web app**, Execute as **Me**, Access **Anyone**.
4. Copy the `/exec` URL → that's `SHEETS_WEBAPP_URL`.
5. (Optional) Project Settings → Script Properties → add `SECRET`, and set the
   same value as `SHEETS_WEBAPP_SECRET`.

_Chat alerts + GitHub Actions scheduling: next iteration._

## Hourly dashboard (GitHub Pages)

Each run writes a JSON snapshot to `docs/runs/`. `src/report.js` builds a
self-contained `docs/index.html` dashboard with an **hour selector** (dropdown +
clickable 7-day history strip) that renders any past run. Build it locally:

```bash
RUN_OUT_DIR=docs/runs node src/index.js   # produces a run file
node src/report.js                        # rebuilds docs/index.html
```

## CI (hourly) + Pages

`.github/workflows/monitor.yml` runs every hour: executes the monitor, logs to
Sheets, rebuilds the dashboard, and commits `docs/` back to the repo.

Setup:
1. Push this repo to GitHub (public → unlimited Actions minutes).
2. **Settings → Secrets and variables → Actions** → add `SHEETS_WEBAPP_URL`
   (and `SHEETS_WEBAPP_SECRET` if you set one).
3. **Settings → Pages** → Source: **Deploy from a branch**, Branch: **main**,
   Folder: **/docs**. The dashboard is served at your Pages URL.
4. (Optional) Trigger the first run manually: **Actions → DubiCars Monitor → Run workflow**.

Runs older than 7 days are pruned automatically.
