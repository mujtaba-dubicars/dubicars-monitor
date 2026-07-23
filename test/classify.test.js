import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyApi, classifyPage, RESULT } from '../src/classify.js';

test('API: fast 200 with valid body -> PASS', () => {
  const r = classifyApi({ status: 200, ms: 120, bodyValid: true, thresholdMs: 600 });
  assert.equal(r.result, RESULT.PASS);
});

test('API: 200 but over threshold -> SLOW', () => {
  const r = classifyApi({ status: 200, ms: 812, bodyValid: true, thresholdMs: 600 });
  assert.equal(r.result, RESULT.SLOW);
});

test('API: non-200 -> FAIL', () => {
  const r = classifyApi({ status: 500, ms: 50, bodyValid: false, thresholdMs: 600 });
  assert.equal(r.result, RESULT.FAIL);
});

test('API: 200 but invalid body -> FAIL', () => {
  const r = classifyApi({ status: 200, ms: 50, bodyValid: false, thresholdMs: 600 });
  assert.equal(r.result, RESULT.FAIL);
});

test('Page: clean and fast -> PASS', () => {
  const r = classifyPage({ loadMs: 1500, netErrors: [], consoleErrors: [], elementFound: true, thresholdMs: 4000 });
  assert.equal(r.result, RESULT.PASS);
});

test('Page: network errors -> FAIL (even if fast)', () => {
  const r = classifyPage({ loadMs: 900, netErrors: [{ status: 404 }], consoleErrors: [], elementFound: true, thresholdMs: 4000 });
  assert.equal(r.result, RESULT.FAIL);
});

test('Page: missing expected element -> FAIL', () => {
  const r = classifyPage({ loadMs: 900, netErrors: [], consoleErrors: [], elementFound: false, thresholdMs: 4000 });
  assert.equal(r.result, RESULT.FAIL);
});

test('Page: clean but slow -> SLOW', () => {
  const r = classifyPage({ loadMs: 5200, netErrors: [], consoleErrors: [], elementFound: true, thresholdMs: 4000 });
  assert.equal(r.result, RESULT.SLOW);
});
