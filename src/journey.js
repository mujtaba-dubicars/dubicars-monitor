import { chromium } from 'playwright';
import { classifyPage, RESULT } from './classify.js';

function newBucket() {
  return { net: [], console: [] };
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isFirstParty(url, firstPartyHosts) {
  const h = hostOf(url);
  return firstPartyHosts.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

// Try to drive the real homepage search: open the popup, type, submit, and
// confirm listings rendered. Throws if any part fails so the caller can fall back.
async function interactiveSearch(page, cfg, navTimeoutMs, listingSrc) {
  const s = cfg.journey.search;
  let opened = false;
  for (const sel of s.triggers) {
    const trigger = page.locator(sel).first();
    if ((await trigger.count()) === 0) continue;
    await trigger.click({ force: true, timeout: 4000 }).catch(() => {});
    try {
      await page.locator(s.input).first().waitFor({ state: 'visible', timeout: 3000 });
      opened = true;
      break;
    } catch {
      // try next trigger
    }
  }
  if (!opened) throw new Error('search popup did not open');

  const input = page.locator(s.input).first();
  await input.fill(cfg.journey.searchTerm, { timeout: 4000 });
  await page.waitForTimeout(s.typeSettleMs); // let autocomplete populate
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: navTimeoutMs }).catch(() => {}),
    input.press('Enter'),
  ]);
  // Confirm real results appeared; if not, let the caller fall back.
  await page.waitForFunction(
    (re) => [...document.querySelectorAll('a[href]')].some((a) => new RegExp(re).test(a.href)),
    listingSrc,
    { timeout: 10000 },
  );
}

// Run the 3-step browser journey. Returns { rows, netErrorRows }.
export async function runJourney(cfg) {
  const t = cfg.thresholds.pageMs;
  const { firstPartyHosts, navTimeoutMs, ignore } = cfg.journey;
  const listingSrc = cfg.journey.listingLinkRegex;
  const listingRe = new RegExp(listingSrc);
  const ignoreUrlRes = (ignore?.urlPatterns || []).map((p) => new RegExp(p));
  const ignoreConsoleRes = (ignore?.consolePatterns || []).map((p) => new RegExp(p));
  const ignoreErrorTexts = ignore?.errorTexts || [];
  const rows = [];
  const netErrorRows = [];

  const isIgnorableNet = (n) =>
    ignoreErrorTexts.some((t2) => (n.detail || '').includes(t2)) ||
    ignoreUrlRes.some((re) => re.test(n.url));
  const isIgnorableConsole = (text) => ignoreConsoleRes.some((re) => re.test(text));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let bucket = newBucket();
  page.on('response', (res) => {
    const s = res.status();
    if (s >= 400) bucket.net.push({ url: res.url(), status: s, detail: '' });
  });
  page.on('requestfailed', (req) => {
    bucket.net.push({ url: req.url(), status: 'FAILED', detail: req.failure()?.errorText || '' });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.console.push(msg.text());
  });
  page.on('pageerror', (err) => bucket.console.push(err.message));

  // Run one named step: reset the bucket, time the action, let late requests
  // settle, split network errors into real vs ignorable, classify. A thrown
  // action error is always a FAIL. The action may return a boolean (elementFound)
  // or { elementFound, note } to add context to the row detail.
  async function step(name, action) {
    bucket = newBucket();
    const start = performance.now();
    let elementFound = null;
    let note = '';
    let error = '';
    try {
      const res = await action();
      if (res && typeof res === 'object') {
        elementFound = res.elementFound ?? null;
        note = res.note || '';
      } else if (typeof res === 'boolean') {
        elementFound = res;
      }
    } catch (e) {
      error = e.message;
    }
    const loadMs = Math.round(performance.now() - start);
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      // some pages never fully idle; ignore
    }

    const realNetErrors = bucket.net.filter(
      (n) => isFirstParty(n.url, firstPartyHosts) && !isIgnorableNet(n),
    );
    const ignoredCount = bucket.net.length - realNetErrors.length;
    const consoleErrors = bucket.console.filter((text) => !isIgnorableConsole(text));

    let c;
    if (error) {
      c = { result: RESULT.FAIL, detail: error };
    } else {
      c = classifyPage({ loadMs, netErrors: realNetErrors, consoleErrors, elementFound, thresholdMs: t });
    }
    const parts = [];
    if (note) parts.push(note);
    if (c.detail) parts.push(c.detail);
    if (ignoredCount) parts.push(`${ignoredCount} non-critical request(s) ignored`);

    rows.push({ step: name, url: page.url(), load_time_ms: loadMs, result: c.result, detail: parts.join('; ') });
    for (const ne of realNetErrors) {
      netErrorRows.push({ page: name, request_url: ne.url, status: ne.status, detail: ne.detail });
    }
  }

  try {
    // 1. Land on the homepage.
    await step('land', async () => {
      await page.goto(cfg.journey.baseUrl, { waitUntil: 'load', timeout: navTimeoutMs });
      return true;
    });

    // 2. Search — type into the real homepage search; fall back to the URL.
    await step('search', async () => {
      let note = 'search via typed input';
      try {
        await interactiveSearch(page, cfg, navTimeoutMs, listingSrc);
      } catch (e) {
        note = `search via URL fallback (typed failed: ${e.message})`;
        const url = cfg.journey.searchUrl.replace('{q}', encodeURIComponent(cfg.journey.searchTerm));
        await page.goto(url, { waitUntil: 'load', timeout: navTimeoutMs });
      }
      const hrefs = await page.$$eval('a[href]', (els) => els.map((e) => e.href));
      return { elementFound: hrefs.some((h) => listingRe.test(h)), note };
    });

    // 3. Open any ad from the results.
    await step('open_ad', async () => {
      const hrefs = await page.$$eval('a[href]', (els) => els.map((e) => e.href));
      const adUrl = hrefs.find((h) => listingRe.test(h));
      if (!adUrl) throw new Error('no ad/listing link found on results page');
      await page.goto(adUrl, { waitUntil: 'load', timeout: navTimeoutMs });
      return listingRe.test(page.url());
    });
  } finally {
    await browser.close();
  }

  return { rows, netErrorRows };
}
