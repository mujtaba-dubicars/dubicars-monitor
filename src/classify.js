// Pure result-classification logic — no I/O, unit-testable.
export const RESULT = {
  PASS: 'PASS',
  SLOW: 'SLOW',
  FAIL: 'FAIL',
  SKIPPED: 'SKIPPED',
};

// Classify a single API request outcome.
export function classifyApi({ status, ms, bodyValid, thresholdMs }) {
  if (status !== 200) return { result: RESULT.FAIL, detail: `HTTP ${status || 'ERR'}` };
  if (!bodyValid) return { result: RESULT.FAIL, detail: 'invalid or error body' };
  if (ms > thresholdMs) return { result: RESULT.SLOW, detail: `${ms}ms > ${thresholdMs}ms` };
  return { result: RESULT.PASS, detail: '' };
}

// Classify a single journey step outcome.
// A step FAILs only on real breakage: failed first-party network requests, or a
// missing expected element. Console errors are counted for visibility but do NOT
// fail the step — they're dominated by third-party noise (Google Sign-In/FedCM,
// ad scripts, CORS) that can't work in a headless, unauthenticated browser.
export function classifyPage({ loadMs, netErrors = [], consoleErrors = [], elementFound, thresholdMs }) {
  const problems = [];
  if (elementFound === false) problems.push('expected element missing');
  if (netErrors.length) problems.push(`${netErrors.length} network request(s) failed`);
  if (problems.length) return { result: RESULT.FAIL, detail: problems.join('; ') };
  const note = consoleErrors.length ? `${consoleErrors.length} console error(s) [info]` : '';
  if (loadMs > thresholdMs) {
    return { result: RESULT.SLOW, detail: [`${loadMs}ms > ${thresholdMs}ms`, note].filter(Boolean).join('; ') };
  }
  return { result: RESULT.PASS, detail: note };
}

export function isAlertworthy(result) {
  return result === RESULT.FAIL || result === RESULT.SLOW;
}
