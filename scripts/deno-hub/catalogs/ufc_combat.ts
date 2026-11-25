/**
 * ufc_combat.ts — Motor de catálogos curados y dinámicos orientados al perfil UFC,
 * MMA, Boxeo, Deportes de Combate y Acción de Adrenalina (cuenta stremiojn@gmail.com).
 *
 * Excluye estrictamente contenido infantil, animación familiar y telenovelas
 * (`without_genres: "16,10751,10762,10766"` en Discover), soporta Tabla de Calificaciones
 * Argentina (INCAA / ENACOM) y caché SWR persistente en Deno KV.
 */

import { fetchCinemetaMeta } from "../utils/cinemeta.ts";
import { jsonResponse } from "../utils/common.ts";
import { getOrSetSwrCache, TTL_SEGMENTS } from "../utils/swr_cache.ts";
import { BLOCKED_TMDB_LANGUAGES, resolveBatchImdb, tmdbGet } from "./tmdb.ts";
import {
  formatCatalogBadge,
  getCertificationChain,
  parseCompositeFilter,
  parseStremioExtra,
  type ArgentineRatingKey,
  type CertificationStep,
} from "./universes_and_platforms.ts";

export const UFC_COMBAT_CATALOG_IDS = new Set([
  "ufc-eventos",
  "ufc-series-hub",
  "cine-ufc-mma",
  "accion-adrenalina",
  "thriller-policial",
  "combat-boxeo",
  "combat-motor-deportes",
]);

export function isUfcCombatCatalogId(id: string): boolean {
  return UFC_COMBAT_CATALOG_IDS.has(id);
}

const EXCLUDE_KIDS_FAMILY_SOAP = "16,10751,10762,10766";
const UFC_SWR_VERSION = "ufc_combat_v3";

interface StremioCatalogMeta {
  id: string;
  type: "movie" | "series";
  name: string;
  poster: string | null;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
  released?: string;
  firstAired?: string;
}

interface CuratedTitleEntry {
  id: string;
  name: string;
  category: string;
  description?: string;
  year?: string;
}

const CURATED_UFC_SERIES: CuratedTitleEntry[] = [
  // UFC Oficial y Realities
  { id: "tt10845410", name: "Dana White's Contender Series", category: "ufc", description: "Prospectos de MMA pelean por un contrato oficial en UFC.", year: "2017" },
  { id: "tt0445912", name: "The Ultimate Fighter", category: "ufc", description: "El reality histórico de entrenamiento y combates de UFC.", year: "2005" },
  { id: "tt25274446", name: "Physical: 100", category: "ufc", description: "Competencia extrema de resistencia entre atletas de élite y peleadores.", year: "2023" },
  // Series de MMA y Combate
  { id: "tt3673794", name: "Kingdom", category: "mma", description: "Drama crudo centrado en un gimnasio de MMA y sus peleadores.", year: "2014" },
  { id: "tt5743796", name: "Warrior", category: "mma", description: "Artes marciales letales y acción sin tregua en el Barrio Chino.", year: "2019" },
  { id: "tt7221388", name: "Cobra Kai", category: "mma", description: "Torneos de karate y rivalidades marciales intensas.", year: "2018" },
  { id: "tt2017109", name: "Banshee", category: "mma", description: "Peleas brutales y acción policial de alto calibre.", year: "2013" },
  { id: "tt7661390", name: "Gangs of London", category: "mma", description: "Acción criminal coreografiada por Gareth Evans (The Raid).", year: "2020" },
  { id: "tt9288030", name: "Reacher", category: "mma", description: "Suspenso policial y combate cuerpo a cuerpo implacable.", year: "2022" },
  { id: "tt3865236", name: "Into the Badlands", category: "mma", description: "Artes marciales de alto voltaje y combates con armas.", year: "2015" },
  { id: "tt3322312", name: "Daredevil", category: "mma", description: "Justiciero experto en boxeo y artes marciales en Hell's Kitchen.", year: "2015" },
  { id: "tt11743610", name: "The Terminal List", category: "mma", description: "Thriller táctico de venganza y operaciones especiales.", year: "2022" },
  // Anime de Combate
  { id: "tt6357658", name: "Baki", category: "anime", description: "Luchadores clandestinos sin reglas buscan derrotar al más fuerte del mundo.", year: "2018" },
  { id: "tt13357140", name: "Baki Hanma", category: "anime", description: "El choque definitivo padre e hijo en las artes marciales extremas.", year: "2021" },
  { id: "tt9058134", name: "Kengan Ashura", category: "anime", description: "Torneo brutal de MMA corporativo sin límites ni reglas.", year: "2019" },
  { id: "tt0481256", name: "Hajime no Ippo", category: "anime", description: "Boxeo profesional técnico y peleas legendarias en el ring.", year: "2000" },
  { id: "tt7965802", name: "Megalobox", category: "anime", description: "Boxeo cyberpunk clandestino con exoesqueletos de combate.", year: "2018" },
  // WWE y Lucha Libre
  { id: "tt0185103", name: "WWE Raw", category: "wwe", description: "Show semanal estelar de lucha libre profesional WWE.", year: "1993" },
  { id: "tt0227972", name: "WWE SmackDown", category: "wwe", description: "Marca insignia de lucha libre y entretenimiento deportivo.", year: "1999" },
  { id: "tt4171176", name: "Lucha Underground", category: "wwe", description: "Combates cinematográficos y lucha libre extrema en el templo.", year: "2014" },
  { id: "tt6554240", name: "Heels", category: "wwe", description: "Drama familiar sobre una promotora independiente de lucha libre.", year: "2021" },
  { id: "tt9159144", name: "Dark Side of the Ring", category: "wwe", description: "Documental de investigación sobre historias ocultas del ring.", year: "2019" },
];

