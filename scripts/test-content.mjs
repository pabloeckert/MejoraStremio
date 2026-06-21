/**
 * test-content.mjs — Verifica que la lista curada de contenido (data/test-content.json)
 * tenga streams y subtítulos en español contra los addons REALMENTE instalados en la cuenta.
 *
 * A diferencia de health-check.mjs (que prueba 3 títulos fijos), este corre la lista de
 * series/pelis de nicho que le importan a Pablo (europeas recientes). Resuelve cada título por
 * su IMDb id (ya guardado en el JSON) y prueba S01E01 (series) o el id (movie) en cada addon de
 * streams + cada addon de subtítulos.
 *
 * Uso:
 *   ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/test-content.mjs
 *
 * Salida: tabla por título con total de streams y subs en español. Marca ⚠ los que dan 0 streams.
 * Exit 0 siempre (es un reporte, no un gate); útil para automatizar y detectar contenido que se
 * cayó de la distribución. Los títulos de origen español llevan audio en español → 0 subs ES OK.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://api.strem.io/api';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'test-content.json'), 'utf8'));

const post = (p, b) =>
  fetch(`${API}/${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
    signal: AbortSignal.timeout(20000),
  }).then((r) => r.json());
const get = (u, t = 22000) =>
  fetch(u, { signal: AbortSignal.timeout(t) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
const baseOf = (u) => u.replace(/manifest\.json$/, '');
const hasRes = (m, r) => (m?.resources || []).some((x) => x === r || x?.name === r);
const isEs = (l) => {
  const s = String(l || '').toLowerCase();
  return s === 'spa' || s.startsWith('es') || s.includes('spa');
};

const email = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const pass = process.env.ST_PASS || '';
if (!pass) {
  console.error('Falta ST_PASS. Uso: ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/test-content.mjs');
  process.exit(1);
}

const login = await post('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) {
  console.error('Login fallido:', JSON.stringify(login?.error || login));
  process.exit(1);
}
const col = await post('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const streamAddons = addons.filter((a) => hasRes(a.manifest, 'stream') && a.manifest?.name !== 'Streailer');
const subAddons = addons.filter((a) => hasRes(a.manifest, 'subtitles'));

console.log('═'.repeat(60));
console.log(' MejoraStremio — Test de contenido curado');
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(60));
console.log('Streams:', streamAddons.map((a) => a.manifest.name).join(', '));
console.log('Subs   :', subAddons.map((a) => a.manifest.name).join(', '), '\n');
console.log('NOMBRE'.padEnd(28), 'PAÍS', 'STREAMS', 'SUBS-ES', '');

let zeroStreams = 0;
for (const t of DATA.titles) {
  const sid = t.type === 'series' ? `${t.id}:1:1` : t.id;
  const streams = await Promise.all(
    streamAddons.map(async (a) => (await get(`${baseOf(a.transportUrl)}stream/${t.type}/${sid}.json`))?.streams?.length ?? 0)
  );
  const subs = await Promise.all(
    subAddons.map(async (a) =>
      ((await get(`${baseOf(a.transportUrl)}subtitles/${t.type}/${sid}.json`, 18000))?.subtitles || []).filter((s) => isEs(s.lang)).length
    )
  );
  const sTot = streams.reduce((x, n) => x + n, 0);
  const eTot = subs.reduce((x, n) => x + n, 0);
  if (sTot === 0) zeroStreams++;
  const flag = sTot === 0 ? '⚠ sin streams' : eTot === 0 ? '~' : '✓';
  console.log(`${t.name.slice(0, 27).padEnd(28)} ${t.country.padEnd(4)} ${String(sTot).padStart(6)} ${String(eTot).padStart(6)}  ${flag}`);
}

console.log('\n' + '═'.repeat(60));
console.log(zeroStreams === 0 ? '✅ Todos los títulos tienen streams' : `⚠ ${zeroStreams} título(s) sin streams (revisar nicho/distribución)`);
console.log('═'.repeat(60));
process.exit(0);
