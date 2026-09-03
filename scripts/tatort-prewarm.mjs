#!/usr/bin/env node
/**
 * tatort-prewarm.mjs — Calienta la cache de traducción IA→ES latino del hub para
 * los episodios de Tatort que Pablo tiene más a mano: los "Continuar viendo" /
 * "Watchlist" de MyTrakt Sync + los N estrenos más recientes. Así, cuando abre un
 * episodio en Stremio y elige el subtítulo "[IA→ES latino]", ya está generado y
 * carga al instante en vez de esperar ~40s la primera vez.
 *
 * La traducción de Tatort usa como base el subtítulo alemán OFICIAL de la
 * Mediathek (no OpenSubtitles), así que calentar no consume cupo de la API de
 * OpenSubtitles — se puede correr a diario sin límite.
 *
 * Requiere: ST_EMAIL, ST_PASS   (para leer los catálogos de MyTrakt)
 * Uso:
 *   node scripts/tatort-prewarm.mjs                 # watchlist/continue + 6 recientes
 *   node scripts/tatort-prewarm.mjs --recent 12     # + los 12 estrenos más nuevos
 *   node scripts/tatort-prewarm.mjs --max 20        # tope de episodios por corrida
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
const IMDB = 'tt0806910';
const API = 'https://api.strem.io/api';

const args = process.argv.slice(2);
const recentN = Number(args[args.indexOf('--recent') + 1]) || (args.includes('--recent') ? 10 : 6);
const maxRun = Number(args[args.indexOf('--max') + 1]) || 14;

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

const loadState = () => (existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : { warmed: {} });
const saveState = (s) => {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + '\n');
};

console.log('═'.repeat(60));
console.log(' Tatort — pre-warm de subtítulos IA→ES latino');
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(60));

// ── Episodios objetivo ─────────────────────────────────────────────────────
const targets = new Map(); // "S:E" -> label

// 1. Cinemeta: catálogo de episodios (para recientes + validar números)
const meta = await getJson(`https://v3-cinemeta.strem.io/meta/series/${IMDB}.json`, 30000);
const vids = (meta?.meta?.videos || [])
  .filter((v) => v.season >= 2015 && new Date(v.released || v.firstAired || 0) <= new Date())
  .sort((a, b) => new Date(b.released || 0) - new Date(a.released || 0));

for (const v of vids.slice(0, recentN)) targets.set(`${v.season}:${v.number}`, v.name || `S${v.season}E${v.number}`);

// 2. MyTrakt: continue watching + watchlist filtrados a Tatort
const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (email && pass) {
  try {
    const login = await post('login', { authKey: null, email, password: pass });
    const authKey = login?.result?.authKey;
    if (authKey) {
      const col = await post('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
      const mt = (col?.result?.addons || []).find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));
      if (mt) {
        const b = baseOf(mt.transportUrl);
        const inProgress = await getJson(`${b}meta/series/${IMDB}.json`, 20000);
        // El "próximo no visto" y algún par posterior, para adelantarse.
        const evs = (inProgress?.meta?.videos || []).filter((v) => v.season > 0).sort((a, b2) => a.season - b2.season || a.number - b2.number);
        const nextIdx = evs.findIndex((v) => v.watched !== true);
        if (nextIdx >= 0) {
          const cutoff = new Date();
          cutoff.setFullYear(cutoff.getFullYear() - 3);
          for (const v of evs.slice(nextIdx, nextIdx + 4)) {
            // Solo si es de los últimos 3 años — si Pablo casi no marcó Tatort en
            // Trakt, el "próximo no visto" es de los 70 y no tiene sentido calentarlo.
            if (new Date(v.released || v.firstAired || 0) >= cutoff) {
              targets.set(`${v.season}:${v.number}`, `${v.name || ''} (up-next)`);
            }
          }
        }
      }
    }
  } catch (e) {
    console.log('  (aviso: no se pudo leer MyTrakt —', e.message + ')');
  }
}

const state = loadState();
const todo = [...targets.entries()].filter(([k]) => state.warmed[k]?.complete !== true).slice(0, maxRun);

console.log(`Objetivos: ${targets.size} | ya calientes: ${targets.size - todo.length} | a calentar esta corrida: ${todo.length}\n`);

let ok = 0;
let partial = 0;
let noBase = 0;
for (const [key, label] of todo) {
  const [s, e] = key.split(':');
  const list = await getJson(`${HUB}/translate/subtitles/series/${IMDB}:${s}:${e}.json`, 30000);
  const sub = list?.subtitles?.[0];
  if (!sub) {
    noBase++;
    state.warmed[key] = { complete: false, reason: 'sin-base', at: new Date().toISOString() };
    console.log(`  – ${IMDB}:${key}  sin subtítulo base (Mediathek/OpenSubtitles)  ${label.slice(0, 40)}`);
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
    console.log(`  ✓ ${IMDB}:${key}  listo en ${secs}s  ${label.slice(0, 40)}`);
  } else {
    partial++;
    state.warmed[key] = { complete: false, reason: `status=${r.status} c=${r.complete || ''}`, at: new Date().toISOString() };
    console.log(`  ~ ${IMDB}:${key}  parcial (${secs}s, ${r.status}/${r.complete})  — reintenta próxima corrida`);
  }
  saveState(state);
  await sleep(2000); // respiro para la RPM de Gemini
}

saveState(state);
console.log('\n' + '═'.repeat(60));
console.log(`RESUMEN: ${ok} calientes, ${partial} parciales, ${noBase} sin base.`);
console.log('═'.repeat(60));
process.exit(0);
