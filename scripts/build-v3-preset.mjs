#!/usr/bin/env node
/**
 * build-v3-preset.mjs — Generador y Reconstructor V3.0 Empresarial de data/preset.json
 *
 * Implementa:
 * 1. Purgado total y estructuración cruzada (Plataformas x Géneros x Origen).
 * 2. Inyección rígida de Filtros Anti-Basura Globales:
 *    - vote_count.gte: 150
 *    - vote_average.gte: 6.0
 *    - without_original_language: "hi,ko,ja,zh,tr,th"
 *    - with_origin_country: "US|GB|AR|ES" (o "US|GB")
 *    - without_genres: "99,10767" (bloqueo conjunto de documentales y talk shows).
 * 3. Catálogos específicos de nicho para stremiojn:
 *    - Management B2B: keywords 1442,11520,10471,164629,236319 (permite documental 99).
 *    - Deportes Motor/Combate: keywords 9715,25484,10121,10649 (permite documental 99).
 * 4. Gobernanza Leanback UX:
 *    - Máximo 20 filas en Inicio (Home).
 *    - El resto de catálogos habilitados en Descubrir (showInHome: false).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PRESET_PATH = join(ROOT, 'data', 'preset.json');

const rawPreset = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));

// ── Filtros Globales Anti-Basura ──────────────────────────────────────────────
const GLOBAL_ANTI_TRASH = {
  'vote_count.gte': 150,
  'vote_average.gte': 6.0,
  without_original_language: 'hi,ko,ja,zh,tr,th',
  with_origin_country: 'US|GB|AR|ES',
  include_adult: false,
};

// Redes y Plataformas Principales
const NETWORKS = [
  { id: 'netflix', name: 'Netflix', networkId: '213', providerId: '8', origin: 'US|GB' },
  { id: 'max', name: 'Max', networkId: '3182', providerId: '1899', origin: 'US|GB|AR|ES' },
  { id: 'prime', name: 'Prime Video', networkId: '1024', providerId: '9', origin: 'US|GB' },
  { id: 'apple', name: 'Apple TV+', networkId: '2552', providerId: '350', origin: 'US|GB' },
];

// Géneros Clave Películas
const MOVIE_GENRES = [
  { id: 'accion', name: 'Acción', genreId: '28' },
  { id: 'thriller', name: 'Thriller & Suspenso', genreId: '53' },
  { id: 'comedia', name: 'Comedia', genreId: '35' },
  { id: 'drama', name: 'Drama', genreId: '18' },
  { id: 'scifi', name: 'Ciencia Ficción', genreId: '878' },
  { id: 'crimen', name: 'Crimen & Policial', genreId: '80' },
  { id: 'animacion', name: 'Animación', genreId: '16' },
  { id: 'aventura', name: 'Aventura', genreId: '12' },
  { id: 'terror', name: 'Terror', genreId: '27' },
  { id: 'misterio', name: 'Misterio', genreId: '9648' },
];

// Géneros Clave Series
const SERIES_GENRES = [
  { id: 'thriller', name: 'Thriller & Suspenso', genreId: '53' },
  { id: 'accion', name: 'Acción & Aventura', genreId: '10759' },
  { id: 'drama', name: 'Drama', genreId: '18' },
  { id: 'scifi', name: 'Sci-Fi & Fantasía', genreId: '10765' },
  { id: 'comedia', name: 'Comedia', genreId: '35' },
  { id: 'crimen', name: 'Crimen', genreId: '80' },
  { id: 'misterio', name: 'Misterio', genreId: '9648' },
  { id: 'animacion', name: 'Animación', genreId: '16' },
];

const newStandardCatalogs = [];
const seenCatalogKeys = new Set();

function makeCatalogItem({
  id,
  type,
  name,
  showInHome = false,
  params = {},
  formStateExtra = {},
}) {
  const key = `${type}|${id}`;
  if (seenCatalogKeys.has(key)) {
    return null;
  }
  seenCatalogKeys.add(key);

  const mergedParams = {
    sort_by: type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
    ...GLOBAL_ANTI_TRASH,
    without_genres: '99,10767',
    ...params,
  };

  return {
    id,
    type,
    name,
    enabled: true,
    showInHome: !!showInHome,
    source: 'tmdb',
    cacheTTL: 86400,
    metadata: {
      description: `TMDB Discover (${type})`,
      discover: {
        version: 2,
        source: 'tmdb',
        mediaType: type,
        params: mergedParams,
        formState: {
          catalogName: name,
          discoverSource: 'tmdb',
          sortBy: mergedParams.sort_by,
          cacheTTL: 86400,
          catalogType: type,
          includeGenres: [],
          excludeGenres: [],
          genreJoinMode: 'or',
          originalLanguage: '',
          originCountry: mergedParams.with_origin_country || '',
          certificationCountry: '',
          certificationValue: '',
          includeAdult: false,
          releasedOnly: false,
          selectedPeople: [],
          peopleJoinMode: 'or',
          withCompanies: [],
          withoutCompanies: [],
          companyJoinMode: 'or',
          withKeywords: [],
          withoutKeywords: [],
          keywordJoinMode: 'or',
          watchRegion: 'AR',
          watchProviders: [],
          providerJoinMode: 'or',
          voteAverageRange: [mergedParams['vote_average.gte'] || 6, 10],
          voteCountMin: mergedParams['vote_count.gte'] || 150,
          runtimeRange: [0, 400],
          ...formStateExtra,
        },
      },
    },
  };
}

function addCatalog(opts) {
  const item = makeCatalogItem(opts);
  if (item) newStandardCatalogs.push(item);
}

// ── 1. Catálogos Anidados Insignia en Inicio (showInHome: true, Leanback UX <= 20) ───

// A. Globales destacados requeridos explícitamente:
addCatalog({
    id: 'tmdb.discover.tv.netflix.thriller.us_uk',
    type: 'series',
    name: 'Netflix | Series | Thriller (US/UK)',
    showInHome: true,
    params: {
      with_networks: '213',
      with_genres: '53',
      with_origin_country: 'US|GB',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.movie.max.accion',
    type: 'movie',
    name: 'Max | Cine | Acción',
    showInHome: true,
    params: {
      with_networks: '3182',
      with_watch_providers: '1899',
      watch_region: 'AR',
      with_genres: '28',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.prime.scifi',
    type: 'series',
    name: 'Prime Video | Series | Sci-Fi & Fantasía',
    showInHome: true,
    params: {
      with_networks: '1024',
      with_genres: '10765',
      with_origin_country: 'US|GB',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.apple.drama',
    type: 'series',
    name: 'Apple TV+ | Series | Drama de Prestigio',
    showInHome: true,
    params: {
      with_networks: '2552',
      with_genres: '18',
      with_origin_country: 'US|GB',
      without_genres: '99,10767',
    },
  });

// B. Catálogos Insignia de Plataforma (4 películas + 4 series):
NETWORKS.forEach((net) => {
  addCatalog({
    id: `tmdb.discover.movie.${net.id}.destacadas`,
    type: 'movie',
    name: `${net.name} | Cine Destacado`,
    showInHome: true,
    params: {
      with_networks: net.networkId,
      with_watch_providers: net.providerId,
      watch_region: 'AR',
      with_origin_country: net.origin,
      without_genres: '99,10767',
    },
  });

  addCatalog({
    id: `tmdb.discover.tv.${net.id}.destacadas`,
    type: 'series',
    name: `${net.name} | Series Destacadas`,
    showInHome: true,
    params: {
      with_networks: net.networkId,
      with_origin_country: net.origin,
      without_genres: '99,10767',
    },
  });
});

// ── 2. Perfilado de Nicho para stremiojn (Excepción: Documental 99 Permitido) ─
// Bloque Management: Keywords 1442,11520,10471,164629,236319
addCatalog({
    id: 'tmdb.discover.movie.business.management.stremiojn',
    type: 'movie',
    name: 'stremiojn | Management & Negocios B2B',
    showInHome: true,
    params: {
      with_keywords: '1442,11520,10471,164629,236319',
      without_genres: '10767', // Documental 99 PERMITIDO
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.business.management.stremiojn',
    type: 'series',
    name: 'stremiojn | Management & Negocios B2B (Series)',
    showInHome: false,
    params: {
      with_keywords: '1442,11520,10471,164629,236319',
      without_genres: '10767', // Documental 99 PERMITIDO
    },
  });

// Bloque Deportes Motor / Combate: Keywords 9715,25484,10121,10649
addCatalog({
    id: 'tmdb.discover.movie.deportes.motor_combate.stremiojn',
    type: 'movie',
    name: 'stremiojn | Deportes de Motor & Combate (F1 / UFC / WWE)',
    showInHome: true,
    params: {
      with_keywords: '9715,25484,10121,10649',
      without_genres: '10767', // Documental 99 PERMITIDO
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.deportes.motor_combate.stremiojn',
    type: 'series',
    name: 'stremiojn | Deportes de Motor & Combate (Series)',
    showInHome: false,
    params: {
      with_keywords: '9715,25484,10121,10649',
      without_genres: '10767', // Documental 99 PERMITIDO
    },
  });

// Nichos específicos secundarios para stremiojn:
addCatalog({
    id: 'tmdb.discover.movie.deportes.f1.stremiojn',
    type: 'movie',
    name: 'stremiojn | Fórmula 1 (F1) Especiales',
    showInHome: false,
    params: {
      with_keywords: '9715',
      without_genres: '10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.movie.deportes.ufc.stremiojn',
    type: 'movie',
    name: 'stremiojn | UFC & Artes Marciales Mixtas',
    showInHome: false,
    params: {
      with_keywords: '10121',
      without_genres: '10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.movie.deportes.wwe.stremiojn',
    type: 'movie',
    name: 'stremiojn | WWE & Lucha Libre Pro',
    showInHome: false,
    params: {
      with_keywords: '25484',
      without_genres: '10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.movie.business.wallstreet.stremiojn',
    type: 'movie',
    name: 'stremiojn | Wall Street & Finanzas Globales',
    showInHome: false,
    params: {
      with_keywords: '1566',
      without_genres: '10767',
    },
  });

// ── 3. Matriz Programática Cruzada (Redes x Géneros x Tipo) ─────────────────
NETWORKS.forEach((net) => {
  // Películas Cruzadas
  MOVIE_GENRES.forEach((g) => {
    addCatalog({
      id: `tmdb.discover.movie.${net.id}.${g.id}`,
      type: 'movie',
      name: `${net.name} | Cine | ${g.name}`,
      showInHome: false,
      params: {
        with_networks: net.networkId,
        with_watch_providers: net.providerId,
        watch_region: 'AR',
        with_origin_country: net.origin,
        with_genres: g.genreId,
        without_genres: '99,10767',
      },
    });
  });

  // Series Cruzadas
  SERIES_GENRES.forEach((g) => {
    addCatalog({
      id: `tmdb.discover.tv.${net.id}.${g.id}`,
      type: 'series',
      name: `${net.name} | Series | ${g.name}`,
      showInHome: false,
      params: {
        with_networks: net.networkId,
        with_origin_country: net.origin,
        with_genres: g.genreId,
        without_genres: '99,10767',
      },
    });
  });
});

// ── 4. Catálogos Dinámicos de Estrenos y Región ──────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
const ninetyDaysAhead = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

addCatalog({
    id: 'tmdb.discover.movie.now_playing.pablo007',
    type: 'movie',
    name: 'En Cartelera',
    showInHome: true,
    params: {
      with_release_type: '2|3',
      region: 'AR',
      'primary_release_date.gte': sixtyDaysAgo,
      'primary_release_date.lte': today,
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.now_playing.pablo062',
    type: 'series',
    name: 'En Cartelera (Series)',
    showInHome: false,
    params: {
      'first_air_date.gte': sixtyDaysAgo,
      'first_air_date.lte': today,
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.movie.upcoming.pablo005',
    type: 'movie',
    name: 'Próximos Estrenos',
    showInHome: false,
    params: {
      'primary_release_date.gte': today,
      'primary_release_date.lte': ninetyDaysAhead,
      'vote_count.gte': 0, // En lanzamientos futuros no hay votos
      'vote_average.gte': 0,
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.upcoming.pablo006',
    type: 'series',
    name: 'Próximos Estrenos (Series)',
    showInHome: false,
    params: {
      'first_air_date.gte': today,
      'first_air_date.lte': ninetyDaysAhead,
      'vote_count.gte': 0,
      'vote_average.gte': 0,
      without_genres: '99,10767',
    },
  });

// Argentina, España, UK y Latinoamérica con filtro anti-basura garantizado
addCatalog({
    id: 'tmdb.discover.movie.argentina.pablo001',
    type: 'movie',
    name: 'Cine Argentina',
    showInHome: false,
    params: {
      with_origin_country: 'AR',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.argentina.pablo002',
    type: 'series',
    name: 'Series Argentina',
    showInHome: false,
    params: {
      with_origin_country: 'AR',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.movie.latam.pablo003',
    type: 'movie',
    name: 'Latinoamérica | Cine',
    showInHome: false,
    params: {
      with_origin_country: 'AR|MX|CO|CL',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.latam.pablo004',
    type: 'series',
    name: 'Latinoamérica | Series',
    showInHome: false,
    params: {
      with_origin_country: 'AR|MX|CO|CL',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.movie.uk.pablo005',
    type: 'movie',
    name: 'Cine Británico (UK)',
    showInHome: false,
    params: {
      with_origin_country: 'GB',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.uk.pablo006',
    type: 'series',
    name: 'Series Británicas (UK)',
    showInHome: false,
    params: {
      with_origin_country: 'GB',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.movie.espana.pablo007',
    type: 'movie',
    name: 'Cine Español (ES)',
    showInHome: false,
    params: {
      with_origin_country: 'ES',
      without_genres: '99,10767',
    },
  });

addCatalog({
    id: 'tmdb.discover.tv.espana.pablo008',
    type: 'series',
    name: 'Series Españolas (ES)',
    showInHome: false,
    params: {
      with_origin_country: 'ES',
      without_genres: '99,10767',
    },
  });

// ── 5. Gobernanza Leanback UX (Home <= 20) ───────────────────────────────────
const homeCatalogs = newStandardCatalogs.filter((c) => c.showInHome);
console.log(`Total catálogos generados: ${newStandardCatalogs.length}`);
console.log(`Catálogos en Home (Inicio): ${homeCatalogs.length} (Tope estricto <= 20)`);

if (homeCatalogs.length > 20) {
  throw new Error(`[Leanback UX Error] ${homeCatalogs.length} catálogos en Home exceden el límite de 20.`);
}

// ── 6. Sobrescritura Atómica de preset.json ──────────────────────────────────
rawPreset.aioMetadataConfig.catalogs.standard = newStandardCatalogs;
writeFileSync(PRESET_PATH, JSON.stringify(rawPreset, null, 2) + '\n', 'utf8');
console.log(`✓ data/preset.json actualizado con éxito.`);
