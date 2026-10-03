#!/usr/bin/env node
/**
 * prune-home-catalogs.mjs — Curaduría y poda de catálogos en Inicio para Leanback UX (TV Box).
 *
 * Reduce los 65 catálogos que aparecían en el Inicio de Stremio a los 10 principales
 * indispensables para evitar el scroll infinito con el D-pad del control remoto.
 * Los demás catálogos permanecen habilitados en AIOMetadata bajo "Descubrir".
 *
 * Además calibra los parámetros de TMDB Discover de "En Cartelera" (cine):
 *   - sort_by: "popularity.desc"
 *   - with_release_type: "2|3" (cines)
 *   - region: "AR"
 *   - vote_count.gte: 1 (evita ocultar estrenos frescos)
 *
 * Uso:
 *   node scripts/prune-home-catalogs.mjs          # dry-run
 *   node scripts/prune-home-catalogs.mjs --write  # aplica a data/preset.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PRESET_PATH = join(ROOT, 'data', 'preset.json');
const WRITE = process.argv.includes('--write');

const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
const std = preset.aioMetadataConfig.catalogs.standard;

// Los 10 catálogos curados que deben estar en el Inicio (Leanback UI)
const HOME_CATALOG_IDS = [
  'tmdb.discover.movie.now_playing.pablo007',                 // 1. En Cartelera (Cine)
  'tmdb.discover.tv.now_playing.pablo062',                    // 2. En Cartelera (Series)
  'tmdb.discover.movie.upcoming.pablo005',                    // 3. Próximos Estrenos (Cine)
  'tmdb.discover.tv.upcoming.pablo006',                       // 4. Próximos Estrenos (Series)
  'tmdb.discover.movie.enc-para-ver-en-familia-cine.pablo122',// 5. Para Ver en Familia (Cine)
  'tmdb.discover.tv.enc-para-ver-en-familia-series.pablo123', // 6. Para Ver en Familia (Series)
  'tmdb.discover.movie.classic-crime.pablo056',               // 7. Policial Clásico
  'tmdb.discover.movie.argentina.pablo001',                   // 8. Cine Argentina
  'tmdb.discover.tv.argentina.pablo002',                      // 9. Series Argentina
  'tmdb.discover.movie.latam.pablo003',                       // 10. Latinoamérica (Cine)
];

const homeSet = new Set(HOME_CATALOG_IDS);

// Separar en home vs resto
const homeCatalogs = [];
const otherCatalogs = [];

for (const id of HOME_CATALOG_IDS) {
  const cat = std.find((c) => c.id === id);
  if (!cat) {
    console.error(`✗ Error: catálogo requerido no encontrado: ${id}`);
    process.exit(1);
  }
  cat.showInHome = true;
  homeCatalogs.push(cat);
}

for (const cat of std) {
  if (!homeSet.has(cat.id)) {
    if (cat.showInHome) {
      cat.showInHome = false;
    }
    otherCatalogs.push(cat);
  }
}

// Calibrar En Cartelera (Cine)
const nowPlayingMovie = homeCatalogs.find((c) => c.id === 'tmdb.discover.movie.now_playing.pablo007');
if (nowPlayingMovie && nowPlayingMovie.metadata?.discover?.params) {
  const p = nowPlayingMovie.metadata.discover.params;
  const fs = nowPlayingMovie.metadata.discover.formState;

  p.sort_by = 'popularity.desc';
  p.with_release_type = '2|3';
  p.region = 'AR';
  p['vote_count.gte'] = 1;

  if (fs) {
    fs.sortBy = 'popularity.desc';
    fs.releaseRegion = 'AR';
    fs.voteCountMin = 1;
  }
  console.log('✓ Calibrados parámetros TMDB Discover de "En Cartelera" (Cine): release_type=2|3, region=AR, sort_by=popularity.desc');
}

preset.aioMetadataConfig.catalogs.standard = [...homeCatalogs, ...otherCatalogs];

console.log('\n── RESULTADO DE LA CURADURÍA LEANBACK ──');
console.log(`Catálogos en Home: ${homeCatalogs.length} filas`);
homeCatalogs.forEach((c, i) => {
  console.log(`  ${String(i + 1).padStart(2)}. [${c.type}] ${c.name} (${c.id})`);
});
console.log(`Catálogos en Descubrir únicamente: ${otherCatalogs.length} filas`);
console.log(`Total catálogos estándar: ${preset.aioMetadataConfig.catalogs.standard.length}`);

if (WRITE) {
  writeFileSync(PRESET_PATH, JSON.stringify(preset, null, 2) + '\n');
  console.log('\n✓ data/preset.json actualizado exitosamente.');
} else {
  console.log('\n[DRY-RUN] Ejecute con --write para guardar los cambios.');
}
