#!/usr/bin/env node
/**
 * diagnose-episodes.mjs — Para un show puntual, encuentra el último episodio marcado como visto
 * (según MyTrakt Sync, sincronizado con Trakt) y prueba streams reales contra TODOS los addons de
 * streams instalados para los siguientes N episodios a partir de ahí. Pensado para diagnosticar
 * "se quedó sin andar a partir de tal punto" sin tener que adivinar en qué episodio está el usuario.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso:
 *   node scripts/diagnose-episodes.mjs <imdbId> [cantidadEpisodios=6]
 *   node scripts/diagnose-episodes.mjs <imdbId> [cantidadEpisodios] [temporadaInicio] [episodioInicio]
 *     — si se pasan temporada/episodio de inicio, arranca ahí en vez de calcular el "último visto".
 *
 * Node >= 20, sin dependencias.
 */
import { isUtilityStream, isRealStream } from './lib/addon-signals.mjs';

const API = 'https://api.strem.io/api';
const LATINO_RE = /latino|🇲🇽|🇦🇷|🇨🇴/i;

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

const [, , imdbId, countArg, seasonArg, episodeArg] = process.argv;
if (!imdbId) die('Uso: diagnose-episodes.mjs <imdbId> [cantidadEpisodios=6] [temporadaInicio] [episodioInicio]');
const count = countArg ? Number(countArg) : 6;
const explicitSeason = seasonArg ? Number(seasonArg) : null;
const explicitEpisode = episodeArg ? Number(episodeArg) : null;

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

console.log('═'.repeat(60));
console.log(` MejoraStremio — Diagnóstico de episodios: ${imdbId}`);
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(60));

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];

const myTrakt = addons.find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));
if (!myTrakt) die('No se encontró MyTrakt Sync en la colección instalada.');
const streamAddons = addons.filter((a) =>
  (a.manifest?.resources || []).some((r) => (r.name || r) === 'stream')
);
if (!streamAddons.length) die('No hay addons de streams instalados.');

const traktBase = baseOf(myTrakt.transportUrl);

const meta = await getJson(`${traktBase}meta/series/${imdbId}.json`);
const videos = (meta?.meta?.videos || [])
  .filter((v) => v.season > 0)
  .sort((a, b) => a.season - b.season || a.number - b.number);
if (!videos.length) die(`MyTrakt Sync no devolvió episodios para ${imdbId} — ¿id correcto?`);

const showName = meta?.meta?.name || imdbId;
console.log(`Show: ${showName} (${videos.length} episodios listados por MyTrakt Sync)\n`);

let startIdx;
if (explicitSeason !== null && explicitEpisode !== null) {
  startIdx = videos.findIndex((v) => v.season === explicitSeason && v.number === explicitEpisode);
  if (startIdx < 0) die(`MyTrakt Sync no lista S${explicitSeason}E${explicitEpisode} para ${imdbId}.`);
  console.log(`Arrancando manualmente en S${String(explicitSeason).padStart(2, '0')}E${String(explicitEpisode).padStart(2, '0')} (pedido explícito).`);
} else {
  const watched = videos.filter((v) => v.watched === true);
  const lastWatched = watched.length ? watched[watched.length - 1] : null;
  startIdx = lastWatched
    ? videos.findIndex((v) => v.season === lastWatched.season && v.number === lastWatched.number) + 1
    : 0;
  if (lastWatched) {
    console.log(`Último visto: S${String(lastWatched.season).padStart(2, '0')}E${String(lastWatched.number).padStart(2, '0')} "${lastWatched.name || lastWatched.title || ''}"`);
  } else {
    console.log('Sin ningún episodio marcado como visto — arrancando desde el primero.');
  }
}

const targets = videos.slice(startIdx, startIdx + count);
if (!targets.length) {
  console.log('\nNo hay episodios siguientes para probar (¿serie completa?).');
  process.exit(0);
}
console.log(`\nProbando streams reales para los próximos ${targets.length} episodio(s):\n`);

function findLatino(streams) {
  const matches = [];
  for (const s of streams) {
    const text = `${s.title || ''}\n${s.name || ''}`;
    if (LATINO_RE.test(text)) matches.push((s.title || s.name || '').split('\n')[0]);
  }
  return matches;
}

for (const ep of targets) {
  const label = `S${String(ep.season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')} "${ep.name || ep.title || ''}"`;
  const streamId = `${imdbId}:${ep.season}:${ep.number}`;
  let totalReal = 0;
  const perAddon = [];
  let allStreams = [];
  for (const a of streamAddons) {
    const base = baseOf(a.transportUrl);
    const d = await getJson(`${base}stream/series/${streamId}.json`, 20000);
    const streams = (d?.streams || []).filter((s) => !isUtilityStream(s));
    const real = streams.filter(isRealStream);
    perAddon.push(`${a.manifest.name}=${real.length}`);
    totalReal += real.length;
    allStreams = allStreams.concat(streams);
  }
  const latino = findLatino(allStreams);
  const flag = totalReal >= 3 ? '✅' : totalReal > 0 ? '⚠' : '✗';
  console.log(`  ${flag} ${label} — ${totalReal} streams reales (${perAddon.join(' ')})${latino.length ? ` | latino: ${latino.slice(0, 2).join(', ')}` : ''}`);
}

console.log('\n' + '═'.repeat(60));
process.exit(0);
