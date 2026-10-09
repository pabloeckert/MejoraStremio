/**
 * tmdb.ts — Catálogos basados en TMDB: Miniseries, Comedias Cortas y Descubrir Maestro.
 * Incorpora arquitectura de dos niveles (L1 RAM LRU + L2 Deno KV persistente) para resolución
 * inmutable de IDs IMDb, batching controlado anti-burst y mitigación total de cascada N+1.
 */

import { cors, getKv, jsonResponse } from "../utils/common.ts";
import { BoundedLruCache } from "../utils/lru-cache.ts";
import { fetchCinemetaCatalogSorted } from "../utils/cinemeta.ts";

export const TMDB_KEY = Deno.env.get("TMDB_API_KEY_AISEARCH") ?? "";
export const TMDB_API = "https://api.themoviedb.org/3";
export const PROD_HUB_UPSTREAM = "https://mejorastremio-hub.pabloeckert.deno.net";

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
export const MINISERIES_BUDGET_MS = 25000;
export const MINISERIES_DISCOVER_PAGES = 4;

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
      if (imdbId) {
        imdbIdLruCache.set(`tv:${tmdbId}`, imdbId);
        safeGetKv().then((kv) => {
          if (kv) kv.set(["tmdb_imdb_v2", "tv", tmdbId], imdbId, { expireIn: IMDB_MAP_KV_TTL_POSITIVE_MS }).catch(() => {});
        }).catch(() => {});
      }
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
      if (detail?.id && imdbId) {
        imdbIdLruCache.set(`tv:${detail.id}`, imdbId);
        safeGetKv().then((kv) => {
          if (kv) kv.set(["tmdb_imdb_v2", "tv", detail.id], imdbId, { expireIn: IMDB_MAP_KV_TTL_POSITIVE_MS }).catch(() => {});
        }).catch(() => {});
      }
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
    { name: "sort", options: ["released", "premiere_date", "year_desc", "popularity.desc"], isRequired: false },
    { name: "skip" },
  ];
}

export const DISCOVER_MANIFEST = {
  id: "com.mejorastremio.discover-master",
  version: "1.2.0",
  name: "Descubrir Maestro & Estrenos",
  description:
    "Catálogos de TMDB Discover y Estrenos al Día 1 ordenados cronológicamente por fecha de lanzamiento. Incluye Nuevos Estrenos Cine, Nuevas Temporadas, Estrenos Streaming y filtros combinados.",
  resources: ["catalog"],
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
    { type: "movie", id: "discover-master", name: "Descubrir Maestro (Cine)", extra: discoverExtra(GENRE_IDS_MOVIE) },
    { type: "series", id: "discover-master", name: "Descubrir Maestro (Series)", extra: discoverExtra(GENRE_IDS_SERIES) },
  ],
};

// Bounded LRU Cache L1: hasta 3000 resoluciones en RAM (~300KB), TTL 30 días
const imdbIdLruCache = new BoundedLruCache<string, string | null>(3000, 30 * 24 * 60 * 60 * 1000);

// Bounded LRU Cache L1 para páginas completas de Discover: hasta 100 páginas, TTL dinámico
interface DiscoverPageCacheEntry {
  // deno-lint-ignore no-explicit-any
  metas: any[];
  cachedAt: number;
  isFresh?: boolean;
}
const discoverPageLruCache = new BoundedLruCache<string, DiscoverPageCacheEntry>(100, 60 * 60 * 1000);

const IMDB_MAP_KV_TTL_POSITIVE_MS = 180 * 24 * 60 * 60 * 1000; // 180 días (IDs de IMDb inmutables)
const IMDB_MAP_KV_TTL_NEGATIVE_MS = 7 * 24 * 60 * 60 * 1000;   // 7 días (reintentar por si se asigna luego)
export const DISCOVER_PAGE_KV_TTL_DEFAULT_MS = 2 * 60 * 60 * 1000; // 2 horas en KV para catálogos estáticos
export const DISCOVER_PAGE_KV_TTL_FRESH_PREMIERES_MS = 60 * 60 * 1000; // 1 hora en KV para estrenos Día 1
export const DISCOVER_PAGE_LRU_TTL_FRESH_MS = 30 * 60 * 1000; // 30 minutos en memoria RAM para estrenos frescos

export function isRecentPremiereQuery(catalogId: string, subPath: string, extraStr?: string): boolean {
  if (subPath.startsWith("/recent")) return true;
  if (/nuevos-estrenos|new-movies|nuevas-temporadas|new-seasons|estrenos-streaming|streaming-premieres|cartelera|now_playing|upcoming/i.test(catalogId)) return true;
  if (extraStr && /sort=(?:released|premiere_date|year_desc)/i.test(extraStr)) return true;
  return false;
}

