/**
 * test-subdl.mjs — Mide la disponibilidad de subtítulos en español SIN "para sordos" (SDH) en
 * SubDL (subdl.com) para la lista curada de data/test-content.json.
 *
 * Por qué: el objetivo de Pablo es español latino sin subtítulos para sordos. Ningún addon de
 * Stremio funcionando hoy filtra el flag de "hearing impaired" (ver CLAUDE.md / memoria). PERO la
 * API de SubDL devuelve ese flag (`hi`) por subtítulo, así que este script reporta cuántos subs en
 * español hay por título distinguiendo hi=false (lo que queremos) de hi=true (los "para sordos").
 *
 * Nota: SubDL solo expone el código "ES" (español genérico); no separa latino de España.
 *
 * Uso:
 *   SUBDL_KEY=... node scripts/test-subdl.mjs
 *
 * Salida: tabla por título con subs ES totales, sin-SDH (hi=false) y SDH (hi=true). Reporta, no
 * escribe. Exit 0 siempre.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'test-content.json'), 'utf8'));

const KEY = process.env.SUBDL_KEY || '';
if (!KEY) {
  console.error('Falta SUBDL_KEY. Uso: SUBDL_KEY=... node scripts/test-subdl.mjs');
  process.exit(1);
}

const get = (url) =>
  fetch(url, { signal: AbortSignal.timeout(20000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

console.log('═'.repeat(64));
console.log(' MejoraStremio — SubDL: español sin "para sordos" (hi=false)');
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(64));
console.log('NOMBRE'.padEnd(28), 'PAÍS', 'ES', 'SIN-SDH', 'SDH', '');

let sinSubs = 0;
for (const t of DATA.titles) {
  const url =
    `https://api.subdl.com/api/v1/subtitles?api_key=${KEY}` +
    `&imdb_id=${t.id}&languages=ES&subs_per_page=30`;
  const r = await get(url);
  const subs = (r?.subtitles || []).filter((s) => (s.language || '').toUpperCase() === 'ES');
  const noSdh = subs.filter((s) => s.hi === false).length;
  const sdh = subs.filter((s) => s.hi === true).length;
  if (noSdh === 0) sinSubs++;
  const flag = noSdh > 0 ? '✓' : subs.length > 0 ? '~ solo SDH' : '⚠ sin ES';
  console.log(
    `${t.name.slice(0, 27).padEnd(28)} ${t.country.padEnd(4)} ` +
      `${String(subs.length).padStart(2)} ${String(noSdh).padStart(7)} ${String(sdh).padStart(3)}  ${flag}`
  );
}

console.log('\n' + '═'.repeat(64));
console.log(
  sinSubs === 0
    ? '✅ Todos los títulos tienen al menos un sub ES sin SDH en SubDL'
    : `⚠ ${sinSubs} título(s) sin subs ES no-SDH en SubDL (audio español o nicho)`
);
console.log('═'.repeat(64));
process.exit(0);
