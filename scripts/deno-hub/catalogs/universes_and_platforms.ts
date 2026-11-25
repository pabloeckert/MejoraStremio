/**
 * universes_and_platforms.ts — Taxonomía Unificada de Sagas/Universos,
 * Plataformas Streaming + Producción Europea y Calificaciones Tabla Argentina (INCAA / ENACOM).
 *
 * Diseñado específicamente para Android TV Leanback UI:
 * - Usa exclusivamente `genre` en el dropdown de Descubrir sin `/` ni strings largos (> 28 chars).
 * - Preserva `+` literal con `parseStremioExtra` (evita corrupción `+13` -> ` 13` de URLSearchParams).
 * - Implementa cadenas de homologación INCAA/ENACOM (AR -> US / GB / ES) en TMDB Discover.
 */

export type ArgentineRatingKey = "ATP" | "+13" | "+16" | "+18" | "ATP_13" | "16_18";
export type UniverseKey = "marvel" | "dc" | "harry-potter" | "xmen" | "independientes";
export type PlatformKey = "netflix" | "hbo" | "prime" | "movistar" | "bbc" | "europa";
export type RegionHint = "AR" | "US" | "ES" | "GB" | "EU";

export interface ParsedCompositeFilter {
  universe?: UniverseKey;
  platform?: PlatformKey;
  genreName?: string;
  genreId?: number;
  rating?: ArgentineRatingKey;
  ratingLabel?: string;
  sortRecent?: boolean;
}

export interface CertificationStep {
  certification_country: string;
  certification: string;
  excludeHorror?: boolean;
}

export interface DiscoverTargetConfig {
  badgeLabel: string;
  regionHint: RegionHint;
  movieParams: Record<string, string>;
  seriesParams: Record<string, string>;
  seriesFallbackParams?: Record<string, string>;
}

export const ARGENTINE_RATING_OPTIONS = ["Todos", "ATP", "+13", "+16", "+18"];

export const CATALOG_ID_TO_PLATFORM: Record<string, PlatformKey> = {
  "stream-netflix": "netflix",
  "stream-hbo": "hbo",
  "stream-prime": "prime",
  "stream-movistar": "movistar",
  "stream-bbc": "bbc",
  "stream-europa": "europa",
};

export const CATALOG_ID_TO_UNIVERSE: Record<string, UniverseKey> = {
  "saga-marvel": "marvel",
  "saga-dc": "dc",
  "saga-harry-potter": "harry-potter",
  "saga-xmen": "xmen",
  "saga-independientes": "independientes",
};

export const PLATFORM_CONFIGS: Record<PlatformKey, DiscoverTargetConfig> = {
  netflix: {
    badgeLabel: "📺 Netflix",
    regionHint: "AR",
    movieParams: { with_watch_providers: "8", watch_region: "AR", "vote_count.gte": "20" },
    seriesParams: {
      with_watch_providers: "8",
      watch_region: "AR",
      without_genres: "10763,10767,10764",
      "vote_count.gte": "10",
    },
    seriesFallbackParams: {
      with_networks: "213",
      without_genres: "10763,10767,10764",
      "vote_count.gte": "10",
    },
  },
  hbo: {
    badgeLabel: "📺 HBO Max",
    regionHint: "AR",
    movieParams: { with_watch_providers: "1899", watch_region: "AR", "vote_count.gte": "20" },
    seriesParams: {
      with_watch_providers: "1899",
      watch_region: "AR",
      without_genres: "10763,10767,10764",
      "vote_count.gte": "10",
    },
    seriesFallbackParams: {
      with_networks: "49|3186|8304",
      without_genres: "10763,10767,10764",
      "vote_count.gte": "10",
    },
  },
  prime: {
    badgeLabel: "📺 Prime Video",
    regionHint: "AR",
    movieParams: { with_watch_providers: "119", watch_region: "AR", "vote_count.gte": "20" },
    seriesParams: {
      with_watch_providers: "119",
      watch_region: "AR",
      without_genres: "10763,10767,10764",
      "vote_count.gte": "10",
    },
    seriesFallbackParams: {
      with_networks: "1024",
      without_genres: "10763,10767,10764",
      "vote_count.gte": "10",
    },
  },
  movistar: {
    badgeLabel: "📺 Movistar+",
    regionHint: "ES",
    movieParams: { with_watch_providers: "149|2241", watch_region: "ES", "vote_count.gte": "10" },
    seriesParams: {
      with_networks: "6920",
      without_genres: "10767,10763,10764",
      "vote_count.gte": "3",
    },
    seriesFallbackParams: {
      with_watch_providers: "149|2241",
      watch_region: "ES",
      without_genres: "10767,10763,10764",
      "vote_count.gte": "5",
    },
  },
  bbc: {
    badgeLabel: "📺 BBC",
    regionHint: "GB",
    movieParams: { with_companies: "3324|288|80893|4762", "vote_count.gte": "15" },
    seriesParams: {
      with_networks: "4|332|3|100",
      without_genres: "10766,10767,10763,10764",
      "vote_count.gte": "10",
    },
    seriesFallbackParams: {
      with_watch_providers: "38",
      watch_region: "GB",
      without_genres: "10766,10767,10763,10764",
      "vote_count.gte": "10",
    },
  },
  europa: {
    badgeLabel: "🇪🇺 Europa",
    regionHint: "EU",
    movieParams: {
      with_origin_country: "GB|FR|ES|IT|DE|SE|DK|NO|NL|BE|IE|PT|PL|CH|AT|FI",
      "vote_count.gte": "30",
    },
    seriesParams: {
      with_origin_country: "GB|FR|ES|IT|DE|SE|DK|NO|NL|BE|IE|PT|PL|CH|AT|FI",
      without_genres: "10766,10767,10763,10764",
      "vote_count.gte": "15",
    },
  },
};

