import { RESULT } from './classify.js';

const STEP_TITLES = { land: 'Homepage', search: 'Search', open_ad: 'Open ad' };

// Turn a row's detail into a short, human-readable reason.
function cleanReason(detail) {
  const first = (detail || '').split(';')[0].trim();
  const m = first.match(/(\d+)\s*ms\s*>\s*(\d+)\s*ms/);
  if (m) return `over the ${m[2]} ms limit`;
  return first;
}

// Collect alert-worthy issues (FAIL/SLOW) as structured objects for the card.
export function buildIssues(apiRows, journeyRows) {
  const issues = [];
  for (const r of apiRows) {
    if (r.result === RESULT.FAIL || r.result === RESULT.SLOW) {
      issues.push({
        result: r.result,
        category: 'API',
        name: r.endpoint + (r.query ? ` · ${r.query}` : ''),
        value: r.response_time_ms !== '' && r.response_time_ms != null ? `${r.response_time_ms} ms` : `HTTP ${r.http_status}`,
        reason: cleanReason(r.detail),
      });
    }
  }
  for (const r of journeyRows) {
    if (r.result === RESULT.FAIL || r.result === RESULT.SLOW) {
      issues.push({
        result: r.result,
        category: 'Page',
        name: STEP_TITLES[r.step] || r.step,
        value: r.load_time_ms !== '' && r.load_time_ms != null ? `${r.load_time_ms} ms` : '',
        reason: cleanReason(r.detail),
      });
    }
  }
  return issues;
}

function statusEmoji(s) {
  return s.fail > 0 ? '🔴' : s.slow > 0 ? '🟠' : '🟢';
}
function statusWord(s) {
  if (s.fail > 0) return `${s.fail} failed`;
  if (s.slow > 0) return `${s.slow} slow`;
  return 'All healthy';
}

// Build a Google Chat cardsV2 message payload for a completed run.
export function buildRunCard(summary, issues, timestamp, dashboardUrl) {
  const ts = `${timestamp.replace('T', ' ').slice(0, 16)} UTC`;
  const emoji = statusEmoji(summary);

  const sections = [];

  // Summary counts.
  const counts = `✅ <b>${summary.pass}</b> passed    🟠 <b>${summary.slow}</b> slow    🔴 <b>${summary.fail}</b> failed`
    + (summary.netErrors ? `    ⚠️ <b>${summary.netErrors}</b> net err` : '');
  sections.push({
    widgets: [
      { decoratedText: { topLabel: `Checks (${summary.total})`, text: counts, wrapText: true } },
    ],
  });

  // Issue rows, or an all-clear note.
  if (issues.length) {
    const shown = issues.slice(0, 12);
    const widgets = shown.map((i) => ({
      decoratedText: {
        topLabel: `${i.result === RESULT.FAIL ? '🔴' : '🟠'} ${i.category} · ${i.name}`,
        text: `<b>${i.value || i.result}</b>`,
        bottomLabel: i.reason,
        wrapText: true,
      },
    }));
    if (issues.length > shown.length) {
      widgets.push({ textParagraph: { text: `…and ${issues.length - shown.length} more` } });
    }
    sections.push({ header: 'Needs attention', widgets });
  } else {
    sections.push({
      widgets: [{ textParagraph: { text: 'All checks passed within their thresholds.' } }],
    });
  }

  // Dashboard button.
  if (dashboardUrl) {
    sections.push({
      widgets: [
        { buttonList: { buttons: [{ text: 'Open dashboard', onClick: { openLink: { url: dashboardUrl } } }] } },
      ],
    });
  }

  return {
    cardsV2: [
      {
        cardId: 'dubicars-monitor-run',
        card: {
          header: {
            title: `${emoji}  DubiCars Monitor`,
            subtitle: `${statusWord(summary)}  ·  ${ts}`,
          },
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

// Post one card for the completed run.
export async function notifyRun({ summary, issues, timestamp, dashboardUrl }) {
  await postToChat(buildRunCard(summary, issues, timestamp, dashboardUrl));
}
