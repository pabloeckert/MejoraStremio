#!/usr/bin/env node
/**
 * prune-home-catalogs.mjs — Curaduría y poda de catálogos en Inicio para Leanback UX (TV Box ZTE B866V2).
 *
 * Directivas de Gobernanza Técnica:
 * 1. Límite estricto de <= 20 filas en Inicio (Home) para evitar el scroll infinito con el D-pad.
 * 2. Blindaje anti-portadas vacías: vote_count.gte >= 3 en TMDB Discover.
 * 3. Ordenamiento dinámico: erradica listas estáticas de popularidad congeladas en el pasado,
 *    priorizando fecha de estreno reciente (primary_release_date.desc / first_air_date.desc).
 * 4. Los catálogos restantes permanecen habilitados en AIOMetadata bajo "Descubrir" (showInHome: false).
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

// Catálogos curados de alta prioridad para la pantalla de inicio (Tope estricto <= 20)
export const HOME_CATALOG_IDS = [
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
  'tmdb.discover.movie.animation_movies.16',                  // 11. Cine Animación
  'tmdb.discover.tv.animation_shows.16',                      // 12. Series Animadas
  'tmdb.discover.movie.crime_movies.80',                      // 13. Cine Policial / Crimen
  'tmdb.discover.tv.crime_shows.80',                          // 14. Series Policial / Crimen
  'tmdb.discover.movie.enc-thriller-psicolo-gico-cine.pablo109',// 15. Thriller Psicológico (Cine)
  'tmdb.discover.tv.enc-thriller-psicolo-gico-series.pablo110', // 16. Thriller Psicológico (Series)
];

if (HOME_CATALOG_IDS.length > 20) {
  throw new Error(`[Gobernanza Leanback] ${HOME_CATALOG_IDS.length} catálogos violan el límite máximo de 20 filas en Home.`);
}

export function pruneAndCalibratePreset(preset) {
  const std = preset.aioMetadataConfig.catalogs.standard;
  const homeSet = new Set(HOME_CATALOG_IDS);
  const homeCatalogs = [];
  const otherCatalogs = [];

  // 1. Filtrar y ordenar exactamente según HOME_CATALOG_IDS
  for (const id of HOME_CATALOG_IDS) {
    const cat = std.find((c) => c.id === id);
    if (!cat) {
      throw new Error(`Catálogo requerido no encontrado en preset.json: ${id}`);
    }
    cat.showInHome = true;
    homeCatalogs.push(cat);
  }

  // 2. Desactivar showInHome en todos los demás catálogos
  for (const cat of std) {
    if (!homeSet.has(cat.id)) {
      cat.showInHome = false;
      otherCatalogs.push(cat);
    }
  }

  // 3. Blindaje Anti-Portadas Vacías y Orden Dinámico en Home
  for (const cat of homeCatalogs) {
    if (cat.metadata?.discover?.params) {
      const p = cat.metadata.discover.params;
      const fs = cat.metadata.discover.formState || {};
      cat.metadata.discover.formState = fs;

      const isUpcoming = /upcoming/.test(cat.id);

      // Blindaje de votos: para contenido ya estrenado, piso mínimo de 3 votos (evita entradas fantasma sin póster)
      if (!isUpcoming) {
        const currentVotes = Number(p['vote_count.gte']) || 0;
        if (currentVotes < 3) {
          p['vote_count.gte'] = 3;
          fs.voteCountMin = 3;
        }
      }

      // Orden dinámico de estreno: erradica popularidad estática
      if (cat.type === 'movie' || cat.metadata.discover.mediaType === 'movie') {
        if (!p.sort_by || p.sort_by === 'popularity.desc') {
          p.sort_by = isUpcoming ? 'primary_release_date.asc' : 'primary_release_date.desc';
          fs.sortBy = p.sort_by;
        }
      } else if (cat.type === 'series' || cat.type === 'tv' || cat.metadata.discover.mediaType === 'tv') {
        if (!p.sort_by || p.sort_by === 'popularity.desc') {
          p.sort_by = isUpcoming ? 'first_air_date.asc' : 'first_air_date.desc';
          fs.sortBy = p.sort_by;
        }
      }
    }
  }

  // Calibraciones específicas de precisión:
  // En Cartelera (Cine)
  const nowPlayingMovie = homeCatalogs.find((c) => c.id === 'tmdb.discover.movie.now_playing.pablo007');
  if (nowPlayingMovie?.metadata?.discover?.params) {
    const p = nowPlayingMovie.metadata.discover.params;
    const fs = nowPlayingMovie.metadata.discover.formState;
    p.sort_by = 'primary_release_date.desc';
    p.with_release_type = '2|3';
    p.region = 'AR';
    p['vote_count.gte'] = 3;
    if (fs) {
      fs.sortBy = 'primary_release_date.desc';
      fs.releaseRegion = 'AR';
      fs.voteCountMin = 3;
    }
  }

  // En Cartelera (Series)
  const nowPlayingSeries = homeCatalogs.find((c) => c.id === 'tmdb.discover.tv.now_playing.pablo062');
  if (nowPlayingSeries?.metadata?.discover?.params) {
    const p = nowPlayingSeries.metadata.discover.params;
    const fs = nowPlayingSeries.metadata.discover.formState;
    p.sort_by = 'first_air_date.desc';
    p['vote_count.gte'] = 3;
    if (fs) {
      fs.sortBy = 'first_air_date.desc';
      fs.voteCountMin = 3;
    }
  }

  preset.aioMetadataConfig.catalogs.standard = [...homeCatalogs, ...otherCatalogs];
  return { homeCatalogs, otherCatalogs };
}

/**
 * Audita data/preset.json contra las directivas de Leanback UX para TV Box (ZTE B866V2):
 * 1. Límite estricto de <= 20 filas en Inicio (Home).
 * 2. Blindaje anti-portadas vacías: vote_count.gte >= 3 en Discover (evita pósters rotos/fantasma).
 * 3. Orden dinámico: prioriza fecha de estreno más reciente (prohíbe popularidad estática).
 */
