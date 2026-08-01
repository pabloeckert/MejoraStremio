#!/usr/bin/env node
/**
 * Registro "antifrustración": cuando un título "no abre" (streams que cargan sin
 * fin o no aparecen), lo registra en data/anti-frustration-log.json con su
 * cobertura real de streams. Permite revisar cada tanto si mejoró.
 *
 * Un stream cuenta como "real" si no trae contador de seeds (👤 N — addons HTTP
 * como NoTorrent/WebStreamrMBG/Nuvio, donde no aplica) o si trae seeds > 0
 * (torrents con al menos un peer). Los torrents con 👤 0 (el patrón "carga y
 * nunca arranca" de Meteor, ver CLAUDE.md) NO cuentan.
 *
 * Para títulos familiares/adolescentes/infantiles (género TMDB/Cinemeta:
 * Animation, Family), además detecta si algún stream trae audio latino
 * (🇲🇽/🇦🇷/🇨🇴 o "latino" en el título).
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOG_PATH = join(ROOT, 'data', 'anti-frustration-log.json');
const CINEMETA = 'https://v3-cinemeta.strem.io';
const API = 'https://api.strem.io/api';

const RESOLVED_THRESHOLD = 3; // streams "reales" mínimos para considerar resuelto
const LATINO_RE = /latino|🇲🇽|🇦🇷|🇨🇴/i;
const FAMILY_GENRES = new Set(['Animation', 'Family']);
// Meteor no expone contador de seeds en el título (a diferencia de Torrentio) y
// tiene fama documentada de dar torrents sin seeds que "cargan y nunca arrancan"
// (ver CLAUDE.md). Sin forma de verificar, sus streams NO cuentan para el total
// "real" — se reportan aparte como referencia, no como señal de que abre.
const UNVERIFIABLE_ADDONS = new Set(['Meteor']);

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

function loadLog() {
  if (!existsSync(LOG_PATH)) return [];
  return JSON.parse(readFileSync(LOG_PATH, 'utf8'));
}
function saveLog(log) {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + '\n');
}

// MyTrakt Sync devuelve "streams" que en realidad son botones de acción
// (Mark Watched / Add to Watchlist / etc, un mp4 de 27KB) para el scrobbling,
// no contenido real — hay que descartarlos antes de contar nada.
function isUtilityStream(s) {
  return /^mytrakt-/.test(s.behaviorHints?.bingeGroup || '') || /\[MyTrakt\]/.test(s.name || '');
}

function seedCount(text) {
  const m = String(text || '').match(/👤\s*([\d,.]+)/);
  return m ? parseInt(m[1].replace(/[,.]/g, ''), 10) : null;
}
function isRealStream(s) {
  const text = `${s.title || ''}\n${s.name || ''}`;
  const seeds = seedCount(text);
  // [TB+] = ya cacheado en TorBox: se sirve directo desde su servidor, no depende
  // del swarm P2P vivo, así que un torrent con 👤 0 hoy igual reproduce si TorBox
  // ya lo tiene guardado (ver "TorBox (debrid activo)" en CLAUDE.md).
  if (/\[TB\+\]/.test(s.name || '')) return true;
  return seeds === null || seeds > 0; // null = addon HTTP sin contador de seeds
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

  return { id, type, season, episode, name, genres, isFamily, perAddon, totalReal, status, latino };
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'add') {
  const [id, type = 'movie', season, episode, ...titleParts] = rest;
  if (!id) die('Uso: anti-frustration.mjs add <imdbId> [movie|series] [season] [episode] ["título"]');
  const result = await checkTitle({
    id,
    type,
    season: season ? Number(season) : undefined,
    episode: episode ? Number(episode) : undefined,
  });
  const label = titleParts.join(' ') || result.name;

  const log = loadLog();
  const key = `${result.id}:${result.season || ''}:${result.episode || ''}`;
  const now = new Date().toISOString();
  const existingIdx = log.findIndex(
    (e) => `${e.id}:${e.season || ''}:${e.episode || ''}` === key
  );
  const entry = {
    ...result,
    label,
    addedAt: existingIdx >= 0 ? log[existingIdx].addedAt : now,
    lastCheckedAt: now,
  };
  if (existingIdx >= 0) log[existingIdx] = entry;
  else log.push(entry);
  saveLog(log);

  console.log(`\n"${label}" (${result.id}${result.season ? `:${result.season}:${result.episode}` : ''})`);
  console.log(`  Género: ${result.genres.join(', ') || '?'}${result.isFamily ? ' — FAMILIAR/INFANTIL' : ''}`);
  for (const [name, c] of Object.entries(result.perAddon)) {
    console.log(`  ${name}: ${c.unverifiable ? `${c.total} sin verificar (no cuenta)` : `${c.real} reales / ${c.total} totales`}`);
  }
  console.log(`  Total streams reales: ${result.totalReal} → ${result.status.toUpperCase()}`);
  if (result.latino) {
    console.log(`  Audio latino: ${result.latino.found ? '✓ encontrado' : '✗ no encontrado'}${result.latino.samples.length ? ' — ' + result.latino.samples.join(' | ') : ''}`);
  }
  console.log(`\n✓ Guardado en data/anti-frustration-log.json`);
} else if (cmd === 'review') {
  const log = loadLog();
  const pending = log.filter((e) => e.status === 'pendiente');
  if (!pending.length) {
    console.log('Nada pendiente en el log.');
    process.exit(0);
  }
  console.log(`Re-chequeando ${pending.length} título(s) pendientes...\n`);
  let fixed = 0, stillStuck = 0;
  for (const e of pending) {
    const result = await checkTitle({ id: e.id, type: e.type, season: e.season, episode: e.episode });
    const idx = log.findIndex((x) => x === e);
    log[idx] = { ...e, ...result, lastCheckedAt: new Date().toISOString() };
    if (result.status === 'resuelto') {
      fixed++;
      console.log(`  ✅ RESUELTO: ${e.label} (${result.totalReal} streams reales)`);
    } else {
      stillStuck++;
      console.log(`  ⏳ sigue pendiente: ${e.label} (${result.totalReal} streams reales)`);
    }
  }
  saveLog(log);
  console.log(`\n${fixed} resuelto(s), ${stillStuck} sigue(n) pendiente(s). Log actualizado.`);
} else if (cmd === 'list' || !cmd) {
  const log = loadLog();
  if (!log.length) {
    console.log('Log vacío — usá: node scripts/anti-frustration.mjs add <imdbId> ...');
    process.exit(0);
  }
  console.log(`${log.length} título(s) en el log:\n`);
  for (const e of log) {
    const flag = e.status === 'resuelto' ? '✅' : '⏳';
    const lat = e.latino ? ` | latino: ${e.latino.found ? '✓' : '✗'}` : '';
    console.log(`${flag} ${e.label} (${e.id}) — ${e.totalReal} streams reales${lat} — última revisión ${e.lastCheckedAt.slice(0, 10)}`);
  }
} else {
  die(`Comando desconocido: ${cmd}. Usá add | review | list`);
}
