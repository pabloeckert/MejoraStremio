/**
 * manifest.ts — Manifiesto canónico de MejoraStremio Hub (v3.1.0).
 *
 * Provee la definición única y estandarizada del Addon Unificado de MejoraStremio,
 * optimizado para Android TV / Leanback UI en TV Box ZTE B866V2.
 * Incorpora:
 * - Recursos: Streams [🌎 LATINO] + TorBox Debrid, Subtítulos SmartSync/IA,
 *   Catálogos con Filtros Multinivel y Metadatos con Sinopsis y Tráilers en Español Latino.
 */

import {
  discoverExtra,
  GENRE_IDS_MOVIE,
  GENRE_IDS_SERIES,
  SERVICE_IDS,
} from "./catalogs/tmdb.ts";

export const MEJORASTREMIO_HUB_MANIFEST = {
  id: "com.mejorastremio.hub",
  version: "3.1.0",
  name: "MejoraStremio Hub v3.1 (Enterprise)",
  description:
    "Suite integral de MejoraStremio para TV Box: Streams con prioridad absoluta de Audio Latino [🌎 LATINO] y TorBox instantáneo, subtítulos sin SDH, SmartSync PAL 25->23.976fps, traducción IA Gemini Flash bajo demanda, sinopsis y tráilers en español latino, y catálogos con filtros por plataforma, región, país y género.",
  resources: ["stream", "subtitles", "catalog", "meta"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
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
      id: "estrenos-streaming",
      name: "Estrenos Streaming (Cine)",
      extra: [
        { name: "service", options: ["Todos", ...Object.keys(SERVICE_IDS)], isRequired: false },
        { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_MOVIE)], isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "estrenos-streaming",
      name: "Estrenos Streaming (Series)",
      extra: [
        { name: "service", options: ["Todos", ...Object.keys(SERVICE_IDS)], isRequired: false },
        { name: "genre", options: ["Todos", ...Object.keys(GENRE_IDS_SERIES)], isRequired: false },
        { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "movie",
      id: "discover-master",
      name: "Descubrir Películas (Filtros Avanzados)",
      extra: discoverExtra(GENRE_IDS_MOVIE, false),
    },
    {
      type: "series",
      id: "discover-master",
      name: "Descubrir Series (Filtros Avanzados)",
      extra: discoverExtra(GENRE_IDS_SERIES, false),
    },
  ],
  languages: ["spl", "spa", "es-419"],
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
};
