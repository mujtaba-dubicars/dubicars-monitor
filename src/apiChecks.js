import { cacheBust, noCacheHeaders, cacheHint } from './cacheBuster.js';
import { classifyApi, RESULT } from './classify.js';

// Fetch a URL (cache-busted) and time it.
async function timedFetch(url) {
  const start = performance.now();
  let status = 0;
  let json = null;
  let hint = '';
  let err = '';
  try {
    const res = await fetch(cacheBust(url), { headers: noCacheHeaders, redirect: 'follow' });
    status = res.status;
    hint = cacheHint(res.headers);
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  } catch (e) {
    err = e.message;
  }
  const ms = Math.round(performance.now() - start);
  return { url, status, ms, json, hint, err };
}

function bodyValid(json) {
  if (!json) return false;
  if (json.error || json.errors) return false;
  return true;
}

function makeRow(endpoint, query, r, thresholdMs) {
  const c = classifyApi({ status: r.status, ms: r.ms, bodyValid: bodyValid(r.json), thresholdMs });
  let detail = r.err || c.detail;
  if (r.hint) detail = detail ? `${detail}; cache?(${r.hint})` : `cache?(${r.hint})`;
  return {
    endpoint,
    query,
    http_status: r.status,
    response_time_ms: r.ms,
    result: c.result,
    detail,
  };
}

function pickRandom(arr, count) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, count);
}

// Pick up to `count` random item ids from a search response body.
// The search API returns { data: [...], meta }; older shapes used { items: [...] }.
export function extractItemIds(json, count) {
  if (!json) return [];
  const arr = Array.isArray(json.items)
    ? json.items
    : Array.isArray(json.data)
      ? json.data
      : null;
  if (!arr) return [];
  const ids = arr.map((it) => it && it.id).filter((v) => v != null);
  const shuffled = [...ids].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Run every API check. Returns an array of API_Log rows.
export async function runApiChecks(cfg) {
  const t = cfg.thresholds.apiMs;
  const rows = [];

  // A1. Search (also feeds A4).
  const searchRes = await timedFetch(cfg.api.search.url);
  rows.push(makeRow('search', '', searchRes, t));

  // A2. Homepage.
  const homeRes = await timedFetch(cfg.api.homepage.url);
  rows.push(makeRow('homepage', '', homeRes, t));

  // A3. Suggestions — a few random full make names per run.
  for (const make of pickRandom(cfg.api.suggestions.makes, cfg.api.suggestions.sampleCount)) {
    const url = `${cfg.api.suggestions.base}?q=${encodeURIComponent(make)}&ul=${encodeURIComponent(cfg.api.suggestions.ul)}`;
    rows.push(makeRow('suggestions', make, await timedFetch(url), t));
  }

  // A4. Items — chained from the search response.
  const ids = extractItemIds(searchRes.json, cfg.api.items.sampleCount);
  if (searchRes.status !== 200 || ids.length === 0) {
    rows.push({
      endpoint: 'items',
      query: '',
      http_status: '',
      response_time_ms: '',
      result: RESULT.SKIPPED,
      detail: 'search dependency unavailable or no items in response',
    });
  } else {
    for (const id of ids) {
      const url = cfg.api.items.urlTemplate.replace('{id}', encodeURIComponent(id));
      rows.push(makeRow('items', String(id), await timedFetch(url), t));
    }
  }

  return rows;
}