export const UNIVERSE_CONFIGS: Record<UniverseKey, DiscoverTargetConfig> = {
  marvel: {
    badgeLabel: "🦸 Marvel",
    regionHint: "US",
    movieParams: { with_companies: "420|7505|19551|11106", "vote_count.gte": "20" },
    seriesParams: { with_companies: "420|38679|7505|19551", "vote_count.gte": "10" },
  },
  dc: {
    badgeLabel: "🦇 DC Comics",
    regionHint: "US",
    movieParams: { with_companies: "429|9993|128064|184898", "vote_count.gte": "20" },
    seriesParams: { with_companies: "429|9993|128064|184898", "vote_count.gte": "10" },
  },
  "harry-potter": {
    badgeLabel: "⚡ Harry Potter",
    regionHint: "GB",
    movieParams: {},
    seriesParams: {},
  },
  xmen: {
    badgeLabel: "❌ X-Men",
    regionHint: "US",
    movieParams: {},
    seriesParams: {},
  },
  independientes: {
    badgeLabel: "🎞️ Independiente",
    regionHint: "US",
    movieParams: {
      with_companies: "41077|90733|10146|307|43|127929|204957|15838|23243",
      "vote_count.gte": "30",
    },
    seriesParams: {
      with_companies: "41077|90733|10146|307|151789|204957",
      "vote_count.gte": "10",
    },
  },
};

/**
 * Parser seguro del segmento extra de Stremio sin corromper `+` literal en espacio
 * (`+13`, `+16`, `+18`, `Movistar+`).
 */
export function parseStremioExtra(extraStr?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!extraStr) return out;
  for (const part of extraStr.split("&")) {
    if (!part) continue;
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const rawKey = part.slice(0, eqIdx);
    const rawVal = part.slice(eqIdx + 1);
    let key = rawKey;
    let val = rawVal;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      // mantener rawKey
    }
    try {
      val = decodeURIComponent(rawVal);
    } catch {
      // mantener rawVal
    }
    out[key] = val;
  }
  return out;
}

export function buildStandardFilterOptions(type: "movie" | "series"): string[] {
  const common = [
    "Todos",
    "Estrenos Recientes",
    "ATP · Todo Público",
    "+13 · Mayores de 13",
    "+16 · Mayores de 16",
    "+18 · Mayores de 18",
  ];
  if (type === "movie") {
    return [
      ...common,
      "Acción",
      "Acción · ATP",
      "Acción · +13",
      "Acción · +16",
      "Acción · +18",
      "Acción · ATP y +13",
      "Acción · +16 y +18",
      "Aventura",
      "Aventura · ATP",
      "Aventura · +13",
      "Animación · ATP",
      "Animación · +13",
      "Ciencia Ficción",
      "Ciencia Ficción · ATP",
      "Ciencia Ficción · +13",
      "Ciencia Ficción · +16",
      "Comedia",
      "Comedia · ATP",
      "Comedia · +13",
      "Comedia · +16",
      "Comedia · ATP y +13",
      "Crimen y Policial",
      "Crimen · +13",
      "Crimen · +16",
      "Crimen · +18",
      "Crimen · +16 y +18",
      "Documental",
      "Documental · ATP",
      "Documental · +13",
      "Drama",
      "Drama · +13",
      "Drama · +16",
      "Drama · +18",
      "Drama · +16 y +18",
      "Familia · ATP",
      "Fantasía",
      "Fantasía · ATP",
      "Fantasía · +13",
      "Misterio",
      "Misterio · +13",
      "Misterio · +16",
      "Thriller",
      "Thriller · +13",
      "Thriller · +16",
      "Thriller · +18",
      "Thriller · +16 y +18",
      "Terror · +16",
      "Terror · +18",
      "Terror · +16 y +18",
      "Romance",
      "Romance · +13",
      "Romance · +16",
      "Historia",
      "Historia · +13",
      "Historia · +16",
    ];
  }
  return [
    ...common,
    "Acción y Aventura",
    "Acción · ATP",
    "Acción · +13",
    "Acción · +16",
    "Acción · +18",
    "Acción · ATP y +13",
    "Acción · +16 y +18",
    "Animación · ATP",
    "Animación · +13",
    "Sci-Fi y Fantasía",
    "Sci-Fi · ATP",
    "Sci-Fi · +13",
    "Sci-Fi · +16",
    "Sci-Fi · ATP y +13",
    "Comedia",
    "Comedia · ATP",
    "Comedia · +13",
    "Comedia · +16",
    "Comedia · ATP y +13",
    "Crimen y Policial",
    "Crimen · +13",
    "Crimen · +16",
    "Crimen · +18",
    "Crimen · +16 y +18",
    "Documental",
    "Documental · ATP",
    "Documental · +13",
    "Drama",
    "Drama · +13",
    "Drama · +16",
    "Drama · +18",
    "Drama · +16 y +18",
    "Familia · ATP",
    "Infantil · ATP",
    "Misterio",
    "Misterio · +13",
    "Misterio · +16",
    "Bélica y Política",
    "Bélica · +16",
  ];
}

