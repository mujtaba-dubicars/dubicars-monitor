import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { runApiChecks } from './apiChecks.js';
import { runJourney } from './journey.js';
import { logToSheets } from './sheetsLogger.js';
import { buildIssues, notifyChat } from './chatNotifier.js';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function printTable(title, rows, cols) {
  console.log(`\n--- ${title} ---`);
  if (!rows.length) {
    console.log('(no rows)');
    return;
  }
  for (const r of rows) {
    console.log(cols.map((c) => `${c}=${r[c] ?? ''}`).join('  |  '));
  }
}

function summarize(apiRows, journeyRows, netErrorRows, issues) {
  const all = [...apiRows, ...journeyRows];
  const count = (res) => all.filter((x) => x.result === res).length;
  return {
    total: all.length,
    pass: count('PASS'),
    slow: count('SLOW'),
    fail: count('FAIL'),
    skipped: count('SKIPPED'),
    netErrors: netErrorRows.length,
    issues: issues.length,
  };
}

// Run both checks in isolation and return the combined result.
async function collect() {
  const timestamp = new Date().toISOString();

  let apiRows = [];
  try {
    apiRows = await runApiChecks(config);
  } catch (e) {
    console.error('API suite crashed:', e.message);
    apiRows = [{ endpoint: '(api-suite)', query: '', http_status: '', response_time_ms: '', result: 'FAIL', detail: `crash: ${e.message}` }];
  }

  let journeyRows = [];
  let netErrorRows = [];
  try {
    ({ rows: journeyRows, netErrorRows } = await runJourney(config));
  } catch (e) {
    console.error('Journey crashed:', e.message);
    journeyRows = [{ step: '(journey)', url: '', load_time_ms: '', result: 'FAIL', detail: `crash: ${e.message}` }];
  }

  const issues = buildIssues(apiRows, journeyRows);
  return { timestamp, apiRows, journeyRows, netErrorRows, issues };
}

// Persist one run as JSON for the dashboard to render later.
function writeRunFile(dir, run) {
  fs.mkdirSync(dir, { recursive: true });
  const safe = run.timestamp.replace(/[:.]/g, '-');
  const payload = {
    timestamp: run.timestamp,
    thresholds: config.thresholds,
    summary: summarize(run.apiRows, run.journeyRows, run.netErrorRows, run.issues),
    api: run.apiRows,
    journey: run.journeyRows,
    netErrors: run.netErrorRows,
  };
  const file = path.join(dir, `${safe}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`Wrote run file: ${file}`);
}

async function main() {
  const run = await collect();
  const { timestamp, apiRows, journeyRows, netErrorRows, issues } = run;
  console.log(`=== DubiCars Monitor @ ${timestamp} ${DRY_RUN ? '[DRY RUN]' : ''} ===`);

  printTable('API', apiRows, ['endpoint', 'query', 'http_status', 'response_time_ms', 'result', 'detail']);
  printTable('Journey', journeyRows, ['step', 'load_time_ms', 'result', 'detail']);
  printTable('Network errors', netErrorRows, ['page', 'request_url', 'status', 'detail']);

  // Persist the run for the dashboard (used in CI; harmless locally).
  if (process.env.RUN_OUT_DIR) writeRunFile(process.env.RUN_OUT_DIR, run);

  if (DRY_RUN) {
    console.log(`\n${issues.length} alert-worthy issue(s). [DRY RUN — not writing to Sheets or Chat]`);
    return;
  }

  if (process.env.SHEETS_WEBAPP_URL) {
    try {
      await logToSheets(config, { apiRows, journeyRows, netErrorRows, timestamp });
      console.log('\nLogged to Google Sheets.');
    } catch (e) {
      console.error('Sheets logging failed:', e.message);
    }
  } else {
    console.log('\nSHEETS_WEBAPP_URL not set — skipping Sheets logging.');
  }

  if (!process.env.GCHAT_WEBHOOK_URL) {
    console.log(`Chat alerts not configured (deferred). ${issues.length} issue(s) would have been posted.`);
  } else if (issues.length) {
    try {
      await notifyChat(issues, timestamp);
      console.log(`Posted ${issues.length} issue(s) to Google Chat.`);
    } catch (e) {
      console.error('Chat notify failed:', e.message);
    }
  } else {
    console.log('All healthy — no Chat alert sent.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
