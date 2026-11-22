/**
 * manifest.ts — Manifiesto canónico de MejoraStremio Hub (v3.4.0).
 *
 * Provee la definición única y estandarizada del Addon Unificado de MejoraStremio,
 * optimizado para Android TV / Leanback UI en TV Box ZTE B866V2.
 * Incorpora:
 * - Recursos: Streams [🌎 LATINO] + TorBox Debrid + Origen [NF]/[HBO]/[Prime]/[Movistar+]/[BBC]/[EU],
 *   Subtítulos SmartSync/IA, Catálogos de Inicio (<=15 filas) + Secciones en Descubrir de
 *   Sagas/Universos (Marvel, DC, Harry Potter, X-Men, Independientes) y Plataformas Streaming/Europa
 *   con filtros unificados de género y tabla de calificaciones Argentina (ATP, +13, +16, +18).
 */

import {
  ARGENTINE_RATING_OPTIONS,
  buildSagasRollupOptions,
  buildStandardFilterOptions,
  buildStreamingRollupOptions,
  discoverExtra,
  GENRE_IDS_MOVIE,
  GENRE_IDS_SERIES,
  SERVICE_IDS,
} from "./catalogs/tmdb.ts";

function buildUniverseOrPlatformExtra(type: "movie" | "series") {
  return [
    { name: "genre", options: buildStandardFilterOptions(type), isRequired: true },
    { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
    { name: "sort", options: ["popularity.desc", "released"], isRequired: false },
    { name: "skip" },
  ];
}

function buildDiscoverSectionPair(id: string, movieName: string, seriesName = movieName) {
  return [
    { type: "movie", id, name: movieName, extra: buildUniverseOrPlatformExtra("movie") },
    { type: "series", id, name: seriesName, extra: buildUniverseOrPlatformExtra("series") },
  ];
}

const SHARED_PLATFORM_AND_SAGA_SECTIONS = [
  // Plataformas Streaming y Producción Europea (Solo en Descubrir: isRequired: true)
  ...buildDiscoverSectionPair("stream-netflix", "📺 Netflix"),
  ...buildDiscoverSectionPair("stream-hbo", "📺 HBO Max"),
  ...buildDiscoverSectionPair("stream-prime", "📺 Prime Video"),
  ...buildDiscoverSectionPair("stream-movistar", "📺 Movistar+"),
  ...buildDiscoverSectionPair("stream-bbc", "📺 BBC"),
  ...buildDiscoverSectionPair("stream-europa", "🇪🇺 Producción Europea"),

  // Sagas y Universos (Solo en Descubrir: isRequired: true)
  ...buildDiscoverSectionPair("saga-marvel", "🦸 Marvel (MCU)"),
  ...buildDiscoverSectionPair("saga-dc", "🦇 DC Comics"),
  ...buildDiscoverSectionPair("saga-harry-potter", "⚡ Harry Potter"),
  ...buildDiscoverSectionPair("saga-xmen", "❌ X-Men"),
  ...buildDiscoverSectionPair("saga-independientes", "🎞️ Cine Independiente", "🎞️ Series Independientes"),

  // Descubrir Avanzado (Solo en Descubrir: isRequired: true)
  {
    type: "movie",
    id: "discover-master",
    name: "Descubrir Películas (Filtros Avanzados)",
    extra: discoverExtra(GENRE_IDS_MOVIE, true),
  },
  {
    type: "series",
    id: "discover-master",
    name: "Descubrir Series (Filtros Avanzados)",
    extra: discoverExtra(GENRE_IDS_SERIES, true),
  },
];

export const MEJORASTREMIO_HUB_MANIFEST = {
  id: "com.mejorastremio.hub",
  version: "3.4.0",
  name: "MejoraStremio Hub v3.4.0 (Enterprise)",
  description:
    "Suite integral de MejoraStremio para TV Box: Streams con prioridad absoluta de Audio Latino [🌎 LATINO], TorBox instantáneo e identificación [NF]/[HBO]/[Prime]/[Movistar+]/[BBC]/[EU], subtítulos sin SDH, SmartSync calibrado, traducción IA Gemini Flash, recomendador IA 'Para vos', catálogo 'Acción ATP & Familiar Latino', y secciones de Sagas/Universos (Marvel, DC, Harry Potter, X-Men, Independientes) y Plataformas con tabla de calificaciones Argentina (ATP, +13, +16, +18).",
  resources: ["stream", "subtitles", "catalog", "meta"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    // 1–15: Filas curadas en Inicio (isRequired: false -> <= 15 filas Leanback UI)
    {
      type: "movie",
      id: "para-vos",
      name: "Para vos · Recomendado por IA",
      extra: [{ name: "skip" }],
    },
    {
      type: "series",
      id: "para-vos",
      name: "Para vos (Series) · Recomendado por IA",
      extra: [{ name: "skip" }],
    },
    {
      type: "movie",
      id: "accion-familiar-latino",
      name: "Acción ATP & Familiar Latino",
      extra: [
        {
          name: "genre",
          options: [
            "Todos",
            "Shawn Levy & Free Guy",
            "Acción y Aventura",
            "Comedia de Acción",
            "Superhéroes ATP",
            "Ciencia Ficción Familiar",
          ],
          isRequired: false,
        },
        { name: "sort", options: ["popularity.desc", "released", "vote_average.desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "accion-familiar-latino",
      name: "Acción ATP & Familiar Latino (Series)",
      extra: [
        { name: "sort", options: ["popularity.desc", "released", "vote_average.desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "movie",
      id: "nuevos-estrenos-cine",
      name: "Nuevos Estrenos Cine",
      extra: [
        { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_MOVIE)], isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "nuevas-temporadas",
      name: "Nuevas Temporadas",
      extra: [
        { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_SERIES)], isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "movie",
      id: "familia",
      name: "Para Ver en Familia",
      extra: [
        { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_MOVIE)], isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "movie",
      id: "cine-argentina",
      name: "Cine Argentina",
      extra: [
        { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_MOVIE)], isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "series-argentina",
      name: "Series Argentina",
      extra: [
        { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_SERIES)], isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "miniseries",
      name: "Miniseries de Fin de Semana",
      extra: [
        { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_SERIES)], isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "short-series",
      name: "Comedias de Bolsillo (≤30 min)",
      extra: [
        { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "movie",
      id: "estrenos-streaming",
      name: "Estrenos Streaming (Cine)",
      extra: [
        { name: "genre", options: buildStreamingRollupOptions("movie"), isRequired: false },
        { name: "service", options: ["Todos", ...Object.keys(SERVICE_IDS)], isRequired: false },
        { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "estrenos-streaming",
      name: "Estrenos Streaming (Series)",
      extra: [
        { name: "genre", options: buildStreamingRollupOptions("series"), isRequired: false },
        { name: "service", options: ["Todos", ...Object.keys(SERVICE_IDS)], isRequired: false },
        { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "movie",
      id: "sagas-universos",
      name: "Sagas y Universos (Marvel · DC · HP · X-Men)",
      extra: [
        { name: "genre", options: buildSagasRollupOptions(), isRequired: false },
        { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
        { name: "sort", options: ["popularity.desc", "released"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "sagas-universos",
      name: "Sagas y Universos (Series)",
      extra: [
        { name: "genre", options: buildSagasRollupOptions(), isRequired: false },
        { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
        { name: "sort", options: ["popularity.desc", "released"], isRequired: false },
        { name: "skip" },
      ],
    },

    // Plataformas Streaming y Producción Europea + Sagas + Descubrir Avanzado (Solo en Descubrir: isRequired: true)
    ...SHARED_PLATFORM_AND_SAGA_SECTIONS,
  ],
  languages: ["spl", "spa", "es-419"],
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
};

/**
 * Manifiesto especializado para stremiojn@gmail.com (Joaquín):
 * 14 filas en Inicio orientadas a UFC, MMA, Boxeo, Combate, Acción y Thriller/Policial
 * (cero contenido infantil/familiar) + 28 secciones en Descubrir (Boxeo, F1/Motor, Plataformas,
 * Sagas/Universos y Tabla de Calificaciones Argentina) = 42 catálogos totales.
 */
export function buildStremioJnManifest() {
  return {
    id: "com.mejorastremio.hub",
    version: "3.4.0",
    name: "MejoraStremio Hub v3.4.0 · UFC & Combate",
    description:
      "Edición UFC & Combate para Joaquín: Eventos UFC PPV/Fight Nights, Series y Realities UFC/MMA, Cine de Combate y Boxeo, Acción de Adrenalina, Thriller/Policial, recomendación IA personalizada, TorBox instantáneo [🌎 LATINO], subtítulos sin SDH duales y todas las secciones de Plataformas y Sagas con Tabla Argentina.",
    resources: ["stream", "subtitles", "catalog", "meta"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
      // 1–14: Filas curadas en Inicio (isRequired: false -> <= 16 Leanback UI, sin infantil)
      {
        type: "movie",
        id: "ufc-eventos",
        name: "🥊 UFC Eventos & PPV (Últimas Veladas)",
        extra: [
          {
            name: "genre",
            options: ["Todos", "Solo PPV Numerados", "Fight Nights y Especiales", "Documentales UFC y MMA"],
            isRequired: false,
          },
          { name: "skip" },
        ],
      },
      {
        type: "series",
        id: "ufc-series-hub",
        name: "🥋 UFC, MMA & Combate (Series y Realities)",
        extra: [
          {
            name: "genre",
            options: ["Todos", "UFC Oficial y Realities", "Series de MMA y Combate", "Anime de Combate", "WWE y Lucha Libre"],
            isRequired: false,
          },
          { name: "skip" },
        ],
      },
      {
        type: "movie",
        id: "cine-ufc-mma",
        name: "🔥 Cine de UFC, MMA & Boxeo",
        extra: [
          {
            name: "genre",
            options: ["Todos", "MMA y Jaula", "Boxeo Profesional", "Kickboxing y Artes Marciales", "Acción de Combate", "+13", "+16", "+18"],
            isRequired: false,
          },
          { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
          { name: "sort", options: ["popularity.desc", "released"], isRequired: false },
          { name: "skip" },
        ],
      },
      {
        type: "movie",
        id: "para-vos",
        name: "⚡ Para vos · UFC, Combate y Acción (IA)",
        extra: [{ name: "skip" }],
      },
      {
        type: "series",
        id: "para-vos",
        name: "⚡ Para vos (Series) · Combate y Adrenalina (IA)",
        extra: [{ name: "skip" }],
      },
      {
        type: "movie",
        id: "accion-adrenalina",
        name: "💥 Acción, Artes Marciales y Adrenalina",
        extra: [
          { name: "genre", options: ["Todos", "Acción", "Aventura", "Ciencia Ficción", "Thriller", "Crimen", "Acción · +13", "Acción · +16", "Acción · +18"], isRequired: false },
          { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
          { name: "sort", options: ["popularity.desc", "released"], isRequired: false },
          { name: "skip" },
        ],
      },
      {
        type: "series",
        id: "accion-adrenalina",
        name: "💥 Series de Acción, Combate y Policial",
        extra: [
          { name: "genre", options: ["Todos", "Acción y Aventura", "Crimen", "Drama", "Misterio", "Sci-Fi & Fantasy"], isRequired: false },
          { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
          { name: "sort", options: ["popularity.desc", "released"], isRequired: false },
          { name: "skip" },
        ],
      },
      {
        type: "movie",
        id: "thriller-policial",
        name: "🔪 Thriller, Crimen y Policial",
        extra: [
          { name: "genre", options: ["Todos", "Thriller", "Crimen", "Misterio", "Acción", "Thriller · +16", "Crimen · +16", "Thriller · +18"], isRequired: false },
          { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
          { name: "sort", options: ["popularity.desc", "released"], isRequired: false },
          { name: "skip" },
        ],
      },
      {
        type: "movie",
        id: "nuevos-estrenos-cine",
        name: "🎬 Nuevos Estrenos Cine",
        extra: [
          { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_MOVIE)], isRequired: false },
          { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
          { name: "skip" },
        ],
      },
      {
        type: "series",
        id: "nuevas-temporadas",
        name: "📺 Nuevas Temporadas",
        extra: [
          { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_SERIES)], isRequired: false },
          { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
          { name: "skip" },
        ],
      },
      {
        type: "movie",
        id: "estrenos-streaming",
        name: "🔥 Estrenos Streaming (Cine)",
        extra: [
          { name: "genre", options: buildStreamingRollupOptions("movie"), isRequired: false },
          { name: "service", options: ["Todos", ...Object.keys(SERVICE_IDS)], isRequired: false },
          { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
          { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
          { name: "skip" },
        ],
      },
      {
        type: "series",
        id: "estrenos-streaming",
        name: "🔥 Estrenos Streaming (Series)",
        extra: [
          { name: "genre", options: buildStreamingRollupOptions("series"), isRequired: false },
          { name: "service", options: ["Todos", ...Object.keys(SERVICE_IDS)], isRequired: false },
          { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
          { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
          { name: "skip" },
        ],
      },
      {
        type: "movie",
        id: "sagas-universos",
        name: "🦸 Sagas y Universos (Marvel · DC · X-Men · Indie)",
        extra: [
          { name: "genre", options: buildSagasRollupOptions(), isRequired: false },
          { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
          { name: "sort", options: ["popularity.desc", "released"], isRequired: false },
          { name: "skip" },
        ],
      },
      {
        type: "series",
        id: "sagas-universos",
        name: "🦸 Sagas y Universos (Series)",
        extra: [
          { name: "genre", options: buildSagasRollupOptions(), isRequired: false },
          { name: "rating", options: ARGENTINE_RATING_OPTIONS, isRequired: false },
          { name: "sort", options: ["popularity.desc", "released"], isRequired: false },
          { name: "skip" },
        ],
      },

      // 15–42: Secciones exclusivas en Descubrir (genre.isRequired: true -> 28 secciones)
      ...buildDiscoverSectionPair("combat-boxeo", "🥊 Boxeo y Kickboxing"),
      ...buildDiscoverSectionPair("combat-motor-deportes", "🏎️ F1, Motor y Deportes"),
      ...SHARED_PLATFORM_AND_SAGA_SECTIONS,
    ],
    languages: ["spl", "spa", "es-419"],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
  };
}