const CURATED_UFC_MMA_MOVIES: CuratedTitleEntry[] = [
  { id: "tt11214558", name: "La Máquina: The Smashing Machine", category: "mma", year: "2025" },
  { id: "tt1291584", name: "La Última Pelea (Warrior)", category: "mma", year: "2011" },
  { id: "tt3359350", name: "El Duro (Road House)", category: "mma", year: "2024" },
  { id: "tt3076658", name: "Creed: Corazón de Campeón", category: "boxeo", year: "2015" },
  { id: "tt11145118", name: "Creed III", category: "boxeo", year: "2023" },
  { id: "tt1798684", name: "Revancha (Southpaw)", category: "boxeo", year: "2015" },
  { id: "tt0964517", name: "El Peleador (The Fighter)", category: "boxeo", year: "2010" },
  { id: "tt0081398", name: "Toro Salvaje (Raging Bull)", category: "boxeo", year: "1980" },
  { id: "tt0075148", name: "Rocky", category: "boxeo", year: "1976" },
  { id: "tt0092675", name: "Contacto Sangriento (Bloodsport)", category: "kickboxing", year: "1988" },
  { id: "tt1156466", name: "Invicto III (Undisputed III: Redemption)", category: "kickboxing", year: "2010" },
  { id: "tt1899353", name: "La Redada (The Raid)", category: "accion", year: "2011" },
  { id: "tt1220719", name: "Ip Man", category: "kickboxing", year: "2008" },
  { id: "tt0368909", name: "Ong-Bak: El Guerrero Muay Thai", category: "kickboxing", year: "2003" },
];

function mapTmdbItemToMeta(
  r: Record<string, unknown>,
  type: "movie" | "series",
  imdbId: string,
  badgeLabel?: string,
  rating?: ArgentineRatingKey,
): StremioCatalogMeta {
  const title = String(r.title ?? r.name ?? "").trim();
  const d0 = String(r.release_date ?? r.first_air_date ?? "");
  const isoDate = d0 && /^\d{4}-\d{2}-\d{2}/.test(d0) ? `${d0.slice(0, 10)}T00:00:00.000Z` : undefined;
  const overview = String(r.overview ?? "").trim();
  const prefix = badgeLabel ? formatCatalogBadge(badgeLabel, rating) : "";
  return {
    id: imdbId,
    type,
    name: title,
    poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
    description: prefix ? `${prefix} ${overview}`.trim() : overview,
    releaseInfo: d0 ? d0.slice(0, 4) : undefined,
    imdbRating: r.vote_average ? String(Number(r.vote_average).toFixed(1)) : undefined,
    released: isoDate,
    firstAired: type === "series" ? isoDate : undefined,
  };
}

