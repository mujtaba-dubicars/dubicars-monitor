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

// Build a Google Chat cardsV2 payload listing every check.
export function buildRunCard(summary, apiRows, journeyRows, timestamp, dashboardUrl) {
  const ts = `${timestamp.replace('T', ' ').slice(0, 16)} UTC`;
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

async function postToChat(payload) {
  const webhook = process.env.GCHAT_WEBHOOK_URL;
  if (!webhook) throw new Error('GCHAT_WEBHOOK_URL not set');
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

// Post one card (all checks) for the completed run.
export async function notifyRun({ summary, apiRows, journeyRows, timestamp, dashboardUrl }) {
  await postToChat(buildRunCard(summary, apiRows, journeyRows, timestamp, dashboardUrl));
}
