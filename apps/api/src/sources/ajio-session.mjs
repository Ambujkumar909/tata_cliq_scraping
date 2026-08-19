/**
 * Ajio browser session — reads the PDP tier through a real page context.
 *
 * WHY A BROWSER, AND WHY NOT JUST COOKIES
 * ---------------------------------------
 * Measured on one machine, one residential IP, within seconds of each other:
 *
 *   Node fetch, every header permutation ............ 403
 *   Headless Chrome, any Ajio URL ................... "Access Denied", 0 cookies
 *   Headed Chrome, PDP .............................. loads, 36 cookies, but
 *                                                     `_abck` stays UNVALIDATED
 *   Node fetch WITH those harvested cookies ......... still 403
 *   fetch() executed INSIDE the page ................ 200 + full featureData
 *
 * So the gate is not the IP, not the headers, and not the cookie jar as a
 * value — it is the live browser context Akamai's sensor is bound to. Cookie
 * harvesting cannot work; the request has to originate in the page. Hence this
 * module keeps ONE warm page and runs `fetch` inside it.
 *
 * Cost is amortised: the first product pays the page load (~3s), every product
 * after it costs ~0.7s on the same page.
 *
 * HEADLESS IS DETECTED — the browser must run headed. On a server that means a
 * virtual display (Xvfb); see the Dockerfile and README for the Ubuntu setup.
 *
 * Opt-in (AJIO_BROWSER_COOKIES=true) and fully optional: a missing
 * playwright-core, missing browser, or any failure degrades to today's
 * behaviour — Ajio specs render "not available", never a crash.
 */
import { config } from '../config.mjs';
import { resolve } from 'node:path';

const IDLE_CLOSE_MS = 5 * 60 * 1000;
const PAGE_MAX_AGE_MS = 15 * 60 * 1000; // recycle before Akamai sours on it
const NAV_TIMEOUT_MS = 30000;

let _ctx = null;
let _page = null;
let _pageAt = 0;
let _closeTimer = null;
let _booting = null;
let _disabled = false;

const log = (m) => console.log(`[ajio-session] ${m}`);

/**
 * Launch a PERSISTENT browser context.
 *
 * A default Playwright launch is refused by Ajio even headed: it runs with
 * `--enable-automation`, leaving `navigator.webdriver === true` and an empty
 * throwaway profile. Measured side by side, minutes apart on one machine:
 * default launch -> "Access Denied"; persistent profile with that flag
 * suppressed -> page loads and the in-page API returns 200 WITH the size guide.
 *
 * The profile lives on disk and accumulates ordinary cookies/history, which is
 * precisely what makes it read as a returning customer rather than a scraper.
 * NOTE: a user-data-dir is single-instance — only one process may hold it.
 */
async function launchContext() {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    log('playwright-core not installed — Ajio charts stay unavailable');
    _disabled = true;
    return null;
  }
  const userDataDir = config.browserProfileDir || resolve(process.cwd(), '.cache', 'ajio-profile');
  const base = {
    headless: false, // headless is fingerprinted and refused outright
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
    ignoreDefaultArgs: ['--enable-automation'],
    locale: 'en-IN', timezoneId: 'Asia/Kolkata', viewport: { width: 1366, height: 768 },
  };
  const attempts = [];
  if (config.chromePath) attempts.push({ executablePath: config.chromePath });
  attempts.push({ channel: 'chrome' }, { channel: 'chromium' }, { channel: 'msedge' }, {});
  for (const opts of attempts) {
    try {
      const ctx = await chromium.launchPersistentContext(userDataDir, { ...base, ...opts });
      log(`browser ready (${opts.channel || opts.executablePath || 'default'})`);
      return ctx;
    } catch { /* next candidate */ }
  }
  log('no usable browser (set CHROME_PATH, and DISPLAY on Linux) — Ajio charts stay unavailable');
  _disabled = true;
  return null;
}

/** Bring up a warm page, seeded on a real Ajio PDP. */
async function ensurePage(seedUrl) {
  if (_page && Date.now() - _pageAt < PAGE_MAX_AGE_MS && !_page.isClosed()) return _page;
  if (_booting) return _booting;

  _booting = (async () => {
    // Recycle a stale page but KEEP the persistent context — its accumulated
    // profile is what makes Ajio treat this as an ordinary browser.
    if (_page && !_page.isClosed()) await _page.close().catch(() => {});
    _page = null;
    if (!_ctx) _ctx = await launchContext();
    if (!_ctx) return null;
    try {
      const page = await _ctx.newPage();
      await page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      // A little human motion; the sensor watches for it.
      await page.mouse.move(400, 300);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(2000);

      if (/access denied/i.test(await page.title())) {
        log('seed page denied — Ajio is refusing this client right now');
        await page.close().catch(() => {});
        return null;
      }
      _page = page;
      _pageAt = Date.now();
      log('page warm');
      return _page;
    } catch (err) {
      log(`page warm-up failed: ${err.message}`);
      return null;
    } finally {
      scheduleClose();
    }
  })().finally(() => {
    _booting = null;
  });

  return _booting;
}

function scheduleClose() {
  clearTimeout(_closeTimer);
  _closeTimer = setTimeout(() => closeAjioSession(), IDLE_CLOSE_MS);
  _closeTimer.unref?.();
}

/**
 * Fetch Ajio's PDP JSON for one product code, from inside the page context.
 * Returns the parsed payload, or null when the broker is off/unavailable —
 * callers treat null as "detail tier not available".
 */
export async function ajioPdpFetch(code, seedUrl) {
  if (!config.ajioBrowserCookies || _disabled || !code) return null;
  if (!seedUrl) return null; // a REAL pdp url is required to seed a usable context
  const page = await ensurePage(seedUrl);
  if (!page) return null;
  scheduleClose();

  try {
    const out = await page.evaluate(async (c) => {
      const r = await fetch(`https://www.ajio.com/api/p/${c}?fields=SITE`, {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      return r.ok ? { ok: true, data: await r.json() } : { ok: false, status: r.status };
    }, code);
    if (out?.ok) return out.data;
    // A 403 here means the page soured — force a fresh one next call.
    if (out?.status === 403) _pageAt = 0;
    return null;
  } catch (err) {
    log(`pdp fetch failed: ${err.message}`);
    _pageAt = 0; // recycle on any page-level error
    return null;
  }
}

export const ajioBrowserEnabled = () => config.ajioBrowserCookies && !_disabled;

/** Release the browser (idle timer and shutdown). */
export async function closeAjioSession() {
  clearTimeout(_closeTimer);
  const c = _ctx;
  _ctx = null;
  _page = null;
  await c?.close().catch(() => {});
}
