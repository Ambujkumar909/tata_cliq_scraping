#!/usr/bin/env node
/**
 * SCRAPE_PROXY self-test — run this once after buying a residential proxy.
 *
 *   SCRAPE_PROXY=http://user:pass@host:port node scripts/test-proxy.mjs
 *
 * Checks, in order:
 *   1. Ajio SEARCH  (works from datacenter IPs — baseline sanity)
 *   2. Ajio PDP     direct — expected 403 from a datacenter IP
 *   3. Ajio PDP     through the proxy — 200 here means the detail tier is
 *                   unlocked: real titles, specs, style codes for Ajio
 *   4. The adapter path (fetchAjioDetail) with the proxy scoping active
 */
import { searchAjio, fetchAjioDetail } from '../src/sources/ajio.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.ajio.com/', Origin: 'https://www.ajio.com' };

const proxy = process.env.SCRAPE_PROXY || '';
const masked = proxy ? proxy.replace(/\/\/([^:]+):[^@]+@/, '//$1:****@') : '(not set)';
console.log(`\n🔌 SCRAPE_PROXY: ${masked}`);
console.log(`   PROXY_HOSTS : ${process.env.PROXY_HOSTS || 'ajio.com (default)'}\n`);

// 1. Baseline: search works direct
const s = await searchAjio('levis men jeans', { limit: 3 });
const code = s.candidates?.[0]?.id;
console.log(`1. Ajio search (direct)   : ${s.blocked ? '✗ BLOCKED' : `✓ ok (${s.candidates.length} results)`}`);
if (!code) { console.log('   no product code to test PDP with — aborting'); process.exit(1); }

// 2. PDP direct — expected 403
try {
  const r = await fetch(`https://www.ajio.com/api/p/${code}`, { headers: HEADERS });
  console.log(`2. Ajio PDP (direct)      : HTTP ${r.status} ${r.status === 403 ? '(expected — Akamai wall)' : ''}`);
} catch (e) { console.log(`2. Ajio PDP (direct)      : ERR ${e.message}`); }

// 3. PDP through the proxy explicitly
if (!proxy) {
  console.log('3. Ajio PDP (via proxy)   : skipped — set SCRAPE_PROXY first');
} else {
  try {
    const { ProxyAgent } = await import('undici');
    const r = await fetch(`https://www.ajio.com/api/p/${code}`, { headers: HEADERS, dispatcher: new ProxyAgent(proxy) });
    console.log(`3. Ajio PDP (via proxy)   : HTTP ${r.status} ${r.status === 200 ? '✓ DETAIL TIER UNLOCKED' : '✗ proxy IP also blocked — try another provider/geo (IN residential works best)'}`);
  } catch (e) { console.log(`3. Ajio PDP (via proxy)   : ERR ${e.message} — check proxy URL/credentials`); }
}

// 4. Adapter path (respects PROXY_HOSTS scoping)
const d = await fetchAjioDetail({ id: code });
console.log(`4. fetchAjioDetail        : ${d.available ? `✓ available (${Object.keys(d.attributes || {}).length} attributes)` : `✗ ${d.reason}`}`);

console.log(`\n${d.available ? '✅ Ajio detail tier is LIVE — specs, descriptions and content quality now flow into reports.' : proxy ? '❌ Proxy did not unlock Ajio — verify it is a residential/mobile IN egress.' : 'ℹ Set SCRAPE_PROXY in .env and re-run. Until then Ajio serves listing data only.'}\n`);