async function resolveCuratedEntries(
  entries: CuratedTitleEntry[],
  type: "movie" | "series",
): Promise<StremioCatalogMeta[]> {
  const settled = await Promise.all(
    entries.map(async (entry) => {
      const meta = await fetchCinemetaMeta(type, entry.id);
      let poster: string | null = typeof meta?.poster === "string" && meta.poster ? meta.poster : null;
      if (!poster) {
        const found = await tmdbGet(`/find/${entry.id}`, {
          external_source: "imdb_id",
          language: "es-MX",
        }).catch(() => null);
        const item = type === "series" ? found?.tv_results?.[0] : found?.movie_results?.[0];
        if (item?.poster_path) {
          poster = `https://image.tmdb.org/t/p/w500${item.poster_path}`;
        }
      }
      return {
        id: entry.id,
        type,
        name: meta?.name || entry.name,
        poster,
        description: meta?.description || entry.description || "",
        releaseInfo: meta?.year ? String(meta.year).slice(0, 4) : entry.year,
      } satisfies StremioCatalogMeta;
    }),
  );
  return settled.filter((m) => Boolean(m.id && m.poster));
}

function applyCertParams(
  base: Record<string, string>,
  step: CertificationStep,
  requestedGenreId?: number,
): Record<string, string> {
  const next: Record<string, string> = {
    ...base,
    certification_country: step.certification_country,
    certification: step.certification,
  };
  if (step.excludeHorror && requestedGenreId !== 27) {
    const existing = next.without_genres ? next.without_genres.split(",").filter(Boolean) : [];
    if (!existing.includes("27")) existing.push("27");
    next.without_genres = existing.join(",");
  }
  return next;
}

async function discoverTmdbCombatMetas(
  type: "movie" | "series",
  baseParams: Record<string, string>,
  page: number,
  options?: {
    rating?: ArgentineRatingKey;
    requestedGenreId?: number;
    badgeLabel?: string;
    allowBlockedLanguages?: boolean;
  },
): Promise<StremioCatalogMeta[]> {
  const path = type === "movie" ? "/discover/movie" : "/discover/tv";
  const p1 = (page - 1) * 2 + 1;
  const p2 = (page - 1) * 2 + 2;
  const seen = new Set<number>();
  // deno-lint-ignore no-explicit-any
  const collected: any[] = [];

  // deno-lint-ignore no-explicit-any
  const appendUnique = (items: any[]) => {
    for (const r of items) {
      if (!r?.id || seen.has(r.id) || !r.poster_path) continue;
      const origLang = String(r.original_language || "").toLowerCase().trim();
      if (!options?.allowBlockedLanguages && BLOCKED_TMDB_LANGUAGES.has(origLang)) continue;
      seen.add(r.id);
      collected.push(r);
    }
  };

  const fetchPair = async (queryParams: Record<string, string>) => {
    const [d1, d2] = await Promise.all([
      tmdbGet(path, { ...queryParams, page: String(p1) }).catch(() => null),
      tmdbGet(path, { ...queryParams, page: String(p2) }).catch(() => null),
    ]);
    appendUnique(d1?.results ?? []);
    appendUnique(d2?.results ?? []);
  };

  if (options?.rating) {
    const chain = getCertificationChain(options.rating, type, "US");
    await fetchPair(applyCertParams(baseParams, chain[0], options.requestedGenreId));
    for (let i = 1; i < chain.length && collected.length < 10; i++) {
      await fetchPair(applyCertParams(baseParams, chain[i], options.requestedGenreId));
    }
  } else {
    await fetchPair(baseParams);
  }

  const tmdbType = type === "series" ? "tv" : "movie";
  const top = collected.slice(0, 30);
  const imdbMap = await resolveBatchImdb(
    top.map((r) => r.id as number).filter(Boolean),
    tmdbType,
  );

  const metas: StremioCatalogMeta[] = [];
  for (const r of top) {
    const imdbId = imdbMap.get(r.id);
    if (!imdbId) continue;
    metas.push(mapTmdbItemToMeta(r, type, imdbId, options?.badgeLabel, options?.rating));
  }
  return metas.slice(0, 25);
}

/**
 * Eventos UFC & PPV dinámicos via TMDB (`/search/movie?query=UFC` + empresas/keywords UFC),
 * ordenados cronológicamente de la velada más reciente hacia atrás.
 */
