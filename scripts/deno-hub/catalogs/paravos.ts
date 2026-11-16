/**
 * paravos.ts — Catálogo Personalizado "Para vos" (Señal Fuerte por Proxy HMAC).
 *
 * Implementa:
 * 1. Registro de Historial de Reproducción:
 *    - Registra eventos en Deno KV bajo ["hist", perfil] ÚNICAMENTE cuando el usuario
 *      inicia una reproducción real en /proxy/stream (o vía redirección HTTP 302 firmada en circuito OPEN).
 * 2. Privacidad Estricta y Retención Bounded:
 *    - Almacena únicamente el hash(token) con SHA-256 (cero authKey o debrid tokens en claro).
 *    - Limita el historial a un máximo de 30 títulos (tt) por perfil con TTL de 90 días.
 * 3. Motor de Recomendaciones Serverless:
 *    - Genera el catálogo "Para vos" consultando TMDB /recommendations sobre las últimas 5 semillas.
 *    - Filtra por el índice de disponibilidad latina lat_idx (Deno KV).
 *    - Excluye títulos ya consumidos en el historial.
 *    - Enriquece la descripción con atribución de semilla ("Porque viste X").
 */

import { cors, jsonResponse, safeGetKv } from "../utils/common.ts";
import { verifyProxyUrl, getHmacProxyKeys } from "../utils/crypto_security.ts";
import { globalMediaFlowCircuitBreaker } from "../streams/mediaflow.ts";
import { getLatinoIndexEntry } from "./lat_idx_worker.ts";
import { TMDB_API, TMDB_KEY, resolveBatchImdb } from "./tmdb.ts";

export const HISTORY_MAX_ITEMS = 30;
export const HISTORY_SEEDS_FOR_RECOMMENDATIONS = 5;
export const HISTORY_KV_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

export interface HistoryItem {
  id: string; // IMDb ID (ej: "tt0903747")
  type: "movie" | "series";
  title?: string;
  played_at: number; // Unix timestamp ms
}

export interface StremioUserLibraryEntry {
  id: string; // IMDb ID (ej: "tt0903747")
  name: string;
  type: "movie" | "series";
  timesWatched?: number;
  timeWatched?: number;
  duration?: number;
  flaggedWatched?: number;
  lastWatched?: string;
  saved?: boolean;
  mtime?: number;
}

export interface ProfilePlaybackHistory {
  profile: string;
  token_hash: string; // SHA-256 hex del token de sesión (cero authKey)
  items: HistoryItem[];
  updated_at: number;
}

export interface ParaVosCatalogMeta {
  id: string;
  type: "movie" | "series";
  name: string;
  poster: string | null;
  description: string;
  genres?: string[];
  releaseInfo?: string;
  imdbRating?: string;
  seed_title?: string;
  has_latino?: boolean;
}

/**
 * Genera el hash criptográfico SHA-256 de un token para garantizar Zero-Secrets.
 */
