#!/usr/bin/env node
/**
 * tatort-coverage.mjs — Audita la cobertura real de Tatort (tt0806910) episodio por episodio para
 * los últimos ~10 años: ¿hay stream (audio alemán) y subtítulo en español para cada uno?
 *
 * Contexto: Tatort es una antología alemana larguísima. Cinemeta la mapea con season=año,
 * number=episodio-del-año. Los indexers de torrents casi nunca parsean los releases de Tatort a
 * ese esquema (los nombran por número de Folge o por título de caso), así que la cobertura de
 * streams por la vía estándar es pobre y muy sesgada a lo reciente. Los subtítulos en español son
 * casi inexistentes (OpenSubtitles.com: 1 en toda la historia de la serie; SubDL: 0).
 *
 * Este script mide exactamente cuánto de eso es cierto hoy, contra la cuenta real, y deja el
 * resultado en data/tatort-coverage.jsonl (una línea por episodio). Es RESUMIBLE: si se corta,
 * al volver a correr saltea los episodios ya medidos. Reporta, no escribe nada en la cuenta.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso:
 *   node scripts/tatort-coverage.mjs                # mide desde 2016 hasta hoy
 *   node scripts/tatort-coverage.mjs --from 2020    # acota el año inicial
 *   node scripts/tatort-coverage.mjs --report       # solo re-imprime el resumen del jsonl actual
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isCachedStream, isRealStream, isUtilityStream, isSpanishLang } from './lib/addon-signals.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'data', 'tatort-coverage.jsonl');
const IMDB = 'tt0806910';
const API = 'https://api.strem.io/api';

const args = process.argv.slice(2);
const fromYear = Number((args.find((a) => a.startsWith('--from'))?.split('=')[1]) || args[args.indexOf('--from') + 1] || 2016);
const reportOnly = args.includes('--report');

const post = (p, b) =>
  fetch(`${API}/${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
    signal: AbortSignal.timeout(25000),
  }).then((r) => r.json());
const getJson = (u, t = 22000) =>
  fetch(u, { signal: AbortSignal.timeout(t) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));
const hasRes = (m, r) => (m?.resources || []).some((x) => x === r || x?.name === r);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadDone() {
  if (!existsSync(OUT)) return new Map();
  const m = new Map();
  for (const line of readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) {
    try {
      const o = JSON.parse(line);
      m.set(o.key, o);
    } catch {}
  }
  return m;
}

function summarize(rows) {
  const byYear = {};
  for (const r of rows) {
    const y = r.season;
    byYear[y] ||= { eps: 0, anyStream: 0, cached: 0, realStream: 0, esSub: 0, esSubReal: 0 };
    const b = byYear[y];
    b.eps++;
    if (r.streamsTotal > 0) b.anyStream++;
    if (r.cachedTotal > 0) b.cached++;
    if (r.realStreamTotal > 0) b.realStream++;
    if (r.esSubsTotal > 0) b.esSub++;
    if (r.esSubsReal > 0) b.esSubReal++;
  }
  console.log('\n' + '═'.repeat(74));
  console.log(' TATORT — cobertura por año (episodios ya estrenados)');
  console.log('═'.repeat(74));
  console.log('año   eps  c/stream  cacheado  stream-real  c/sub-ES  sub-ES-real');
  let T = { eps: 0, anyStream: 0, cached: 0, realStream: 0, esSub: 0, esSubReal: 0 };
  for (const y of Object.keys(byYear).sort()) {
    const b = byYear[y];
    for (const k of Object.keys(T)) T[k] += b[k];
    console.log(
      `${y}  ${String(b.eps).padStart(4)}  ${String(b.anyStream).padStart(7)}  ${String(b.cached).padStart(8)}  ${String(b.realStream).padStart(10)}  ${String(b.esSub).padStart(8)}  ${String(b.esSubReal).padStart(10)}`
    );
  }
  console.log('─'.repeat(74));
  console.log(
    `TOT ${String(T.eps).padStart(5)}  ${String(T.anyStream).padStart(7)}  ${String(T.cached).padStart(8)}  ${String(T.realStream).padStart(10)}  ${String(T.esSub).padStart(8)}  ${String(T.esSubReal).padStart(10)}`
  );
  console.log('═'.repeat(74));
  console.log(
    `\nStreams (algún addon):   ${T.anyStream}/${T.eps} (${((100 * T.anyStream) / T.eps).toFixed(1)}%)` +
      `\nStreams cacheados TorBox: ${T.cached}/${T.eps} (${((100 * T.cached) / T.eps).toFixed(1)}%)` +
      `\nSubs ES (algo):           ${T.esSub}/${T.eps} (${((100 * T.esSub) / T.eps).toFixed(1)}%)` +
      `\nSubs ES reales (no auto): ${T.esSubReal}/${T.eps} (${((100 * T.esSubReal) / T.eps).toFixed(1)}%)`
  );
}

// ── Cinemeta: lista de episodios ────────────────────────────────────────────
const meta = await getJson(`https://v3-cinemeta.strem.io/meta/series/${IMDB}.json`, 30000);
const now = new Date();
const allVids = (meta?.meta?.videos || [])
  .filter((v) => v.season >= fromYear && v.season < 3000)
  .filter((v) => {
    const d = v.released || v.firstAired;
    return d && new Date(d) <= now;
  })
  .sort((a, b) => a.season - b.season || a.number - b.number);

const done = loadDone();

if (reportOnly) {
  summarize([...done.values()]);
  process.exit(0);
}

console.log(`Tatort: ${allVids.length} episodios estrenados desde ${fromYear}. Ya medidos: ${done.size}.`);

// ── Login + addons ─────────────────────────────────────────────────────────
const login = await post('login', { authKey: null, email: process.env.ST_EMAIL, password: process.env.ST_PASS });
const authKey = login?.result?.authKey;
if (!authKey) {
  console.error('Login fallido:', JSON.stringify(login?.error || login));
  process.exit(1);
}
const col = await post('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const streamAddons = addons.filter(
  (a) => hasRes(a.manifest, 'stream') && !['Streailer', 'MyTrakt Sync | ElfHosted'].includes(a.manifest?.name)
);
const subAddons = addons.filter((a) => hasRes(a.manifest, 'subtitles') && !(a.manifest?.id || '').startsWith('trakt.addon.v3.'));

console.log('Streams:', streamAddons.map((a) => a.manifest.name).join(', '));
console.log('Subs   :', subAddons.map((a) => a.manifest.name).join(', '));

// ── Medición episodio por episodio ─────────────────────────────────────────
const pending = allVids.filter((v) => !done.has(`${v.season}:${v.number}`));
console.log(`\nMidiendo ${pending.length} episodios...\n`);

let n = 0;
for (const v of pending) {
  const sid = `${IMDB}:${v.season}:${v.number}`;
  const key = `${v.season}:${v.number}`;

  const streamResults = await Promise.all(
    streamAddons.map(async (a) => {
      const r = await getJson(`${baseOf(a.transportUrl)}stream/series/${sid}.json`, 20000);
      const list = (r?.streams || []).filter((s) => !isUtilityStream(s));
      return {
        name: a.manifest.name,
        count: list.length,
        cached: list.filter(isCachedStream).length,
        real: list.filter(isRealStream).length,
        sample: list[0] ? `${list[0].name || ''} ${list[0].title || ''}`.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
      };
    })
  );
  const subResults = await Promise.all(
    subAddons.map(async (a) => {
      const r = await getJson(`${baseOf(a.transportUrl)}subtitles/series/${sid}.json`, 18000);
      const list = r?.subtitles || [];
      const es = list.filter((s) => isSpanishLang(s.lang));
      // "auto" = etiqueta de traducción bajo demanda, no un sub ya hecho
      const esReal = es.filter((s) => !/make |translat|auto/i.test(String(s.lang)));
      return { name: a.manifest.name, es: es.length, esReal: esReal.length, langs: [...new Set(list.map((s) => s.lang))].slice(0, 8) };
    })
  );

  const row = {
    key,
    imdb: sid,
    season: v.season,
    number: v.number,
    title: v.name || '',
    released: (v.released || v.firstAired || '').slice(0, 10),
    streamsTotal: streamResults.reduce((s, r) => s + r.count, 0),
    cachedTotal: streamResults.reduce((s, r) => s + r.cached, 0),
    realStreamTotal: streamResults.reduce((s, r) => s + r.real, 0),
    streamsByAddon: streamResults.filter((r) => r.count > 0),
    esSubsTotal: subResults.reduce((s, r) => s + r.es, 0),
    esSubsReal: subResults.reduce((s, r) => s + r.esReal, 0),
    subsByAddon: subResults.filter((r) => r.es > 0),
    checkedAt: new Date().toISOString(),
  };
  appendFileSync(OUT, JSON.stringify(row) + '\n');
  done.set(key, row);

  n++;
  const mark = row.streamsTotal ? (row.cachedTotal ? '⚡' : '·') : '✗';
  const smark = row.esSubsReal ? 'S' : row.esSubsTotal ? 's' : '–';
  process.stdout.write(
    `[${n}/${pending.length}] ${sid} ${row.released} ${mark}${smark} str=${row.streamsTotal}(c${row.cachedTotal}) esSub=${row.esSubsTotal}  ${v.name?.slice(0, 40) || ''}\n`
  );
  await sleep(250);
}

summarize([...done.values()]);
process.exit(0);
