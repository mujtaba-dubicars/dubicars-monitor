import { RESULT } from './classify.js';

// Turn API + journey results into a flat list of alert-worthy issues.
export function buildIssues(apiRows, journeyRows) {
  const issues = [];
  for (const r of apiRows) {
    if (r.result === RESULT.FAIL || r.result === RESULT.SLOW) {
      const label = `API ${r.endpoint}${r.query ? ` (${r.query})` : ''}`;
      const detail = `${r.http_status} ${r.response_time_ms}ms ${r.detail}`.trim();
      issues.push({ result: r.result, label, detail });
    }
  }
  for (const r of journeyRows) {
    if (r.result === RESULT.FAIL || r.result === RESULT.SLOW) {
      issues.push({ result: r.result, label: `Page ${r.step}`, detail: `${r.load_time_ms}ms ${r.detail}`.trim() });
    }
  }
  return issues;
}

function statusEmoji(s) {
  return s.fail > 0 ? '🔴' : s.slow > 0 ? '🟠' : '✅';
}
function statusWord(s) {
  if (s.fail > 0) return `${s.fail} failed`;
  if (s.slow > 0) return `${s.slow} slow`;
  return 'all healthy';
}

// Build the per-run summary message (Google Chat text format).
export function buildRunMessage(summary, issues, timestamp, dashboardUrl) {
  const ts = `${timestamp.replace('T', ' ').slice(0, 16)} UTC`;
  const lines = [
    `*DubiCars Monitor* ${statusEmoji(summary)} ${statusWord(summary)}`,
    `${ts}  ·  ${summary.pass}✅  ${summary.slow}🟠  ${summary.fail}🔴`
      + (summary.netErrors ? `  ·  ${summary.netErrors} net err` : ''),
  ];
  for (const i of issues.slice(0, 12)) {
    lines.push(`${i.result === RESULT.FAIL ? '🔴' : '🟠'} ${i.label}: ${i.detail}`);
  }
  if (issues.length > 12) lines.push(`…and ${issues.length - 12} more`);
  if (dashboardUrl) lines.push(`<${dashboardUrl}|Open dashboard>`);
  return lines.join('\n');
}

async function postToChat(text) {
  const webhook = process.env.GCHAT_WEBHOOK_URL;
  if (!webhook) throw new Error('GCHAT_WEBHOOK_URL not set');
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`chat webhook responded ${res.status}: ${body.slice(0, 120)}`);
  }
}

// Post one summary message for the completed run.
export async function notifyRun({ summary, issues, timestamp, dashboardUrl }) {
  await postToChat(buildRunMessage(summary, issues, timestamp, dashboardUrl));
}
