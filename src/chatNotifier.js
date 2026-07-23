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

// Post one grouped message to the Google Chat space. Requires env GCHAT_WEBHOOK_URL.
export async function notifyChat(issues, timestamp) {
  const webhook = process.env.GCHAT_WEBHOOK_URL;
  if (!webhook) throw new Error('GCHAT_WEBHOOK_URL not set');

  const lines = issues.map((i) => `${i.result === RESULT.FAIL ? '🔴' : '🟠'} ${i.label}: ${i.detail}`);
  const text = `*DubiCars Monitor* — ${issues.length} issue(s) @ ${timestamp}\n${lines.join('\n')}`;

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`chat webhook responded ${res.status}`);
}