export function buildSagasRollupOptions(): string[] {
  return [
    "Todos",
    "Marvel (MCU)",
    "Marvel · ATP",
    "Marvel · +13",
    "Marvel · +16",
    "Marvel · ATP y +13",
    "Marvel · +16 y +18",
    "Marvel · Acción · +13",
    "Marvel · Sci-Fi · ATP y +13",
    "DC Comics",
    "DC Comics · ATP",
    "DC Comics · +13",
    "DC Comics · +16",
    "DC Comics · +18",
    "DC Comics · ATP y +13",
    "DC Comics · +16 y +18",
    "DC Comics · Acción · +13",
    "DC Comics · Crimen · +16 y +18",
    "Harry Potter",
    "Harry Potter · ATP",
    "Harry Potter · +13",
    "Harry Potter · Fantasía · ATP",
    "Harry Potter · Aventura · +13",
    "X-Men",
    "X-Men · ATP",
    "X-Men · +13",
    "X-Men · +16",
    "X-Men · +18",
    "X-Men · +16 y +18",
    "X-Men · Acción · +13",
    "X-Men · Acción · +16 y +18",
    "Independientes",
    "Independientes · ATP",
    "Independientes · +13",
    "Independientes · +16",
    "Independientes · +18",
    "Independientes · ATP y +13",
    "Independientes · +16 y +18",
    "Independientes · Drama · +16 y +18",
    "Independientes · Comedia · +13",
    "Independientes · Thriller · +16 y +18",
    "Independientes · Terror · +16 y +18",
    "ATP · Todo Público",
    "+13 · Mayores de 13",
    "+16 · Mayores de 16",
    "+18 · Mayores de 18",
  ];
}

export function buildStreamingRollupOptions(type: "movie" | "series"): string[] {
  return [
    "Todos",
    "Netflix",
    "Netflix · ATP",
    "Netflix · +13",
    "Netflix · +16",
    "Netflix · +18",
    "Netflix · ATP y +13",
    "Netflix · +16 y +18",
    "Netflix · Acción · +13",
    "Netflix · Drama · +16 y +18",
    "Netflix · Thriller · +16 y +18",
    "HBO Max",
    "HBO Max · ATP",
    "HBO Max · +13",
    "HBO Max · +16",
    "HBO Max · +18",
    "HBO Max · ATP y +13",
    "HBO Max · +16 y +18",
    "HBO Max · Drama · +16 y +18",
    "HBO Max · Acción · +13",
    "HBO Max · Crimen · +16 y +18",
    "Prime Video",
    "Prime Video · ATP",
    "Prime Video · +13",
    "Prime Video · +16",
    "Prime Video · +18",
    "Prime Video · ATP y +13",
    "Prime Video · +16 y +18",
    "Prime Video · Acción · +13",
    "Prime Video · Sci-Fi · +16 y +18",
    "Movistar+",
    "Movistar+ · ATP",
    "Movistar+ · +13",
    "Movistar+ · +16",
    "Movistar+ · +18",
    "Movistar+ · +16 y +18",
    "Movistar+ · Drama · +16 y +18",
    "Movistar+ · Crimen · +16 y +18",
    "BBC",
    "BBC · ATP",
    "BBC · +13",
    "BBC · +16",
    "BBC · +18",
    "BBC · ATP y +13",
    "BBC · +16 y +18",
    "BBC · Drama · +13",
    "BBC · Crimen · +16 y +18",
    "BBC · Misterio · +13",
    "Producción Europea",
    "Europa · ATP",
    "Europa · +13",
    "Europa · +16",
    "Europa · +18",
    "Europa · ATP y +13",
    "Europa · +16 y +18",
    "Europa · Drama · +16 y +18",
    "Europa · Thriller · +16 y +18",
    "Europa · Comedia · ATP y +13",
    "ATP · Todo Público",
    "+13 · Mayores de 13",
    "+16 · Mayores de 16",
    "+18 · Mayores de 18",
    ...(type === "movie"
      ? [
          "Acción",
          "Comedia",
          "Drama",
          "Ciencia Ficción",
          "Crimen y Policial",
          "Thriller",
          "Familia",
          "Animación",
          "Documental",
        ]
      : [
          "Acción y Aventura",
          "Comedia",
          "Drama",
          "Sci-Fi y Fantasía",
          "Crimen y Policial",
          "Misterio",
          "Familia",
          "Animación",
          "Documental",
        ]),
  ];
}

