/**
 * manifest.ts — Manifiesto canónico de MejoraStremio Hub (v1.4.2).
 *
 * Provee la definición única y estandarizada del Addon Unificado de MejoraStremio,
 * optimizado para Android TV / Leanback UI en TV Box ZTE B866V2.
 */

export const MEJORASTREMIO_HUB_MANIFEST = {
  id: "com.mejorastremio.hub",
  version: "1.4.2",
  name: "MejoraStremio Hub (TorBox Latino + Subtítulos IA)",
  description:
    "Suite integral de MejoraStremio para TV Box: Streams con prioridad absoluta de Audio Latino [🌎 LATINO] y TorBox instantáneo, subtítulos sin SDH, SmartSync PAL 25->23.976fps, traducción IA Gemini Flash bajo demanda y catálogos de estreno Día 1 en orden cronológico estricto.",
  resources: ["stream", "subtitles", "catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    {
      type: "movie",
      id: "nuevos-estrenos-cine",
      name: "Nuevos Estrenos Cine",
      extra: [
        { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "nuevas-temporadas",
      name: "Nuevas Temporadas",
      extra: [
        { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "movie",
      id: "estrenos-streaming",
      name: "Estrenos Streaming (Cine)",
      extra: [
        { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
        { name: "skip" },
      ],
    },
    {
      type: "series",
      id: "estrenos-streaming",
      name: "Estrenos Streaming (Series)",
      extra: [
        { name: "sort", options: ["released", "premiere_date", "year_desc"], isRequired: false },
        { name: "skip" },
      ],
    },
  ],
  languages: ["spl", "spa", "es-419"],
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
};
