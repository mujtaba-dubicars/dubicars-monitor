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
export function classifyPage({ loadMs, netErrors = [], consoleErrors = [], elementFound, thresholdMs }) {
  const problems = [];
  if (elementFound === false) problems.push('expected element missing');
  if (netErrors.length) problems.push(`${netErrors.length} network request(s) failed`);
  if (consoleErrors.length) problems.push(`${consoleErrors.length} console error(s)`);
  if (problems.length) return { result: RESULT.FAIL, detail: problems.join('; ') };
  if (loadMs > thresholdMs) return { result: RESULT.SLOW, detail: `${loadMs}ms > ${thresholdMs}ms` };
  return { result: RESULT.PASS, detail: '' };
}

export function isAlertworthy(result) {
  return result === RESULT.FAIL || result === RESULT.SLOW;
}