function normalizeToken(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\bmovistar\s+/g, "movistar+ ")
    .replace(/\bmovistar$/g, "movistar+");
}

const MOVIE_GENRE_ALIASES: Record<string, { id: number; name: string }> = {
  "accion": { id: 28, name: "Acción" },
  "aventura": { id: 12, name: "Aventura" },
  "animacion": { id: 16, name: "Animación" },
  "comedia": { id: 35, name: "Comedia" },
  "crimen": { id: 80, name: "Crimen y Policial" },
  "crimen y policial": { id: 80, name: "Crimen y Policial" },
  "documental": { id: 99, name: "Documental" },
  "drama": { id: 18, name: "Drama" },
  "familia": { id: 10751, name: "Familia" },
  "fantasia": { id: 14, name: "Fantasía" },
  "historia": { id: 36, name: "Historia" },
  "terror": { id: 27, name: "Terror" },
  "musica": { id: 10402, name: "Música" },
  "misterio": { id: 9648, name: "Misterio" },
  "romance": { id: 10749, name: "Romance" },
  "ciencia ficcion": { id: 878, name: "Ciencia Ficción" },
  "sci-fi": { id: 878, name: "Ciencia Ficción" },
  "thriller": { id: 53, name: "Thriller" },
  "belica": { id: 10752, name: "Bélica" },
  "western": { id: 37, name: "Western" },
};

const SERIES_GENRE_ALIASES: Record<string, { id: number; name: string }> = {
  "accion": { id: 10759, name: "Acción y Aventura" },
  "accion y aventura": { id: 10759, name: "Acción y Aventura" },
  "aventura": { id: 10759, name: "Acción y Aventura" },
  "animacion": { id: 16, name: "Animación" },
  "comedia": { id: 35, name: "Comedia" },
  "crimen": { id: 80, name: "Crimen y Policial" },
  "crimen y policial": { id: 80, name: "Crimen y Policial" },
  "documental": { id: 99, name: "Documental" },
  "drama": { id: 18, name: "Drama" },
  "familia": { id: 10751, name: "Familia" },
  "infantil": { id: 10762, name: "Infantil" },
  "misterio": { id: 9648, name: "Misterio" },
  "noticias": { id: 10763, name: "Noticias" },
  "reality": { id: 10764, name: "Reality" },
  "sci-fi": { id: 10765, name: "Sci-Fi y Fantasía" },
  "sci-fi y fantasia": { id: 10765, name: "Sci-Fi y Fantasía" },
  "ciencia ficcion": { id: 10765, name: "Sci-Fi y Fantasía" },
  "ciencia ficcion y fantasia": { id: 10765, name: "Sci-Fi y Fantasía" },
  "fantasia": { id: 10765, name: "Sci-Fi y Fantasía" },
  "telenovela": { id: 10766, name: "Telenovela" },
  "talk show": { id: 10767, name: "Talk Show" },
  "belica": { id: 10768, name: "Bélica y Política" },
  "belica y politica": { id: 10768, name: "Bélica y Política" },
  "western": { id: 37, name: "Western" },
};