export async function hashToken(token: string): Promise<string> {
  if (!token) return "";
  const enc = new TextEncoder();
  const hashBuf = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Clave canónica de Deno KV para el historial de reproducción de un perfil:
 * ["hist", perfil]
 */
export function buildHistoryKey(profile: string): Deno.KvKey {
  const norm = profile.trim().toLowerCase().replace(/@gmail\.com$/, "");
  return ["hist", norm];
}

/**
 * Registra una señal fuerte de reproducción en Deno KV bajo ["hist", perfil].
 * Solo se invoca desde el endpoint /proxy/stream.
 */
export async function recordPlaybackEvent(
  kv: Deno.Kv,
  profile: string,
  rawToken: string,
  item: { id: string; type: "movie" | "series"; title?: string },
  ttlMs: number = HISTORY_KV_TTL_MS,
): Promise<ProfilePlaybackHistory> {
  const key = buildHistoryKey(profile);
  const tokenHash = await hashToken(rawToken);

  const existingEntry = await kv.get<ProfilePlaybackHistory>(key);
  const currentHistory: ProfilePlaybackHistory = existingEntry?.value || {
    profile: profile.trim().toLowerCase(),
    token_hash: tokenHash,
    items: [],
    updated_at: 0,
  };

  const cleanId = String(item.id).split(":")[0].toLowerCase();
  // Deduplicación: remover ocurrencia previa si ya existía
  const filtered = currentHistory.items.filter((i) => i.id.toLowerCase() !== cleanId);

  // Insertar al frente como título más reciente
  const newItem: HistoryItem = {
    id: cleanId,
    type: item.type || "movie",
    title: item.title?.trim() || cleanId,
    played_at: Date.now(),
  };

  const updatedItems = [newItem, ...filtered].slice(0, HISTORY_MAX_ITEMS);

  const updatedHistory: ProfilePlaybackHistory = {
    profile: profile.trim().toLowerCase(),
    token_hash: tokenHash || currentHistory.token_hash,
    items: updatedItems,
    updated_at: Date.now(),
  };

  await kv.set(key, updatedHistory, { expireIn: ttlMs });
  return updatedHistory;
}

/**
 * Consulta el historial de reproducción de un perfil desde Deno KV.
 */
export async function getProfileHistory(
  kv: Deno.Kv,
  profile: string,
): Promise<ProfilePlaybackHistory | null> {
  const key = buildHistoryKey(profile);
  const entry = await kv.get<ProfilePlaybackHistory>(key);
  return entry?.value || null;
}

/**
 * Clave canónica de Deno KV para la biblioteca completa de Stremio de un perfil:
 * ["user_library", perfil]
 */
export function buildLibraryKey(profile: string): Deno.KvKey {
  const norm = profile.trim().toLowerCase().replace(/@gmail\.com$/, "");
  return ["user_library", norm];
}

export function buildWatchedKey(profile: string): Deno.KvKey {
  const norm = profile.trim().toLowerCase().replace(/@gmail\.com$/, "");
  return ["user_watched", norm];
}

/**
 * Persiste la colección de biblioteca (vistos, guardados, likes) en Deno KV.
 * Aplica acotamiento defensivo (bounded footprint < 64 KiB para KV) seleccionando
 * los 120 ítems de mayor afinidad y compactando la lista de IDs vistos.
 */
export async function saveUserLibrary(
  kv: Deno.Kv,
  profile: string,
  items: StremioUserLibraryEntry[],
  ttlMs: number = HISTORY_KV_TTL_MS,
): Promise<void> {
  const norm = profile.trim().toLowerCase().replace(/@gmail\.com$/, "");

  // 1. Extraer todos los IDs de títulos ya vistos (compactos, ~10 bytes c/u)
  const watchedIds: string[] = [];
  for (const it of items) {
    if ((it.timesWatched && it.timesWatched > 0) || it.flaggedWatched === 1) {
      const cleanId = String(it.id).toLowerCase();
      if (!watchedIds.includes(cleanId)) watchedIds.push(cleanId);
    }
  }
  await kv.set(buildWatchedKey(norm), watchedIds, { expireIn: ttlMs });

  // 2. Ordenar ítems por afinidad para conservar los mejores 120 como semillas ricas
  const sorted = [...items].sort((a, b) => {
    const scoreA = (a.timesWatched || 0) * 10 + (a.saved ? 5 : 0) + (a.lastWatched ? 20 : 0);
    const scoreB = (b.timesWatched || 0) * 10 + (b.saved ? 5 : 0) + (b.lastWatched ? 20 : 0);
    return scoreB - scoreA;
  });

  const boundedItems = sorted.slice(0, 120);
  await kv.set(buildLibraryKey(norm), boundedItems, { expireIn: ttlMs });
}

/**
 * Recupera la biblioteca de Stremio y los IDs vistos del perfil desde Deno KV.
 */
export async function getUserLibrary(
  kv: Deno.Kv,
  profile: string,
): Promise<{ library: StremioUserLibraryEntry[]; watchedIds: string[] }> {
  const norm = profile.trim().toLowerCase().replace(/@gmail\.com$/, "");
  const [libEntry, watchedEntry] = await Promise.all([
    kv.get<StremioUserLibraryEntry[]>(buildLibraryKey(norm)),
    kv.get<string[]>(buildWatchedKey(norm)),
  ]);
  return {
    library: libEntry?.value || [],
    watchedIds: watchedEntry?.value || [],
  };
}

/**
 * Endpoint /proxy/stream — Valida firma HMAC, registra señal fuerte de historial
 * y redirige (HTTP 302) al stream final con soporte para Circuit Breaker.
 */
export async function handleProxyStream(
  reqUrl: URL,
  _req: Request,
  customKv?: Deno.Kv | null,
): Promise<Response> {
  const targetUrl = reqUrl.searchParams.get("url");
  const profile = reqUrl.searchParams.get("profile") || "default";
  const token = reqUrl.searchParams.get("token") || "";
  const id = reqUrl.searchParams.get("id") || "";
  const type = (reqUrl.searchParams.get("type") as "movie" | "series") || "movie";
  const title = reqUrl.searchParams.get("title") || "";

  if (!targetUrl) {
    return jsonResponse({ error: "Parámetro 'url' requerido." }, { status: 400 });
  }

  // 1. Verificación Criptográfica HMAC-SHA256 y Expiración
  const { activeKey, previousKey } = getHmacProxyKeys();
  const verification = await verifyProxyUrl(reqUrl, activeKey, previousKey);

  if (!verification.valid) {
    return jsonResponse(
      {
        error: "Acceso denegado: firma HMAC de proxy inválida o expirada.",
        reason: verification.reason,
      },
      { status: 403 },
    );
  }

  // 2. Registro de Señal Fuerte de Reproducción en Deno KV
  const kv = customKv ?? (await safeGetKv());
  if (kv && id && profile) {
    try {
      await recordPlaybackEvent(kv, profile, token, { id, type, title });
    } catch (err) {
      console.warn(`[paravos] Error no bloqueante al registrar historial: ${(err as Error).message}`);
    }
  }

  // 3. Resolución de Redirección con Circuit Breaker
  // Si el circuito está abierto o cerrado, respondemos con HTTP 302 a targetUrl
  // permitiendo reproducción inmediata en ExoPlayer (Android TV)
  const isCircuitOpen = !globalMediaFlowCircuitBreaker.canAttempt();
  const headers = new Headers(cors);
  headers.set("Location", targetUrl);
  headers.set("X-Circuit-Status", isCircuitOpen ? "OPEN" : "CLOSED");
  headers.set("Cache-Control", "no-cache, no-store, must-revalidate");

  return new Response(null, {
    status: 302,
    headers,
  });
}

/**
 * Resuelve el TMDB ID correspondiente a un IMDb ID consultando TMDB /find/{id}.
 */
export async function resolveTmdbIdFromImdb(
  imdbId: string,
  type: "movie" | "series",
): Promise<{ tmdbId: number; title: string } | null> {
  if (!TMDB_KEY) return null;
  try {
    const cleanId = imdbId.split(":")[0];
    const qs = new URLSearchParams({
      api_key: TMDB_KEY,
      external_source: "imdb_id",
      language: "es-MX",
    });
    const res = await fetch(`${TMDB_API}/find/${cleanId}?${qs}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    if (type === "movie" && Array.isArray(data?.movie_results) && data.movie_results.length > 0) {
      const m = data.movie_results[0];
      return { tmdbId: m.id, title: m.title || m.original_title };
    }
    if (type === "series" && Array.isArray(data?.tv_results) && data.tv_results.length > 0) {
      const s = data.tv_results[0];
      return { tmdbId: s.id, title: s.name || s.original_name };
    }
    // Si no coincidió con el tipo sugerido, probar el otro
    if (Array.isArray(data?.movie_results) && data.movie_results.length > 0) {
      const m = data.movie_results[0];
      return { tmdbId: m.id, title: m.title || m.original_title };
    }
    if (Array.isArray(data?.tv_results) && data.tv_results.length > 0) {
      const s = data.tv_results[0];
      return { tmdbId: s.id, title: s.name || s.original_name };
    }
    return null;
  } catch {
    return null;
  }
}

export interface TmdbRecommendationItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path: string | null;
  overview: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}

/**
 * Obtiene recomendaciones de TMDB (/movie|tv/{id}/recommendations) para una semilla.
 */
export async function fetchTmdbRecommendations(
  tmdbId: number,
  type: "movie" | "series",
): Promise<TmdbRecommendationItem[]> {
  if (!TMDB_KEY) return [];
  try {
    const endpoint = type === "movie" ? `/movie/${tmdbId}/recommendations` : `/tv/${tmdbId}/recommendations`;
    const qs = new URLSearchParams({
      api_key: TMDB_KEY,
      language: "es-MX",
      page: "1",
    });
    const res = await fetch(`${TMDB_API}${endpoint}?${qs}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

/**
 * Obtiene títulos similares de TMDB (/movie|tv/{id}/similar) como resguardo si recommendations es escaso.
 */
export async function fetchTmdbSimilar(
  tmdbId: number,
  type: "movie" | "series",
): Promise<TmdbRecommendationItem[]> {
  if (!TMDB_KEY) return [];
  try {
    const endpoint = type === "movie" ? `/movie/${tmdbId}/similar` : `/tv/${tmdbId}/similar`;
    const qs = new URLSearchParams({
      api_key: TMDB_KEY,
      language: "es-MX",
      page: "1",
    });
    const res = await fetch(`${TMDB_API}${endpoint}?${qs}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

export const DEFAULT_EG_SEEDS_MOVIE: { id: string; title: string; reason: string }[] = [
  { id: "tt16995302", title: "Misión bolsa mágica (The Man with the Bag)", reason: "viste" },
  { id: "tt6264654", title: "Free Guy: Tomando el control", reason: "te gustó" },
  { id: "tt0119396", title: "Jackie Brown", reason: "guardaste en tu biblioteca" },
  { id: "tt0091369", title: "Labyrinth", reason: "guardaste en tu biblioteca" },
  { id: "tt0295297", title: "Harry Potter and the Chamber of Secrets", reason: "guardaste en tu biblioteca" },
  { id: "tt0468569", title: "Batman: El caballero de la noche", reason: "te encantó" },
];

export const DEFAULT_EG_SEEDS_SERIES: { id: string; title: string; reason: string }[] = [
  { id: "tt14060708", title: "HPI : Haut Potentiel Intellectuel", reason: "viste" },
  { id: "tt31510819", title: "Tierra de Mafia (MobLand)", reason: "te encantó" },
  { id: "tt42615019", title: "El método Scaloni", reason: "viste" },
];

/**
 * Motor de Recomendaciones del Catálogo Personalizado "Para vos":
 * 1. Aprende de:
 *    - Títulos vistos en historial y biblioteca (timesWatched, flaggedWatched, lastWatched).
 *    - Títulos guardados en biblioteca (saved).
 *    - Títulos favoritos/re-vistos (timesWatched > 1).
 * 2. Excluye estrictamente títulos ya vistos o ya presentes en biblioteca.
 * 3. Consulta TMDB /recommendations y /similar con language=es-MX.
 * 4. Prioriza por disponibilidad en índice latino (lat_idx en KV).
 * 5. Asigna etiqueta visual descriptiva y explicativa ("Porque te encantó X", "Porque guardaste Y").
 */
export async function buildParaVosCatalog(
  kv: Deno.Kv,
  profile: string,
  catalogType: "movie" | "series" = "movie",
): Promise<{ metas: ParaVosCatalogMeta[] }> {
  const history = await getProfileHistory(kv, profile);
  const { library, watchedIds: storedWatchedIds } = await getUserLibrary(kv, profile);

  // 1. Recolectar conjunto de exclusión (lo ya visto o en biblioteca)
  const watchedIds = new Set<string>(storedWatchedIds.map((id) => id.toLowerCase()));
  const knownLibraryIds = new Set<string>();

  if (history) {
    for (const h of history.items) {
      watchedIds.add(h.id.toLowerCase());
    }
  }

  if (library && library.length > 0) {
    for (const lib of library) {
      const cleanId = String(lib.id).toLowerCase();
      knownLibraryIds.add(cleanId);
      if ((lib.timesWatched && lib.timesWatched > 0) || lib.flaggedWatched === 1) {
        watchedIds.add(cleanId);
      }
    }
  }

  // 2. Extraer semillas clasificadas y ponderadas por afinidad
  interface SeedCandidate {
    id: string;
    type: "movie" | "series";
    title: string;
    reason: string;
    score: number;
  }

  const seedCandidates: SeedCandidate[] = [];

  if (library && library.length > 0) {
    for (const lib of library) {
      if (lib.type && lib.type !== catalogType) continue;
      let score = 0;
      let reason = "viste";
      const times = lib.timesWatched || 0;
      if (times > 1) {
        score += 100 + times * 10;
        reason = "te encantó";
      } else if (times === 1) {
        score += 50;
        if (lib.lastWatched) {
          const watchedDate = new Date(lib.lastWatched).getTime();
          if (!isNaN(watchedDate)) {
            const daysAgo = Math.max(0, (Date.now() - watchedDate) / (1000 * 60 * 60 * 24));
            score += Math.max(0, 30 - daysAgo);
          }
        }
        reason = "viste";
      } else if (lib.saved) {
        score += 30;
        reason = "guardaste en tu biblioteca";
      }
      if (score > 0) {
        seedCandidates.push({
          id: lib.id,
          type: lib.type || catalogType,
          title: lib.name || lib.id,
          reason,
          score,
        });
      }
    }
  }

  // Incorporar historial de reproducción reciente
  if (history && history.items.length > 0) {
    for (const h of history.items) {
      if (h.type && h.type !== catalogType) continue;
      const existing = seedCandidates.find((s) => s.id.toLowerCase() === h.id.toLowerCase());
      if (existing) {
        existing.score += 40;
      } else {
        seedCandidates.push({
          id: h.id,
          type: h.type || catalogType,
          title: h.title || h.id,
          reason: "viste recientemente",
          score: 60,
        });
      }
    }
  }

  // Ordenar semillas por puntaje de afinidad descendente
  seedCandidates.sort((a, b) => b.score - a.score);

  // Selección diversa de semillas: balanceador que evita agrupar múltiples entregas de la misma saga
  const diverseSeeds: SeedCandidate[] = [];
  const seenFranchiseTokens = new Set<string>();

  for (const seed of seedCandidates) {
    const simplifiedTitle = (seed.title || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[:\-–].*$/, "")
      .replace(/\b(part|vol|parte|season|temporada|\d+)\b/g, "")
      .trim();

    if (simplifiedTitle.length >= 4 && seenFranchiseTokens.has(simplifiedTitle)) {
      continue; // Saltar si ya tenemos una semilla de esta misma saga
    }

    if (simplifiedTitle.length >= 4) {
      seenFranchiseTokens.add(simplifiedTitle);
    }
    diverseSeeds.push(seed);
    if (diverseSeeds.length >= HISTORY_SEEDS_FOR_RECOMMENDATIONS) break;
  }

  // Si no hay semillas suficientes en KV, aplicar fallback inteligente
  let seedsToProcess = diverseSeeds;
  if (seedsToProcess.length === 0) {
    const defaults = catalogType === "series" ? DEFAULT_EG_SEEDS_SERIES : DEFAULT_EG_SEEDS_MOVIE;
    seedsToProcess = defaults.map((d) => ({
      id: d.id,
      type: catalogType,
      title: d.title,
      reason: d.reason,
      score: 10,
    }));
  }

  // 3. Procesar recomendaciones de TMDB
  const candidateTmdbIds: number[] = [];
  const seedAttributions = new Map<number, { seedTitle: string; reason: string; item: TmdbRecommendationItem }>();

  for (const seed of seedsToProcess) {
    const tmdbRes = await resolveTmdbIdFromImdb(seed.id, seed.type);
    if (!tmdbRes) continue;

    const seedTitle = seed.title || tmdbRes.title || seed.id;
    let recs = await fetchTmdbRecommendations(tmdbRes.tmdbId, catalogType);
    if (recs.length === 0) {
      recs = await fetchTmdbSimilar(tmdbRes.tmdbId, catalogType);
    }

    for (const rec of recs.slice(0, 10)) {
      if (!seedAttributions.has(rec.id)) {
        seedAttributions.set(rec.id, { seedTitle, reason: seed.reason, item: rec });
        candidateTmdbIds.push(rec.id);
      }
    }
  }

  if (candidateTmdbIds.length === 0) {
    return { metas: [] };
  }

  // 4. Batch resolve IMDb IDs
  const tmdbType = catalogType === "movie" ? "movie" : "tv";
  const imdbMap = await resolveBatchImdb(candidateTmdbIds, tmdbType);

  const candidates: ParaVosCatalogMeta[] = [];

  for (const tmdbId of candidateTmdbIds) {
    const imdbId = imdbMap.get(tmdbId);
    if (!imdbId) continue;
    const cleanId = imdbId.toLowerCase();
    // Excluir si ya fue visto o si ya está en la biblioteca
    if (watchedIds.has(cleanId) || knownLibraryIds.has(cleanId)) continue;

    const attr = seedAttributions.get(tmdbId);
    if (!attr) continue;

    const raw = attr.item;
    const rawTitle = raw.title || raw.name || "Sin título";
    const posterUrl = raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : null;

    // Verificar disponibilidad en el índice latino (lat_idx)
    let hasLatino = false;
    try {
      const latEntry = await getLatinoIndexEntry(kv, imdbId);
      if (latEntry && (latEntry.has_latino || latEntry.confidence === "Confirmado" || latEntry.confidence === "Probable")) {
        hasLatino = true;
      }
    } catch {
      // Ignorar fallback
    }

    const yearStr = raw.release_date
      ? raw.release_date.slice(0, 4)
      : raw.first_air_date
      ? raw.first_air_date.slice(0, 4)
      : "";

    const latinoBadge = hasLatino ? " [🌎 Doblaje Latino]" : "";
    const description = `Porque ${attr.reason} ${attr.seedTitle} · ${raw.overview || "Recomendado por IA para vos."}${latinoBadge}`;

    candidates.push({
      id: imdbId,
      type: catalogType,
      name: rawTitle,
      poster: posterUrl,
      description,
      releaseInfo: yearStr,
      imdbRating: raw.vote_average ? String(raw.vote_average.toFixed(1)) : undefined,
      seed_title: attr.seedTitle,
      has_latino: hasLatino,
    });
  }

  // Ordenar priorizando títulos con disponibilidad latina confirmada
  candidates.sort((a, b) => {
    if (a.has_latino && !b.has_latino) return -1;
    if (!a.has_latino && b.has_latino) return 1;
    return 0;
  });

  return { metas: candidates.slice(0, 30) };
}

/**
 * Endpoint /api/sync-library — Recibe la sincronización de biblioteca Stremio
 * (vistos, guardados, likes) y los almacena en Deno KV para alimentar el motor IA.
 */
export async function handleSyncLibrary(
  reqUrl: URL,
  req: Request,
  customKv?: Deno.Kv | null,
): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido. Utilizar POST." }, { status: 405 });
  }
  const profile = reqUrl.searchParams.get("profile") || "stremioeg";
  try {
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      return jsonResponse({ error: "Payload vacío: se requiere array 'items'." }, { status: 400 });
    }
    const kv = customKv ?? (await safeGetKv());
    if (!kv) {
      return jsonResponse({ error: "Deno KV no disponible." }, { status: 500 });
    }
    await saveUserLibrary(kv, profile, items);
    return jsonResponse({
      ok: true,
      profile,
      synced_items: items.length,
      timestamp: Date.now(),
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, { status: 500 });
  }
}
