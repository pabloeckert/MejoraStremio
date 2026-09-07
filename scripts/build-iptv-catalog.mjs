#!/usr/bin/env node
/**
 * build-iptv-catalog.mjs — genera data/iptv-channels.json para la sección "TV en Vivo" de stremioeg.
 *
 * Fuente: iptv-org (github.com/iptv-org), datos públicos de canales de aire/cable legítimos con
 * streams HLS. Filtra por país (castellano + un set internacional en idioma original), saca NSFW /
 * cerrados / categorías no deseadas (religioso, deportes, shop, legislativo) y VERIFICA que cada
 * stream esté vivo con un GET real antes de incluirlo — así el /iptv del hub sirve solo canales que
 * de verdad abren (mismo criterio anti-frustración que el resto del proyecto).
 *
 * Corre en CI (.github/workflows/iptv-refresh.yml) 2×/semana y commitea el archivo. El hub lo lee
 * desde raw.githubusercontent en vivo (cache 6h) — mismo patrón que /synopsis con preset.json.
 *
 * Uso: node scripts/build-iptv-catalog.mjs [--limit N] [--no-verify]
 * Node >= 20, sin dependencias.
 */
import { writeFileSync } from 'node:fs';

const API = 'https://iptv-org.github.io/api';
const OUT = new URL('../data/iptv-channels.json', import.meta.url);
const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const VERIFY = !args.includes('--no-verify');

// Catálogo → países. Castellano: AR/ES/LatAm (filtro por país). Internacional: NO por país
// (serían miles de candidatos), sino un allowlist de canales de noticias/cultura en idioma
// original reconocidos — ver INTL_ALLOWLIST abajo.
const CATALOGS = {
  'iptv-ar': { name: 'Argentina', countries: ['AR'] },
  'iptv-es': { name: 'España', countries: ['ES'] },
  'iptv-latam': { name: 'Latinoamérica', countries: ['MX', 'CO', 'CL', 'UY', 'PE', 'VE'] },
  'iptv-intl': { name: 'Internacional', countries: [] },
};
const COUNTRY_TO_CATALOG = {};
for (const [cid, c] of Object.entries(CATALOGS)) for (const cc of c.countries) COUNTRY_TO_CATALOG[cc] = cid;

// Canales internacionales en idioma original (noticias / cultura / documentales) — ids de iptv-org.
const INTL_ALLOWLIST = new Set([
  'BBCNews.uk', 'BBCNewsHD.uk', 'SkyNews.uk', 'DWEnglish.de', 'France24English.fr',
  'AlJazeeraEnglish.qa', 'CNNInternationalEurope.us', 'CNNInternational.us', 'EuronewsEnglish.fr',
  'BloombergTV.us', 'BloombergTVEurope.us', 'ABCNewsLive.us', 'CBSNews.us', 'NBCNews.us',
  'CNBC.us', 'PBS.us', 'PBSKids.us', 'CSPAN.us', 'CSPAN2.us', 'NASATVPublic.us', 'NASATVMedia.us',
  'DeutscheWelle.de', 'TV5MondeEurope.fr', 'RaiNews24.it', 'Rai1.it', 'Rai2.it', 'Rai3.it',
  'ARD.de', 'ZDF.de', 'ArteDE.de', 'ArteFR.fr', 'BBCOne.uk', 'BBCTwo.uk', 'ITV1.uk', 'Channel4.uk',
  'SBSWorldMovies.au', 'ABCAustralia.au', 'CBCNewsNetwork.ca', 'RTVELa1.es',
  'EuronewsFrench.fr', 'SkyNewsAustralia.au', 'GBNews.uk', 'TRTWorld.tr', 'NHKWorldJapan.jp',
  'AljazeeraMubasher.qa', 'KBSWorld.kr', 'ChannelNewsAsia.sg', 'i24NewsEnglish.il',
  'FRANCE24English.fr', 'Newsmax.us', 'ScrippsNews.us', 'CGTN.cn', 'CGTNDocumentary.cn',
]);

// categorías de iptv-org → género en español (Title Case). Las no listadas → "General".
const GENRE = {
  news: 'Noticias',
  movies: 'Películas',
  series: 'Series',
  documentary: 'Documentales',
  culture: 'Cultura', education: 'Cultura', classic: 'Cultura', science: 'Cultura',
  kids: 'Infantil', animation: 'Infantil', family: 'Infantil',
  music: 'Música',
  entertainment: 'Entretenimiento', comedy: 'Entretenimiento', lifestyle: 'Entretenimiento',
  travel: 'Entretenimiento', cooking: 'Entretenimiento', outdoor: 'Entretenimiento',
};
const DROP_CATEGORIES = new Set(['religious', 'sports', 'shop', 'legislative', 'adult', 'xxx']);

const genreOf = (cats = []) => {
  for (const c of cats) if (GENRE[c]) return GENRE[c];
  return 'General';
};

