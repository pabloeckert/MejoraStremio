#!/usr/bin/env node
/**
 * check-catalog-streams.mjs — Trae los títulos reales de un catálogo puntual de AIOMetadata
 * (en vivo) y prueba streams reales contra todos los addons de streams instalados para cada uno.
 * Pensado para verificar reportes tipo "todo lo de tal catálogo no anda" con evidencia real,
 * título por título, en vez de suponer.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/check-catalog-streams.mjs <catalogId> <type=movie|series> [cantidad=8]
 *
 * Node >= 20, sin dependencias.
 */
import { isUtilityStream, isRealStream } from './lib/addon-signals.mjs';

const API = 'https://api.strem.io/api';
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
    .catch((e) => ({ __error: String(e) }));
const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));

const [, , catalogId, type, countArg] = process.argv;
if (!catalogId || !type) die('Uso: check-catalog-streams.mjs <catalogId> <movie|series> [cantidad=8]');
const count = countArg ? Number(countArg) : 8;

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

console.log('═'.repeat(70));
console.log(` MejoraStremio — Chequeo real de streams: ${catalogId} (${type})`);
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(70));

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const aio = addons.find((a) => a.manifest?.id === 'aio-metadata');
if (!aio) die('AIOMetadata no está instalado.');
const streamAddons = addons.filter((a) => (a.manifest?.resources || []).some((r) => (r.name || r) === 'stream'));

const aioBase = baseOf(aio.transportUrl);
const catalog = await getJson(`${aioBase}catalog/${type}/${catalogId}.json`);
const metas = catalog?.metas || [];
if (!metas.length) {
  console.log(`\n✗ El catálogo devolvió 0 resultados en vivo — ¿id correcto? (${aioBase}catalog/${type}/${catalogId}.json)`);
  process.exit(1);
}
console.log(`\n✓ Catálogo en vivo devuelve ${metas.length} títulos. Probando los primeros ${Math.min(count, metas.length)}:\n`);

for (const m of metas.slice(0, count)) {
  const imdbId = m.imdb_id || m.id;
  if (!imdbId || !imdbId.startsWith('tt')) {
    console.log(`  ? "${m.name}" — sin id de IMDb (id=${m.id}), no se puede consultar streams`);
    continue;
  }
  const streamId = type === 'series' ? `${imdbId}:1:1` : imdbId;
  let totalReal = 0;
  const perAddon = [];
  for (const a of streamAddons) {
    const base = baseOf(a.transportUrl);
    const d = await getJson(`${base}stream/${type}/${streamId}.json`, 18000);
    const streams = (d?.streams || []).filter((s) => !isUtilityStream(s));
    const real = streams.filter(isRealStream);
    if (real.length) perAddon.push(`${a.manifest.name}=${real.length}`);
    totalReal += real.length;
  }
  const flag = totalReal >= 3 ? '✅' : totalReal > 0 ? '⚠' : '✗';
  const note = type === 'series' ? ' (probado con S01E01)' : '';
  console.log(`  ${flag} "${m.name}" (${imdbId})${note} — ${totalReal} streams reales${perAddon.length ? ` (${perAddon.join(' ')})` : ''}`);
}

console.log('\n' + '═'.repeat(70));
process.exit(0);
