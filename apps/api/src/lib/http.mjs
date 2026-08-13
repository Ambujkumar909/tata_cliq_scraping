/**
 * Resilient HTTP layer: browser-like headers, timeout, retry with backoff,
 * and optional upstream proxy (needed for IP-reputation-blocked sources like Ajio).
 */

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let dispatcher = null;
let dispatcherReady = false;

async function getDispatcher() {
  if (dispatcherReady) return dispatcher;
  dispatcherReady = true;
  const proxy = process.env.SCRAPE_PROXY;
  if (proxy) {
    try {
      const { ProxyAgent } = await import('undici');
      dispatcher = new ProxyAgent(proxy);
      console.log(`[http] SCRAPE_PROXY active for hosts: ${proxyHostList().join(', ')}`);
    } catch {
      console.warn('[http] SCRAPE_PROXY set but "undici" not installed — running direct');
    }
  }
  return dispatcher;
}

/**
 * Hosts the proxy applies to. Residential/mobile proxies bill per GB, and only
 * Ajio's Akamai edge actually needs one — CLIQ and Myntra answer datacenter
 * IPs fine. So the proxy is scoped per-host (suffix match, default ajio.com)
 * instead of swallowing all traffic. Override: PROXY_HOSTS=ajio.com,myntra.com
 */
function proxyHostList() {
  return (process.env.PROXY_HOSTS || 'ajio.com')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function needsProxy(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return proxyHostList().some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Proxy dispatcher for adapters that manage their own fetch calls (Myntra's
 * cookie-warmed gateway). Returns undici's ProxyAgent when the URL's host is
 * proxy-scoped, else null. Without this, PROXY_HOSTS=myntra.com would be
 * silently ignored by the Myntra adapter.
 */
export async function getProxyDispatcher(url) {
  return needsProxy(url) ? getDispatcher() : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { headers = {}, retries = 3, timeoutMs } = {}) {
  const timeout = timeoutMs || Number(process.env.HTTP_TIMEOUT_MS || 20000);
  const disp = needsProxy(url) ? await getDispatcher() : null;
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': DEFAULT_UA,
          'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
          ...headers,
        },
        signal: ctrl.signal,
        ...(disp ? { dispatcher: disp } : {}),
      });
      clearTimeout(t);
      const body = await res.text();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      // 403/blocked won't recover on retry from same IP — fail fast.
      if (err.status === 403) break;
      if (attempt < retries) await sleep(300 * attempt);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, { headers: { Accept: 'application/json', ...(opts.headers || {}) }, ...opts });
  return JSON.parse(text);
}

/** Extract a balanced JSON object that follows an anchor string in `html`. */
export function extractJsonAfter(html, anchor) {
  const i = html.indexOf(anchor);
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      if (--depth === 0) {
        try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}
