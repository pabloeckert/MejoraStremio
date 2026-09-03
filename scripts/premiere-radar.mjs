#!/usr/bin/env node
/**
 * premiere-radar.mjs — Para cada show en progreso/watchlist en MyTrakt Sync, calcula el próximo
 * episodio no visto y avisa por email la PRIMERA vez que ese episodio puntual está realmente listo
 * para ver: al menos un stream cacheado en TorBox (Torrentio/Comet, sin depender de que el swarm
 * P2P tenga seeds vivos) Y al menos un subtítulo en español ya hecho (no una traducción bajo
 * demanda todavía sin generar) en alguna de las 5 fuentes de subs instaladas.
 *
 * "Próximo episodio no visto" viene directo del campo `watched` que MyTrakt Sync ya calcula por
 * episodio en su propio endpoint de meta (sincronizado con Trakt) — no hace falta la API de Trakt
 * ni sus tokens (que ni siquiera son accesibles desde acá, ver CLAUDE.md).
 *
 * Si el episodio target ni siquiera se estrenó todavía, queda "pendiente" sin gastar requests en
 * Torrentio/Comet/subs. Si ya se estrenó pero falla alguno de los dos chequeos, también queda
 * "pendiente" — se re-chequea en la próxima corrida, sin avisar nada (cero spam de falsos
 * positivos). El estado persiste en data/premiere-radar-state.json para no avisar dos veces el
 * mismo episodio una vez que ya pasó a LISTO.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/premiere-radar.mjs
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isCachedStream, isSpanishLang } from './lib/addon-signals.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_PATH = join(ROOT, 'data', 'premiere-radar-state.json');
const API = 'https://api.strem.io/api';

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
    .catch(() => null);
const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));
const hasRes = (m, r) => (m?.resources || []).some((x) => x === r || x?.name === r);

function loadState() {
  if (!existsSync(STATE_PATH)) return [];
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}
function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];

const myTrakt = addons.find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));
if (!myTrakt) die('No se encontró MyTrakt Sync en la colección instalada.');
const torrentio = addons.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
const comet = addons.find((a) => a.manifest?.id === 'stremio.comet.fast');
if (!torrentio || !comet) die('Torrentio y/o Comet no están instalados — no se puede chequear cache TorBox.');
// MyTrakt Sync declara el recurso "subtitles" en su manifest pero no lo implementa de verdad
// (siempre devuelve []) — no es una de las 5 fuentes de subs reales, se excluye explícitamente.
const subAddons = addons.filter((a) => hasRes(a.manifest, 'subtitles') && a.manifest?.id !== myTrakt.manifest.id);
if (!subAddons.length) die('No hay addons de subtítulos instalados.');

const traktBase = baseOf(myTrakt.transportUrl);
const torrentioBase = baseOf(torrentio.transportUrl);
const cometBase = baseOf(comet.transportUrl);

console.log('═'.repeat(60));
console.log(' MejoraStremio — Radar de estrenos listos');
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(60));
console.log(`MyTrakt: ${myTrakt.manifest.name} | Streams: Torrentio, Comet | Subs: ${subAddons.map(a => a.manifest.name).join(', ')}\n`);

async function fetchCatalog(type, id) {
  const metas = [];
  for (let skip = 0; skip < 500; skip += 100) {
    const page = await getJson(`${traktBase}catalog/${type}/${id}${skip ? `/skip=${skip}` : ''}.json`);
    const pageMetas = page?.metas || [];
    metas.push(...pageMetas);
    if (pageMetas.length < 100) break;
  }
  return metas;
}

const [continueWatching, watchlist] = await Promise.all([
  fetchCatalog('series', 'continue_watching_shows'),
  fetchCatalog('series', 'watchlist_shows'),
]);

const shows = new Map();
for (const m of [...continueWatching, ...watchlist]) {
  if (m.imdb_id && !shows.has(m.imdb_id)) shows.set(m.imdb_id, m.name);
}

// Guard: si MyTrakt devuelve 0 shows es casi siempre un fallo transitorio del endpoint
// (getJson → null → metas:[]), no que Pablo se haya quedado sin nada en progreso. Sin este
// guard, saveState([]) borraba todo el estado y la corrida siguiente re-"notificaba" cada
// episodio desde cero (pasó el 2026-09-02, ver CLAUDE.md sesión 2026-09-03 dev 2). Abortamos
// sin tocar el archivo de estado.
if (shows.size === 0) {
  die('MyTrakt Sync devolvió 0 shows (continue_watching + watchlist vacíos) — probable fallo ' +
      'transitorio del endpoint. No se toca data/premiere-radar-state.json.');
}
console.log(`${shows.size} show(s) en progreso/watchlist en MyTrakt Sync.\n`);

function nextUnwatched(videos) {
  return (videos || [])
    .filter((v) => v.season > 0)
    .sort((a, b) => a.season - b.season || a.number - b.number)
    .find((v) => v.watched !== true);
}

async function checkCached(imdbId, season, episode) {
  const streamId = `${imdbId}:${season}:${episode}`;
  const [t, c] = await Promise.all([
    getJson(`${torrentioBase}stream/series/${streamId}.json`),
    getJson(`${cometBase}stream/series/${streamId}.json`),
  ]);
  const streams = [...(t?.streams || []), ...(c?.streams || [])];
  return streams.some(isCachedStream);
}

async function checkSpanishSubs(imdbId, season, episode) {
  const streamId = `${imdbId}:${season}:${episode}`;
  const results = await Promise.all(
    subAddons.map((a) => getJson(`${baseOf(a.transportUrl)}subtitles/series/${streamId}.json`, 18000))
  );
  return results.some((r) => (r?.subtitles || []).some((s) => isSpanishLang(s.lang)));
}

const state = loadState();
const now = new Date();
const newState = [];
const newlyReady = [];
let readyCount = 0, pendingCount = 0, notAiredCount = 0;

for (const [imdbId, showName] of shows) {
  const meta = await getJson(`${traktBase}meta/series/${imdbId}.json`);
  const target = nextUnwatched(meta?.meta?.videos);
  if (!target) {
    console.log(`  — ${showName}: sin próximo episodio (serie al día/completa)`);
    continue;
  }

  const key = `${imdbId}:${target.season}:${target.number}`;
  const label = `${showName} S${String(target.season).padStart(2, '0')}E${String(target.number).padStart(2, '0')}`;
  const releaseDate = target.released || target.firstAired || null;
  const aired = releaseDate ? new Date(releaseDate) <= now : false;

  const prev = state.find((e) => e.key === key);

  if (!aired) {
    notAiredCount++;
    console.log(`  ⏳ ${label} — todavía no se estrenó (${releaseDate || 'fecha desconocida'})`);
    newState.push({ key, imdbId, show: showName, season: target.season, episode: target.number,
      episodeTitle: target.name || target.title || '', status: 'pendiente', reason: 'no-estrenado',
      lastCheckedAt: now.toISOString(), notifiedAt: prev?.notifiedAt || null });
    continue;
  }

  const [cached, subs] = await Promise.all([
    checkCached(imdbId, target.season, target.number),
    checkSpanishSubs(imdbId, target.season, target.number),
  ]);
  const ready = cached && subs;

  if (ready) {
    readyCount++;
    const alreadyNotified = !!prev?.notifiedAt;
    console.log(`  ✅ ${label} "${target.name || ''}" — LISTO (cache=${cached} subs=${subs})${alreadyNotified ? ' [ya avisado]' : ''}`);
    if (!alreadyNotified) {
      newlyReady.push({ show: showName, season: target.season, episode: target.number, title: target.name || target.title || '' });
    }
    newState.push({ key, imdbId, show: showName, season: target.season, episode: target.number,
      episodeTitle: target.name || target.title || '', status: 'listo', lastCheckedAt: now.toISOString(),
      notifiedAt: alreadyNotified ? prev.notifiedAt : now.toISOString() });
  } else {
    pendingCount++;
    console.log(`  ⏳ ${label} — pendiente (cache=${cached} subs=${subs})`);
    newState.push({ key, imdbId, show: showName, season: target.season, episode: target.number,
      episodeTitle: target.name || target.title || '', status: 'pendiente', reason: !cached ? 'sin-cache-torbox' : 'sin-subs-es',
      lastCheckedAt: now.toISOString(), notifiedAt: prev?.notifiedAt || null });
  }
}

saveState(newState);

console.log('\n' + '═'.repeat(60));
console.log(`RESUMEN: ${readyCount} listo(s), ${pendingCount} pendiente(s), ${notAiredCount} sin estrenar todavía.`);
for (const r of newlyReady) {
  console.log(`LISTO_NUEVO | ${r.show} | S${String(r.season).padStart(2, '0')}E${String(r.episode).padStart(2, '0')} | ${r.title}`);
}
console.log('═'.repeat(60));
process.exit(0);
