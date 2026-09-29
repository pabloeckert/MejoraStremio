#!/usr/bin/env node
/**
 * torbox-airlock.mjs â€” Marca en TorBox como "airlocked" (no se purga a los 30 dÃ­as de inactividad)
 * los episodios cacheados de shows que Pablo estÃ¡ mirando despacio (Continue Watching en MyTrakt
 * Sync) pero todavÃ­a no vio â€” el caso real que motivÃ³ esto fue Ãgata y Lola (8 episodios cacheados
 * en riesgo de purgarse antes de que los mire, ver sesiÃ³n 2026-08-25 en GEMINI.md).
 *
 * Mismo patrÃ³n de "prÃ³ximo episodio no visto" que premiere-radar.mjs, pero en vez de mirar solo el
 * siguiente episodio, recorre TODOS los no vistos de cada show en progreso â€” cualquiera de ellos
 * puede estar cacheado y en riesgo, no solo el inmediato siguiente.
 *
 * Matching contra TorBox: se identifica el stream cacheado en Torrentio/Comet (mismo criterio
 * isCachedStream ya usado en el resto del repo) y se extrae su infoHash (campo estÃ¡ndar del
 * protocolo Stremio para streams de torrent). Se compara contra el hash de cada torrent de
 * /api/torrents/mylist para encontrar el id interno de TorBox y marcarlo airlocked.
 *
 * Endpoint de escritura confirmado el 2026-09-03 (sesiÃ³n previa habÃ­a dejado esto sin verificar,
 * por el mismo bloqueo de red hacia api.torbox.app/support.torbox.app de esta sesiÃ³n â€” ver sesiÃ³n
 * 2026-08-27/28 en GEMINI.md): NO es `controltorrent` con operation="airlock" (esa lista de
 * operaciones es Reannounce/Delete/Resume Ãºnicamente, confirmado contra la documentaciÃ³n oficial
 * del SDK â€” TorBox-App/torbox-sdk-js y torbox-sdk-py). El campo `airlocked` se setea con
 * `PUT /api/torrents/edittorrent` (`{ torrent_id, airlocked: true }`), confirmado leyendo el
 * cÃ³digo fuente real de un cliente TorBox de terceros open-source (jittarao/torbox-app,
 * backend/src/api/ApiClient.js â€” mÃ©todo `setAirlock`, que arma el PUT a `edittorrent`/
 * `editusenetdownload`/`editwebdownload` segÃºn el tipo de asset). TodavÃ­a no probado contra la
 * cuenta real de Pablo (esta sesiÃ³n sigue sin salida de red hacia TorBox) â€” correr primero con
 * --dry-run y revisar la respuesta cruda antes de confiar en --apply, mismo criterio de siempre.
 *
 * Requiere: ST_EMAIL, ST_PASS, TORBOX_API_KEY
 * Uso:
 *   node scripts/torbox-airlock.mjs              # dry-run: solo muestra quÃ© marcarÃ­a
 *   node scripts/torbox-airlock.mjs --apply       # marca de verdad los episodios encontrados
 *
 * Node >= 20, sin dependencias.
 */
import { isCachedStream } from './lib/addon-signals.mjs';
import { apiPost } from './lib/stremio-api.mjs';

const TORBOX_API = 'https://api.torbox.app/v1/api';

const APPLY = process.argv.includes('--apply');

const die = (m, code = 1) => { console.error(`âœ— ${m}`); process.exit(code); };
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

console.log('â•'.repeat(60));
console.log(' MejoraStremio â€” TorBox AirLock (contenido en progreso)');
console.log(' ' + new Date().toISOString());
console.log(` Modo: ${APPLY ? 'APLICANDO (--apply)' : 'dry-run (sin --apply, no escribe nada)'}`);
console.log('â•'.repeat(60));

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];