async function fetchUfcEventsCatalog(genre: string, skip: number): Promise<StremioCatalogMeta[]> {
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getUTCFullYear();

  if (genre === "Documentales UFC y MMA") {
    const page = Math.floor(skip / 25) + 1;
    return await discoverTmdbCombatMetas(
      "movie",
      {
        language: "es-MX",
        with_genres: "99",
        with_keywords: "271585|354756|9917|384605|209476",
        sort_by: "primary_release_date.desc",
        "vote_count.gte": "3",
        "primary_release_date.lte": today,
      },
      page,
      { badgeLabel: "🥊 Documental UFC/MMA" },
    );
  }

  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
  const [searchByYear, byCompanies, byKeywords] = await Promise.all([
    Promise.all(
      years.map((y) =>
        tmdbGet("/search/movie", {
          query: "UFC",
          primary_release_year: String(y),
          language: "es-MX",
          include_adult: "false",
          page: "1",
        }).catch(() => null),
      ),
    ),
    tmdbGet("/discover/movie", {
      with_companies: "72685|197945",
      "primary_release_date.lte": today,
      sort_by: "primary_release_date.desc",
      language: "es-MX",
      page: "1",
    }).catch(() => null),
    tmdbGet("/discover/movie", {
      with_keywords: "271585|354756",
      "primary_release_date.lte": today,
      sort_by: "primary_release_date.desc",
      language: "es-MX",
      page: "1",
    }).catch(() => null),
  ]);

  // deno-lint-ignore no-explicit-any
  const seen = new Map<number, any>();
  const allRaw = [
    ...searchByYear.flatMap((d) => d?.results ?? []),
    ...(byCompanies?.results ?? []),
    ...(byKeywords?.results ?? []),
  ];

  for (const r of allRaw) {
    if (!r?.id || !r.poster_path) continue;
    const date = String(r.release_date || "");
    if (!date || date > today) continue;
    const title = String(r.original_title || r.title || "");
    if (!/\bUFC\b/i.test(title)) continue;
    if (genre === "Solo PPV Numerados" && !/^UFC\s+\d+/i.test(title)) continue;
    if (
      genre === "Fight Nights y Especiales" &&
      !/fight\s*night|on\s*espn|on\s*abc|freedom|apex/i.test(title)
    ) {
      continue;
    }
    if (!seen.has(r.id)) seen.set(r.id, r);
  }

  const sorted = [...seen.values()].sort((a, b) =>
    String(b.release_date || "").localeCompare(String(a.release_date || ""))
  );
  const sliceCandidates = sorted.slice(skip, skip + 60);
  const imdbMap = await resolveBatchImdb(
    sliceCandidates.map((r) => r.id as number),
    "movie",
  );

  const metas: StremioCatalogMeta[] = [];
  for (const r of sliceCandidates) {
    const imdbId = imdbMap.get(r.id);
    if (!imdbId) continue;
    metas.push(mapTmdbItemToMeta(r, "movie", imdbId, "🥊 Evento UFC"));
    if (metas.length >= 25) break;
  }
  return metas;
}

/**
 * Series y Realities UFC / MMA / Combate / Anime / WWE.
 */
