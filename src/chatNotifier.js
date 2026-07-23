import { RESULT } from './classify.js';

const STEP_TITLES = { land: 'Homepage', search: 'Search', open_ad: 'Open ad' };
const ICON = { PASS: '✅', SLOW: '🟠', FAIL: '🔴', SKIPPED: '⚪' };
const icon = (r) => ICON[r] || '⚪';

// Turn a row's detail into a short, human-readable reason.
function cleanReason(detail) {
  const first = (detail || '').split(';')[0].trim();
  const m = first.match(/(\d+)\s*ms\s*>\s*(\d+)\s*ms/);
  if (m) return `over the ${m[2]} ms limit`;
  return first;
}

// Alert-worthy issues (used only for the summary.issues count).
export function buildIssues(apiRows, journeyRows) {
  const issues = [];
  for (const r of [...apiRows, ...journeyRows]) {
    if (r.result === RESULT.FAIL || r.result === RESULT.SLOW) issues.push(r);
  }
  return issues;
}

function statusWord(s) {
  if (s.fail > 0) return `${s.fail} failed`;
  if (s.slow > 0) return `${s.slow} slow`;
  return 'All healthy';
}

// One decoratedText widget for a single check.
function checkWidget({ label, result, value, detail }) {
  const cached = /cache\?/.test(detail || '');
  let sub = '';
  if (result === RESULT.SLOW || result === RESULT.FAIL) sub = cleanReason(detail);
  else if (cached) sub = 'cached (CDN)';
  const w = {
    topLabel: label,
    text: `${icon(result)} <b>${value}</b>`,
    wrapText: true,
  };
  if (sub) w.bottomLabel = sub;
  return { decoratedText: w };
}

function apiValue(r) {
  if (r.result === RESULT.SKIPPED) return 'skipped';
  if (r.response_time_ms !== '' && r.response_time_ms != null) return `${r.response_time_ms} ms`;
  return `HTTP ${r.http_status || '—'}`;
}

// Timestamps are stored UTC; display in GMT+5.
function toLocal(timestamp) {
  const ms = Date.parse(timestamp);
  if (isNaN(ms)) return timestamp;
  return `${new Date(ms + 5 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} GMT+5`;
}

// Build a Google Chat cardsV2 payload listing every check.
export function buildRunCard(summary, apiRows, journeyRows, timestamp, dashboardUrl) {
  const ts = toLocal(timestamp);
  const emoji = summary.fail > 0 ? '🔴' : summary.slow > 0 ? '🟠' : '🟢';

  const counts = `✅ <b>${summary.pass}</b> passed   🟠 <b>${summary.slow}</b> slow   🔴 <b>${summary.fail}</b> failed`
    + (summary.netErrors ? `   ⚠️ <b>${summary.netErrors}</b> net err` : '');

  const apiWidgets = (apiRows || []).map((r) => checkWidget({
    label: `${r.endpoint}${r.query ? ` · ${r.query}` : ''}`,
    result: r.result,
    value: apiValue(r),
    detail: r.detail,
  }));

  const journeyWidgets = (journeyRows || []).map((r) => checkWidget({
    label: STEP_TITLES[r.step] || r.step,
    result: r.result,
    value: r.load_time_ms !== '' && r.load_time_ms != null ? `${r.load_time_ms} ms` : '—',
    detail: r.detail,
  }));

  const sections = [
    { widgets: [{ decoratedText: { topLabel: `Checks (${summary.total})`, text: counts, wrapText: true } }] },
    { header: 'APIs', collapsible: false, widgets: apiWidgets },
    { header: 'Buyer journey', collapsible: false, widgets: journeyWidgets },
  ];
  if (dashboardUrl) {
    sections.push({ widgets: [{ buttonList: { buttons: [{ text: 'Open dashboard', onClick: { openLink: { url: dashboardUrl } } }] } }] });
  }

  return {
    cardsV2: [
      {
        cardId: 'dubicars-monitor-run',
        card: {
          header: { title: `${emoji}  DubiCars Monitor`, subtitle: `${statusWord(summary)}  ·  ${ts}` },
          sections,
        },
      },
    ],
  };
}

// Should the alerts space be pinged? Any failure, or >= threshold slow checks.
export function shouldAlert(summary, slowThreshold) {
  return summary.fail > 0 || summary.slow >= slowThreshold;
}

// One row (API or journey) → a decoratedText widget, labeled by kind.
function rowWidget(r) {
  const isApi = 'endpoint' in r;
  const label = isApi
    ? `API · ${r.endpoint}${r.query ? ` · ${r.query}` : ''}`
    : `Page · ${STEP_TITLES[r.step] || r.step}`;
  const value = isApi
    ? apiValue(r)
    : (r.load_time_ms !== '' && r.load_time_ms != null ? `${r.load_time_ms} ms` : '—');
  return checkWidget({ label, result: r.result, value, detail: r.detail });
}

// Concise card for the alerts space — only the failed/slow checks.
export function buildAlertCard(summary, apiRows, journeyRows, timestamp, dashboardUrl) {
  const problems = [...apiRows, ...journeyRows].filter((r) => r.result === RESULT.FAIL || r.result === RESULT.SLOW);
  const emoji = summary.fail > 0 ? '🔴' : '🟠';
  const sub = [summary.fail ? `${summary.fail} failed` : null, summary.slow ? `${summary.slow} slow` : null]
    .filter(Boolean).join(' · ');

  const sections = [
    { widgets: [{ decoratedText: { topLabel: `${summary.total} checks`, text: `🔴 <b>${summary.fail}</b> failed   🟠 <b>${summary.slow}</b> slow`, wrapText: true } }] },
    { header: 'Problems', collapsible: false, widgets: problems.map(rowWidget) },
  ];
  if (dashboardUrl) {
    sections.push({ widgets: [{ buttonList: { buttons: [{ text: 'Open dashboard', onClick: { openLink: { url: dashboardUrl } } }] } }] });
  }

  return {
    cardsV2: [
      {
        cardId: 'dubicars-monitor-alert',
        card: {
          header: { title: `${emoji}  DubiCars Monitor — Alert`, subtitle: `${sub}  ·  ${toLocal(timestamp)}` },
          sections,
        },
      },
    ],
  };
}

async function postToChat(webhook, payload) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`chat webhook responded ${res.status}: ${body.slice(0, 160)}`);
  }
}

// Post the full-run card to the main space.
export async function notifyRun({ summary, apiRows, journeyRows, timestamp, dashboardUrl }) {
  const webhook = process.env.GCHAT_WEBHOOK_URL;
  if (!webhook) throw new Error('GCHAT_WEBHOOK_URL not set');
  await postToChat(webhook, buildRunCard(summary, apiRows, journeyRows, timestamp, dashboardUrl));
}

// Post the concise alert card to the alerts space.
export async function notifyAlert({ summary, apiRows, journeyRows, timestamp, dashboardUrl }) {
  const webhook = process.env.GCHAT_ALERT_WEBHOOK_URL;
  if (!webhook) throw new Error('GCHAT_ALERT_WEBHOOK_URL not set');
  await postToChat(webhook, buildAlertCard(summary, apiRows, journeyRows, timestamp, dashboardUrl));
}
