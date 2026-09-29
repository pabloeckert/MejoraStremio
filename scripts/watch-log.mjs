#!/usr/bin/env node
/**
 * Log inteligente de visualizaciÃ³n: lee el historial real de la cuenta
 * (colecciÃ³n `libraryItem` del datastore de Stremio â€” no requiere Trakt/MyTrakt,
 * es nativo de la API de Stremio) y reporta quÃ© se mira mÃ¡s y quÃ© mÃ¡s "engancha"
 * (tiempo total visto, veces completado, Ãºltima vez visto).
 *
 * Pensado para perfiles familiares (ver cuentas/solotveg/GEMINI.md) donde no hay
 * Trakt conectado â€” si en algÃºn momento se conecta Trakt para ese perfil, esto
 * sigue funcionando igual (son fuentes independientes).
 *
 * Requiere: ST_EMAIL, ST_PASS (de la cuenta a inspeccionar)
 *
 * Uso:
 *   ST_EMAIL=... ST_PASS=... node scripts/watch-log.mjs           # reporta por consola
 *   ST_EMAIL=... ST_PASS=... node scripts/watch-log.mjs --save <slug>   # ademÃ¡s guarda snapshot en data/watch-log-<slug>.jsonl
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const API = 'https://api.strem.io/api';

const die = (m, code = 1) => { console.error(`âœ— ${m}`); process.exit(code); };

async function login(email, password) {
  const r = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: null, email, password }),
    signal: AbortSignal.timeout(20000),
  }).then((x) => x.json());
  if (!r?.result?.authKey) die('Login fallido: ' + JSON.stringify(r?.error || r));
  return r.result.authKey;
}

async function getLibrary(authKey) {
  const r = await fetch(`${API}/datastoreGet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'DatastoreGet', authKey, collection: 'libraryItem', ids: [], all: true }),
    signal: AbortSignal.timeout(20000),
  }).then((x) => x.json());
  if (r.error) die('No se pudo leer libraryItem: ' + JSON.stringify(r.error));
  return r.result || [];
}

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

const authKey = await login(email, pass);
const items = await getLibrary(authKey);

const ranked = items
  .map((it) => ({
    id: it._id,
    name: it.name || it._id,
    type: it.type,
    timesWatched: it.state?.timesWatched || 0,
    minutesWatched: Math.round((it.state?.overallTimeWatched || 0) / 60000),
    lastWatched: it.state?.lastWatched || null,
    inLibrary: !it.removed,
  }))
  .filter((it) => it.minutesWatched > 0 || it.timesWatched > 0)
  .sort((a, b) => b.minutesWatched - a.minutesWatched || b.timesWatched - a.timesWatched);

console.log(`\n${items.length} tÃ­tulo(s) en el historial de ${email}, ${ranked.length} con actividad real:\n`);
if (!ranked.length) {
  console.log('  (sin actividad todavÃ­a â€” el mecanismo funciona, falta uso real de la cuenta)');
} else {
  for (const it of ranked) {
    const fecha = it.lastWatched ? it.lastWatched.slice(0, 10) : '?';
    console.log(`  ${it.minutesWatched}min | ${it.timesWatched}x completo | ${it.name} (${it.type}, ${it.id}) | Ãºltima vez ${fecha}${it.inLibrary ? '' : ' | no guardado en biblioteca'}`);
  }
}

const [, , flag, slug] = process.argv;
if (flag === '--save') {
  if (!slug) die('Uso: watch-log.mjs --save <slug>');
  const logPath = join(ROOT, 'data', `watch-log-${slug}.jsonl`);
  mkdirSync(dirname(logPath), { recursive: true });
  const entry = { date: new Date().toISOString(), totalItems: items.length, ranked };
  appendFileSync(logPath, JSON.stringify(entry) + '\n');
  console.log(`\nâœ“ Snapshot guardado en data/watch-log-${slug}.jsonl`);
}
