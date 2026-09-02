#!/usr/bin/env node
/**
 * check-os-languages.mjs — Chequeo puntual, de un solo uso: confirma si la API moderna de
 * OpenSubtitles (api.opensubtitles.com) expone un código de idioma separado para español
 * latinoamericano (se investigó como "ea" en una búsqueda web, nunca probado contra la API real).
 * El endpoint /infos/languages es público, no requiere API key.
 *
 * Uso: node scripts/check-os-languages.mjs
 * Node >= 20, sin dependencias.
 */
const res = await fetch('https://api.opensubtitles.com/api/v1/infos/languages', {
  headers: { 'Api-Key': 'dummy', 'User-Agent': 'MejoraStremio v1' },
  signal: AbortSignal.timeout(15000),
});
console.log('HTTP status:', res.status);
const body = await res.text();
let json;
try { json = JSON.parse(body); } catch { console.log('Respuesta no-JSON:', body.slice(0, 500)); process.exit(1); }

const langs = json?.data || [];
console.log(`Total idiomas listados: ${langs.length}\n`);

const spanishRelated = langs.filter((l) =>
  /spanish|español|latin/i.test(l.language_name || '') || (l.language_code || '').startsWith('es') || l.language_code === 'ea'
);
console.log('Idiomas relacionados con español/latino:');
for (const l of spanishRelated) {
  console.log(`  code="${l.language_code}" name="${l.language_name}"`);
}
