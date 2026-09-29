#!/usr/bin/env node
/**
 * monthly-digest.mjs â€” "Esto se estrenÃ³ de tu gusto": barre los combos paÃ­s+gÃ©nero
 * del cluster policial + familia de Pablo (mismos ejes que /discover del hub) y
 * junta lo estrenado en los Ãºltimos ~35 dÃ­as. Corre 1 vez por mes, sin email â€” se
 * registra en data/internal-log.jsonl (mismo patrÃ³n que el resto de los cron, ver
 * GEMINI.md "SesiÃ³n 2026-08-02" â€” Pablo no quiere mÃ¡s mails del proyecto).
 *
 * No requiere ninguna API key: le pega al propio hub (mejorastremio-hub), que ya
 * tiene la TMDB key server-side.
 *
 * Uso: node scripts/monthly-digest.mjs [--days 35]
 *
 * Nota de alcance: la otra mitad de la idea original ("filas que nunca abriste")
 * NO es viable â€” Stremio no expone telemetrÃ­a de quÃ© catÃ¡logos navega el usuario,
 * solo libraryItem (lo que se agregÃ³ a Continuar/Biblioteca). Ver GEMINI.md.
 */
const HUB = process.env.HUB_BASE || 'https://mejorastremio-hub.pabloeckert.deno.net';
const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 35;

// Mismos combos que el cluster policial/familia del Home (ver docs/encuesta-catalogos.md).
// Humor Negro queda afuera: no es un gÃ©nero TMDB nativo en /discover (se arma con
// keywords en preset.json, /discover/recent solo soporta gÃ©nero+paÃ­s).
const COMBOS = [
  { country: 'Alemania', genre: 'Crimen', type: 'series', label: 'Crimen AlemÃ¡n (series)' },
  { country: 'Reino Unido', genre: 'Crimen', type: 'series', label: 'Crimen Reino Unido (series)' },
  { country: 'EspaÃ±a', genre: 'Crimen', type: 'series', label: 'Crimen EspaÃ±ol (series)' },
  { country: 'Francia', genre: 'Crimen', type: 'series', label: 'Crimen FrancÃ©s (series)' },
  { genre: 'Crimen', type: 'movie', label: 'Crimen (cine, cualquier paÃ­s)' },
  { genre: 'Misterio', type: 'series', label: 'Misterio (series, cualquier paÃ­s)' },
  { genre: 'Familia', type: 'movie', label: 'Familia (cine)' },
  { genre: 'Familia', type: 'series', label: 'Familia (series)' },
];

const getJson = (u) => fetch(u, { signal: AbortSignal.timeout(20000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

console.log('â•'.repeat(64));
console.log(` Resumen mensual â€” estrenos de tu gusto (Ãºltimos ${days} dÃ­as)`);
console.log(' ' + new Date().toISOString());
console.log('â•'.repeat(64));

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
    console.log(`\n${c.label} â€” ${items.length} tÃ­tulo(s):`);
    for (const it of items.slice(0, 5)) console.log(`  â€¢ ${it.name}${it.date ? ` (${it.date})` : ''}`);
    lines.push(`${c.label}: ${items.slice(0, 5).map((i) => i.name).join(', ')}`);
  } else {
    console.log(`\n${c.label} â€” nada nuevo.`);
  }
  await new Promise((res) => setTimeout(res, 300));
}

console.log('\n' + 'â•'.repeat(64));
console.log(`RESUMEN: ${totalFound} tÃ­tulo(s) nuevo(s) en total dentro del cluster de gusto.`);
if (lines.length) {
  console.log('DIGEST: ' + lines.join(' | '));
}
console.log('â•'.repeat(64));
process.exit(0);
