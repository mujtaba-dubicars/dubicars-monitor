// Logs monitoring rows to Google Sheets by POSTing to an Apps Script Web App
// bound to the sheet. The Web App (apps-script/Code.gs) auto-creates the tabs
// and header rows. Requires env SHEETS_WEBAPP_URL; optional SHEETS_WEBAPP_SECRET.

const HEADERS = {
  api: ['timestamp', 'endpoint', 'query', 'http_status', 'response_time_ms', 'result', 'detail'],
  journey: ['timestamp', 'step', 'url', 'load_time_ms', 'result', 'detail'],
  netErrors: ['timestamp', 'page', 'request_url', 'status', 'detail'],
};

export async function logToSheets(cfg, { apiRows, journeyRows, netErrorRows, timestamp }) {
  const url = process.env.SHEETS_WEBAPP_URL;
  if (!url) throw new Error('SHEETS_WEBAPP_URL not set');
  const { tabs } = cfg.sheets;

  const payload = {
    secret: process.env.SHEETS_WEBAPP_SECRET || undefined,
    sheets: {
      [tabs.api]: {
        headers: HEADERS.api,
        rows: apiRows.map((r) => [timestamp, r.endpoint, r.query, r.http_status, r.response_time_ms, r.result, r.detail]),
      },
      [tabs.journey]: {
        headers: HEADERS.journey,
        rows: journeyRows.map((r) => [timestamp, r.step, r.url, r.load_time_ms, r.result, r.detail]),
      },
      [tabs.netErrors]: {
        headers: HEADERS.netErrors,
        rows: netErrorRows.map((r) => [timestamp, r.page, r.request_url, r.status, r.detail]),
      },
    },
  };

  const body = JSON.stringify(payload);
  let lastErr;
  // Apps Script deployments can briefly 403/5xx (propagation, cold start); retry.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'follow', // web apps 302 to a googleusercontent URL; followed as GET
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`non-JSON response (check deployment access): ${text.slice(0, 120)}`);
      }
      if (parsed.ok === false) throw new Error(`webapp error: ${parsed.error}`);
      return parsed;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw new Error(`sheets webapp failed after 3 attempts: ${lastErr.message}`);
}