export function auditLeanbackHomeCatalogs(presetData) {
  const std = presetData?.aioMetadataConfig?.catalogs?.standard;
  if (!Array.isArray(std)) {
    return {
      valid: false,
      errors: ['No se encontró aioMetadataConfig.catalogs.standard en el preset.'],
      warnings: [],
      homeCount: 0,
      homeCatalogs: [],
    };
  }

  const errors = [];
  const warnings = [];
  const homeCatalogs = std.filter((c) => c.showInHome !== false && c.enabled !== false);
  const homeCount = homeCatalogs.length;

  // 1. Tope estricto de <= 20 filas en Inicio (Leanback UX)
  if (homeCount === 0) {
    errors.push('No hay catálogos configurados para la pantalla de inicio (showInHome: true).');
  } else if (homeCount > 20) {
    errors.push(`Gobernanza Leanback violada: ${homeCount} catálogos en Inicio exceden el límite máximo de 20 filas.`);
  }

  // 2. Blindaje anti-portadas vacías y ordenamiento dinámico
  homeCatalogs.forEach((c) => {
    const isUpcoming = /upcoming/.test(String(c.id || ''));
    const params = c.metadata?.discover?.params;

    if (params) {
      // Blindaje anti-portadas vacías: para títulos ya estrenados, vote_count.gte >= 3
      if (!isUpcoming) {
        const voteCountGte = Number(params['vote_count.gte']);
        if (isNaN(voteCountGte) || voteCountGte < 3) {
          errors.push(`Catálogo de inicio "${c.name}" (${c.id}) carece de blindaje anti-portadas vacías (vote_count.gte: ${params['vote_count.gte'] ?? 'no definido'}, mínimo requerido: 3).`);
        }
      }

      // Erradicación de listas de popularidad congeladas en el pasado
      const sortBy = String(params.sort_by || '');
      if (/^popularity\./i.test(sortBy)) {
        errors.push(`Catálogo de inicio "${c.name}" (${c.id}) usa orden de popularidad estático "${sortBy}". Debe priorizar fecha de estreno más reciente.`);
      } else if (!isUpcoming && !/(release_date|first_air_date|date)\.desc/i.test(sortBy)) {
        warnings.push(`Catálogo de inicio "${c.name}" (${c.id}) tiene sort_by "${sortBy}" en lugar de orden descendente por fecha.`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    homeCount,
    homeCatalogs,
  };
}

// Ejecución CLI directa
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
  const { homeCatalogs, otherCatalogs } = pruneAndCalibratePreset(preset);

  console.log('\n── RESULTADO DE LA CURADURÍA LEANBACK UX (ZTE B866V2) ──');
  console.log(`Filas curadas en Inicio (Home): ${homeCatalogs.length} (límite estricto <= 20)`);
  homeCatalogs.forEach((c, i) => {
    const p = c.metadata?.discover?.params || {};
    console.log(`  ${String(i + 1).padStart(2)}. [${c.type}] ${c.name.padEnd(34)} | sort: ${p.sort_by} | vote_gte: ${p['vote_count.gte']}`);
  });
  console.log(`\nFilas en Descubrir únicamente: ${otherCatalogs.length} catálogos`);
  console.log(`Total catálogos estándar: ${preset.aioMetadataConfig.catalogs.standard.length}`);

  if (WRITE) {
    writeFileSync(PRESET_PATH, JSON.stringify(preset, null, 2) + '\n');
    console.log('\n✓ data/preset.json actualizado exitosamente con la nueva curaduría.');
  } else {
    console.log('\n[DRY-RUN] Ejecute con --write para persistir los cambios.');
  }
}
