#!/usr/bin/env node
/**
 * torbox-airlock.mjs — Marca en TorBox como "airlocked" (no se purga a los 30 días de inactividad)
 * los episodios cacheados de shows que Pablo está mirando despacio (Continue Watching en MyTrakt
 * Sync) pero todavía no vio — el caso real que motivó esto fue Ágata y Lola (8 episodios cacheados
 * en riesgo de purgarse antes de que los mire, ver sesión 2026-08-25 en CLAUDE.md).
 *
 * Mismo patrón de "próximo episodio no visto" que premiere-radar.mjs, pero en vez de mirar solo el
 * siguiente episodio, recorre TODOS los no vistos de cada show en progreso — cualquiera de ellos
 * puede estar cacheado y en riesgo, no solo el inmediato siguiente.
 *
 * Matching contra TorBox: se identifica el stream cacheado en Torrentio/Comet (mismo criterio
 * isCachedStream ya usado en el resto del repo) y se extrae su infoHash (campo estándar del
 * protocolo Stremio para streams de torrent). Se compara contra el hash de cada torrent de
 * /api/torrents/mylist para encontrar el id interno de TorBox y marcarlo airlocked.
 *
 * ⚠️ AVISO — el endpoint de escritura (marcar airlocked) no se pudo verificar contra la API real
 * de TorBox al escribir este script: esta sesión corre en un contenedor con la salida de red
 * bloqueada hacia api.torbox.app/support.torbox.app (confirmado con curl/WebFetch, ver sesión
 * 2026-08-27/28 en CLAUDE.md). Lo que SÍ está confirmado (vía búsqueda web, changelog público de
 * TorBox v9/AirLock): existe un campo booleano `airlocked` editable en las rutas de torrents, y el
 * patrón general de TorBox para editar torrents es `POST /api/torrents/controltorrent` con un
 * campo `operation` (ya usado para reannounce/delete/resume). Este script asume por analogía
 * `{ torrent_id, operation: "airlock" }`.  **Antes de confiar en --apply, correlo primero con
 * --dry-run (default) y revisá la respuesta cruda que imprime** — si TorBox rechaza el nombre de
 * la operación, el fix es de una sola línea (ver OPERATION_NAME abajo) una vez confirmado el
 * nombre real contra la documentación en vivo (https://api.torbox.app o el support center).
 *
 * Requiere: ST_EMAIL, ST_PASS, TORBOX_API_KEY
 * Uso:
 *   node scripts/torbox-airlock.mjs              # dry-run: solo muestra qué marcaría
 *   node scripts/torbox-airlock.mjs --apply       # marca de verdad los episodios encontrados
 *
 * Node >= 20, sin dependencias.
 */
import { isCachedStream } from './lib/addon-signals.mjs';

const API = 'https://api.strem.io/api';
const TORBOX_API = 'https://api.torbox.app/v1/api';
// Nombre de la operación asumido por analogía con reannounce/delete/resume — ver aviso arriba.
const OPERATION_NAME = 'airlock';

const APPLY = process.argv.includes('--apply');

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

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
const torboxKey = process.env.TORBOX_API_KEY;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');
if (!torboxKey) die('Falta TORBOX_API_KEY');

console.log('═'.repeat(60));
console.log(' MejoraStremio — TorBox AirLock (contenido en progreso)');
console.log(' ' + new Date().toISOString());
console.log(` Modo: ${APPLY ? 'APLICANDO (--apply)' : 'dry-run (sin --apply, no escribe nada)'}`);
console.log('═'.repeat(60));

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];

const myTrakt = addons.find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));
const torrentio = addons.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
const comet = addons.find((a) => a.manifest?.id === 'stremio.comet.fast');
if (!myTrakt) die('No se encontró MyTrakt Sync en la colección instalada.');
if (!torrentio || !comet) die('Torrentio y/o Comet no están instalados.');

const traktBase = baseOf(myTrakt.transportUrl);
const torrentioBase = baseOf(torrentio.transportUrl);
const cometBase = baseOf(comet.transportUrl);

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