function parseRatingString(norm: string): { rating?: ArgentineRatingKey; ratingLabel?: string } {
  if (!norm || norm === "todos") return {};
  if (/\batp\s*y\s*\+?\s*13\b/.test(norm) || norm === "atp_13") {
    return { rating: "ATP_13", ratingLabel: "ATP y +13" };
  }
  if (/\+?\s*16\s*y\s*\+?\s*18\b/.test(norm) || norm === "16_18") {
    return { rating: "16_18", ratingLabel: "+16 y +18" };
  }
  if (/\batp\b/.test(norm)) {
    return { rating: "ATP", ratingLabel: "ATP" };
  }
  if (/(?:^|[\s·,(+])13\b/.test(norm) || /\+13\b/.test(norm)) {
    return { rating: "+13", ratingLabel: "+13" };
  }
  if (/(?:^|[\s·,(+])16\b/.test(norm) || /\+16\b/.test(norm)) {
    return { rating: "+16", ratingLabel: "+16" };
  }
  if (/(?:^|[\s·,(+])18\b/.test(norm) || /\+18\b/.test(norm)) {
    return { rating: "+18", ratingLabel: "+18" };
  }
  return {};
}

export function parseCompositeFilter(
  rawGenre: string | null | undefined,
  type: "movie" | "series",
  rawRating?: string | null,
  rawService?: string | null,
  rawUniverse?: string | null,
): ParsedCompositeFilter {
  const result: ParsedCompositeFilter = {};
  const norm = rawGenre ? normalizeToken(rawGenre) : "";

  if (norm && norm !== "todos") {
    if (norm.includes("estrenos recientes")) {
      result.sortRecent = true;
    }

    // Universos / Sagas
    if (norm.includes("marvel")) result.universe = "marvel";
    else if (norm.includes("dc comics") || /\bdc\b/.test(norm)) result.universe = "dc";
    else if (norm.includes("harry potter")) result.universe = "harry-potter";
    else if (norm.includes("x-men") || norm.includes("xmen")) result.universe = "xmen";
    else if (norm.includes("independiente")) result.universe = "independientes";

    // Plataformas
    if (norm.includes("netflix")) result.platform = "netflix";
    else if (norm.includes("hbo")) result.platform = "hbo";
    else if (norm.includes("prime")) result.platform = "prime";
    else if (norm.includes("movistar")) result.platform = "movistar";
    else if (norm.includes("bbc")) result.platform = "bbc";
    else if (norm.includes("europa") || norm.includes("europea")) result.platform = "europa";

    // Calificación desde `genre`
    const parsedFromGenre = parseRatingString(norm);
    if (parsedFromGenre.rating) {
      result.rating = parsedFromGenre.rating;
      result.ratingLabel = parsedFromGenre.ratingLabel;
    }

    // Género: inspeccionar TODOS los segmentos separados por `·` para filtros de 2 y 3 niveles
    const aliasMap = type === "movie" ? MOVIE_GENRE_ALIASES : SERIES_GENRE_ALIASES;
    const segments = norm.split("·").map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const genreMatch = aliasMap[seg];
      if (genreMatch) {
        result.genreId = genreMatch.id;
        result.genreName = genreMatch.name;
        break;
      }
    }
  }

  // Parámetro explícito `universe=...`
  if (rawUniverse && normalizeToken(rawUniverse) !== "todos") {
    const uniNorm = normalizeToken(rawUniverse);
    if (uniNorm.includes("marvel")) result.universe = "marvel";
    else if (uniNorm.includes("dc comics") || /\bdc\b/.test(uniNorm)) result.universe = "dc";
    else if (uniNorm.includes("harry potter")) result.universe = "harry-potter";
    else if (uniNorm.includes("x-men") || uniNorm.includes("xmen")) result.universe = "xmen";
    else if (uniNorm.includes("independiente")) result.universe = "independientes";
  }

  // Parámetro explícito `service=...`
  if (rawService && normalizeToken(rawService) !== "todos") {
    const svcNorm = normalizeToken(rawService);
    if (svcNorm.includes("netflix")) result.platform = "netflix";
    else if (svcNorm.includes("hbo")) result.platform = "hbo";
    else if (svcNorm.includes("prime")) result.platform = "prime";
    else if (svcNorm.includes("movistar")) result.platform = "movistar";
    else if (svcNorm.includes("bbc")) result.platform = "bbc";
    else if (svcNorm.includes("europa") || svcNorm.includes("europea")) result.platform = "europa";
  }

  // Parámetro explícito `rating=...` tiene prioridad sobre el inferido desde genre
  if (rawRating && normalizeToken(rawRating) !== "todos") {
    const explicitRating = parseRatingString(normalizeToken(rawRating));
    if (explicitRating.rating) {
      result.rating = explicitRating.rating;
      result.ratingLabel = explicitRating.ratingLabel;
    }
  }

  return result;
}

export function getCertificationChain(
  rating: ArgentineRatingKey,
  type: "movie" | "series",
  regionHint?: RegionHint,
): CertificationStep[] {
  if (type === "movie") {
    switch (rating) {
      case "ATP":
        return [
          { certification_country: "US", certification: "G|PG", excludeHorror: true },
          { certification_country: "AR", certification: "ATP", excludeHorror: true },
          { certification_country: "GB", certification: "U|PG", excludeHorror: true },
          { certification_country: "ES", certification: "A|Ai|7|7i", excludeHorror: true },
        ];
      case "+13":
        return [
          { certification_country: "US", certification: "PG-13" },
          { certification_country: "AR", certification: "+13" },
          { certification_country: "GB", certification: "12A|12" },
          { certification_country: "ES", certification: "12" },
        ];
      case "+16":
        if (regionHint === "ES") {
          return [
            { certification_country: "ES", certification: "16" },
            { certification_country: "GB", certification: "15" },
            { certification_country: "AR", certification: "+16" },
            { certification_country: "US", certification: "R" },
          ];
        }
        return [
          { certification_country: "GB", certification: "15" },
          { certification_country: "AR", certification: "+16" },
          { certification_country: "ES", certification: "16" },
          { certification_country: "US", certification: "R" },
        ];
      case "+18":
        return [
          { certification_country: "US", certification: "R|NC-17" },
          { certification_country: "GB", certification: "18" },
          { certification_country: "ES", certification: "18" },
          { certification_country: "AR", certification: "+18" },
        ];
      case "ATP_13":
        return [
          { certification_country: "US", certification: "G|PG|PG-13", excludeHorror: true },
          { certification_country: "AR", certification: "ATP|+13", excludeHorror: true },
          { certification_country: "GB", certification: "U|PG|12A|12", excludeHorror: true },
          { certification_country: "ES", certification: "A|Ai|7|7i|12", excludeHorror: true },
        ];
      case "16_18":
        if (regionHint === "ES") {
          return [
            { certification_country: "ES", certification: "16|18" },
            { certification_country: "GB", certification: "15|18" },
            { certification_country: "US", certification: "R|NC-17" },
            { certification_country: "AR", certification: "+16|+18" },
          ];
        }
        if (regionHint === "GB" || regionHint === "EU") {
          return [
            { certification_country: "GB", certification: "15|18" },
            { certification_country: "ES", certification: "16|18" },
            { certification_country: "US", certification: "R|NC-17" },
            { certification_country: "AR", certification: "+16|+18" },
          ];
        }
        return [
          { certification_country: "US", certification: "R|NC-17" },
          { certification_country: "GB", certification: "15|18" },
          { certification_country: "AR", certification: "+16|+18" },
          { certification_country: "ES", certification: "16|18" },
        ];
    }
  }

  // Series (TV)
  switch (rating) {
    case "ATP":
      return [
        { certification_country: "US", certification: "TV-Y|TV-Y7|TV-G|TV-PG" },
        { certification_country: "AR", certification: "ATP" },
        { certification_country: "ES", certification: "TP|7|10" },
        { certification_country: "GB", certification: "U|PG" },
      ];
    case "+13":
      return [
        { certification_country: "US", certification: "TV-14" },
        { certification_country: "AR", certification: "SAM 13" },
        { certification_country: "ES", certification: "12|13" },
        { certification_country: "GB", certification: "12A|12" },
      ];
    case "+16":
      if (regionHint === "ES") {
        return [
          { certification_country: "ES", certification: "16" },
          { certification_country: "GB", certification: "15" },
          { certification_country: "AR", certification: "SAM 16" },
          { certification_country: "US", certification: "TV-MA" },
        ];
      }
      return [
        { certification_country: "GB", certification: "15" },
        { certification_country: "ES", certification: "16" },
        { certification_country: "AR", certification: "SAM 16" },
        { certification_country: "US", certification: "TV-MA" },
      ];
    case "+18":
      return [
        { certification_country: "US", certification: "TV-MA" },
        { certification_country: "ES", certification: "18" },
        { certification_country: "GB", certification: "18" },
        { certification_country: "AR", certification: "SAM 18" },
      ];
    case "ATP_13":
      return [
        { certification_country: "US", certification: "TV-Y|TV-Y7|TV-G|TV-PG|TV-14" },
        { certification_country: "AR", certification: "ATP|SAM 13" },
        { certification_country: "ES", certification: "TP|7|10|12|13" },
        { certification_country: "GB", certification: "U|PG|12A|12" },
      ];
    case "16_18":
      if (regionHint === "ES") {
        return [
          { certification_country: "ES", certification: "16|18" },
          { certification_country: "GB", certification: "15|18" },
          { certification_country: "US", certification: "TV-MA" },
          { certification_country: "AR", certification: "SAM 16|SAM 18" },
        ];
      }
      if (regionHint === "GB" || regionHint === "EU") {
        return [
          { certification_country: "GB", certification: "15|18" },
          { certification_country: "ES", certification: "16|18" },
          { certification_country: "US", certification: "TV-MA" },
          { certification_country: "AR", certification: "SAM 16|SAM 18" },
        ];
      }
      return [
        { certification_country: "US", certification: "TV-MA" },
        { certification_country: "GB", certification: "15|18" },
        { certification_country: "ES", certification: "16|18" },
        { certification_country: "AR", certification: "SAM 16|SAM 18" },
      ];
  }
}

export function formatCatalogBadge(badgeLabel: string, rating?: ArgentineRatingKey): string {
  if (!rating) return `[${badgeLabel}]`;
  const ratingText = rating === "ATP_13"
    ? "ATP y +13"
    : rating === "16_18"
    ? "+16 y +18"
    : rating;
  return `[${badgeLabel} · 🇦🇷 ${ratingText}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Colecciones Curadas (Harry Potter / X-Men) con Tabla de Calificación AR Exacta
// ─────────────────────────────────────────────────────────────────────────────

const HP_MOVIE_RATING_MAP: Record<number, ArgentineRatingKey[]> = {
  671: ["ATP"],     // La piedra filosofal
  672: ["ATP"],     // La cámara secreta
  673: ["ATP"],     // El prisionero de Azkaban
  899082: ["ATP"],  // 20 Aniversario: Regreso a Hogwarts
  674: ["+13"],     // El cáliz de fuego
  675: ["+13"],     // La Orden del Fénix
  767: ["+13"],     // El misterio del príncipe
  12444: ["+13"],   // Reliquias de la Muerte Parte 1
  12445: ["+13"],   // Reliquias de la Muerte Parte 2
  259316: ["+13"],  // Animales Fantásticos y dónde encontrarlos
  338952: ["+13"],  // Animales Fantásticos: Los crímenes de Grindelwald
  338953: ["+13"],  // Animales Fantásticos: Los secretos de Dumbledore
};

const HP_SERIES_RATING_MAP: Record<number, ArgentineRatingKey[]> = {
  224377: ["+13"],  // Harry Potter (HBO)
  254514: ["ATP"],  // Harry Potter: Wizards of Baking
  133723: ["ATP"],  // Hogwarts Tournament of Houses
  260229: ["+13"],  // Icons Unearthed: Harry Potter
};

const XMEN_MOVIE_HIGH_RATING_IDS = new Set([
  263115, // Logan
  293660, // Deadpool
  383498, // Deadpool 2
  533535, // Deadpool & Wolverine
]);

const XMEN_SERIES_RATING_MAP: Record<number, ArgentineRatingKey[]> = {
  138502: ["+13"],         // X-Men '97
  4574: ["ATP"],           // X-Men (1992)
  668: ["ATP"],            // X-Men: Evolution
  6549: ["ATP"],           // Wolverine and the X-Men
  67195: ["+16", "+18"],   // Legion
  69629: ["+13"],          // The Gifted
  43146: ["+13"],          // X-Men (Anime)
};

function matchesCuratedRating(arRatings: ArgentineRatingKey[], filter?: ArgentineRatingKey): boolean {
  if (!filter) return true;
  if (filter === "ATP_13") return arRatings.includes("ATP") || arRatings.includes("+13");
  if (filter === "16_18") return arRatings.includes("+16") || arRatings.includes("+18");
  return arRatings.includes(filter);
}

// deno-lint-ignore no-explicit-any
export type TmdbGetFn = (path: string, params: Record<string, string>) => Promise<any>;
export type ResolveBatchImdbFn = (tmdbIds: number[], type: "movie" | "tv") => Promise<Map<number, string | null>>;

export interface CuratedMetaItem {
  id: string;
  type: "movie" | "series";
  name: string;
  poster: string | null;
  description: string;
  releaseInfo?: string;
  released?: string;
  firstAired?: string;
}

export async function fetchCuratedCollectionUniverse(
  universe: "harry-potter" | "xmen",
  type: "movie" | "series",
  parsed: ParsedCompositeFilter,
  tmdbGetFn: TmdbGetFn,
  resolveBatchImdbFn: ResolveBatchImdbFn,
): Promise<CuratedMetaItem[]> {
  // deno-lint-ignore no-explicit-any
  const rawItems: any[] = [];

  if (universe === "harry-potter") {
    if (type === "movie") {
      const [colHp, colFb, doc20] = await Promise.all([
        tmdbGetFn("/collection/1241", { language: "es-MX" }).catch(() => null),
        tmdbGetFn("/collection/435259", { language: "es-MX" }).catch(() => null),
        tmdbGetFn("/movie/899082", { language: "es-MX" }).catch(() => null),
      ]);
      if (Array.isArray(colHp?.parts)) rawItems.push(...colHp.parts);
      if (Array.isArray(colFb?.parts)) rawItems.push(...colFb.parts);
      if (doc20?.id) rawItems.push(doc20);
    } else {
      const tvIds = [224377, 254514, 133723, 260229];
      const shows = await Promise.all(
        tvIds.map((id) => tmdbGetFn(`/tv/${id}`, { language: "es-MX" }).catch(() => null)),
      );
      for (const s of shows) {
        if (s?.id) rawItems.push(s);
      }
    }
  } else {
    // xmen
    if (type === "movie") {
      const [colXm, colWol, colDp, newMut] = await Promise.all([
        tmdbGetFn("/collection/748", { language: "es-MX" }).catch(() => null),
        tmdbGetFn("/collection/453993", { language: "es-MX" }).catch(() => null),
        tmdbGetFn("/collection/448150", { language: "es-MX" }).catch(() => null),
        tmdbGetFn("/movie/340102", { language: "es-MX" }).catch(() => null),
      ]);
      if (Array.isArray(colXm?.parts)) rawItems.push(...colXm.parts);
      if (Array.isArray(colWol?.parts)) rawItems.push(...colWol.parts);
      if (Array.isArray(colDp?.parts)) rawItems.push(...colDp.parts);
      if (newMut?.id) rawItems.push(newMut);
    } else {
      const tvIds = [138502, 4574, 668, 6549, 67195, 69629, 43146];
      const shows = await Promise.all(
        tvIds.map((id) => tmdbGetFn(`/tv/${id}`, { language: "es-MX" }).catch(() => null)),
      );
      for (const s of shows) {
        if (s?.id) rawItems.push(s);
      }
    }
  }

  // Deduplicar por TMDB ID
  const seenIds = new Set<number>();
  // deno-lint-ignore no-explicit-any
  const deduped: any[] = [];
  for (const item of rawItems) {
    if (!item?.id || seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    deduped.push(item);
  }

  // Filtrar por calificación AR y por género si se solicitó
  const filtered = deduped.filter((item) => {
    let arRatings: ArgentineRatingKey[];
    if (universe === "harry-potter") {
      arRatings = type === "movie"
        ? (HP_MOVIE_RATING_MAP[item.id] ?? ["+13"])
        : (HP_SERIES_RATING_MAP[item.id] ?? ["+13"]);
    } else {
      arRatings = type === "movie"
        ? (XMEN_MOVIE_HIGH_RATING_IDS.has(item.id) ? ["+16", "+18"] : ["+13"])
        : (XMEN_SERIES_RATING_MAP[item.id] ?? ["+13"]);
    }

    if (!matchesCuratedRating(arRatings, parsed.rating)) {
      return false;
    }

    if (parsed.genreId) {
      const itemGenres: number[] = Array.isArray(item.genre_ids)
        ? item.genre_ids
        : Array.isArray(item.genres)
        // deno-lint-ignore no-explicit-any
        ? item.genres.map((g: any) => Number(g.id))
        : [];
      if (!itemGenres.includes(parsed.genreId)) {
        return false;
      }
    }

    return true;
  });

  if (filtered.length === 0) return [];

  const tmdbType = type === "series" ? "tv" : "movie";
  const tmdbIds = filtered.map((item) => Number(item.id));
  const imdbIdMap = await resolveBatchImdbFn(tmdbIds, tmdbType);

  const badgeLabel = UNIVERSE_CONFIGS[universe].badgeLabel;

  // Ordenar: recientes si sortRecent, o por popularidad descendente / fecha
  const sorted = [...filtered].sort((a, b) => {
    const dA = String(a.release_date ?? a.first_air_date ?? "");
    const dB = String(b.release_date ?? b.first_air_date ?? "");
    if (parsed.sortRecent) return dB.localeCompare(dA);
    const popDiff = Number(b.popularity ?? 0) - Number(a.popularity ?? 0);
    if (Math.abs(popDiff) > 0.1) return popDiff;
    return dA.localeCompare(dB);
  });

  const metas: CuratedMetaItem[] = [];
  for (const item of sorted) {
    const imdbId = imdbIdMap.get(item.id);
    if (!imdbId || !item.poster_path) continue;
    let arRatingBadge: ArgentineRatingKey;
    if (universe === "harry-potter") {
      arRatingBadge = type === "movie"
        ? (HP_MOVIE_RATING_MAP[item.id]?.[0] ?? "+13")
        : (HP_SERIES_RATING_MAP[item.id]?.[0] ?? "+13");
    } else {
      arRatingBadge = type === "movie"
        ? (XMEN_MOVIE_HIGH_RATING_IDS.has(item.id) ? "+16" : "+13")
        : (XMEN_SERIES_RATING_MAP[item.id]?.[0] ?? "+13");
    }

    const d0 = String(item.release_date ?? item.first_air_date ?? "");
    const isoDate = d0 && /^\d{4}-\d{2}-\d{2}/.test(d0) ? `${d0.slice(0, 10)}T00:00:00.000Z` : undefined;
    const prefix = formatCatalogBadge(badgeLabel, parsed.rating ?? arRatingBadge);
    metas.push({
      id: imdbId,
      type,
      name: String(item.title ?? item.name ?? ""),
      poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
      description: `${prefix} ${item.overview ?? ""}`.trim(),
      releaseInfo: d0 ? d0.slice(0, 4) : undefined,
      released: isoDate,
      firstAired: type === "series" ? isoDate : undefined,
    });
  }

  return metas;
}

export function buildUniverseOrPlatformDiscoverParams(
  target: DiscoverTargetConfig,
  type: "movie" | "series",
  parsed: ParsedCompositeFilter,
  sortParam: string,
): {
  params: Record<string, string>;
  regionHint: RegionHint;
  fallbackParams?: Record<string, string>;
  badgeLabel: string;
} {
  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
  const baseSource = type === "movie" ? target.movieParams : target.seriesParams;
  const params: Record<string, string> = {
    language: "es-MX",
    ...baseSource,
  };

  if (sortParam === "popularity.desc" || sortParam === "Popularidad") {
    params.sort_by = "popularity.desc";
  } else {
    params.sort_by = `${dateField}.desc`;
    params[`${dateField}.lte`] = new Date().toISOString().slice(0, 10);
  }

  if (parsed.genreId) {
    params.with_genres = String(parsed.genreId);
  }

  let fallbackParams: Record<string, string> | undefined;
  if (type === "series" && target.seriesFallbackParams) {
    fallbackParams = {
      language: "es-MX",
      ...target.seriesFallbackParams,
      sort_by: params.sort_by,
    };
    if (params[`${dateField}.lte`]) fallbackParams[`${dateField}.lte`] = params[`${dateField}.lte`];
    if (parsed.genreId) fallbackParams.with_genres = String(parsed.genreId);
  }

  return {
    params,
    regionHint: target.regionHint,
    fallbackParams,
    badgeLabel: target.badgeLabel,
  };
}