const myTrakt = addons.find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));
const torrentio = addons.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
const comet = addons.find((a) => a.manifest?.id === 'stremio.comet.fast');
if (!myTrakt) die('No se encontrÃ³ MyTrakt Sync en la colecciÃ³n instalada.');
if (!torrentio || !comet) die('Torrentio y/o Comet no estÃ¡n instalados.');

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
if (shows.size === 0) {
  // MyTrakt devolviÃ³ 0 shows: casi seguro un fallo transitorio del endpoint (Pablo siempre tiene
  // algo en progreso). A diferencia de premiere-radar.mjs, este script NO persiste estado â€” no hay
  // nada que un fallo silencioso pueda corromper. Salir limpio (exit 0) en vez de marcar el job en
  // rojo por un hipo de un servicio de terceros: la corrida de maÃ±ana reintenta sola.
  console.log('âš  MyTrakt Sync devolviÃ³ 0 shows en Continue Watching â€” probable fallo transitorio ' +
              'del endpoint. No hay nada que airlockear en esta corrida; se reintenta maÃ±ana.');
  process.exit(0);
}
console.log(`${shows.size} show(s) en Continue Watching en MyTrakt Sync.\n`);

// Solo tiene sentido airlockear episodios cuya cache en TorBox sea reciente (TorBox reciÃ©n los
// bajÃ³ y los purga a los 30 dÃ­as de inactividad). Un episodio estrenado hace aÃ±os que Pablo
// "mira despacio" no suele tener una descarga fresca en riesgo. Acotar ademÃ¡s evita que el
// dry-run recorra cientos de episodios viejos de shows largos (X-Files, etc.) probando streams
// uno por uno â€” antes no terminaba nunca. Ventana: 2 aÃ±os, tope 30 episodios por show.
const AIRLOCK_MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const AIRLOCK_PER_SHOW_CAP = 30;
function unwatchedEpisodes(videos) {
  const now = Date.now();
  return (videos || [])
    .filter((v) => v.season > 0 && v.watched !== true)
    .filter((v) => {
      const d = v.released || v.firstAired;
      if (!d) return true; // sin fecha: no descartar
      const t = new Date(d).getTime();
      return Number.isNaN(t) || now - t <= AIRLOCK_MAX_AGE_MS;
    })
    .sort((a, b) => a.season - b.season || a.number - b.number)
    .slice(-AIRLOCK_PER_SHOW_CAP);
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

// â”€â”€ TorBox: listar torrents cacheados de la cuenta y correlacionar por hash â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function torboxMyList() {
  const url = `${TORBOX_API}/torrents/mylist?bypass_cache=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${torboxKey}` }, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) die('No se pudo listar torrents de TorBox: ' + JSON.stringify(body || res.status));
  return body.data || [];
}

async function torboxSetAirlock(torrentId) {
  const res = await fetch(`${TORBOX_API}/torrents/edittorrent`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${torboxKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ torrent_id: torrentId, airlocked: true }),
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
        console.log(`  â­  ${label} â€” ya airlocked (${torrent.name || hash})`);
        continue;
      }
      console.log(`  ðŸ”’ ${label} â€” candidato a airlock (${torrent.name || hash}, id=${torrent.id})`);
      if (APPLY) {
        const r = await torboxSetAirlock(torrent.id);
        if (r.ok) {
          marked++;
          console.log(`     âœ… marcado (status ${r.status})`);
        } else {
          failed++;
          console.log(`     âœ— fallÃ³ â€” status ${r.status}, respuesta: ${JSON.stringify(r.body)}`);
        }
      }
    }
  }
}

console.log('\n' + 'â•'.repeat(60));
console.log(`RESUMEN: ${candidates} candidato(s) encontrados, ${alreadyLocked} ya airlocked.`);
if (APPLY) {
  console.log(`  ${marked} marcado(s) OK, ${failed} fallido(s).`);
  if (failed > 0) {
    console.log(`  âš  Si TODOS fallaron con el mismo error: revisar la respuesta cruda de arriba â€”`);
    console.log(`    puede que la cuenta no tenga cupo de AirLock disponible, o que el campo`);
    console.log(`    esperado por la API haya cambiado desde que se confirmÃ³ este endpoint.`);
  }
} else {
  console.log('  (dry-run â€” correr con --apply para marcar de verdad)');
}
console.log('â•'.repeat(60));
process.exit(failed > 0 && APPLY ? 1 : 0);
