#!/usr/bin/env node
/**
 * diagnose-tatort.mjs — Diagnóstico de un solo uso: Pablo pidió esfuerzo máximo para conseguir
 * Tatort (tt0806910) en alemán con subtítulos español latino, al menos los últimos 10 años.
 * Tatort corre desde 1970 con ~30 episodios/año (cada uno una película standalone de 90min con
 * elenco distinto) — son cientos de episodios en la última década, así que este script muestrea
 * en vez de probar todos: agarra los episodios de los últimos N años (de la lista real de
 * MyTrakt/Cinemeta) y prueba streams (cualquier addon) + subtítulos ES (cualquier fuente) contra
 * la cuenta real, para saber con evidencia si hay cobertura real antes de instalar/armar nada.
 *
 * Corregido 2026-09-03: el primer intento usaba tt0185906, que en realidad es "Band of Brothers"
 * (confirmado contra Cinemeta: devolvía ese nombre, 14 episodios, todos de 2001) — id equivocado,
 * no un límite real de cobertura de Tatort. El id correcto, confirmado por búsqueda externa
 * (imdb.com/title/tt0806910), es tt0806910.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/diagnose-tatort.mjs [años=10] [muestraPorAño=2]
 *
 * Node >= 20, sin dependencias.
 */
import { isUtilityStream, isRealStream } from './lib/addon-signals.mjs';

const API = 'https://api.strem.io/api';
const IMDB_ID = 'tt0806910';
const die = (m, code = 1) => { console.error(`✗ ${m}`); process.exit(code); };
const apiPost = (path, body) =>
  fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  }).then((r) => r.json());
const getJson = (url, t = 20000) =>
  fetch(url, { signal: AbortSignal.timeout(t) })
    .then((r) => (r.ok ? r.json() : null))
    .catch((e) => ({ __error: String(e) }));
const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));
const hasRes = (m, r) => (m?.resources || []).some((x) => x === r || x?.name === r);

const [, , yearsArg, sampleArg] = process.argv;
const years = yearsArg ? Number(yearsArg) : 10;
const samplePerYear = sampleArg ? Number(sampleArg) : 2;

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

console.log('═'.repeat(70));
console.log(` MejoraStremio — Diagnóstico Tatort (${IMDB_ID}) — últimos ${years} años`);
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(70));

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const streamAddons = addons.filter((a) => hasRes(a.manifest, 'stream'));
const subAddons = addons.filter((a) => hasRes(a.manifest, 'subtitles'));
const myTrakt = addons.find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));
console.log(`${streamAddons.length} addon(s) de streams, ${subAddons.length} de subtítulos.\n`);

// Cinemeta tiene la lista completa de episodios de shows masivos como Tatort — MyTrakt Sync a
// veces trunca listas muy largas. Se prueban ambos y se usa el que devuelva más episodios.
const CINEMETA = 'https://v3-cinemeta.strem.io';
const [cinemetaMeta, traktMeta] = await Promise.all([
  getJson(`${CINEMETA}/meta/series/${IMDB_ID}.json`),
  myTrakt ? getJson(`${baseOf(myTrakt.transportUrl)}meta/series/${IMDB_ID}.json`) : null,
]);
const cinemetaVideos = cinemetaMeta?.meta?.videos || [];
const traktVideos = traktMeta?.meta?.videos || [];
const videos = traktVideos.length > cinemetaVideos.length ? traktVideos : cinemetaVideos;
console.log(`Fuente de episodios: ${traktVideos.length > cinemetaVideos.length ? 'MyTrakt Sync' : 'Cinemeta'} — ${videos.length} episodio(s) totales listados.\n`);
if (!videos.length) die('No se pudo obtener la lista de episodios de Tatort.');

const cutoffYear = new Date().getFullYear() - years;
const recentByYear = new Map();
for (const v of videos) {
  const dateStr = v.released || v.firstAired || v.air_date;
  if (!dateStr) continue;
  const year = new Date(dateStr).getFullYear();
  if (Number.isNaN(year) || year < cutoffYear) continue;
  if (!recentByYear.has(year)) recentByYear.set(year, []);
  recentByYear.get(year).push(v);
}

const totalRecent = [...recentByYear.values()].reduce((s, arr) => s + arr.length, 0);
console.log(`Episodios desde ${cutoffYear}: ${totalRecent} (${recentByYear.size} año(s) con datos).`);
console.log(`Muestreando ${samplePerYear} por año (primero y último disponible de cada año) — total estimado: ~${Math.min(totalRecent, samplePerYear * recentByYear.size)} episodios a probar.\n`);

const sample = [];
for (const [year, eps] of [...recentByYear.entries()].sort((a, b) => a[0] - b[0])) {
  eps.sort((a, b) => (a.season - b.season) || (a.number - b.number));
  const picked = samplePerYear >= eps.length ? eps : [eps[0], eps[eps.length - 1]].filter((v, i, arr) => arr.indexOf(v) === i);
  for (const p of picked) sample.push({ ...p, __year: year });
}

console.log(`Probando ${sample.length} episodio(s) de muestra:\n`);

let streamHits = 0, subHits = 0, engSubHits = 0;
const findings = [];

for (const ep of sample) {
  const label = `${ep.__year} S${String(ep.season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')} "${ep.name || ep.title || ''}"`;
  const streamId = `${IMDB_ID}:${ep.season}:${ep.number}`;

  let totalReal = 0;
  const perAddon = [];
  for (const a of streamAddons) {
    const base = baseOf(a.transportUrl);
    const d = await getJson(`${base}stream/series/${streamId}.json`, 18000);
    const streams = (d?.streams || []).filter((s) => !isUtilityStream(s));
    const real = streams.filter(isRealStream);
    if (real.length) perAddon.push(`${a.manifest.name}=${real.length}`);
    totalReal += real.length;
  }
  if (totalReal > 0) streamHits++;

  let esSubs = 0, enSubs = 0;
  for (const a of subAddons) {
    const base = baseOf(a.transportUrl);
    const d = await getJson(`${base}subtitles/series/${streamId}.json`, 15000);
    for (const s of d?.subtitles || []) {
      const lang = (s.lang || '').toLowerCase();
      if (lang.startsWith('es') || lang.startsWith('spa') || lang.includes('spanish')) esSubs++;
      else if (lang.startsWith('en') || lang.startsWith('eng') || lang.includes('english')) enSubs++;
    }
  }
  if (esSubs > 0) subHits++;
  if (enSubs > 0) engSubHits++;

  const flag = totalReal >= 3 ? '✅' : totalReal > 0 ? '⚠' : '✗';
  const subFlag = esSubs > 0 ? '✅ES' : enSubs > 0 ? '⚠solo-EN' : '✗sin-subs';
  console.log(`  ${flag} ${label} — ${totalReal} streams (${perAddon.join(' ') || 'ninguno'}) | subs: ${subFlag} (es=${esSubs} en=${enSubs})`);
  findings.push({ label, totalReal, esSubs, enSubs });
}

console.log('\n' + '═'.repeat(70));
console.log(`RESUMEN: ${streamHits}/${sample.length} episodios con al menos 1 stream real.`);
console.log(`         ${subHits}/${sample.length} episodios con al menos 1 subtítulo ES real.`);
console.log(`         ${engSubHits}/${sample.length} episodios con subtítulo EN (fuente posible para traducción IA).`);
console.log('═'.repeat(70));
process.exit(0);
