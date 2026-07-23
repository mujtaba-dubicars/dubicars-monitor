# DubiCars Automated Monitor — Design

**Date:** 2026-07-22
**Owner:** mujtaba@dubicars.com
**Status:** Approved for planning

## 1. Purpose

An unattended monitor that, a few times per day, measures DubiCars API and page
performance, records the results to Google Sheets, and alerts a Google Chat group
only when something is wrong. Goals:

- Track API response times over time.
- Simulate a real user journey (homepage → search → open a listing) and detect
  page-load errors, failed network requests, and slow loads.
- Cost: **$0** — free tiers only.

## 1a. Reporting dashboard (added)

Each run also writes a JSON snapshot to `docs/runs/<timestamp>.json`.
`src/report.js` builds a self-contained `docs/index.html` dashboard (embedded
data, no runtime fetch) with an **hour selector** — a dropdown plus a clickable
7-day history strip — so any past hourly run can be viewed. Served free via
GitHub Pages from `main:/docs`. Runs older than 7 days are pruned. The hourly
workflow runs the monitor, rebuilds the dashboard, and commits `docs/` back.

## 2. Where it runs

**GitHub Actions** (public repo).

- Free unlimited Actions minutes for public repos.
- Built-in cron scheduler, secret storage, Node.js + headless browser support.
- No server to maintain.

Alternatives rejected: Google Apps Script (cannot drive a real browser for the
search journey); VPS/cron (not free).

Note: GitHub scheduled crons are best-effort and can be delayed several minutes
under platform load. Acceptable for a "few times a day" cadence.

## 3. Checks performed each run

### A. API checks (HTTP)

All API endpoints are public (no auth) and defined in a config array so more can
be added later without code changes. For every API request:

- **FAIL** if status ≠ 200 or body is invalid/an error payload.
- **SLOW** if response time > **600 ms**.
- **Cache-busting is enforced** so we always measure real server work, never an
  edge/CDN-cached response. Each request sends `Cache-Control: no-cache`,
  `Pragma: no-cache`, and appends a throwaway unique query param (e.g. `_cb=<nonce>`)
  that the API ignores. The response is also inspected for cache indicators
  (`Age`, `X-Cache`, `CF-Cache-Status`); if a served-from-cache indicator is
  detected, the result is flagged in the `detail` column so cached timings are
  never mistaken for real ones.

**A1. Search API** — `GET https://www.dubicars.com/api/v2/search?page=1`
Single request per run. Records HTTP status, response time (ms), JSON body
validity.

**A2. Homepage API** — `GET https://www.dubicars.com/api/v3/homepage`
Single request per run. Records HTTP status, response time (ms), JSON body
validity. Cache-busted per the rule above.

**A3. Suggestions API (incremental typing)** —
`GET https://api-suggestions.dubicars.com/v1/suggestions?q=<prefix>&ul=KW`
Simulates a user typing "toyota" one keystroke at a time, firing one request per
**cumulative prefix**: `t`, `to`, `toy`, `toyo`, `toyot`, `toyota` (6 requests,
each with `ul=KW`). Every request is cache-busted per the rule above (so repeated
prefixes across runs never return a cached response). Records status, response
time, and body validity **per prefix**. The prefix string and locale (`ul`) are
config values so they can be changed or extended later.

**A4. Items API (chained from search results)** —
`GET https://www.dubicars.com/api/v3/items/<id>`
Depends on A1. After the search response is fetched, parse its `items[]` array and
pick **2–3 random item IDs** (count configurable). For each picked ID, request the
items endpoint with the ID substituted into the path. Records status, response
time, and body validity **per item ID** (the ID goes in the `query` column).
Cache-busted per the rule above.
- If A1 fails or returns no parseable `items[]`, A4 is **skipped** and logged as
  `SKIPPED` with a `detail` noting the search dependency was unavailable (not
  counted as an items-API failure).
- Randomness varies the sampled IDs across runs, giving broader coverage of the
  item catalog over time.

### B. Browser journey (Playwright, headless Chromium)

Steps, each timed **and** network-instrumented (both load time and all network
requests are checked at every step):

1. **Land** — open `https://www.dubicars.com/`; record load time and check all
   network requests.
2. **Search** — **hybrid**: first drive the real homepage search (open the search
   popup, type **"Nissan Navara"**, submit); if the popup can't be driven, fall
   back to navigating the site's real results URL. The row detail records which
   path was used. Either way, record results-page load time and check all network
   requests fired while results load.
