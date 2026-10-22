/**
 * trailers.ts — Ingesta, Filtrado Estricto de Tráilers en Audio Latino y Fallback Serverless.
 *
 * Implementa:
 * 1. TMDB First: Ingesta primaria con include_video_language=es-MX,es.
 * 2. Filtro Negativo Implacable:
 *    - Descarta incondicionalmente si menciona 'castellano', 'es-ES', 'VOSE' o 'subtitulado'.
 *    - Acepta solo si el nombre incluye 'latino' o 'doblado' y canal/publisher validado.
 * 3. Hot Path Zero-Latency: Si TMDB no aporta candidato válido, emite array vacío []
 *    sin bloquear la UI ni consumir cuota externa en tiempo real.
 * 4. Fallback YouTube en Cron Nocturno: Delegado exclusivamente al cron nocturno con
 *    presupuesto estricto de máx 50 búsquedas/día y caché Deno KV de 30 días.
 */

import { TMDB_API, TMDB_KEY } from "./tmdb.ts";

export const TRAILER_KV_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
export const DAILY_YOUTUBE_SEARCH_BUDGET = 50; // Límite estricto de búsquedas YouTube por día

export interface TmdbVideoItem {
  id?: string;
  iso_639_1?: string;
  iso_3166_1?: string;
  key: string;
  name: string;
  site: string;
  size?: number;
  type: string;
  official?: boolean;
  published_at?: string;
  channelTitle?: string;
}

export interface TrailerCandidate {
  ytId: string;
  name: string;
  type: string;
  source: "tmdb" | "youtube_cron";
  channelTitle?: string;
  publishedAt?: string;
}

export interface TrailerCacheEntry {
  imdb_id: string;
  candidate: TrailerCandidate | null;
  cached_at: number;
}

/**
 * Whitelist de Canales y Distribuidores Oficiales en Latinoamérica.
 */
export const LATINO_CHANNEL_WHITELIST = new Set([
  "warner bros. pictures latinoamérica",
  "warner bros. pictures méxico",
  "sony pictures méxico",
  "universal pictures méxico",
  "universal pictures latam",
  "universal pictures latinoamérica",
  "20th century studios la",
  "20th century fox latinoamérica",
  "disney studios la",
  "walt disney studios latinoamérica",
  "paramount pictures méxico",
  "paramount pictures latinoamérica",
  "cinemex",
  "cinépolis",
  "netflix latinoamérica",
  "prime video latam",
  "hbo max latinoamérica",
  "max latinoamérica",
  "corazón films",
  "diamond films latam",
  "star+ latinoamérica",
  "apple tv latinoamérica",
  "lionsgate latinoamérica",
  "bf distribution",
  "cinemania latino",
  "trailers tc",
  "sensacine méxico",
  "paloma & nacho",
  "videocine",
]);

/**
 * Tokens de descarte incondicional (Filtro Negativo Implacable).
 */
export const NEGATIVE_TRAILER_TOKENS = [
  "castellano",
  "es-es",
  "vose",
  "subtitulado",
  "subtitulada",
  "subtitulos",
  "subtítulos",
  "sub en español",
  "con subtitulos",
  "con subtítulos",
  "en españa",
  "trailer españa",
  "tráiler españa",
];

/**
 * Normaliza texto para análisis léxico.
 */
export function normalizeVideoText(text?: string | null): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Evalúa si un video es un tráiler válido en Audio Latinoamericano.
 */
export function isStrictLatinoTrailer(video: TmdbVideoItem): boolean {
  if (video.site !== "YouTube") return false;
  if (video.type !== "Trailer" && video.type !== "Teaser") return false;

  const normName = normalizeVideoText(video.name);
  const normChannel = normalizeVideoText(video.channelTitle);

  // 1. FILTRO NEGATIVO IMPLACABLE: Si menciona castellano, españa, VOSE o subtitulado -> RECHAZO TOTAL
  for (const neg of NEGATIVE_TRAILER_TOKENS) {
    const normNeg = normalizeVideoText(neg);
    if (normName.includes(normNeg)) {
      return false;
    }
  }

  // 2. FILTRO POSITIVO: Debe incluir 'latino' o 'doblado'
  const hasLatinoKeyword = normName.includes("latino") || normName.includes("doblado");
  if (!hasLatinoKeyword) {
    return false;
  }

  // 3. VALIDACIÓN DE CANAL / PUBLISHER (Si se especifica el canal, debe pertenecer a la whitelist)
  if (normChannel) {
    const isWhitelisted = Array.from(LATINO_CHANNEL_WHITELIST).some((ch) =>
      normChannel.includes(normalizeVideoText(ch))
    );
    if (!isWhitelisted) {
      return false;
    }
  }

  return true;
}

/**
 * Ingesta Primaria TMDB First: Consulta /movie|tv/{id}/videos con include_video_language=es-MX,es.
 */
