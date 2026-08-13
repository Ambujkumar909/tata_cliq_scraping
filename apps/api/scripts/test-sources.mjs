#!/usr/bin/env node
/**
 * Source connectivity diagnostic — run this ON THE DEPLOYMENT HOST to see
 * exactly which platform blocks its IP and at which tier.
 *
 *   node scripts/test-sources.mjs
 *   # or via docker:
 *   docker run --rm -v "$PWD/apps/api:/w" -w /w node:22 node scripts/test-sources.mjs
 *
 * Datacenter/cloud IPs (AWS, GCP…) are routinely blocked by Akamai, which
 * fronts BOTH Myntra and Ajio. Tata CLIQ's searchbff is open. This prints a
 * per-tier verdict so "everything says not found" becomes a specific cause.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const get = async (url, headers = {}, timeoutMs = 15000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal });
    const body = await res.text();
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: '', err: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
};

const verdict = (ok, note) => `${ok ? '✓' : '✗'}  ${note}`;
console.log('\n🔎 PriceLens source connectivity from this host\n');

// 0. Egress IP
const ip = await get('https://api.ipify.org');
console.log(`egress IPv4        : ${ip.body || ip.err || 'unknown'}`);

// 1. Tata CLIQ searchbff
{
  const r = await get(
    'https://searchbff.tatacliq.com/products/mpl/search?searchText=tshirt%3Arelevance&channel=WEB&page=0&pageSize=1&isKeywordRedirectEnabled=false&isTextSearch=true&isMDE=true',
    { Accept: 'application/json', Origin: 'https://www.tatacliq.com', Referer: 'https://www.tatacliq.com/' },
  );
  const ok = r.status === 200 && r.body.includes('searchresult');
  console.log(`TATA CLIQ search   : HTTP ${r.status || r.err}  ${verdict(ok, ok ? 'anchor catalog reachable' : 'BLOCKED — nothing works without this')}`);
}

// 2. Myntra — three tiers
{
  const warm = await get('https://www.myntra.com/tshirts', { Accept: 'text/html', 'Accept-Language': 'en-IN,en;q=0.9' });
  const warmOk = warm.status === 200 && !/access denied|bot|captcha/i.test(warm.body.slice(0, 2000));
  console.log(`MYNTRA cookie warm : HTTP ${warm.status || warm.err}  ${verdict(warmOk, warmOk ? 'storefront serves HTML' : 'bot-walled (Akamai)')}`);

  const gw = await get('https://www.myntra.com/gateway/v2/search/tshirt?rows=1&o=0', {
    Accept: 'application/json',
    'x-myntra-app': 'deviceID=pricelens;reqChannel=web;appFamily=MyntraRetailWeb;',
    Referer: 'https://www.myntra.com/tshirt',
  });
  const gwOk = gw.status === 200 && gw.body.includes('products');
  console.log(`MYNTRA gateway     : HTTP ${gw.status || gw.err}  ${verdict(gwOk, gwOk ? 'search API open' : 'blocked (expected without warmed cookies — fine if fallback works)')}`);

  const htmlOk = warm.status === 200 && warm.body.includes('window.__myx');
  console.log(`MYNTRA html embed  : ${verdict(htmlOk, htmlOk ? '__myx payload present — HTML fallback works' : '__myx MISSING — HTML fallback dead too')}`);

  if (!warmOk && !htmlOk) console.log('                     → Myntra is fully blocked from this IP. Fix: route myntra.com through SCRAPE_PROXY (PROXY_HOSTS=ajio.com,myntra.com).');
}

// 3. Ajio search
{
  const r = await get(
    'https://www.ajio.com/api/search?fields=SITE&currentPage=0&pageSize=1&format=json&query=tshirt&sortBy=relevance&platform=Desktop',
    { Accept: 'application/json', Referer: 'https://www.ajio.com/', Origin: 'https://www.ajio.com' },
  );
  const ok = r.status === 200 && r.body.includes('products');
  console.log(`AJIO search        : HTTP ${r.status || r.err}  ${verdict(ok, ok ? 'search API open' : 'blocked (Akamai) — needs SCRAPE_PROXY')}`);
}

console.log('\nIf Myntra/Ajio are blocked: set SCRAPE_PROXY (Indian residential) in .env,');
console.log('set PROXY_HOSTS to the blocked hosts, and docker compose up -d.\n');