async function fetchUfcSeriesCatalog(genre: string, skip: number): Promise<StremioCatalogMeta[]> {
  let targetEntries = CURATED_UFC_SERIES;
  if (genre === "UFC Oficial y Realities") {
    targetEntries = CURATED_UFC_SERIES.filter((e) => e.category === "ufc");
  } else if (genre === "Series de MMA y Combate") {
    targetEntries = CURATED_UFC_SERIES.filter((e) => e.category === "mma");
  } else if (genre === "Anime de Combate") {
    targetEntries = CURATED_UFC_SERIES.filter((e) => e.category === "anime");
  } else if (genre === "WWE y Lucha Libre") {
    targetEntries = CURATED_UFC_SERIES.filter((e) => e.category === "wwe");
  }

  const [curatedMetas, dynamicUfcTv] = await Promise.all([
    resolveCuratedEntries(targetEntries, "series"),
    genre === "Todos" || genre === "UFC Oficial y Realities"
      ? tmdbGet("/search/tv", { query: "UFC", language: "es-MX", page: "1" }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const seenIds = new Set(curatedMetas.map((m) => m.id));
  const combined = [...curatedMetas];

  // deno-lint-ignore no-explicit-any
  const tvResults = (dynamicUfcTv?.results ?? []) as any[];
  // deno-lint-ignore no-explicit-any
  const tvCandidates = tvResults.filter((r: any) => r?.id && r.poster_path && /\bUFC\b/i.test(String(r.original_name || r.name || ""))).slice(0, 15);
  if (tvCandidates.length > 0) {
    const imdbMap = await resolveBatchImdb(tvCandidates.map((r) => r.id as number), "tv");
    for (const r of tvCandidates) {
      const imdbId = imdbMap.get(r.id);
      if (!imdbId || seenIds.has(imdbId)) continue;
      seenIds.add(imdbId);
      combined.push(mapTmdbItemToMeta(r, "series", imdbId, "🥋 UFC Oficial"));
    }
  }

  return combined.slice(skip, skip + 25);
}

/**
 * Cine de UFC, MMA, Boxeo y Artes Marciales (sin animación infantil ni familia).
 */
async function fetchCineUfcMmaCatalog(
  genre: string,
  rating: ArgentineRatingKey | undefined,
  sortParam: string,
  skip: number,
): Promise<StremioCatalogMeta[]> {
  const page = Math.floor(skip / 25) + 1;
  const sortRecent = sortParam === "released" || sortParam === "premiere_date" || sortParam === "year_desc";

  let keywords = "9917|384605|337847|271585|354756|209476|18111";
  let catKey = "all";
  let badge = "🔥 UFC / MMA & Boxeo";

  if (genre === "MMA y Jaula") {
    keywords = "9917|384605|337847|271585|354756";
    catKey = "mma";
    badge = "🥊 MMA y Jaula";
  } else if (genre === "Boxeo Profesional") {
    keywords = "209476|249834|210531|155840";
    catKey = "boxeo";
    badge = "🥊 Boxeo Profesional";
  } else if (genre === "Kickboxing y Artes Marciales") {
    keywords = "18111|10515|779|156159";
    catKey = "kickboxing";
    badge = "🥋 Kickboxing / Artes Marciales";
  } else if (genre === "Acción de Combate") {
    keywords = "779|156159|384605";
    catKey = "accion";
    badge = "💥 Acción de Combate";
  }

  const today = new Date().toISOString().slice(0, 10);
  const dynamicPromise = discoverTmdbCombatMetas(
    "movie",
    {
      language: "es-MX",
      with_keywords: keywords,
      without_genres: EXCLUDE_KIDS_FAMILY_SOAP,
      "vote_count.gte": rating ? "15" : "5",
      "primary_release_date.lte": today,
      sort_by: (sortParam === "popularity.desc" || sortParam === "Popularidad") ? "popularity.desc" : "primary_release_date.desc",
    },
    page,
    { rating, badgeLabel: badge },
  );

  // Cuando hay calificación INCAA explícita o paginación > 0, priorizar resultados exactos de Discover
  if (rating || page > 1 || sortRecent) {
    return await dynamicPromise;
  }

  const curatedSubset = catKey === "all"
    ? CURATED_UFC_MMA_MOVIES
    : CURATED_UFC_MMA_MOVIES.filter((c) => c.category === catKey);

  const [curatedMetas, dynamicMetas] = await Promise.all([
    resolveCuratedEntries(curatedSubset, "movie"),
    dynamicPromise,
  ]);

  const seen = new Set<string>();
  const merged: StremioCatalogMeta[] = [];
  for (const m of [...curatedMetas, ...dynamicMetas]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      merged.push(m);
    }
  }
  return merged.slice(0, 25);
}

export async function handleUfcCombatCatalog(
  type: "movie" | "series",
  catalogId: string,
  extraStr?: string,
  url?: URL,
): Promise<Response> {
  const extraMap = parseStremioExtra(extraStr);
  const rawGenre = (extraMap.genre || url?.searchParams?.get("genre") || "Todos").trim();
  const rawRating = (extraMap.rating || url?.searchParams?.get("rating") || "").trim();
  const sortParam = (extraMap.sort || url?.searchParams?.get("sort") || "").trim();
  const skip = parseInt(extraMap.skip ?? url?.searchParams?.get("skip") ?? "0", 10) || 0;
  const page = Math.floor(skip / 25) + 1;
  const parsed = parseCompositeFilter(rawGenre, type, rawRating);
  const today = new Date().toISOString().slice(0, 10);
  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";

  const swrKey = [
    UFC_SWR_VERSION,
    catalogId,
    type,
    rawGenre || "all",
    rawRating || "all",
    sortParam || "default",
    skip,
  ];

  const metas = await getOrSetSwrCache<StremioCatalogMeta[]>(
    swrKey,
    async () => {
      if (catalogId === "ufc-eventos" && type === "movie") {
        return await fetchUfcEventsCatalog(rawGenre, skip);
      }

      if (catalogId === "ufc-series-hub" && type === "series") {
        return await fetchUfcSeriesCatalog(rawGenre, skip);
      }

      if (catalogId === "cine-ufc-mma" && type === "movie") {
        return await fetchCineUfcMmaCatalog(rawGenre, parsed.rating, sortParam, skip);
      }

      if (catalogId === "accion-adrenalina") {
        const defaultGenre = type === "movie" ? "28" : "10759";
        const withGenres = parsed.genreId ? String(parsed.genreId) : defaultGenre;
        return await discoverTmdbCombatMetas(
          type,
          {
            language: "es-MX",
            with_genres: withGenres,
            without_genres: EXCLUDE_KIDS_FAMILY_SOAP,
            "vote_count.gte": type === "movie" ? "10" : "5",
            [`${dateField}.lte`]: today,
            sort_by: (sortParam === "popularity.desc" || sortParam === "Popularidad") ? "popularity.desc" : `${dateField}.desc`,
          },
          page,
          { rating: parsed.rating, requestedGenreId: parsed.genreId, badgeLabel: "💥 Acción & Adrenalina" },
        );
      }

      if (catalogId === "thriller-policial") {
        const withGenres = parsed.genreId ? String(parsed.genreId) : (type === "movie" ? "53|80" : "80|9648");
        return await discoverTmdbCombatMetas(
          type,
          {
            language: "es-MX",
            with_genres: withGenres,
            without_genres: EXCLUDE_KIDS_FAMILY_SOAP,
            "vote_count.gte": type === "movie" ? "10" : "5",
            [`${dateField}.lte`]: today,
            sort_by: (sortParam === "popularity.desc" || sortParam === "Popularidad") ? "popularity.desc" : `${dateField}.desc`,
          },
          page,
          { rating: parsed.rating, requestedGenreId: parsed.genreId, badgeLabel: "🔪 Thriller & Policial" },
        );
      }

      if (catalogId === "combat-boxeo") {
        const baseParams: Record<string, string> = {
          language: "es-MX",
          with_keywords: "209476|249834|210531|18111|10515|9917|384605",
          without_genres: EXCLUDE_KIDS_FAMILY_SOAP,
          "vote_count.gte": type === "movie" ? "10" : "3",
          [`${dateField}.lte`]: today,
          sort_by: (sortParam === "popularity.desc" || sortParam === "Popularidad") ? "popularity.desc" : `${dateField}.desc`,
        };
        if (parsed.genreId) baseParams.with_genres = String(parsed.genreId);
        const results = await discoverTmdbCombatMetas(type, baseParams, page, {
          rating: parsed.rating,
          requestedGenreId: parsed.genreId,
          badgeLabel: "🥊 Boxeo & Kickboxing",
        });
        if (results.length > 0 || page > 1 || parsed.rating) return results;
        const fallbackEntries = type === "movie"
          ? CURATED_UFC_MMA_MOVIES.filter((m) => m.category === "boxeo" || m.category === "kickboxing")
          : CURATED_UFC_SERIES.filter((s) => s.category === "mma" || s.category === "anime");
        return await resolveCuratedEntries(fallbackEntries, type);
      }

      if (catalogId === "combat-motor-deportes") {
        const baseParams: Record<string, string> = {
          language: "es-MX",
          with_keywords: "830|10121|25484|6075|18035",
          without_genres: EXCLUDE_KIDS_FAMILY_SOAP,
          "vote_count.gte": type === "movie" ? "10" : "5",
          [`${dateField}.lte`]: today,
          sort_by: (sortParam === "popularity.desc" || sortParam === "Popularidad") ? "popularity.desc" : `${dateField}.desc`,
        };
        if (parsed.genreId) baseParams.with_genres = String(parsed.genreId);
        return await discoverTmdbCombatMetas(type, baseParams, page, {
          rating: parsed.rating,
          requestedGenreId: parsed.genreId,
          badgeLabel: "🏎️ F1, Motor & Deportes",
        });
      }

      return [];
    },
    {
      type: "catalog",
      ttlMs: TTL_SEGMENTS.CATALOG_METADATA.freshMs,
      staleMs: TTL_SEGMENTS.CATALOG_METADATA.staleMs,
    },
  );

  return jsonResponse({ metas });
}
