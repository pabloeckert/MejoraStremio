#!/usr/bin/env node
/**
 * torbox-airlock.mjs — Marca en TorBox como "airlocked" los episodios en progreso con Fail-Closed.
 *
 * Directivas de Gobernanza Técnica v2.1:
 * 1. Fail-Closed ante fallos externos: Si la API de TorBox, Trakt o Stremio devuelve 401 (token expirado),
 *    403 o 5xx (caída upstream), el script captura la excepción, emite una advertencia formal
 *    y finaliza con código de salida 0 (limpio), evitando que el pipeline de GitHub Actions se marque en rojo.
 * 2. Protección de cuota: Acota a episodios recientes (últimos 2 años, máx 30 por show).
 *
 * Requiere: ST_EMAIL, ST_PASS, TORBOX_API_KEY
 * Uso:
 *   node scripts/torbox-airlock.mjs              # dry-run
 *   node scripts/torbox-airlock.mjs --apply       # persistente
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, existsSync } from 'node:fs';
import { isCachedStream } from './lib/addon-signals.mjs';
import { apiPost } from './lib/stremio-api.mjs';

const TORBOX_API = 'https://api.torbox.app/v1/api';
const APPLY = process.argv.includes('--apply');

const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));

const getJson = async (url, t = 20000) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(t) });
    if (res.status === 401 || res.status === 403) {
      console.warn(`::warning:: [FAIL-CLOSED] API devolvió HTTP ${res.status} (autenticación expirada) en ${url}`);
      return { _status: res.status, _authError: true };
    }
    if (res.status >= 500) {
      console.warn(`::warning:: [FAIL-CLOSED] API devolvió HTTP ${res.status} (error upstream 5xx) en ${url}`);
      return { _status: res.status, _serverError: true };
    }
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (e) {
    console.warn(`::warning:: [FAIL-CLOSED] Excepción de red hacia ${url}: ${e.message}`);
    return null;
  }
};

async function main() {
  const email = process.env.ST_EMAIL;
  let pass = process.env.ST_PASS;
  const torboxKey = process.env.TORBOX_API_KEY;

  if (!pass) {
    const localCred = 'C:/Users/tabeg/OneDrive/Documentos/Stemio/Pruebas/baee30cf-9528-4d53-82f3-2c4831853455.txt';
    if (existsSync(localCred)) {
      try {
        const rawLines = readFileSync(localCred, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        pass = rawLines.length > 1 ? rawLines[1] : rawLines[0];
      } catch {
        // Ignorar error de respaldo local
      }
    }
  }

  if (!email || !pass) {
    console.warn('::warning:: [FAIL-CLOSED] Faltan credenciales ST_EMAIL / ST_PASS. Omitiendo TorBox AirLock.');
    process.exitCode = 0;
    return;
  }

  if (!torboxKey) {
    console.warn('::warning:: [FAIL-CLOSED] Falta TORBOX_API_KEY. Omitiendo TorBox AirLock.');
    process.exitCode = 0;
    return;
  }

  console.log('═'.repeat(60));
  console.log(' MejoraStremio — TorBox AirLock (v2.1 Fail-Closed)');
  console.log(' ' + new Date().toISOString());
  console.log(` Modo: ${APPLY ? 'APLICANDO (--apply)' : 'dry-run (sin --apply, sólo lectura)'}`);
  console.log('═'.repeat(60));

  let authKey = null;
  try {
    const login = await apiPost('login', { authKey: null, email, password: pass });
    authKey = login?.result?.authKey;
  } catch (e) {
    console.warn(`::warning:: [FAIL-CLOSED] Error de red en login Stremio: ${e.message}.`);
    process.exitCode = 0;
    return;
  }

  if (!authKey) {
    console.warn('::warning:: [FAIL-CLOSED] Login fallido en Stremio API. Omitiendo TorBox AirLock.');
    process.exitCode = 0;
    return;
  }

  let addons = [];
  try {
    const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
    addons = col?.result?.addons || [];
  } catch (e) {
    console.warn(`::warning:: [FAIL-CLOSED] Error al leer addonCollection: ${e.message}.`);
    process.exitCode = 0;
    return;
  }

  const myTrakt = addons.find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));
  const torrentio = addons.find((a) =>
    a.manifest?.id === 'com.mejorastremio.hub' ||
    a.manifest?.id === 'com.mejorastremio.streams' ||
    a.manifest?.id === 'com.stremio.torrentio.addon'
  );
  const comet = addons.find((a) => a.manifest?.id === 'stremio.comet.fast');

  if (!myTrakt) {
    console.warn('::warning:: [FAIL-CLOSED] No se encontró MyTrakt Sync en la colección instalada (cuenta unificada). Omitiendo TorBox AirLock limpiamente.');
    process.exitCode = 0;
    return;
  }

  if (!torrentio && !comet) {
    console.warn('::warning:: [FAIL-CLOSED] Ni Torrentio/Hub ni Comet están instalados para extraer infoHashes.');
    process.exitCode = 0;
    return;
  }

  const traktBase = baseOf(myTrakt.transportUrl);
  const torrentioBase = torrentio ? baseOf(torrentio.transportUrl) : null;
  const cometBase = comet ? baseOf(comet.transportUrl) : null;

  async function fetchCatalog(type, id) {
    const metas = [];
    for (let skip = 0; skip < 500; skip += 100) {
      const page = await getJson(`${traktBase}catalog/${type}/${id}${skip ? `/skip=${skip}` : ''}.json`);
      if (page?._authError || page?._serverError) {
        console.warn(`::warning:: [FAIL-CLOSED] Trakt devolvió HTTP ${page._status} en catálogo ${id}. Saliendo de forma limpia.`);
        return null;
      }
      const pageMetas = page?.metas || [];
      metas.push(...pageMetas);
      if (pageMetas.length < 100) break;
    }
    return metas;
  }

  const continueWatching = await fetchCatalog('series', 'continue_watching_shows');
  if (continueWatching === null) {
    process.exitCode = 0;
    return;
  }

  const traktAuthExpired = continueWatching.some(
    (m) => String(m?.id || '').startsWith('trakt_auth_required') || /trakt authentication required/i.test(m?.name || '')
  );

  if (traktAuthExpired) {
    console.warn('\n::warning:: [TRAKT_AUTH_REQUIRED] La sesión de Trakt.tv ha expirado en MyTrakt Sync.');
    console.warn('⚠️ TorBox AirLock pausado hasta renovar la autenticación.\n');
    process.exitCode = 0;
    return;
  }

  const shows = new Map();
  for (const m of continueWatching) {
    if (m.imdb_id && !shows.has(m.imdb_id)) shows.set(m.imdb_id, m.name);
  }

  if (shows.size === 0) {
    console.log('⚠️ MyTrakt Sync devolvió 0 shows en Continue Watching — omitiendo AirLock de forma controlada.');
    process.exitCode = 0;
    return;
  }

  console.log(`${shows.size} show(s) en Continue Watching en MyTrakt Sync.\n`);

  const AIRLOCK_MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
  const AIRLOCK_PER_SHOW_CAP = 30;

  function unwatchedEpisodes(videos) {
    const now = Date.now();
    return (videos || [])
      .filter((v) => v.season > 0 && v.watched !== true)
      .filter((v) => {
        const d = v.released || v.firstAired;
        if (!d) return true;
        const t = new Date(d).getTime();
        return Number.isNaN(t) || now - t <= AIRLOCK_MAX_AGE_MS;
      })
      .sort((a, b) => a.season - b.season || a.number - b.number)
      .slice(-AIRLOCK_PER_SHOW_CAP);
  }

  async function cachedInfoHashes(imdbId, season, episode) {
    const streamId = `${imdbId}:${season}:${episode}`;
    const proms = [];
    if (torrentioBase) proms.push(getJson(`${torrentioBase}stream/series/${streamId}.json`));
    if (cometBase) proms.push(getJson(`${cometBase}stream/series/${streamId}.json`));
    const results = await Promise.all(proms);
    const streams = results.flatMap((r) => r?.streams || []);
    return streams.filter(isCachedStream).map((s) => (s.infoHash || '').toLowerCase()).filter(Boolean);
  }

  async function torboxMyList() {
    const url = `${TORBOX_API}/torrents/mylist?bypass_cache=true`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${torboxKey}` }, signal: AbortSignal.timeout(20000) });
      if (res.status === 401 || res.status === 403) {
        console.warn(`::warning:: [FAIL-CLOSED] TorBox API devolvió HTTP ${res.status} (TORBOX_API_KEY expirada o inválida). Abortando limpiamente.`);
        return null;
      }
      if (res.status >= 500) {
        console.warn(`::warning:: [FAIL-CLOSED] TorBox API devolvió HTTP ${res.status} (error de servidor en TorBox). Abortando limpiamente.`);
        return null;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        console.warn(`::warning:: [FAIL-CLOSED] No se pudo listar torrents de TorBox: ${JSON.stringify(body || res.status)}`);
        return null;
      }
      return body.data || [];
    } catch (e) {
      console.warn(`::warning:: [FAIL-CLOSED] Excepción al consultar TorBox API: ${e.message}`);
      return null;
    }
  }

  async function torboxSetAirlock(torrentId) {
    try {
      const res = await fetch(`${TORBOX_API}/torrents/edittorrent`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${torboxKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ torrent_id: torrentId, airlocked: true }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await res.json().catch(() => null);
      return { ok: res.ok && body?.success, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: { error: e.message } };
    }
  }

  const myTorrents = await torboxMyList();
  if (myTorrents === null) {
    process.exitCode = 0;
    return;
  }

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
        if (!torrent) continue;
        candidates++;
        if (torrent.airlocked) {
          alreadyLocked++;
          console.log(`  🔒  ${label} — ya airlocked (${torrent.name || hash})`);
          continue;
        }
        console.log(`  🔐 ${label} — candidato a airlock (${torrent.name || hash}, id=${torrent.id})`);
        if (APPLY) {
          const r = await torboxSetAirlock(torrent.id);
          if (r.ok) {
            marked++;
            console.log(`     ✅ marcado (status ${r.status})`);
          } else {
            failed++;
            console.log(`     ⚠️ fallo en airlock — status ${r.status}, respuesta: ${JSON.stringify(r.body)}`);
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
      console.warn(`::warning:: [FAIL-CLOSED] ${failed} torrents no pudieron marcarse airlocked en TorBox.`);
    }
  } else {
    console.log('  (dry-run — correr con --apply para marcar de verdad)');
  }
  console.log('═'.repeat(60));
  process.exitCode = 0;
}

main().catch((err) => {
  console.warn(`::warning:: [FAIL-CLOSED] Excepción no controlada en torbox-airlock: ${err.message}. Abortando con salida 0.`);
  process.exitCode = 0;
});
