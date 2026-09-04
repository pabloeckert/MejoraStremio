#!/usr/bin/env node
/**
 * tatort-prewarm.mjs — Calienta la cache de traducción IA→ES latino del hub para
 * los episodios de los procedurales alemanes que Pablo tiene más a mano: los
 * "Continuar viendo" / "Watchlist" de MyTrakt Sync + los N estrenos más
 * recientes + relleno de los últimos años. Así, cuando abre un episodio en
 * Stremio y elige el subtítulo "[IA→ES latino]", ya está generado y carga al
 * instante en vez de esperar ~40s la primera vez.
 *
 * Cubre los mismos shows que la ruta /mediathek del hub (MEDIATHEK_SHOWS):
 * Tatort, Polizeiruf 110 y SOKO Leipzig. La traducción usa como base el
 * subtítulo alemán OFICIAL de la Mediathek (no OpenSubtitles), así que calentar
 * no consume cupo de la API de OpenSubtitles — se puede correr a diario.
 *
 * Requiere: ST_EMAIL, ST_PASS   (para leer los catálogos de MyTrakt)
 * Uso:
 *   node scripts/tatort-prewarm.mjs                 # watchlist/continue + 6 recientes por show
 *   node scripts/tatort-prewarm.mjs --recent 12     # + los 12 estrenos más nuevos por show
 *   node scripts/tatort-prewarm.mjs --max 20        # tope TOTAL de episodios por corrida
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_PATH = join(ROOT, 'data', 'tatort-prewarm-state.json');
const HUB = process.env.HUB_BASE || 'https://mejorastremio-hub.pabloeckert.deno.net';
const API = 'https://api.strem.io/api';

// Mismos shows que MEDIATHEK_SHOWS en scripts/deno-hub.ts.
const SHOWS = [
  { imdb: 'tt0806910', name: 'Tatort' },
  { imdb: 'tt0806901', name: 'Polizeiruf 110' },
  { imdb: 'tt0274279', name: 'SOKO Leipzig' },
];

const args = process.argv.slice(2);
const recentN = Number(args[args.indexOf('--recent') + 1]) || (args.includes('--recent') ? 10 : 6);
const maxRun = Number(args[args.indexOf('--max') + 1]) || 24;

const post = (p, b) =>
  fetch(`${API}/${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
    signal: AbortSignal.timeout(25000),
  }).then((r) => r.json());
const getJson = (u, t = 20000) =>
  fetch(u, { signal: AbortSignal.timeout(t) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loadState = () => {
  const s = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : { warmed: {} };
  if (!s.warmed) s.warmed = {};
  // Migración: las claves viejas eran "S:E" (solo Tatort). Ahora son "<imdb>:S:E".
  let migrated = 0;
  for (const k of Object.keys(s.warmed)) {
    if (!/^tt\d+:/.test(k)) {
      s.warmed[`tt0806910:${k}`] = s.warmed[k];
      delete s.warmed[k];
      migrated++;
    }
  }
  if (migrated) console.log(`  (migradas ${migrated} claves de estado al formato <imdb>:S:E)`);
  return s;
};
const saveState = (s) => {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + '\n');
};

console.log('═'.repeat(60));
console.log(' Procedurales DE — pre-warm de subtítulos IA→ES latino');
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(60));

// ── Episodios objetivo ─────────────────────────────────────────────────────
const targets = new Map(); // "<imdb>:S:E" -> label

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
let authKey = null;
let myTrakt = null;
if (email && pass) {
  try {
    const login = await post('login', { authKey: null, email, password: pass });
    authKey = login?.result?.authKey;
    if (authKey) {
      const col = await post('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
      const mt = (col?.result?.addons || []).find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));
      if (mt) myTrakt = baseOf(mt.transportUrl);
    }
  } catch (e) {
    console.log('  (aviso: no se pudo leer la cuenta —', e.message + ')');
  }
}

const backfillCutoff = new Date();
backfillCutoff.setFullYear(backfillCutoff.getFullYear() - 4);
const upNextCutoff = new Date();
upNextCutoff.setFullYear(upNextCutoff.getFullYear() - 3);

for (const show of SHOWS) {
  // 1. Cinemeta: catálogo de episodios (recientes + relleno de los últimos 4 años).
  const meta = await getJson(`https://v3-cinemeta.strem.io/meta/series/${show.imdb}.json`, 30000);
  const vids = (meta?.meta?.videos || [])
    .filter((v) => v.season > 0 && v.number > 0 && new Date(v.released || v.firstAired || 0) <= new Date())
    .sort((a, b) => new Date(b.released || b.firstAired || 0) - new Date(a.released || a.firstAired || 0));

  for (const v of vids.slice(0, recentN)) {
    targets.set(`${show.imdb}:${v.season}:${v.number}`, `${show.name} — ${v.name || `S${v.season}E${v.number}`}`);
  }
  for (const v of vids) {
    if (new Date(v.released || v.firstAired || 0) < backfillCutoff) break; // vids está ordenado desc
    targets.set(`${show.imdb}:${v.season}:${v.number}`, `${show.name} — ${v.name || `S${v.season}E${v.number}`}`);
  }

  // 2. MyTrakt: próximo no visto (y un par posteriores) si es de los últimos 3 años.
  if (myTrakt) {
    try {
      const inProgress = await getJson(`${myTrakt}meta/series/${show.imdb}.json`, 20000);
      const evs = (inProgress?.meta?.videos || [])
        .filter((v) => v.season > 0)
        .sort((a, b) => a.season - b.season || a.number - b.number);
      const nextIdx = evs.findIndex((v) => v.watched !== true);
      if (nextIdx >= 0) {
        for (const v of evs.slice(nextIdx, nextIdx + 4)) {
          if (new Date(v.released || v.firstAired || 0) >= upNextCutoff) {
            targets.set(`${show.imdb}:${v.season}:${v.number}`, `${show.name} — ${v.name || ''} (up-next)`);
          }
        }
      }
    } catch (e) {
      console.log(`  (aviso: MyTrakt ${show.name} —`, e.message + ')');
    }
  }
}

const state = loadState();
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const eligible = [...targets.entries()].filter(([k]) => {
  const w = state.warmed[k];
  if (w?.complete === true) return false;
  // "sin-base" es permanente (la Mediathek no lo tiene) — no reintentar cada
  // día; recién re-chequear pasado un mes por si la ARD lo sube.
  if (w?.reason === 'sin-base' && Date.now() - new Date(w.at || 0).getTime() < MONTH_MS) return false;
  return true;
});

// Round-robin por show: que Polizeiruf/SOKO no queden hambreados detrás del
// backlog de Tatort. Cada show aporta de a uno por vuelta hasta llegar a maxRun.
const byShow = new Map(SHOWS.map((s) => [s.imdb, []]));
for (const entry of eligible) {
  const imdb = entry[0].split(':')[0];
  (byShow.get(imdb) || byShow.set(imdb, []).get(imdb)).push(entry);
}
const todo = [];
let anyLeft = true;
while (todo.length < maxRun && anyLeft) {
  anyLeft = false;
  for (const list of byShow.values()) {
    if (list.length && todo.length < maxRun) {
      todo.push(list.shift());
      anyLeft = true;
    }
  }
}

console.log(`Objetivos: ${targets.size} | ya calientes: ${targets.size - eligible.length} | pendientes: ${eligible.length} | a calentar esta corrida: ${todo.length}\n`);

let ok = 0;
let partial = 0;
let noBase = 0;
for (const [key, label] of todo) {
  const [imdb, s, e] = key.split(':');
  const list = await getJson(`${HUB}/translate/subtitles/series/${imdb}:${s}:${e}.json`, 30000);
  const sub = list?.subtitles?.[0];
  if (!sub) {
    noBase++;
    state.warmed[key] = { complete: false, reason: 'sin-base', at: new Date().toISOString() };
    console.log(`  – ${key}  sin subtítulo base (Mediathek/OpenSubtitles)  ${label.slice(0, 44)}`);
    await sleep(500);
    continue;
  }
  const t0 = Date.now();
  const r = await fetch(sub.url, { signal: AbortSignal.timeout(170000) }).then((x) => ({
    status: x.status,
    complete: x.headers.get('x-translate-complete'),
  })).catch((err) => ({ status: 'ERR', err: String(err) }));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.status === 200 && r.complete === 'true') {
    ok++;
    state.warmed[key] = { complete: true, at: new Date().toISOString() };
    console.log(`  ✓ ${key}  listo en ${secs}s  ${label.slice(0, 44)}`);
  } else {
    partial++;
    state.warmed[key] = { complete: false, reason: `status=${r.status} c=${r.complete || ''}`, at: new Date().toISOString() };
    console.log(`  ~ ${key}  parcial (${secs}s, ${r.status}/${r.complete})  — reintenta próxima corrida`);
  }
  saveState(state);
  await sleep(2000); // respiro para la RPM de Gemini
}

saveState(state);
console.log('\n' + '═'.repeat(60));
console.log(`RESUMEN: ${ok} calientes, ${partial} parciales, ${noBase} sin base.`);
console.log('═'.repeat(60));
process.exit(0);