async function safeGetKv(): Promise<Deno.Kv | null> {
  try {
    if (typeof Deno !== "undefined" && typeof Deno.openKv === "function") {
      return await getKv();
    }
  } catch {
    // Si no está disponible Deno KV en este runtime, opera exclusivamente con L1 LRU
  }
  return null;
}

/**
 * Resuelve un ID de IMDb a partir de un TMDB ID con estrategia L1 (RAM) + L2 (Deno KV).
 * No vuelve a consultar a la red si ya fue resuelto previamente.
 */
export async function resolveImdbIdCached(
  tmdbId: number,
  type: "movie" | "tv"
): Promise<string | null> {
  const cacheKey = `${type}:${tmdbId}`;

  // 1. Revisar L1 (RAM)
  const memCached = imdbIdLruCache.get(cacheKey);
  if (memCached !== undefined) {
    return memCached;
  }

  // 2. Revisar L2 (Deno KV)
  const kv = await safeGetKv();
  if (kv) {
    try {
      const entry = await kv.get<string>(["tmdb_imdb_v2", type, tmdbId]);
      if (entry && entry.value !== null) {
        const val = entry.value === "" ? null : entry.value;
        imdbIdLruCache.set(cacheKey, val);
        return val;
      }
    } catch {
      // Continuar al fetch de red
    }
  }

  // 3. Fallback de Red a TMDB
  try {
    const path = type === "movie" ? `/movie/${tmdbId}/external_ids` : `/tv/${tmdbId}/external_ids`;
    const d = await tmdbGet(path, {});
    const imdbId: string | null = d?.imdb_id ?? null;

    // Guardar en L1
    imdbIdLruCache.set(cacheKey, imdbId);

    // Persistir en L2 (Deno KV de larga duración)
    if (kv) {
      const expireIn = imdbId ? IMDB_MAP_KV_TTL_POSITIVE_MS : IMDB_MAP_KV_TTL_NEGATIVE_MS;
      kv.set(["tmdb_imdb_v2", type, tmdbId], imdbId ?? "", { expireIn }).catch(() => {});
    }

    return imdbId;
  } catch {
    return null;
  }
}

export async function resolveImdbId(tmdbId: number): Promise<string | null> {
  return await resolveImdbIdCached(tmdbId, "movie");
}

export async function resolveImdbIdTv(tmdbId: number): Promise<string | null> {
  return await resolveImdbIdCached(tmdbId, "tv");
}

/**
 * Erradica la cascada N+1 resolviendo una lista de IDs TMDB en batch:
 * 1. Filtra primero por L1 (RAM) -> 0 latencia.
 * 2. Consulta en lote a L2 (Deno KV via getMany) en 1 sola operación -> 0 peticiones HTTP.
 * 3. Para los items que realmente requieran red, procesa en chunks controlados (tamaño 4) anti-burst.
 */
export async function resolveBatchImdb(
  tmdbIds: number[],
  type: "movie" | "tv"
): Promise<Map<number, string | null>> {
  const result = new Map<number, string | null>();
  const missingInMem: number[] = [];

  // Paso 1: L1 en memoria (RAM)
  for (const id of tmdbIds) {
    const memVal = imdbIdLruCache.get(`${type}:${id}`);
    if (memVal !== undefined) {
      result.set(id, memVal);
    } else {
      missingInMem.push(id);
    }
  }

  if (missingInMem.length === 0) {
    return result; // 100% hits en L1 RAM -> 0 peticiones de red
  }

  // Paso 2: L2 Deno KV (Batch getMany en 1 sola operación atómica)
  const missingNet: number[] = [];
  const kv = await safeGetKv();
  if (kv) {
    try {
      const kvKeys = missingInMem.map((id) => ["tmdb_imdb_v2", type, id] as const);
      const entries = await kv.getMany<string[]>(kvKeys);
      for (let i = 0; i < missingInMem.length; i++) {
        const id = missingInMem[i];
        const entry = entries[i];
        if (entry && entry.value !== null) {
          const val = entry.value === "" ? null : entry.value;
          imdbIdLruCache.set(`${type}:${id}`, val);
          result.set(id, val);
        } else {
          missingNet.push(id);
        }
      }
    } catch {
      missingNet.push(...missingInMem);
    }
  } else {
    missingNet.push(...missingInMem);
  }

  if (missingNet.length === 0) {
    return result; // Todos los restantes encontrados en L2 KV -> 0 peticiones HTTP a TMDB
  }

  // Paso 3: Para los items que realmente requieren red, procesar en chunks controlados (anti-burst)
  const CHUNK_SIZE = 4;
  for (let i = 0; i < missingNet.length; i += CHUNK_SIZE) {
    const chunk = missingNet.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(async (id) => {
      try {
        const path = type === "movie" ? `/movie/${id}/external_ids` : `/tv/${id}/external_ids`;
        const d = await tmdbGet(path, {});
        const imdbId: string | null = d?.imdb_id ?? null;

        imdbIdLruCache.set(`${type}:${id}`, imdbId);
        result.set(id, imdbId);

        if (kv) {
          const expireIn = imdbId ? IMDB_MAP_KV_TTL_POSITIVE_MS : IMDB_MAP_KV_TTL_NEGATIVE_MS;
          kv.set(["tmdb_imdb_v2", type, id], imdbId ?? "", { expireIn }).catch(() => {});
        }
      } catch {
        result.set(id, null);
      }
    }));
  }

  return result;
}

