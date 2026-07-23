// Cache-busting helpers so we always measure real server work, never a
// CDN/edge-cached response.
let counter = 0;

// Append a throwaway unique param the API ignores.
export function cacheBust(url) {
  const u = new URL(url);
  counter += 1;
  u.searchParams.set('_cb', `${Date.now()}${counter}`);
  return u.toString();
}

export const noCacheHeaders = {
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

// Inspect response headers for signs it was served from cache.
export function cacheHint(headers) {
  const hints = [];
  const age = headers.get('age');
  const xCache = headers.get('x-cache');
  const cf = headers.get('cf-cache-status');
  if (age && Number(age) > 0) hints.push(`Age:${age}`);
  if (xCache && /hit/i.test(xCache)) hints.push(`X-Cache:${xCache}`);
  if (cf && /hit/i.test(cf)) hints.push(`CF:${cf}`);
  return hints.join(',');
}