const continueWatching = await fetchCatalog('series', 'continue_watching_shows');
const shows = new Map();
for (const m of continueWatching) if (m.imdb_id && !shows.has(m.imdb_id)) shows.set(m.imdb_id, m.name);
console.log(`${shows.size} show(s) en Continue Watching en MyTrakt Sync.\n`);

function unwatchedEpisodes(videos) {
  return (videos || [])
    .filter((v) => v.season > 0 && v.watched !== true)
    .sort((a, b) => a.season - b.season || a.number - b.number);
}

async function cachedInfoHashes(imdbId, season, episode) {
  const streamId = `${imdbId}:${season}:${episode}`;
  const [t, c] = await Promise.all([
    getJson(`${torrentioBase}stream/series/${streamId}.json`),
    getJson(`${cometBase}stream/series/${streamId}.json`),
  ]);
  const streams = [...(t?.streams || []), ...(c?.streams || [])];
  return streams.filter(isCachedStream).map((s) => (s.infoHash || '').toLowerCase()).filter(Boolean);
}

// ── TorBox: listar torrents cacheados de la cuenta y correlacionar por hash ──────────────────
async function torboxMyList() {
  const url = `${TORBOX_API}/torrents/mylist?bypass_cache=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${torboxKey}` }, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) die('No se pudo listar torrents de TorBox: ' + JSON.stringify(body || res.status));
  return body.data || [];
}

async function torboxSetAirlock(torrentId) {
  const res = await fetch(`${TORBOX_API}/torrents/controltorrent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${torboxKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ torrent_id: torrentId, operation: OPERATION_NAME }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok && body?.success, status: res.status, body };
}

const myTorrents = await torboxMyList();
const byHash = new Map(myTorrents.map((t) => [(t.hash || '').toLowerCase(), t]));
console.log(`${myTorrents.length} torrent(s) en la cuenta de TorBox.\n`);

let candidates = 0, alreadyLocked = 0, marked = 0, failed = 0;

for (const [imdbId, showName] of shows) {
  const meta = await getJson(`${traktBase}meta/series/${imdbId}.json`);
  const pending = unwatchedEpisodes(meta?.meta?.videos);
  if (!pending.length) continue;

  for (const ep of pending) {
    const label = `${showName} S${String(ep.season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')}`;
    const hashes = await cachedInfoHashes(imdbId, ep.season, ep.number);
    for (const hash of hashes) {
      const torrent = byHash.get(hash);
      if (!torrent) continue; // cacheado en Torrentio/Comet pero no aparece en mylist propio (raro, se salta)
      candidates++;
      if (torrent.airlocked) {
        alreadyLocked++;
        console.log(`  ⏭  ${label} — ya airlocked (${torrent.name || hash})`);
        continue;
      }
      console.log(`  🔒 ${label} — candidato a airlock (${torrent.name || hash}, id=${torrent.id})`);
      if (APPLY) {
        const r = await torboxSetAirlock(torrent.id);
        if (r.ok) {
          marked++;
          console.log(`     ✅ marcado (status ${r.status})`);
        } else {
          failed++;
          console.log(`     ✗ falló — status ${r.status}, respuesta: ${JSON.stringify(r.body)}`);
        }
      }
    }
  }
}

console.log('\n' + '═'.repeat(60));
console.log(`RESUMEN: ${candidates} candidato(s) encontrados, ${alreadyLocked} ya airlocked.`);
if (APPLY) {
  console.log(`  ${marked} marcado(s) OK, ${failed} fallido(s).`);
  if (failed > 0) {
    console.log(`  ⚠ Si TODOS fallaron con el mismo error: probablemente OPERATION_NAME="${OPERATION_NAME}"`);
    console.log(`    no es el nombre real que espera la API — confirmar contra la doc en vivo y corregir`);
    console.log(`    la constante al inicio del script (una sola línea).`);
  }
} else {
  console.log('  (dry-run — correr con --apply para marcar de verdad)');
}
console.log('═'.repeat(60));
process.exit(failed > 0 && APPLY ? 1 : 0);