export async function handleDiscover(subPath: string, url: URL): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(DISCOVER_MANIFEST);
  }

  if (subPath.startsWith("/recent")) {
    if (!TMDB_KEY) {
      try {
        const upstreamUrl = `${PROD_HUB_UPSTREAM}/discover${subPath}${url.search}`;
        const r = await fetch(upstreamUrl, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const data = await r.json();
          return jsonResponse(data);
        }
      } catch {
        // fallback
      }
    }

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
      "vote_count.gte": "1",
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
      // Ordenación cronológica estricta: de más reciente a más antigua
      items.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
      return jsonResponse({ type, country: country ?? null, genre: genre ?? null, items });
    } catch (e) {
      return jsonResponse({ items: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const catalogMatch = subPath.match(/^\/catalog\/(movie|series)\/([^/]+)(?:\/([^/]+))?\.json$/);
  if (!catalogMatch) {
    return new Response("Not found", { status: 404, headers: cors });
  }
  const [, type, catalogId, extraStr] = catalogMatch;
  const isRecognizedCatalog = /^(discover-master|nuevos-estrenos-cine|new-movies|nuevas-temporadas|new-seasons|estrenos-streaming|streaming-premieres)$/.test(catalogId);
  if (!isRecognizedCatalog) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  const genreMap = type === "movie" ? GENRE_IDS_MOVIE : GENRE_IDS_SERIES;

  const extra = new URLSearchParams(extraStr ?? "");
  const service = extra.get("service");
  const region = extra.get("region");
  const country = extra.get("country");
  const language = extra.get("language");
  const genre = extra.get("genre");
  const sortParam = extra.get("sort") || url.searchParams.get("sort") || "";
  const PAGE_SIZE = 25;
  const skip = parseInt(extra.get("skip") ?? "0", 10);
  const page = Math.floor(skip / PAGE_SIZE) + 1;

  const isFresh = isRecentPremiereQuery(catalogId, subPath, extraStr);
  const dynamicKvTtl = isFresh ? DISCOVER_PAGE_KV_TTL_FRESH_PREMIERES_MS : DISCOVER_PAGE_KV_TTL_DEFAULT_MS;

  // Clave determinista para caché de página completa v4 (invalidación instantánea)
  const pageCacheKey = `${catalogId}:${type}:${service || "all"}:${region || "all"}:${country || "all"}:${language || "all"}:${genre || "all"}:${sortParam || "default"}:${page}`;

  // 1. Revisar caché de página en L1 (RAM) con validación de caducidad para feeds frescos
  const memPage = discoverPageLruCache.get(pageCacheKey);
  if (memPage) {
    const isMemStale = isFresh && (Date.now() - memPage.cachedAt > DISCOVER_PAGE_LRU_TTL_FRESH_MS);
    if (!isMemStale) {
      return jsonResponse({ metas: memPage.metas });
    }
  }

  // 2. Revisar caché de página en L2 (Deno KV catalog_v4_live)
  const kv = await safeGetKv();
  if (kv) {
    try {
      // deno-lint-ignore no-explicit-any
      const kvPage = await kv.get<any[]>(["catalog_v4_live", type, pageCacheKey]);
      if (kvPage?.value && Array.isArray(kvPage.value)) {
        discoverPageLruCache.set(pageCacheKey, { metas: kvPage.value, cachedAt: Date.now(), isFresh });
        return jsonResponse({ metas: kvPage.value });
      }
    } catch {
      // Continuar a resolución
    }
  }

  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const params: Record<string, string> = {
    sort_by: `${dateField}.desc`,
    language: "es-ES",
    "vote_count.gte": "1",
  };

  if (catalogId === "nuevos-estrenos-cine" || catalogId === "new-movies") {
    params[`${dateField}.lte`] = today;
    params[`${dateField}.gte`] = ninetyDaysAgo;
    params.with_release_type = "2|3"; // Cines
    params.region = "AR";
    params.sort_by = "primary_release_date.desc";
  } else if (catalogId === "nuevas-temporadas" || catalogId === "new-seasons") {
    params[`${dateField}.lte`] = today;
    params[`${dateField}.gte`] = ninetyDaysAgo;
    params.sort_by = "first_air_date.desc";
  } else if (catalogId === "estrenos-streaming" || catalogId === "streaming-premieres") {
    params[`${dateField}.lte`] = today;
    params[`${dateField}.gte`] = ninetyDaysAgo;
    params.with_watch_providers = "8|9|337|1899|350"; // Netflix, Prime, Disney+, Max, Apple TV+
    params.watch_region = DISCOVER_WATCH_REGION;
    params.sort_by = type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
  } else {
    // discover-master
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
    // Directiva de ordenación estricta por fecha descendente
    if (!sortParam || sortParam === "released" || sortParam === "premiere_date" || sortParam === "year_desc") {
      params.sort_by = type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
    } else if (sortParam === "popularity.desc" || sortParam === "Popularidad") {
      params.sort_by = "popularity.desc";
      params["vote_count.gte"] = "20";
    } else {
      params.sort_by = type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
    }
  }

  if (!TMDB_KEY) {
    try {
      const upstreamUrl = `${PROD_HUB_UPSTREAM}/discover${subPath}${url.search}`;
      const r = await fetch(upstreamUrl, { signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data?.metas) && data.metas.length >= 20) {
          return jsonResponse(data);
        }
      }
    } catch {
      // fallback
    }

    try {
      const cinType = type === "series" ? "series" : "movie";
      const cinData = await fetchCinemetaCatalogSorted(cinType, "top", undefined, PAGE_SIZE);
      if (cinData.metas.length > 0) {
        return jsonResponse({ metas: cinData.metas.slice(0, PAGE_SIZE) });
      }
    } catch {
      // fallback
    }

    return new Response(
      "TMDB_API_KEY_AISEARCH no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  try {
    const path = type === "movie" ? "/discover/movie" : "/discover/tv";
    // Consultar 2 páginas de TMDB en paralelo para entregar entre 20 y 30 títulos tras filtrado
    const p1 = (page - 1) * 2 + 1;
    const p2 = (page - 1) * 2 + 2;
    const [d1, d2] = await Promise.all([
      tmdbGet(path, { ...params, page: String(p1) }).catch(() => null),
      tmdbGet(path, { ...params, page: String(p2) }).catch(() => null),
    ]);

    // deno-lint-ignore no-explicit-any
    const results1 = (d1?.results ?? []) as any[];
    // deno-lint-ignore no-explicit-any
    const results2 = (d2?.results ?? []) as any[];
    const combinedResults = [...results1, ...results2];

    // Deduplicar resultados brutos por TMDB ID
    const seenTmdbIds = new Set<number>();
    // deno-lint-ignore no-explicit-any
    const results: any[] = [];
    for (const r of combinedResults) {
      if (r && r.id && !seenTmdbIds.has(r.id)) {
        seenTmdbIds.add(r.id);
        results.push(r);
      }
    }

    // Erradicación de Cascada N+1: resolución en lote con L1 + L2 Deno KV + chunks controlados
    const tmdbType = type === "movie" ? "movie" : "tv";
    // deno-lint-ignore no-explicit-any
    const tmdbIds = results.map((r: any) => r.id as number).filter(Boolean);
    const imdbIdMap = await resolveBatchImdb(tmdbIds, tmdbType);

    // deno-lint-ignore no-explicit-any
    const resolved = results.map((r: any) => {
      const imdbId = imdbIdMap.get(r.id);
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
    });

    // Filtrar portadas vacías y ordenar cronológicamente de forma estricta descendente
    const metas = resolved
      // deno-lint-ignore no-explicit-any
      .filter((m: any) => m !== null && !!m.poster)
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => String(b._d ?? "").localeCompare(String(a._d ?? "")))
      .slice(0, PAGE_SIZE)
      // deno-lint-ignore no-explicit-any
      .map(({ _d, ...m }: any) => m);

    // Guardar en caché L1 y L2 (catalog_v4_live) con TTL de refresco dinámico
    if (metas.length > 0) {
      discoverPageLruCache.set(pageCacheKey, { metas, cachedAt: Date.now(), isFresh });
      if (kv) {
        kv.set(["catalog_v4_live", type, pageCacheKey], metas, { expireIn: dynamicKvTtl }).catch(() => {});
      }
    }

    return jsonResponse({ metas });
  } catch (e) {
    return jsonResponse({ metas: [], error: (e as Error).message }, { status: 500 });
  }
}
