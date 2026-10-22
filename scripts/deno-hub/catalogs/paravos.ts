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
 * Motor de Recomendaciones del Catálogo Personalizado "Para vos":
 * 1. Toma hasta 5 semillas del historial del usuario.
 * 2. Consulta TMDB /recommendations para cada semilla.
 * 3. Excluye títulos ya vistos en el historial.
 * 4. Prioriza por disponibilidad en índice latino (lat_idx en KV).
 * 5. Asigna etiqueta visual descriptiva: "Porque viste X".
 */
export async function buildParaVosCatalog(
  kv: Deno.Kv,
  profile: string,
  catalogType: "movie" | "series" = "movie",
): Promise<{ metas: ParaVosCatalogMeta[] }> {
  const history = await getProfileHistory(kv, profile);
  if (!history || history.items.length === 0) {
    return { metas: [] };
  }

  // Filtrar semillas por tipo si es posible, o tomar las últimas 5 generales
  const relevantSeeds = history.items
    .filter((i) => i.type === catalogType || !i.type)
    .slice(0, HISTORY_SEEDS_FOR_RECOMMENDATIONS);

  const seedsToProcess = relevantSeeds.length > 0 ? relevantSeeds : history.items.slice(0, HISTORY_SEEDS_FOR_RECOMMENDATIONS);

  const watchedIds = new Set(history.items.map((i) => i.id.toLowerCase()));
  const candidates: ParaVosCatalogMeta[] = [];
  const candidateTmdbIds: number[] = [];
  const seedAttributions = new Map<number, { seedTitle: string; item: TmdbRecommendationItem }>();

  // Procesar semillas en paralelo controlado
  for (const seed of seedsToProcess) {
    const tmdbRes = await resolveTmdbIdFromImdb(seed.id, seed.type);
    if (!tmdbRes) continue;

    const seedTitle = seed.title || tmdbRes.title || seed.id;
    const recs = await fetchTmdbRecommendations(tmdbRes.tmdbId, catalogType);

    for (const rec of recs.slice(0, 10)) {
      if (!seedAttributions.has(rec.id)) {
        seedAttributions.set(rec.id, { seedTitle, item: rec });
        candidateTmdbIds.push(rec.id);
      }
    }
  }

  if (candidateTmdbIds.length === 0) {
    return { metas: [] };
  }

  // Resolver en batch los IMDb IDs de los candidatos recomendados
  const tmdbType = catalogType === "movie" ? "movie" : "tv";
  const imdbMap = await resolveBatchImdb(candidateTmdbIds, tmdbType);

  // Enriquecer candidatos con validación de lat_idx y formato Stremio
  for (const tmdbId of candidateTmdbIds) {
    const imdbId = imdbMap.get(tmdbId);
    if (!imdbId) continue;
    if (watchedIds.has(imdbId.toLowerCase())) continue; // Exclusión de títulos ya vistos

    const attr = seedAttributions.get(tmdbId);
    if (!attr) continue;

    const raw = attr.item;
    const rawTitle = raw.title || raw.name || "Sin título";
    const posterUrl = raw.poster_path
      ? `https://image.tmdb.org/t/p/w500${raw.poster_path}`
      : null;

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

    candidates.push({
      id: imdbId,
      type: catalogType,
      name: rawTitle,
      poster: posterUrl,
      description: `Porque viste ${attr.seedTitle} · ${raw.overview || "Recomendado para vos en base a tus reproducciones recientes."}`,
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
