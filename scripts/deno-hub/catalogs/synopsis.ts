/**
 * synopsis.ts — MejoraStremio Synopsis IA (Proxy de Metadata Enriquecido).
 * Pasa AIOMetadata intacto y reescribe la sinopsis en español latino cuando es corta o está en inglés.
 */

import { cors, jsonResponse, getKv, safeGetKv } from "../utils/common.ts";
import { getCompressedKvText, setCompressedKvText } from "../utils/kv_blob_cache.ts";
import { fetchCinemetaMeta, canonicalImdbId } from "../utils/cinemeta.ts";
import { getLocalizedTrailersWithFallback, tmdbGet } from "./tmdb.ts";
import { resolveTmdbIdFromImdb } from "./paravos.ts";
import { getLatinoTrailersHotPath } from "./trailers.ts";
import {
  GEMINI_API_KEY,
  OPENROUTER_API_KEY,
  callGemini,
  callOpenRouter,
} from "../translate/gemini.ts";

export const AIOMETADATA_BASE = "https://aiometadata.elfhosted.com";
export const PRESET_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/preset.json";

export const AI_BUDGET_MS = 4000;
export const SYNOPSIS_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

export const SYNOPSIS_MANIFEST = {
  id: "com.mejorastremio.synopsis-proxy",
  version: "1.0.0",
  name: "MejoraStremio Synopsis IA",
  description:
    "Proxy de metadata: pasa AIOMetadata intacto y solo reescribe la sinopsis " +
    "cuando está corta o en inglés (Gemini, fallback OpenRouter). Cae a " +
    "Cinemeta si AIOMetadata no responde.",
  resources: ["meta"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

let cachedInstanceId: string | null = null;
let cachedInstanceIdAt = 0;
export const INSTANCE_ID_TTL_MS = 10 * 60 * 1000;

export async function getInstanceId(): Promise<string> {
  const fallbackId = "2d8ff56f-9385-4f71-b1e2-2fadd32aa810";
  const now = Date.now();
  if (cachedInstanceId && now - cachedInstanceIdAt < INSTANCE_ID_TTL_MS) {
    return cachedInstanceId;
  }
  try {
    const r = await fetch(PRESET_URL, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const preset = await r.json();
      const id = preset?.aioMetadataConfig?.instanceId;
      if (id) {
        cachedInstanceId = id;
        cachedInstanceIdAt = now;
        return id;
      }
    }
  } catch {
    // Si la lectura remota falla o da timeout, usa el fallback garantizado
  }
  cachedInstanceId = cachedInstanceId || fallbackId;
  return cachedInstanceId;
}

// deno-lint-ignore no-explicit-any
export async function fetchAioMeta(type: string, rawId: string): Promise<any> {
  const instanceId = await getInstanceId();
  const url = `${AIOMETADATA_BASE}/stremio/${instanceId}/meta/${type}/${rawId}.json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`AIOMetadata respondió ${r.status}`);
  const d = await r.json();
  if (!d?.meta) throw new Error("AIOMetadata: respuesta sin meta");
  return d.meta;
}

export const ENGLISH_HINTS = [
  " the ", " and ", " with ", " from ", " this ", " that ", " their ",
  " were ", " when ", " which ", " who ", " has ", " will ", " story follows",
];
export const SPANISH_HINTS = [
  " el ", " la ", " los ", " las ", " de ", " con ", " para ", " una ",
  " uno ", " que ", " su ", " sus ", " es ", " son ", " esta ", " este ",
];

export function looksEnglish(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  const en = ENGLISH_HINTS.filter((h) => t.includes(h)).length;
  const es = SPANISH_HINTS.filter((h) => t.includes(h)).length;
  return en >= 2 && en > es;
}

export function needsEnrichment(description: string | undefined): boolean {
  if (!description) return false;
  if (description.length < 300) return true;
  return looksEnglish(description);
}

// deno-lint-ignore no-explicit-any
export function buildPrompt(meta: any, description: string): string {
  const title = meta.name ?? meta.title ?? "";
  const year = meta.year ?? meta.releaseInfo ?? "";
  const genres = Array.isArray(meta.genres) ? meta.genres.join(", ") : "";
  return (
    "Reescribí esta sinopsis en español latino, más rica y detallada que el " +
    "original. No inventes giros de trama ni eventos específicos que no estén " +
    "ya insinuados en el texto original — solo expandí tono, ambientación, " +
    "contexto y premisa. Devolvé solo la sinopsis reescrita, sin comentarios " +
    "ni encabezados.\n\n" +
    `Título: ${title}${year ? ` (${year})` : ""}\n` +
    `Género: ${genres || "desconocido"}\n` +
    `Sinopsis actual: ${description}`
  );
}

export async function enrichSynopsis(
  imdbId: string,
  type: string,
  // deno-lint-ignore no-explicit-any
  meta: any,
  description: string,
): Promise<string | null> {
  const key = ["synopsis", imdbId, type];
  let kv: Deno.Kv | null = null;
  try {
    kv = await getKv();
    if (kv) {
      const cached = await getCompressedKvText(kv, key);
      if (cached) return cached;
    }
  } catch {
    kv = null;
  }

  const deadline = Date.now() + AI_BUDGET_MS;
  const prompt = buildPrompt(meta, description);

  let text: string | null = null;

  if (GEMINI_API_KEY) {
    const remaining = deadline - Date.now();
    if (remaining > 500) {
      try {
        text = await callGemini(prompt, GEMINI_API_KEY, AbortSignal.timeout(remaining));
      } catch {
        // continúa a fallback
      }
    }
  }

  if (!text && OPENROUTER_API_KEY) {
    const remaining = deadline - Date.now();
    if (remaining > 500) {
      try {
        text = await callOpenRouter(prompt, OPENROUTER_API_KEY, AbortSignal.timeout(remaining));
      } catch {
        // ambos fallaron
      }
    }
  }

  if (text && kv) {
    try {
      await setCompressedKvText(kv, key, text, { expireIn: SYNOPSIS_CACHE_TTL_MS });
    } catch {
      // sin cache
    }
  }
  return text;
}

export const META_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días en Deno KV

export async function handleMeta(
  type: string,
  rawId: string,
  customKv?: Deno.Kv | null,
): Promise<Response> {
  const cleanId = canonicalImdbId(rawId.split(":")[0]);
  if (!cleanId.startsWith("tt")) {
    return new Response("Invalid ID prefix", { status: 400, headers: cors });
  }

  const kv = customKv ?? (await safeGetKv());
  const cacheKey = ["meta_latino_v2", type, cleanId];

  // 1. Revisar caché KV
  if (kv) {
    try {
      const cached = await kv.get<Record<string, unknown>>(cacheKey);
      if (cached?.value) {
        return jsonResponse({ meta: cached.value });
      }
    } catch {
      // continuar
    }
  }

  // 2. Ingesta primaria base de Cinemeta (garantiza lista de episodios completa para series e IMDb rating)
  // deno-lint-ignore no-explicit-any
  let meta: any = await fetchCinemetaMeta(type, cleanId);
  if (!meta) {
    try {
      meta = await fetchAioMeta(type, cleanId);
    } catch {
      // ambos fallaron
    }
  }

  if (!meta) {
    return jsonResponse({ meta: null, error: "Metadatos no encontrados" }, { status: 404 });
  }

  // 3. Consulta TMDB en español latino (es-MX)
  try {
    const tmdbResolve = await resolveTmdbIdFromImdb(cleanId, type === "series" ? "series" : "movie");
    if (tmdbResolve?.tmdbId) {
      const tmdbPath = type === "series" ? `/tv/${tmdbResolve.tmdbId}` : `/movie/${tmdbResolve.tmdbId}`;
      const tmdbDetail = await tmdbGet(tmdbPath, { language: "es-MX", append_to_response: "videos" }).catch(() => null);

      if (tmdbDetail) {
        // Enriquecer título con localización si existe
        if (tmdbDetail.title || tmdbDetail.name) {
          meta.name = tmdbDetail.title || tmdbDetail.name;
        }

        // Enriquecer descripción con TMDB es-MX oficial
        const tmdbOverview = String(tmdbDetail.overview || "").trim();
        if (tmdbOverview && tmdbOverview.length > 20 && !looksEnglish(tmdbOverview)) {
          meta.description = tmdbOverview;
        } else if (needsEnrichment(meta.description)) {
          const enriched = await enrichSynopsis(cleanId, type, meta, meta.description || "");
          if (enriched) meta.description = enriched;
        }

        // Ingesta y badging de Tráilers doblados al español latino
        const hotTrailers = await getLatinoTrailersHotPath(tmdbResolve.tmdbId, type === "series" ? "tv" : "movie", cleanId, kv).catch(() => []);
        const fallbackTrailers = await getLocalizedTrailersWithFallback(tmdbResolve.tmdbId, type === "series" ? "tv" : "movie").catch(() => ({ trailers: [], trailerStreams: [] }));

        // Prioridad absoluta a trailers latinos verificados
        // deno-lint-ignore no-explicit-any
        const finalTrailers: any[] = [];
        // deno-lint-ignore no-explicit-any
        const finalStreams: any[] = [];
        const seenYtKeys = new Set<string>();

        // 1. HotPath trailers
        for (const ht of hotTrailers) {
          if (ht.ytId && !seenYtKeys.has(ht.ytId)) {
            seenYtKeys.add(ht.ytId);
            finalTrailers.push({
              source: ht.ytId,
              type: "Trailer",
              name: `[🌎 LATINO] ${ht.name || "Tráiler Oficial"}`,
              lang: "es-419",
            });
            finalStreams.push({
              title: `[🌎 LATINO] ${ht.name || "Tráiler Oficial"}`,
              ytId: ht.ytId,
              lang: "es-419",
              official: true,
            });
          }
        }

        // 2. Fallback trailers de TMDB
        for (const t of fallbackTrailers.trailers) {
          if (t.source && !seenYtKeys.has(t.source)) {
            seenYtKeys.add(t.source);
            finalTrailers.push(t);
          }
        }
        for (const s of fallbackTrailers.trailerStreams) {
          if (s.ytId && !seenYtKeys.has(s.ytId)) {
            seenYtKeys.add(s.ytId);
            finalStreams.push(s);
          }
        }

        if (finalTrailers.length > 0) {
          meta.trailers = finalTrailers;
        }
        if (finalStreams.length > 0) {
          meta.trailerStreams = finalStreams;
        }
      }
    }
  } catch {
    // Si la localización TMDB falla, conservar metadata de Cinemeta
  }

  // 4. Fallback de IA si aún estuviese en inglés
  if (needsEnrichment(meta.description)) {
    try {
      const enriched = await enrichSynopsis(cleanId, type, meta, meta.description);
      if (enriched) meta.description = enriched;
    } catch {
      // conservar descripción
    }
  }

  // 5. Compatibilidad Android TV v1.12.0: Fechas canónicas ISO-8601 para el nuevo Calendario y Grid
  normalizeMetaDatesForAndroidTv(meta, type);

  // 6. Guardar en Deno KV
  if (kv) {
    kv.set(cacheKey, meta, { expireIn: META_CACHE_TTL_MS }).catch(() => {});
  }

  return jsonResponse({ meta });
}

// deno-lint-ignore no-explicit-any
export function normalizeMetaDatesForAndroidTv(meta: any, type: string): void {
  if (!meta) return;

  const toIsoDate = (val: unknown): string | undefined => {
    if (!val) return undefined;
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (/^\d{4}-\d{2}-\d{2}(T|\b)/.test(trimmed)) {
        try {
          const d = new Date(trimmed);
          if (!isNaN(d.getTime())) return d.toISOString();
        } catch { /* ignore */ }
      }
      if (/^\d{4}$/.test(trimmed)) {
        return `${trimmed}-01-01T00:00:00.000Z`;
      }
    } else if (typeof val === "number" && !isNaN(val)) {
      try {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d.toISOString();
      } catch { /* ignore */ }
    }
    return undefined;
  };

  const isoReleased = toIsoDate(meta.released) || toIsoDate(meta.firstAired) || toIsoDate(meta.year);
  if (isoReleased) {
    meta.released = isoReleased;
  }

  if (type === "series") {
    meta.firstAired = toIsoDate(meta.firstAired) || meta.released;
  }

  if (!meta.releaseInfo && meta.released) {
    meta.releaseInfo = String(meta.released).slice(0, 4);
  }

  if (Array.isArray(meta.videos)) {
    for (const v of meta.videos) {
      if (!v) continue;
      if (typeof v.season !== "number" && v.season) v.season = parseInt(String(v.season), 10);
      if (typeof v.number !== "number" && (v.episode || v.number)) {
        v.number = parseInt(String(v.episode ?? v.number), 10);
      }
      if (v.number !== undefined && v.episode === undefined) {
        v.episode = v.number;
      }
      const epDate = toIsoDate(v.released) || toIsoDate(v.firstAired);
      if (epDate) {
        v.released = epDate;
        v.firstAired = epDate;
      }
    }
  }
}

export async function handleSynopsis(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(SYNOPSIS_MANIFEST);
  }

  const metaMatch = subPath.match(/^\/meta\/(movie|series)\/(.+)\.json$/);
  if (metaMatch) {
    return await handleMeta(metaMatch[1], metaMatch[2]);
  }

  return new Response("Not found", { status: 404, headers: cors });
}
