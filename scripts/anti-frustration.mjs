#!/usr/bin/env node
/**
 * Registro "antifrustraciÃ³n": cuando un tÃ­tulo "no abre" (streams que cargan sin
 * fin o no aparecen), lo registra en data/anti-frustration-log.json con su
 * cobertura real de streams. Permite revisar cada tanto si mejorÃ³.
 *
 * Un stream cuenta como "real" si no trae contador de seeds (ðŸ‘¤ N â€” addons HTTP
 * como NoTorrent/WebStreamrMBG/Nuvio, donde no aplica) o si trae seeds > 0
 * (torrents con al menos un peer). Los torrents con ðŸ‘¤ 0 (el patrÃ³n "carga y
 * nunca arranca" de Meteor, ver GEMINI.md) NO cuentan.
 *
 * Para tÃ­tulos familiares/adolescentes/infantiles (gÃ©nero TMDB/Cinemeta:
 * Animation, Family), ademÃ¡s detecta si algÃºn stream trae audio latino
 * (ðŸ‡²ðŸ‡½/ðŸ‡¦ðŸ‡·/ðŸ‡¨ðŸ‡´ o "latino" en el tÃ­tulo).
 *
 * Requiere: ST_EMAIL, ST_PASS
 *
 * Uso:
 *   node scripts/anti-frustration.mjs add tt9293466 series 1 1 "Balthazar S01E01"
 *   node scripts/anti-frustration.mjs add tt2380307 movie                # Coco
 *   node scripts/anti-frustration.mjs review                             # re-chequea lo pendiente
 *   node scripts/anti-frustration.mjs list                               # resumen del log
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isUtilityStream, isRealStream } from './lib/addon-signals.mjs';
import { apiPost } from './lib/stremio-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOG_PATH = join(ROOT, 'data', 'anti-frustration-log.json');
const CINEMETA = 'https://v3-cinemeta.strem.io';

const RESOLVED_THRESHOLD = 3; // streams "reales" mÃ­nimos para considerar resuelto
const LATINO_RE = /latino|🇲🇽|🇦🇷|🇨🇴|🌎|ðŸ‡²ðŸ‡½|ðŸ‡¦ðŸ‡·|ðŸ‡¨ðŸ‡´/i;
const FAMILY_GENRES = new Set(['Animation', 'Family']);
// Meteor no expone contador de seeds en el tÃ­tulo (a diferencia de Torrentio) y
// tiene fama documentada de dar torrents sin seeds que "cargan y nunca arrancan"
// (ver GEMINI.md). Sin forma de verificar, sus streams NO cuentan para el total
// "real" â€” se reportan aparte como referencia, no como seÃ±al de que abre.
const UNVERIFIABLE_ADDONS = new Set(['Meteor']);

const die = (m, code = 1) => { console.error(`âœ— ${m}`); process.exit(code); };
const getJson = (url, t = 20000) =>
  fetch(url, { signal: AbortSignal.timeout(t) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

function loadLog() {
  if (!existsSync(LOG_PATH)) return [];
  return JSON.parse(readFileSync(LOG_PATH, 'utf8'));
}
function saveLog(log) {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + '\n');
}

function findLatino(streams) {
  const matches = [];
  for (const s of streams) {
    const text = `${s.title || ''}\n${s.name || ''}`;
    if (LATINO_RE.test(text)) matches.push((s.title || s.name || '').split('\n')[0]);
  }
  return matches;
}

async function loginAndCollection() {
  const email = process.env.ST_EMAIL;
  const pass = process.env.ST_PASS;
  if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');
  const login = await apiPost('login', { authKey: null, email, password: pass });
  const authKey = login?.result?.authKey;
  if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));
  const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const addons = col?.result?.addons || [];
  const streamAddons = addons.filter((a) =>
    (a.manifest?.resources || []).some((r) => (r.name || r) === 'stream')
  );
  return { streamAddons };
}

async function checkTitle({ id, type, season, episode }) {
  const { streamAddons } = await loginAndCollection();
  const streamId = type === 'series' && season && episode ? `${id}:${season}:${episode}` : id;

  const meta = await getJson(`${CINEMETA}/meta/${type}/${id}.json`);
  const name = meta?.meta?.name || id;
  const genres = meta?.meta?.genre || [];
  const isFamily = genres.some((g) => FAMILY_GENRES.has(g));

  // Para series: Â¿el episodio pedido existe realmente en la metadata? Un episodio inexistente
  // (o un id de IMDb que Cinemeta resuelve a OTRO tÃ­tulo por un mapeo roto de TMDB) genera una
  // entrada que nunca puede resolver â€” como pasÃ³ con "Infiltrada S01E11" mapeada al id de Wild
  // Cards (2026-09-03/06). null = no se pudo determinar (Cinemeta caÃ­do o sin lista de videos).
  let episodeExists = null;
  if (type === 'series' && season && episode) {
    const videos = meta?.meta?.videos;
    if (Array.isArray(videos) && videos.length) {
      episodeExists = videos.some((v) => v.season === season && v.episode === episode);
    }
  }

  const perAddon = {};
  let allStreams = [];
  for (const a of streamAddons) {
    const base = a.transportUrl.replace(/manifest\.json$/, '');
    const d = await getJson(`${base}stream/${type}/${streamId}.json`, 20000);
    const streams = (d?.streams || []).filter((s) => !isUtilityStream(s));
    const unverifiable = UNVERIFIABLE_ADDONS.has(a.manifest.name);
    const real = unverifiable ? [] : streams.filter(isRealStream);
    perAddon[a.manifest.name] = { total: streams.length, real: real.length, unverifiable };
    allStreams = allStreams.concat(streams);
  }
  const totalReal = Object.values(perAddon).reduce((s, c) => s + c.real, 0);
  const status = totalReal >= RESOLVED_THRESHOLD ? 'resuelto' : 'pendiente';

  let latino = null;
  if (isFamily) {
    const found = findLatino(allStreams);
    latino = { checked: true, found: found.length > 0, samples: found.slice(0, 3) };
  }

  return { id, type, season, episode, name, genres, isFamily, perAddon, totalReal, status, latino, episodeExists };
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'add') {
  const force = rest.includes('--force');
  const [id, type = 'movie', season, episode, ...titleParts] = rest.filter((a) => a !== '--force');
  if (!id) die('Uso: anti-frustration.mjs add <imdbId> [movie|series] [season] [episode] ["tÃ­tulo"] [--force]');
  const result = await checkTitle({
    id,
    type,
    season: season ? Number(season) : undefined,
    episode: episode ? Number(episode) : undefined,
  });
  const label = titleParts.join(' ') || result.name;

  if (result.episodeExists === false && !force) {
    die(`El episodio S${season}E${episode} NO existe en la metadata de "${result.name}" (${id}).\n` +
        `  Probablemente un id de IMDb equivocado o un mapeo roto de TMDB â†’ una entrada asÃ­ nunca\n` +
        `  va a poder resolver. Si igual querÃ©s registrarlo, agregÃ¡ --force.`);
  }

  const log = loadLog();
  const key = `${result.id}:${result.season || ''}:${result.episode || ''}`;
  const now = new Date().toISOString();
  const existingIdx = log.findIndex(
    (e) => `${e.id}:${e.season || ''}:${e.episode || ''}` === key
  );
  const { episodeExists: _drop, ...resultForLog } = result;
  const entry = {
    ...resultForLog,
    label,
    addedAt: existingIdx >= 0 ? log[existingIdx].addedAt : now,
    lastCheckedAt: now,
  };
  if (existingIdx >= 0) log[existingIdx] = entry;
  else log.push(entry);
  saveLog(log);

  console.log(`\n"${label}" (${result.id}${result.season ? `:${result.season}:${result.episode}` : ''})`);
  console.log(`  GÃ©nero: ${result.genres.join(', ') || '?'}${result.isFamily ? ' â€” FAMILIAR/INFANTIL' : ''}`);
  for (const [name, c] of Object.entries(result.perAddon)) {
    console.log(`  ${name}: ${c.unverifiable ? `${c.total} sin verificar (no cuenta)` : `${c.real} reales / ${c.total} totales`}`);
  }
  console.log(`  Total streams reales: ${result.totalReal} â†’ ${result.status.toUpperCase()}`);
  if (result.latino) {
    console.log(`  Audio latino: ${result.latino.found ? 'âœ“ encontrado' : 'âœ— no encontrado'}${result.latino.samples.length ? ' â€” ' + result.latino.samples.join(' | ') : ''}`);
  }
  console.log(`\nâœ“ Guardado en data/anti-frustration-log.json`);
} else if (cmd === 'review') {
  const log = loadLog();
  const pending = log.filter((e) => e.status === 'pendiente');
  if (!pending.length) {
    console.log('Nada pendiente en el log.');
    process.exit(0);
  }
  console.log(`Re-chequeando ${pending.length} tÃ­tulo(s) pendientes...\n`);
  let fixed = 0, stillStuck = 0;
  for (const e of pending) {
    const { episodeExists: _drop, ...result } = await checkTitle({ id: e.id, type: e.type, season: e.season, episode: e.episode });
    const idx = log.findIndex((x) => x === e);
    log[idx] = { ...e, ...result, lastCheckedAt: new Date().toISOString() };
    if (result.status === 'resuelto') {
      fixed++;
      console.log(`  âœ… RESUELTO: ${e.label} (${result.totalReal} streams reales)`);
    } else {
      stillStuck++;
      console.log(`  â³ sigue pendiente: ${e.label} (${result.totalReal} streams reales)`);
    }
  }
  saveLog(log);
  console.log(`\n${fixed} resuelto(s), ${stillStuck} sigue(n) pendiente(s). Log actualizado.`);
} else if (cmd === 'list' || !cmd) {
  const log = loadLog();
  if (!log.length) {
    console.log('Log vacÃ­o â€” usÃ¡: node scripts/anti-frustration.mjs add <imdbId> ...');
    process.exit(0);
  }
  console.log(`${log.length} tÃ­tulo(s) en el log:\n`);
  for (const e of log) {
    const flag = e.status === 'resuelto' ? 'âœ…' : 'â³';
    const lat = e.latino ? ` | latino: ${e.latino.found ? 'âœ“' : 'âœ—'}` : '';
    console.log(`${flag} ${e.label} (${e.id}) â€” ${e.totalReal} streams reales${lat} â€” Ãºltima revisiÃ³n ${e.lastCheckedAt.slice(0, 10)}`);
  }
} else {
  die(`Comando desconocido: ${cmd}. UsÃ¡ add | review | list`);
}
