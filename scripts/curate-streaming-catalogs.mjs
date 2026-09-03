#!/usr/bin/env node
/**
 * Limpia Streaming Catalogs: elimina los ~28 servicios irrelevantes para
 * Argentina/España (India, Holanda, UK geo-bloqueado, US-only, nicho)
 * y deja solo los 9 globales/españoles disponibles en la región.
 *
 * Por defecto SOLO REPORTA. Con --apply hace el swap en la colección.
 *
 * Requiere: ST_EMAIL, ST_PASS
 *
 * Uso:
 *   ST_EMAIL=... ST_PASS=... node scripts/curate-streaming-catalogs.mjs
 *   ST_EMAIL=... ST_PASS=... node scripts/curate-streaming-catalogs.mjs --apply
 *
 * Node >= 20, sin dependencias.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BACKUPS = join(ROOT, '.backups');

const API = 'https://api.strem.io/api';
const SC_HOST = 'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club';
const SC_ID = 'pw.ers.netflix-catalog';

const APPLY = process.argv.includes('--apply');

const die = (m, code = 1) => { console.error(`✗ ${m}`); process.exit(code); };
const apiPost = (path, body) =>
  fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  }).then(r => r.json());
const getJson = (url, t = 15000) =>
  fetch(url, { signal: AbortSignal.timeout(t) })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

// Regla de Pablo (2026-07-02): Europa occidental + todo el continente americano
// ("de Ushuaia a Alaska") + Oceanía van TODOS, sin curar por disponibilidad
// regional. Asia, Medio Oriente y África solo si están comprobados y valorados
// (ninguno lo está todavía) — quedan afuera hasta que haya una señal concreta.
const KEEP = [
  'nfx', 'dnp', 'amp', 'atp', 'hbm', 'pmp', 'sst', 'cpd', 'mp9', 'hlu', // 9 originales + Hulu
  'pcp', 'nfk', 'gop', 'clv', 'mbi', 'stz', 'sgo',
  'itv', 'act', 'bbo', 'bbc', 'al4', 'crc', 'shd', // bloque UK: Pablo lo usa fuerte (ver abajo)
];
// Excluidos por ahora (Asia/Medio Oriente, sin comprobar): cru (Crunchyroll),
// jhs (JioHotstar), zee (Zee5), vik (Rakuten Viki), sonyliv (Sony Liv),
// iqi (iQIYI), sha (Shahid VIP).
//
// Sacados 2026-09-03 (dev 2) por "borrar lo que no se usa" (dogma 2026-08-28 tarde), con
// evidencia real de watch-log.mjs — 290 títulos con actividad real en stremioeg, CERO minutos
// en cualquiera de estos:
//   cts (Curiosity Stream), mgl (MagellanTV), dpe (Discovery+) — bloque documentales
//   nlz (NLZIET), vil (Videoland)                              — bloque holandés
//   hay (Hayu)                                                 — reality TV
// El bloque UK (itv/act/bbo/bbc/al4 + sgo) se CONSERVA: es el 2º más mirado de Pablo por lejos
// (Ghosts 1318min, Ludwig 396min, Slow Horses, Dept Q, Douglas Is Cancelled, Harry Wild,
// The Boroughs). Aplicar con: ST_EMAIL=... ST_PASS=... node scripts/curate-streaming-catalogs.mjs --apply

const LABELS = {
  nfx: 'Netflix', dnp: 'Disney+', amp: 'Prime Video', atp: 'Apple TV+',
  hbm: 'HBO Max', pmp: 'Paramount+', sst: 'SkyShowtime', cpd: 'Canal+', mp9: 'Movistar+',
  hlu: 'Hulu', pcp: 'Peacock', nfk: 'Netflix Kids', cts: 'Curiosity Stream',
  mgl: 'MagellanTV', cru: 'Crunchyroll', jhs: 'JioHotstar', gop: 'Globoplay',
  clv: 'Clarovideo', zee: 'Zee5', nlz: 'NLZIET', hay: 'Hayu', vil: 'Videoland',
  mbi: 'Mubi', dpe: 'Discovery+', stz: 'Starz', sgo: 'Sky Go', vik: 'Rakuten Viki',
  sonyliv: 'Sony Liv', itv: 'ITVX', act: 'Acorn TV', bbo: 'BritBox',
  shd: 'Shudder', bbc: 'BBC iPlayer', al4: 'Channel 4', crc: 'Criterion Channel',
  iqi: 'iQIYI', sha: 'Shahid VIP',
};
const label = s => LABELS[s] || s;

function parseUrl(transportUrl) {
  // URL: https://<host>/<base64config>/manifest.json
  // config: services_csv:::timestamp:0:0:
  const encoded = transportUrl
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/\/manifest\.json$/, '');
  const decoded = Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf8');
  const sepIdx = decoded.indexOf(':::');
  const services = decoded.slice(0, sepIdx).split(',').map(s => s.trim()).filter(Boolean);
  const rest = decoded.slice(sepIdx + 3); // timestamp:0:0:
  return { services, rest };
}

function buildUrl(services, rest) {
  const raw = services.join(',') + ':::' + rest;
  const encoded = Buffer.from(raw).toString('base64');
  return `${SC_HOST}/${encoded}/manifest.json`;
}

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

mkdirSync(BACKUPS, { recursive: true });

// 1. Login
const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));
console.log('✓ Login OK');

// 2. Colección actual
const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const idx = addons.findIndex(a => a.manifest?.id === SC_ID);
if (idx < 0) die('No encontré Streaming Catalogs en la colección');

const current = addons[idx];
const { services: current_services, rest } = parseUrl(current.transportUrl);

const toRemove = current_services.filter(s => !KEEP.includes(s));
const toKeep   = current_services.filter(s => KEEP.includes(s));
const missing  = KEEP.filter(s => !current_services.includes(s));

console.log(`\n— Streaming Catalogs (índice ${idx}, ${current_services.length} servicios) —`);
console.log(`Se mantienen (${toKeep.length}): ${toKeep.map(label).join(', ')}`);
console.log(`Se eliminan  (${toRemove.length}): ${toRemove.map(label).join(', ')}`);
if (missing.length) console.log(`No estaban: ${missing.map(label).join(', ')}`);

// 3. Generar y verificar nueva URL
const newUrl = buildUrl(KEEP, rest);
const newManifest = await getJson(newUrl);
if (!newManifest?.catalogs?.length) die('No pude verificar el nuevo manifest — ¿URL inválida?');
console.log(`\n✓ Nuevo manifest OK: ${newManifest.catalogs.length} catálogos (antes ~${current_services.length * 2})`);
console.log('  Primeros:', newManifest.catalogs.slice(0, 4).map(c => c.name).join(', '));

if (!APPLY) {
  console.log('\nℹ Modo reporte (sin --apply): no se tocó la cuenta.');
  process.exit(0);
}

// 4. Backup + swap
const stamp = Date.now();
writeFileSync(
  join(BACKUPS, `backup-streaming-catalogs-pre-curate-${stamp}.json`),
  JSON.stringify({ before: current }, null, 2)
);
console.log(`\n✓ Backup: .backups/backup-streaming-catalogs-pre-curate-${stamp}.json`);

addons[idx] = { ...addons[idx], transportUrl: newUrl, manifest: newManifest };

if (!(await assertNoFrozenEmptyCatalogs(addons, [SC_ID]))) {
  process.exit(1);
}

const result = await apiPost('addonCollectionSet', {
  type: 'AddonCollectionSet',
  authKey,
  addons,
});

if (result?.result?.success) {
  console.log(`✓ Cuenta actualizada — Streaming Catalogs: ${newManifest.catalogs.length} catálogos.`);
} else {
  die('addonCollectionSet falló: ' + JSON.stringify(result));
}