3. **Open an ad** — click any result (the first) to open the listing/ad detail
   page; record its load time and check all network requests.

For **every** page loaded in the journey, a network listener captures **all**
requests the page fires (XHR/fetch, scripts, CSS, images, fonts, etc.) and:

- Logs each response that is **not 2xx/3xx** (404, 500, failed, blocked, timeout)
  with its URL, status, and originating page.
- Captures JavaScript **console errors**.
- Asserts an expected element appeared (so a "200 but blank" page still FAILs).
- Records overall page load time (navigation → network-idle).

Per-step outcome:

- **FAIL** if any network request failed, a console error occurred, or the
  expected element is missing.
- **SLOW** if page load exceeds the **page threshold: 4,000 ms** (starting value,
  tuned after observing real numbers; the 600 ms bar applies to the API only).

## 4. Logging to Google Sheets

A **new dedicated Google Sheet** with three tabs. Each run appends rows.

- **`API_Log`**: `timestamp, endpoint, query, http_status, response_time_ms,
  result, detail` — for the suggestions API, `query` holds the prefix
  (`t`…`toyota`) so each keystroke's timing is a separate row.
- **`Journey_Log`**: `timestamp, step, url, load_time_ms, result, detail`
- **`Network_Errors`**: `timestamp, page, request_url, status, detail`

Transport: an **Apps Script Web App** bound to the sheet (`apps-script/Code.gs`).
The monitor POSTs JSON; the Web App auto-creates the tabs + headers and appends
rows. Auth is a single Web App URL (`SHEETS_WEBAPP_URL`), with an optional shared
secret. Chosen over a Google service account for simpler setup and secret handling
(no GCP project or JSON key).

## 5. Google Chat alerts

- On any **FAIL** or **SLOW** in a run, post one grouped message to the Chat space
  via an **incoming webhook** (URL stored as a GitHub secret).
- One message per run, listing all issues, e.g.:
  `🔴 API 200 but 812 ms · 🔴 Search page: 2 network requests failed (404)`.
- Healthy runs post nothing.

## 6. Configuration & secrets

Config file (checked into repo — no secrets):

- API endpoint list (search API; homepage API; suggestions API; items API)
- Items sampling config: how many random IDs to pull from search results (default 2–3)
- Suggestions typing config: base word ("toyota"), locale (`ul=KW`), cumulative-
  prefix mode
- Search term ("Nissan Navara") for the browser journey
- Thresholds (API 600 ms, page 4,000 ms)
- Journey step definitions

GitHub Secrets:

- `GOOGLE_SERVICE_ACCOUNT_JSON` — service-account credentials
- `GCHAT_WEBHOOK_URL` — Google Chat incoming webhook
- `SHEET_ID` — target spreadsheet ID

## 7. Components / structure

- `config.*` — endpoints, thresholds, search term, journey steps.
- API-check module — runs HTTP checks, returns structured results.
- Journey module — Playwright script, returns per-step results + network errors.
- Sheets-logger module — appends rows to the three tabs.
- Chat-notifier module — formats and posts the grouped alert.
- Orchestrator — runs both checks, aggregates results, logs, alerts.
- `.github/workflows/monitor.yml` — cron schedule + job definition.

Each module has a single responsibility and a clear input/output contract so it
can be tested independently.

## 8. Error handling

- A crash in the journey must not prevent the API results (and vice versa) from
  being logged — each check is isolated and its failure is itself recorded/alerted.
- If Sheets logging fails, still attempt the Chat alert (and vice versa); log the
  secondary failure to the Actions run output.
- Network/timeout errors in checks are treated as FAIL results, not crashes.

## 9. Testing

- Unit-test result-classification logic (PASS/SLOW/FAIL) with mock inputs.
- Unit-test the Chat message formatter against known result sets.
- A manual/dry-run mode that runs checks and prints results without writing to the
  sheet or posting to Chat (guarded by an env flag) for local verification.

## 10. Cost

All free: GitHub Actions (public repo), Playwright (OSS), Google Sheets API,
Google Chat webhook. Zero recurring cost.

## 11. Open items / future

- Tune the 4,000 ms page threshold after observing real numbers.
- Optionally add per-endpoint thresholds later.
- Optionally add more API endpoints via the config array.
