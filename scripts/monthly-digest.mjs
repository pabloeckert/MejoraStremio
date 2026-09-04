#!/usr/bin/env node
/**
 * monthly-digest.mjs — "Esto se estrenó de tu gusto": barre los combos país+género
 * del cluster policial + familia de Pablo (mismos ejes que /discover del hub) y
 * junta lo estrenado en los últimos ~35 días. Corre 1 vez por mes, sin email — se
 * registra en data/internal-log.jsonl (mismo patrón que el resto de los cron, ver
 * CLAUDE.md "Sesión 2026-08-02" — Pablo no quiere más mails del proyecto).
 *
 * No requiere ninguna API key: le pega al propio hub (mejorastremio-hub), que ya
 * tiene la TMDB key server-side.
 *
 * Uso: node scripts/monthly-digest.mjs [--days 35]
 *
 * Nota de alcance: la otra mitad de la idea original ("filas que nunca abriste")
 * NO es viable — Stremio no expone telemetría de qué catálogos navega el usuario,
 * solo libraryItem (lo que se agregó a Continuar/Biblioteca). Ver CLAUDE.md.
 */
const HUB = process.env.HUB_BASE || 'https://mejorastremio-hub.pabloeckert.deno.net';
const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 35;

// Mismos combos que el cluster policial/familia del Home (ver docs/encuesta-catalogos.md).
// Humor Negro queda afuera: no es un género TMDB nativo en /discover (se arma con
// keywords en preset.json, /discover/recent solo soporta género+país).
const COMBOS = [
  { country: 'Alemania', genre: 'Crimen', type: 'series', label: 'Crimen Alemán (series)' },
  { country: 'Reino Unido', genre: 'Crimen', type: 'series', label: 'Crimen Reino Unido (series)' },
  { country: 'España', genre: 'Crimen', type: 'series', label: 'Crimen Español (series)' },
  { country: 'Francia', genre: 'Crimen', type: 'series', label: 'Crimen Francés (series)' },
  { genre: 'Crimen', type: 'movie', label: 'Crimen (cine, cualquier país)' },
  { genre: 'Misterio', type: 'series', label: 'Misterio (series, cualquier país)' },
  { genre: 'Familia', type: 'movie', label: 'Familia (cine)' },
  { genre: 'Familia', type: 'series', label: 'Familia (series)' },
];

const getJson = (u) => fetch(u, { signal: AbortSignal.timeout(20000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

console.log('═'.repeat(64));
console.log(` Resumen mensual — estrenos de tu gusto (últimos ${days} días)`);
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(64));

let totalFound = 0;
const lines = [];
for (const c of COMBOS) {
  const qs = new URLSearchParams({ type: c.type, days: String(days) });
  if (c.country) qs.set('country', c.country);
  if (c.genre) qs.set('genre', c.genre);
  const r = await getJson(`${HUB}/discover/recent?${qs}`);
  const items = r?.items || [];
  totalFound += items.length;
  if (items.length) {
    console.log(`\n${c.label} — ${items.length} título(s):`);
    for (const it of items.slice(0, 5)) console.log(`  • ${it.name}${it.date ? ` (${it.date})` : ''}`);
    lines.push(`${c.label}: ${items.slice(0, 5).map((i) => i.name).join(', ')}`);
  } else {
    console.log(`\n${c.label} — nada nuevo.`);
  }
  await new Promise((res) => setTimeout(res, 300));
}

console.log('\n' + '═'.repeat(64));
console.log(`RESUMEN: ${totalFound} título(s) nuevo(s) en total dentro del cluster de gusto.`);
if (lines.length) {
  console.log('DIGEST: ' + lines.join(' | '));
}
console.log('═'.repeat(64));
process.exit(0);
