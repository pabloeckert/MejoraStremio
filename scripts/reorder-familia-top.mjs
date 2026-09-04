#!/usr/bin/env node
/**
 * reorder-familia-top.mjs — One-shot. Sube el bloque familiar / apto para todo
 * público al tope del Home de stremioeg (pedido de Pablo 2026-09-04: "todo lo
 * familiar y apto para todo público arriba de todo").
 *
 * - Marca showInHome=true en "Para Ver en Familia" (Cine+Series) y "Familiar en
 *   Inglés" (estaban enabled pero solo en Descubrir).
 * - Reordena aioMetadataConfig.catalogs.standard: Familia → Policial → Humor
 *   Negro → Países → Estrenos, y después todo lo de Descubrir/deshabilitado en
 *   su orden actual.
 *
 * No toca red ni credenciales. Después: regenerate-aiometadata.mjs --apply --force
 *
 * Uso: node scripts/reorder-familia-top.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESET = join(__dirname, '..', 'data', 'preset.json');
const write = process.argv.includes('--write');

const preset = JSON.parse(readFileSync(PRESET, 'utf8'));
const cats = preset.aioMetadataConfig.catalogs.standard;
const byId = new Map(cats.map((c) => [c.id, c]));
const find = (frag) => cats.find((c) => c.id.includes(frag));

// ── 1. showInHome=true en los 3 catálogos familiares que estaban solo en Descubrir
for (const frag of ['pablo122', 'pablo123', 'pablo055']) {
  const c = find(frag);
  if (!c) { console.error('✗ no encontrado:', frag); process.exit(1); }
  c.showInHome = true;
  console.log('  + Home:', c.name);
}

// ── 2. Orden nuevo del Home (por id / fragmento)
const HOME_ORDER = [
  // FAMILIA / APTO TODO PÚBLICO
  'pablo122', 'pablo123',                              // Para Ver en Familia (Cine/Series)
  'movie.family_movies.10751', 'tv.family_shows.10751',
  'pablo113',                                          // Comedia Juvenil (Actores Reales)
  'pablo059', 'pablo060',                              // Cartoon Network, Nickelodeon
  'movie.animation_movies.16', 'tv.animation_shows.16',
  'pablo055',                                          // Familiar en Inglés
  // POLICIAL / CRIMEN / MISTERIO
  'movie.crime_movies.80', 'tv.crime_shows.80',
  'movie.mystery_movies.9648', 'tv.mystery_shows.9648',
  'movie.thriller_movies.53',
  'pablo109', 'pablo110',                              // Thriller Psicológico
  'pablo056',                                          // Policial Clásico
  'pablo108',                                          // Cine Negro Clásico
  'pablo063', 'pablo064',                              // Europe Noir
  'pablo066', 'pablo067',                              // Crimen Alemán
  'pablo068', 'pablo069',                              // Crimen Reino Unido
  'pablo102', 'pablo103',                              // Crimen Francés
  'pablo104', 'pablo105',                              // Crimen Español
  'pablo106', 'pablo107',                              // Crimen Italiano
  'pablo100', 'pablo101',                              // Crimen Nórdico
  // HUMOR NEGRO
  'pablo111', 'pablo112',
  // PAÍSES
  'movie.argentina.pablo001', 'tv.argentina.pablo002',
  'movie.es.pablo07', 'tv.es.pablo08',
  'movie.fr.pablo09', 'tv.fr.pablo010',
  'movie.de.pablo011', 'tv.de.pablo012',
  'movie.it.pablo013', 'tv.it.pablo014',
  'movie.gb.pablo015', 'tv.gb.pablo016',
  'movie.mx.pablo019', 'tv.mx.pablo020',
  'movie.us.pablo029', 'tv.us.pablo030',
  'pablo114', 'pablo115',                              // Suecia
  'pablo118', 'pablo119',                              // Noruega
  'pablo116', 'pablo117',                              // Dinamarca
  'pablo120', 'pablo121',                              // Islandia
  'movie.latam.pablo003', 'tv.latam.pablo004',
  // ESTRENOS
  'movie.upcoming.pablo005', 'tv.upcoming.pablo006',
  'movie.now_playing.pablo007', 'tv.now_playing.pablo062',
];

const homeCats = [];
const seen = new Set();
for (const frag of HOME_ORDER) {
  const c = cats.find((x) => x.id.includes(frag) && !seen.has(x.id));
  if (!c) { console.error('✗ HOME_ORDER no matchea:', frag); process.exit(1); }
  homeCats.push(c);
  seen.add(c.id);
}

// Chequeo: todo catálogo con showInHome debe estar en HOME_ORDER
const orphanHome = cats.filter((c) => c.enabled && c.showInHome && !seen.has(c.id));
if (orphanHome.length) {
  console.error('✗ catálogos en Home sin lugar en HOME_ORDER:');
  orphanHome.forEach((c) => console.error('   ', c.name, c.id));
  process.exit(1);
}

// El resto (Descubrir + deshabilitados) en su orden actual
const rest = cats.filter((c) => !seen.has(c.id));
preset.aioMetadataConfig.catalogs.standard = [...homeCats, ...rest];

console.log(`\nHome: ${homeCats.length} filas | resto: ${rest.length} | total: ${homeCats.length + rest.length}`);
console.log('\n── NUEVO ORDEN DEL HOME ──');
homeCats.forEach((c, i) => console.log(String(i + 1).padStart(3), c.type.padEnd(7), c.name));

if (write) {
  writeFileSync(PRESET, JSON.stringify(preset, null, 2) + '\n');
  console.log('\n✓ data/preset.json actualizado. Ahora: regenerate-aiometadata.mjs --apply --force');
} else {
  console.log('\n[DRY-RUN] Pasar --write para guardar.');
}