const getJson = (url, t = 25000) =>
  fetch(url, { signal: AbortSignal.timeout(t) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url} → ${r.status}`))));

async function verifyStream(url, userAgent, referrer) {
  const headers = { 'User-Agent': userAgent || 'Mozilla/5.0', Range: 'bytes=0-2047' };
  if (referrer) headers['Referer'] = referrer;
  try {
    const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!(r.status === 200 || r.status === 206)) return false;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (url.includes('.m3u8') || ct.includes('mpegurl') || ct.includes('vnd.apple')) {
      const txt = await r.text();
      return txt.includes('#EXTM3U');
    }
    return true; // otros contenedores (ts/mp4): con 200/206 alcanza
  } catch {
    return false;
  }
}

console.log('Bajando iptv-org…');
const [channels, streamsArr, logosArr] = await Promise.all([
  getJson(`${API}/channels.json`),
  getJson(`${API}/streams.json`),
  getJson(`${API}/logos.json`),
]);

const streamByCh = new Map();
for (const s of streamsArr) {
  if (!s.channel || !s.url) continue;
  const prev = streamByCh.get(s.channel);
  // preferir el de mejor calidad declarada
  const q = (x) => parseInt(String(x?.quality || '0'), 10) || 0;
  if (!prev || q(s) > q(prev)) streamByCh.set(s.channel, s);
}
const logoByCh = new Map();
for (const l of logosArr) if (l.channel && l.in_use && !logoByCh.has(l.channel)) logoByCh.set(l.channel, l.url);

const catalogFor = (c) => {
  if (INTL_ALLOWLIST.has(c.id)) return 'iptv-intl';
  return COUNTRY_TO_CATALOG[c.country] ?? null;
};

let candidates = channels.filter((c) => {
  if (c.is_nsfw || c.closed || c.replaced_by) return false;
  const cat = catalogFor(c);
  if (!cat) return false;
  // el allowlist internacional pasa aunque su categoría esté en DROP (ej. un canal "public")
  if (cat !== 'iptv-intl' && (c.categories || []).some((x) => DROP_CATEGORIES.has(x))) return false;
  return streamByCh.has(c.id);
});
console.log(`${candidates.length} canal(es) candidato(s) tras filtro estructural.`);
if (Number.isFinite(LIMIT)) candidates = candidates.slice(0, LIMIT);

const out = [];
let checked = 0;
const CONCURRENCY = 24;

// Cap por catálogo: LatAm da >500 candidatos vivos (muchísimo canal local minúsculo). Se
// prioriza tener categoría real (≠ solo "General") y logo, después alfabético. 150 alcanza de
// sobra y la lista queda navegable; el filtro por género hace el resto.
const CAP_PER_CATALOG = 150;
const capScore = (c) => (c.genre !== 'General' ? 2 : 0) + (c.logo ? 1 : 0);
const applyCap = (arr) => {
  const kept = [];
  for (const cid of Object.keys(CATALOGS)) {
    kept.push(...arr.filter((c) => c.catalog === cid)
      .sort((a, b) => capScore(b) - capScore(a) || a.name.localeCompare(b.name, 'es'))
      .slice(0, CAP_PER_CATALOG));
  }
  return kept;
};

const flush = () => {
  const sorted = applyCap(out).sort((a, b) => a.catalog.localeCompare(b.catalog) || a.name.localeCompare(b.name, 'es'));
  const byCatalog = {};
  for (const c of sorted) byCatalog[c.catalog] = (byCatalog[c.catalog] || 0) + 1;
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'iptv-org',
    catalogs: Object.fromEntries(Object.entries(CATALOGS).map(([k, v]) => [k, v.name])),
    counts: byCatalog,
    channels: sorted,
  }, null, 2) + '\n');
  return byCatalog;
};

for (let i = 0; i < candidates.length; i += CONCURRENCY) {
  const batch = candidates.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(async (c) => {
    const s = streamByCh.get(c.id);
    const live = VERIFY ? await verifyStream(s.url, s.user_agent, s.referrer) : true;
    checked++;
    return live ? {
      id: c.id,
      name: c.name,
      catalog: catalogFor(c),
      country: c.country,
      genre: genreOf(c.categories),
      logo: logoByCh.get(c.id) || null,
      url: s.url,
      quality: s.quality || null,
      userAgent: s.user_agent || null,
      referrer: s.referrer || null,
    } : null;
  }));
  for (const r of results) if (r) out.push(r);
  if (checked % 240 < CONCURRENCY) {
    flush(); // flush incremental — una corrida interrumpida igual deja algo usable
    console.log(`  ${checked}/${candidates.length} verificados, ${out.length} vivos`);
  }
}

const byCatalog = flush();
console.log(`\n✓ ${out.length} canales vivos escritos en data/iptv-channels.json`);
console.log('  por catálogo:', JSON.stringify(byCatalog));
