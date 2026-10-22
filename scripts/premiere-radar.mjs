#!/usr/bin/env node
/**
 * premiere-radar.mjs — Radar de estrenos listos para ver con blindaje Fail-Closed.
 *
 * Directivas de Gobernanza Técnica v2.1:
 * 1. Fail-Closed ante fallos externos: Si la API de Trakt o Stremio devuelve 401 (token expirado),
 *    403 o 5xx (caída upstream), el script captura la excepción, emite una advertencia formal
 *    y finaliza con código de salida 0 (limpio), evitando marcar en rojo el pipeline de GitHub Actions.
 * 2. Cero spam de estado: Si no hay shows o Trakt está temporalmente inaccesible, preserva
 *    data/premiere-radar-state.json intacto sin borrar registros previos.
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
import { apiPost } from './lib/stremio-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_PATH = join(ROOT, 'data', 'premiere-radar-state.json');

const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));
const hasRes = (m, r) => (m?.resources || []).some((x) => x === r || x?.name === r);

function loadState() {
  if (!existsSync(STATE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

const getJson = async (url, t = 20000) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(t) });
    if (res.status === 401 || res.status === 403) {
      console.warn(`::warning:: [FAIL-CLOSED] API devolvió HTTP ${res.status} (autenticación expirada) en ${url}`);
      return { _status: res.status, _authError: true };
    }
    if (res.status >= 500) {
      console.warn(`::warning:: [FAIL-CLOSED] API devolvió HTTP ${res.status} (error de servidor upstream) en ${url}`);
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
  let email = process.env.ST_EMAIL || process.env.STREMIO_EMAIL;
  let pass = process.env.ST_PASS || process.env.STREMIO_PASS;

  if (!pass) {
    const localCred = 'C:/Users/tabeg/OneDrive/Documentos/Stemio/Pruebas/baee30cf-9528-4d53-82f3-2c4831853455.txt';
    if (existsSync(localCred)) {
      try {
        const rawLines = readFileSync(localCred, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        pass = rawLines.length > 1 ? rawLines[1] : rawLines[0];
        if (!email) email = 'stremioeg@gmail.com';
      } catch {
        // Ignorar error al leer respaldo local
      }
    }
  }
  if (!email) email = 'stremioeg@gmail.com';

  if (!email || !pass) {
    console.warn('::warning:: [FAIL-CLOSED] Faltan credenciales ST_EMAIL / ST_PASS. Omitiendo radar de estrenos.');
    process.exitCode = 0;
    return;
  }

  let authKey = null;
  try {
    const login = await apiPost('login', { authKey: null, email, password: pass });
    authKey = login?.result?.authKey;
  } catch (e) {
    console.warn(`::warning:: [FAIL-CLOSED] Error de conexión en login: ${e.message}. Omitiendo de forma limpia.`);
    process.exitCode = 0;
    return;
  }

  if (!authKey) {
    console.warn('::warning:: [FAIL-CLOSED] Login fallido en Stremio API. Omitiendo radar de estrenos limpiamente.');
    process.exitCode = 0;
    return;
  }

  let addons = [];
  try {
    const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
    addons = col?.result?.addons || [];
  } catch (e) {
    console.warn(`::warning:: [FAIL-CLOSED] Error al obtener addonCollection: ${e.message}.`);
    process.exitCode = 0;
    return;
  }

  const myTrakt = addons.find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));
  if (!myTrakt) {
    console.warn('::warning:: [FAIL-CLOSED] MyTrakt Sync no está en la colección de addons instalada (cuenta unificada). Omitiendo radar de estrenos limpiamente.');
    process.exitCode = 0;
    return;
  }

  const torrentio = addons.find((a) =>
    a.manifest?.id === 'com.mejorastremio.hub' ||
    a.manifest?.id === 'com.mejorastremio.streams' ||
    a.manifest?.id === 'com.stremio.torrentio.addon'
  );
  const comet = addons.find((a) => a.manifest?.id === 'stremio.comet.fast');
  if (!torrentio && !comet) {
    console.warn('::warning:: [FAIL-CLOSED] Ni MejoraStremio/Torrentio ni Comet encontrados para streams. Omitiendo radar de estrenos limpiamente.');
    process.exitCode = 0;
    return;
  }

  const subAddons = addons.filter((a) => hasRes(a.manifest, 'subtitles') && a.manifest?.id !== myTrakt.manifest.id);
  if (!subAddons.length) {
    console.warn('::warning:: [FAIL-CLOSED] No se encontraron addons de subtítulos. Omitiendo radar de estrenos limpiamente.');
    process.exitCode = 0;
    return;
  }

  const traktBase = baseOf(myTrakt.transportUrl);
  const torrentioBase = torrentio ? baseOf(torrentio.transportUrl) : null;
  const cometBase = comet ? baseOf(comet.transportUrl) : null;

  console.log('═'.repeat(60));
  console.log(' MejoraStremio — Radar de estrenos listos (v2.1 Fail-Closed + OAuth Autómata)');
  console.log(' ' + new Date().toISOString());
  console.log('═'.repeat(60));
  console.log(`MyTrakt: ${myTrakt.manifest.name} | Streams: Torrentio/Comet | Subs: ${subAddons.map((a) => a.manifest.name).join(', ')}\n`);

  const TRAKT_AUTH_FILE = join(ROOT, 'data', 'trakt-auth.json');

  async function refreshTraktToken() {
    let auth = {};
    if (existsSync(TRAKT_AUTH_FILE)) {
      try {
        auth = JSON.parse(readFileSync(TRAKT_AUTH_FILE, 'utf8'));
      } catch {}
    }

    const refreshToken = auth.refresh_token || process.env.TRAKT_REFRESH_TOKEN;
    const clientId = auth.client_id || process.env.TRAKT_CLIENT_ID || 'd301ba16194b65dc9bfaad3316db73a110bfad1357fa174ee0f0e0fe331cf116';
    const clientSecret = auth.client_secret || process.env.TRAKT_CLIENT_SECRET || '';

    if (!refreshToken) {
      throw new Error('No hay refresh_token disponible en data/trakt-auth.json ni en TRAKT_REFRESH_TOKEN');
    }

    console.log('🔄 [Autómata OAuth Trakt] Intentando auto-recuperación de sesión vía refresh_token...');
    const res = await fetch('https://api.trakt.tv/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Trakt OAuth devolvió HTTP ${res.status}: ${errText}`);
    }

    const newTokens = await res.json();
    const updatedAuth = {
      ...auth,
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token || refreshToken,
      updated_at: new Date().toISOString(),
      expires_in: newTokens.expires_in,
    };

    mkdirSync(dirname(TRAKT_AUTH_FILE), { recursive: true });
    writeFileSync(TRAKT_AUTH_FILE, JSON.stringify(updatedAuth, null, 2) + '\n', 'utf8');
    console.log('✓ [Autómata OAuth Trakt] Nuevo Access Token negociado y persistido con éxito.');
    return updatedAuth;
  }

  async function fetchCatalog(type, id, retry = 0) {
    const metas = [];
    for (let skip = 0; skip < 500; skip += 100) {
      const page = await getJson(`${traktBase}catalog/${type}/${id}${skip ? `/skip=${skip}` : ''}.json`);
      if (page?._authError) {
        if (retry === 0) {
          console.warn(`::warning:: [TRAKT_401] Trakt devolvió HTTP 401 en catálogo ${id}. Ejecutando autómata OAuth...`);
          try {
            await refreshTraktToken();
            return await fetchCatalog(type, id, retry + 1);
          } catch (oauthErr) {
            console.warn(`::warning:: [FAIL-CLOSED] Autómata OAuth no pudo refrescar token: ${oauthErr.message}`);
            process.exitCode = 0;
            return null;
          }
        }
        console.warn(`::warning:: [FAIL-CLOSED] Trakt devolvió HTTP 401 tras reintento de refresh. Saliendo de forma limpia.`);
        process.exitCode = 0;
        return null;
      }
      if (page?._serverError) {
        console.warn(`::warning:: [FAIL-CLOSED] Trakt devolvió HTTP ${page._status} (error de servidor upstream) en catálogo ${id}. Saliendo de forma limpia.`);
        process.exitCode = 0;
        return null;
      }
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

  if (continueWatching === null || watchlist === null) {
    process.exitCode = 0;
    return;
  }

  const allMetas = [...continueWatching, ...watchlist];

  // Detección semántica de expiración de sesión Trakt
  const traktAuthExpired = allMetas.some(
    (m) => String(m?.id || '').startsWith('trakt_auth_required') || /trakt authentication required/i.test(m?.name || '')
  );

  if (traktAuthExpired) {
    console.warn('\n::warning:: [TRAKT_AUTH_REQUIRED] La sesión de Trakt.tv ha expirado en MyTrakt Sync.');
    console.warn('⚠️ Se requiere re-autenticar la cuenta en: https://mytrakt.elfhosted.com');
    console.warn('ℹ️ No se modifica data/premiere-radar-state.json para preservar el historial previo.\n');
    process.exitCode = 0;
    return;
  }

  const shows = new Map();
  for (const m of allMetas) {
    if (m.imdb_id && !shows.has(m.imdb_id)) shows.set(m.imdb_id, m.name);
  }

  if (shows.size === 0) {
    console.warn('⚠️ MyTrakt Sync devolvió 0 shows — probable fallo transitorio del endpoint.');
    console.warn('ℹ️ No se toca data/premiere-radar-state.json. Saliendo de forma controlada.');
    process.exitCode = 0;
    return;
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
    const proms = [];
    if (torrentioBase) proms.push(getJson(`${torrentioBase}stream/series/${streamId}.json`));
    if (cometBase) proms.push(getJson(`${cometBase}stream/series/${streamId}.json`));
    const results = await Promise.all(proms);
    const streams = results.flatMap((r) => r?.streams || []);
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
      newState.push({
        key, imdbId, show: showName, season: target.season, episode: target.number,
        episodeTitle: target.name || target.title || '', status: 'pendiente', reason: 'no-estrenado',
        lastCheckedAt: now.toISOString(), notifiedAt: prev?.notifiedAt || null,
      });
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
      newState.push({
        key, imdbId, show: showName, season: target.season, episode: target.number,
        episodeTitle: target.name || target.title || '', status: 'listo', lastCheckedAt: now.toISOString(),
        notifiedAt: alreadyNotified ? prev.notifiedAt : now.toISOString(),
      });
    } else {
      pendingCount++;
      console.log(`  ⏳ ${label} — pendiente (cache=${cached} subs=${subs})`);
      newState.push({
        key, imdbId, show: showName, season: target.season, episode: target.number,
        episodeTitle: target.name || target.title || '', status: 'pendiente', reason: !cached ? 'sin-cache-torbox' : 'sin-subs-es',
        lastCheckedAt: now.toISOString(), notifiedAt: prev?.notifiedAt || null,
      });
    }
  }

  saveState(newState);

  console.log('\n' + '═'.repeat(60));
  console.log(`RESUMEN: ${readyCount} listo(s), ${pendingCount} pendiente(s), ${notAiredCount} sin estrenar todavía.`);
  for (const r of newlyReady) {
    console.log(`LISTO_NUEVO | ${r.show} | S${String(r.season).padStart(2, '0')}E${String(r.episode).padStart(2, '0')} | ${r.title}`);
  }
  console.log('═'.repeat(60));
  process.exitCode = 0;
}

main().catch((err) => {
  console.warn(`::warning:: [FAIL-CLOSED] Excepción no controlada en premiere-radar: ${err.message}. Abortando con salida 0.`);
  process.exitCode = 0;
});