export async function fetchTmdbVideos(
  tmdbId: number | string,
  type: "movie" | "tv",
): Promise<TmdbVideoItem[]> {
  if (!TMDB_KEY) return [];
  try {
    const endpoint = type === "movie" ? `/movie/${tmdbId}/videos` : `/tv/${tmdbId}/videos`;
    const qs = new URLSearchParams({
      api_key: TMDB_KEY,
      include_video_language: "es-MX,es",
    });
    const res = await fetch(`${TMDB_API}${endpoint}?${qs}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.results) ? (data.results as TmdbVideoItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * Hot Path: Consulta de Tráilers con garantía Zero-Latency.
 * Si TMDB no aporta un candidato latino estricto, retorna array vacío [] de inmediato.
 * NUNCA llama a la API de YouTube en el hot path.
 */
export async function getLatinoTrailersHotPath(
  tmdbId: number | string,
  type: "movie" | "tv",
  imdbId?: string,
  kv?: Deno.Kv | null,
): Promise<TrailerCandidate[]> {
  // 1. Revisar caché KV si se suministró imdbId
  if (imdbId && kv) {
    try {
      const cached = await kv.get<TrailerCacheEntry>(["trailer", imdb_id(imdbId)]);
      if (cached && cached.value) {
        if (cached.value.candidate) {
          return [cached.value.candidate];
        }
        // Si hay registro negativo reciente (cache negativo), devolver vacío
        if (Date.now() - cached.value.cached_at < TRAILER_KV_TTL_MS) {
          return [];
        }
      }
    } catch {
      // Continuar al fetch
    }
  }

  // 2. Ingesta primaria TMDB con filtros estrictos
  const videos = await fetchTmdbVideos(tmdbId, type);
  for (const v of videos) {
    if (isStrictLatinoTrailer(v)) {
      const candidate: TrailerCandidate = {
        ytId: v.key,
        name: v.name,
        type: v.type,
        source: "tmdb",
        channelTitle: v.channelTitle,
        publishedAt: v.published_at,
      };

      // Guardar en caché KV en background
      if (imdbId && kv) {
        kv.set(
          ["trailer", imdb_id(imdbId)],
          { imdb_id: imdbId, candidate, cached_at: Date.now() },
          { expireIn: TRAILER_KV_TTL_MS },
        ).catch(() => {});
      }

      return [candidate];
    }
  }

  // 3. Fallback caliente: array vacío [] (cero bloqueo, cero llamadas a YouTube API)
  return [];
}

function imdb_id(id: string): string {
  return String(id).toLowerCase().trim();
}

/**
 * Cron Nocturno: Fallback a YouTube API para títulos sin tráiler en TMDB.
 * Presupuesto máximo: 50 búsquedas diarias registradas en Deno KV.
 */
export async function runNightlyTrailerCron(
  kv: Deno.Kv,
  titlesToResolve: Array<{ imdbId: string; title: string; year?: number | string; type?: "movie" | "tv" }>,
  youtubeApiKey?: string,
  customDateKey?: string,
): Promise<{
  attempted: number;
  found: number;
  budgetUsedToday: number;
  budgetRemaining: number;
}> {
  const dateKey = customDateKey || new Date().toISOString().slice(0, 10);
  const budgetKey: Deno.KvKey = ["trailer_budget", dateKey];

  // 1. Consultar consumo diario actual
  const budgetEntry = await kv.get<number>(budgetKey);
  let currentUsage = budgetEntry?.value || 0;

  if (currentUsage >= DAILY_YOUTUBE_SEARCH_BUDGET || !youtubeApiKey) {
    return {
      attempted: 0,
      found: 0,
      budgetUsedToday: currentUsage,
      budgetRemaining: Math.max(0, DAILY_YOUTUBE_SEARCH_BUDGET - currentUsage),
    };
  }

  let attempted = 0;
  let found = 0;

  for (const item of titlesToResolve) {
    if (currentUsage >= DAILY_YOUTUBE_SEARCH_BUDGET) break;

    // Verificar si ya está en caché KV
    const cached = await kv.get<TrailerCacheEntry>(["trailer", imdb_id(item.imdbId)]);
    if (cached?.value?.candidate) {
      continue;
    }

    attempted++;
    currentUsage++;

    try {
      const q = `${item.title} trailer oficial doblado latino`;
      const qs = new URLSearchParams({
        part: "snippet",
        q,
        type: "video",
        maxResults: "5",
        key: youtubeApiKey,
      });

      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${qs}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        let matchedCandidate: TrailerCandidate | null = null;

        for (const ytItem of items) {
          const videoMock: TmdbVideoItem = {
            key: ytItem?.id?.videoId || "",
            name: ytItem?.snippet?.title || "",
            site: "YouTube",
            type: "Trailer",
            channelTitle: ytItem?.snippet?.channelTitle || "",
            published_at: ytItem?.snippet?.publishedAt,
          };

          if (isStrictLatinoTrailer(videoMock)) {
            matchedCandidate = {
              ytId: videoMock.key,
              name: videoMock.name,
              type: "Trailer",
              source: "youtube_cron",
              channelTitle: videoMock.channelTitle,
              publishedAt: videoMock.published_at,
            };
            break;
          }
        }

        // Persistir en Deno KV con TTL de 30 días
        await kv.set(
          ["trailer", imdb_id(item.imdbId)],
          { imdb_id: item.imdbId, candidate: matchedCandidate, cached_at: Date.now() },
          { expireIn: TRAILER_KV_TTL_MS },
        );

        if (matchedCandidate) {
          found++;
        }
      }
    } catch {
      // Continuar al siguiente item
    }
  }

  // Actualizar presupuesto del día en KV
  await kv.set(budgetKey, currentUsage, { expireIn: 2 * 24 * 60 * 60 * 1000 });

  return {
    attempted,
    found,
    budgetUsedToday: currentUsage,
    budgetRemaining: Math.max(0, DAILY_YOUTUBE_SEARCH_BUDGET - currentUsage),
  };
}
