/**
 * tmdb.ts — Catálogos basados en TMDB: Miniseries, Comedias Cortas y Descubrir Maestro.
 * Incorpora caché LRU bounded para la resolución de IDs IMDb (máximo 500 entradas).
 */

import { cors, jsonResponse } from "../utils/common.ts";
import { BoundedLruCache } from "../utils/lru-cache.ts";

export const TMDB_KEY = Deno.env.get("TMDB_API_KEY_AISEARCH") ?? "";
export const TMDB_API = "https://api.themoviedb.org/3";

export const MINISERIES_MANIFEST = {
  id: "com.mejorastremio.miniseries",
  version: "1.0.0",
  name: "Miniseries",
  description:
    "Series de 1 sola temporada, 10 episodios o menos, finalizadas — armado " +
    "vía TMDB Discover (with_type=Miniseries) + filtro de detalle por " +
    "temporadas/episodios, que Discover no soporta de forma directa.",
  resources: ["catalog"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [{
    type: "series",
    id: "miniseries",
    name: "Miniseries",
    extra: [
      {
        name: "genre",
        options: [
          "Todos",
          "Action & Adventure",
          "Animación",
          "Comedia",
          "Crimen",
          "Documental",
          "Drama",
          "Familia",
          "Kids",
          "Misterio",
          "News",
          "Reality",
          "Sci-Fi & Fantasy",
          "Soap",
          "Talk",
          "War & Politics",
          "Western",
        ],
        isRequired: false,
      },
      { name: "skip" },
    ],
  }],
};

export interface MiniseriesMeta {
  id: string;
  type: "series";
  name: string;
  poster: string | null;
  description: string;
  genres: string[];
  releaseInfo?: string;
  _d?: string;
}

let miniseriesCache: { at: number; metas: MiniseriesMeta[]; partial: boolean } | null = null;
export const MINISERIES_FULL_TTL_MS = 12 * 60 * 60 * 1000;
export const MINISERIES_PARTIAL_TTL_MS = 60 * 60 * 1000;
export const MINISERIES_BUDGET_MS = 20000;
export const MINISERIES_DISCOVER_PAGES = 2;

// deno-lint-ignore no-explicit-any
export async function tmdbGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params });
  const r = await fetch(`${TMDB_API}${path}?${qs}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`TMDB ${path} respondió ${r.status}`);
  return await r.json();
}

export async function buildMiniseriesCatalog(): Promise<{ metas: MiniseriesMeta[]; partial: boolean }> {
  const deadline = Date.now() + MINISERIES_BUDGET_MS;
  const candidates: number[] = [];

  for (let page = 1; page <= MINISERIES_DISCOVER_PAGES; page++) {
    if (Date.now() > deadline) return { metas: [], partial: true };
    try {
      const d = await tmdbGet("/discover/tv", {
        sort_by: "first_air_date.desc",
        with_status: "3",
        with_type: "2",
        "vote_count.gte": "10",
        "first_air_date.lte": new Date().toISOString().slice(0, 10),
        language: "es-ES",
        page: String(page),
      });
      // deno-lint-ignore no-explicit-any
      for (const s of (d?.results ?? []) as any[]) candidates.push(s.id);
    } catch {
      break;
    }
  }

  const metas: MiniseriesMeta[] = [];
  let partial = false;

  for (const tmdbId of candidates) {
    if (Date.now() > deadline) { partial = true; break; }
    try {
      const detail = await tmdbGet(`/tv/${tmdbId}`, {
        language: "es-ES",
        append_to_response: "external_ids",
      });
      const imdbId = detail?.external_ids?.imdb_id;
      if (
        imdbId &&
        detail.number_of_seasons === 1 &&
        detail.number_of_episodes > 0 &&
        detail.number_of_episodes <= 10
      ) {
        metas.push({
          id: imdbId,
          type: "series",
          name: detail.name,
          poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null,
          description: detail.overview ?? "",
          // deno-lint-ignore no-explicit-any
          genres: ((detail.genres ?? []) as any[]).map((g) => g.name),
          releaseInfo: (detail.first_air_date ?? "").slice(0, 4) || undefined,
          _d: detail.first_air_date ?? "",
        });
      }
    } catch {
      // continuar
    }
  }

  metas.sort((a, b) => (b._d ?? "").localeCompare(a._d ?? ""));
  for (const m of metas) delete m._d;
  return { metas, partial };
}

export async function getMiniseriesCatalog(): Promise<MiniseriesMeta[]> {
  const ttl = miniseriesCache?.partial ? MINISERIES_PARTIAL_TTL_MS : MINISERIES_FULL_TTL_MS;
  if (miniseriesCache && Date.now() - miniseriesCache.at < ttl) return miniseriesCache.metas;

  const stale = miniseriesCache?.metas ?? [];
  try {
    const { metas, partial } = await buildMiniseriesCatalog();
    if (metas.length === 0 && stale.length > 0) return stale;
    miniseriesCache = { at: Date.now(), metas, partial };
    return metas;
  } catch {
    return stale;
  }
}

export async function handleMiniseries(subPath: string): Promise<Response> {
  if (!TMDB_KEY) {
    return new Response(
      "TMDB_API_KEY_AISEARCH no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(MINISERIES_MANIFEST);
  }

  const catalogMatch = subPath.match(/^\/catalog\/series\/miniseries(?:\/([^/]+))?\.json$/);
  if (catalogMatch) {
    try {
      let metas = await getMiniseriesCatalog();
      const extraStr = catalogMatch[1];
      if (extraStr) {
        const extra = new URLSearchParams(extraStr);
        const genre = extra.get("genre");
        if (genre && genre !== "Todos") metas = metas.filter((m) => m.genres.includes(genre));
        const skip = parseInt(extra.get("skip") ?? "0", 10);
        if (skip > 0) metas = metas.slice(skip);
      }
      return jsonResponse({ metas });
    } catch (e) {
      return jsonResponse({ metas: [], error: (e as Error).message }, { status: 500 });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}

export const SHORT_SERIES_MANIFEST = {
  id: "com.mejorastremio.short-series",
  version: "1.1.0",
  name: "Comedias Cortas (30 min o menos)",
  description:
    "Sitcoms y comedias live-action cuyos episodios duran 30 minutos o menos. " +
    "TMDB Discover (comedia, sin animación) + confirmación por episode_run_time.",
  resources: ["catalog"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [{
    type: "series",
    id: "short-series",
    name: "Comedias Cortas (≤30 min)",
    extra: [{ name: "skip" }],
  }],
};

export interface ShortSeriesMeta {
  id: string;
  type: "series";
  name: string;
  poster: string | null;
  description: string;
  genres: string[];
  runtime: number;
  releaseInfo?: string;
  _d?: string;
}

let shortSeriesCache: { at: number; metas: ShortSeriesMeta[]; partial: boolean } | null = null;
export const SHORT_SERIES_FULL_TTL_MS = 12 * 60 * 60 * 1000;
export const SHORT_SERIES_PARTIAL_TTL_MS = 60 * 60 * 1000;
export const SHORT_SERIES_BUDGET_MS = 24000;
export const SHORT_SERIES_DISCOVER_PAGES = 5;

export async function buildShortSeriesCatalog(): Promise<{ metas: ShortSeriesMeta[]; partial: boolean }> {
  const deadline = Date.now() + SHORT_SERIES_BUDGET_MS;
  const candidates: number[] = [];

  for (let page = 1; page <= SHORT_SERIES_DISCOVER_PAGES; page++) {
    if (Date.now() > deadline) return { metas: [], partial: true };
    try {
      const d = await tmdbGet("/discover/tv", {
        sort_by: "first_air_date.desc",
        "with_runtime.lte": "30",
        "vote_count.gte": "40",
        "first_air_date.lte": new Date().toISOString().slice(0, 10),
        with_genres: "35",
        without_genres: "16,10762,10763,10766,10767",
        language: "es-ES",
        page: String(page),
      });
      // deno-lint-ignore no-explicit-any
      for (const s of (d?.results ?? []) as any[]) candidates.push(s.id);
    } catch {
      break;
    }
  }

  const metas: ShortSeriesMeta[] = [];
  const seen = new Set<string>();
  let partial = false;

  for (let i = 0; i < candidates.length; i += 8) {
    if (Date.now() > deadline) { partial = true; break; }
    const batch = candidates.slice(i, i + 8);
    const details = await Promise.all(batch.map((id) =>
      tmdbGet(`/tv/${id}`, { language: "es-ES", append_to_response: "external_ids" }).catch(() => null)
    ));
    for (const detail of details) {
      const imdbId = detail?.external_ids?.imdb_id;
      // deno-lint-ignore no-explicit-any
      const runtimes = (detail?.episode_run_time ?? []) as any[];
      const maxRuntime = runtimes.length ? Math.max(...runtimes) : null;
      if (imdbId && !seen.has(imdbId) && maxRuntime !== null && maxRuntime > 0 && maxRuntime <= 30) {
        seen.add(imdbId);
        metas.push({
          id: imdbId,
          type: "series",
          name: detail.name,
          poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null,
          description: detail.overview ?? "",
          // deno-lint-ignore no-explicit-any
          genres: ((detail.genres ?? []) as any[]).map((g) => g.name),
          runtime: maxRuntime,
          releaseInfo: (detail.first_air_date ?? "").slice(0, 4) || undefined,
          _d: detail.first_air_date ?? "",
        });
      }
    }
  }

  metas.sort((a, b) => (b._d ?? "").localeCompare(a._d ?? ""));
  for (const m of metas) delete m._d;
  return { metas, partial };
}

export async function getShortSeriesCatalog(): Promise<ShortSeriesMeta[]> {
  const ttl = shortSeriesCache?.partial ? SHORT_SERIES_PARTIAL_TTL_MS : SHORT_SERIES_FULL_TTL_MS;
  if (shortSeriesCache && Date.now() - shortSeriesCache.at < ttl) return shortSeriesCache.metas;

  const stale = shortSeriesCache?.metas ?? [];
  try {
    const { metas, partial } = await buildShortSeriesCatalog();
    if (metas.length === 0 && stale.length > 0) return stale;
    shortSeriesCache = { at: Date.now(), metas, partial };
    return metas;
  } catch {
    return stale;
  }
}

export async function handleShortSeries(subPath: string): Promise<Response> {
  if (!TMDB_KEY) {
    return new Response(
      "TMDB_API_KEY_AISEARCH no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(SHORT_SERIES_MANIFEST);
  }

  const catalogMatch = subPath.match(/^\/catalog\/series\/short-series(?:\/([^/]+))?\.json$/);
  if (catalogMatch) {
    try {
      let metas = await getShortSeriesCatalog();
      const extraStr = catalogMatch[1];
      if (extraStr) {
        const extra = new URLSearchParams(extraStr);
        const skip = parseInt(extra.get("skip") ?? "0", 10);
        if (skip > 0) metas = metas.slice(skip);
      }
      return jsonResponse({ metas });
    } catch (e) {
      return jsonResponse({ metas: [], error: (e as Error).message }, { status: 500 });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}

export const SERVICE_IDS: Record<string, number> = {
  "Netflix": 8,
  "Disney+": 337,
  "Prime Video": 9,
  "HBO Max": 1899,
  "Paramount+": 2303,
  "Hulu": 15,
  "Peacock": 386,
  "Apple TV+": 350,
  "Starz": 43,
  "Mubi": 11,
  "Criterion Channel": 258,
  "Shudder": 99,
  "Acorn TV": 87,
  "BritBox": 151,
  "Crunchyroll": 283,
};
export const DISCOVER_WATCH_REGION = "AR";

export const COUNTRY_IDS: Record<string, string> = {
  "Argentina": "AR", "España": "ES", "Francia": "FR", "Alemania": "DE",
  "Italia": "IT", "Reino Unido": "GB", "Portugal": "PT", "México": "MX",
  "Colombia": "CO", "Chile": "CL", "Brasil": "BR", "Perú": "PE",
  "Estados Unidos": "US", "Canadá": "CA", "Australia": "AU", "Nueva Zelanda": "NZ",
  "Japón": "JP", "Corea": "KR", "China": "CN", "Taiwán": "TW",
  "Tailandia": "TH", "Hong Kong": "HK", "India": "IN",
};

export const REGION_IDS: Record<string, string> = {
  "Latinoamérica": "AR|MX|CO|CL|BR|PE",
  "Europa": "ES|FR|DE|IT|GB|PT",
  "Norteamérica": "US|CA",
  "Asia": "JP|KR|CN|TW|TH|HK|IN",
  "Oceanía": "AU|NZ",
};

export const LANGUAGE_IDS: Record<string, string> = {
  "Español": "es", "Inglés": "en", "Francés": "fr", "Alemán": "de",
  "Italiano": "it", "Portugués": "pt", "Japonés": "ja", "Coreano": "ko",
  "Chino": "zh", "Hindi": "hi", "Tailandés": "th",
};

export const GENRE_IDS_MOVIE: Record<string, number> = {
  "Acción": 28, "Aventura": 12, "Animación": 16, "Comedia": 35, "Crimen": 80,
  "Documental": 99, "Drama": 18, "Familia": 10751, "Fantasía": 14,
  "Historia": 36, "Terror": 27, "Música": 10402, "Misterio": 9648,
  "Romance": 10749, "Ciencia Ficción": 878, "Thriller": 53, "Bélica": 10752,
  "Western": 37,
};
export const GENRE_IDS_SERIES: Record<string, number> = {
  "Acción y Aventura": 10759, "Animación": 16, "Comedia": 35, "Crimen": 80,
  "Documental": 99, "Drama": 18, "Familia": 10751, "Infantil": 10762,
  "Misterio": 9648, "Noticias": 10763, "Reality": 10764,
  "Ciencia Ficción y Fantasía": 10765, "Telenovela": 10766, "Talk Show": 10767,
  "Bélica y Política": 10768, "Western": 37,
};

export function discoverExtra(genreMap: Record<string, number>) {
  return [
    { name: "service", options: ["Todos", ...Object.keys(SERVICE_IDS)], isRequired: false },
    { name: "region", options: ["Todos", ...Object.keys(REGION_IDS)], isRequired: false },
    { name: "country", options: ["Todos", ...Object.keys(COUNTRY_IDS)], isRequired: false },
    { name: "language", options: ["Todos", ...Object.keys(LANGUAGE_IDS)], isRequired: false },
    { name: "genre", options: ["Todos", ...Object.keys(genreMap)], isRequired: false },
    { name: "skip" },
  ];
}

export const DISCOVER_MANIFEST = {
  id: "com.mejorastremio.discover-master",
  version: "1.0.0",
  name: "Descubrir Maestro",
  description:
    "Catálogo único con servicio de streaming, región, país, idioma y género " +
    "combinables como filtros simultáneos (TMDB Discover) — a diferencia de " +
    "AIOMetadata, donde cada eje es un catálogo fijo separado.",
  resources: ["catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    { type: "movie", id: "discover-master", name: "Descubrir Maestro", extra: discoverExtra(GENRE_IDS_MOVIE) },
    { type: "series", id: "discover-master", name: "Descubrir Maestro", extra: discoverExtra(GENRE_IDS_SERIES) },
  ],
};

// Bounded LRU Cache: máximo 500 resoluciones en RAM (~100KB), TTL 7 días
const imdbIdCache = new BoundedLruCache<number, string | null>(500, 7 * 24 * 60 * 60 * 1000);

export async function resolveImdbId(tmdbId: number): Promise<string | null> {
  const cached = imdbIdCache.get(tmdbId);
  if (cached !== undefined) return cached;
  try {
    const d = await tmdbGet(`/movie/${tmdbId}/external_ids`, {});
    const id = d?.imdb_id ?? null;
    imdbIdCache.set(tmdbId, id);
    return id;
  } catch {
    return null;
  }
}

export async function resolveImdbIdTv(tmdbId: number): Promise<string | null> {
  const cached = imdbIdCache.get(tmdbId);
  if (cached !== undefined) return cached;
  try {
    const d = await tmdbGet(`/tv/${tmdbId}/external_ids`, {});
    const id = d?.imdb_id ?? null;
    imdbIdCache.set(tmdbId, id);
    return id;
  } catch {
    return null;
  }
}

export async function handleDiscover(subPath: string, url: URL): Promise<Response> {
  if (!TMDB_KEY) {
    return new Response(
      "TMDB_API_KEY_AISEARCH no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(DISCOVER_MANIFEST);
  }

  if (subPath.startsWith("/recent")) {
    const qs = url.searchParams;
    const type = qs.get("type") === "series" ? "series" : "movie";
    const country = qs.get("country");
    const genre = qs.get("genre");
    const days = Math.min(60, Math.max(1, parseInt(qs.get("days") ?? "35", 10)));
    const genreMap = type === "movie" ? GENRE_IDS_MOVIE : GENRE_IDS_SERIES;
    const queryDateField = type === "movie" ? "primary_release_date" : "first_air_date";
    const responseDateField = type === "movie" ? "release_date" : "first_air_date";
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const params: Record<string, string> = {
      sort_by: `${queryDateField}.desc`,
      language: "es-ES",
      "vote_count.gte": "5",
      [`${queryDateField}.gte`]: since,
      [`${queryDateField}.lte`]: new Date().toISOString().slice(0, 10),
    };
    if (country && COUNTRY_IDS[country]) params.with_origin_country = COUNTRY_IDS[country];
    if (genre && genreMap[genre]) params.with_genres = String(genreMap[genre]);
    try {
      const path = type === "movie" ? "/discover/movie" : "/discover/tv";
      const d = await tmdbGet(path, params);
      // deno-lint-ignore no-explicit-any
      const results = ((d?.results ?? []) as any[]).slice(0, 10);
      const items = results.map((r) => ({
        name: r.title ?? r.name,
        date: r[responseDateField] ?? null,
        overview: (r.overview ?? "").slice(0, 160),
      }));
      return jsonResponse({ type, country: country ?? null, genre: genre ?? null, items });
    } catch (e) {
      return jsonResponse({ items: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const catalogMatch = subPath.match(/^\/catalog\/(movie|series)\/discover-master(?:\/([^/]+))?\.json$/);
  if (!catalogMatch) {
    return new Response("Not found", { status: 404, headers: cors });
  }
  const [, type, extraStr] = catalogMatch;
  const genreMap = type === "movie" ? GENRE_IDS_MOVIE : GENRE_IDS_SERIES;

  const extra = new URLSearchParams(extraStr ?? "");
  const service = extra.get("service");
  const region = extra.get("region");
  const country = extra.get("country");
  const language = extra.get("language");
  const genre = extra.get("genre");
  const skip = parseInt(extra.get("skip") ?? "0", 10);
  const page = Math.floor(skip / 20) + 1;

  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
  const params: Record<string, string> = {
    sort_by: `${dateField}.desc`,
    language: "es-ES",
    page: String(page),
    "vote_count.gte": "20",
  };
  if (type === "series") params.without_genres = "10763,10767";
  if (service && service !== "Todos" && SERVICE_IDS[service]) {
    params.with_watch_providers = String(SERVICE_IDS[service]);
    params.watch_region = DISCOVER_WATCH_REGION;
  }
  if (country && country !== "Todos" && COUNTRY_IDS[country]) {
    params.with_origin_country = COUNTRY_IDS[country];
  } else if (region && region !== "Todos" && REGION_IDS[region]) {
    params.with_origin_country = REGION_IDS[region];
  }
  if (language && language !== "Todos" && LANGUAGE_IDS[language]) {
    params.with_original_language = LANGUAGE_IDS[language];
  }
  if (genre && genre !== "Todos" && genreMap[genre]) {
    params.with_genres = String(genreMap[genre]);
  }

  try {
    const path = type === "movie" ? "/discover/movie" : "/discover/tv";
    const d = await tmdbGet(path, params);
    // deno-lint-ignore no-explicit-any
    const results = (d?.results ?? []) as any[];

    const resolved = await Promise.all(results.map(async (r) => {
      const imdbId = type === "movie"
        ? await resolveImdbId(r.id)
        : await resolveImdbIdTv(r.id);
      if (!imdbId) return null;
      const d0 = (r.release_date ?? r.first_air_date ?? "") as string;
      return {
        id: imdbId,
        type,
        name: r.title ?? r.name,
        poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
        description: r.overview ?? "",
        releaseInfo: d0 ? d0.slice(0, 4) : undefined,
        _d: d0,
      };
    }));

    const metas = resolved
      .filter((m) => m !== null)
      .sort((a, b) => (b!._d).localeCompare(a!._d))
      // deno-lint-ignore no-explicit-any
      .map(({ _d, ...m }: any) => m);
    return jsonResponse({ metas });
  } catch (e) {
    return jsonResponse({ metas: [], error: (e as Error).message }, { status: 500 });
  }
}
