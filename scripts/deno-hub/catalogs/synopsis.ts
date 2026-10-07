/**
 * synopsis.ts — MejoraStremio Synopsis IA (Proxy de Metadata Enriquecido).
 * Pasa AIOMetadata intacto y reescribe la sinopsis en español latino cuando es corta o está en inglés.
 */

import { cors, jsonResponse, parseStremioSubId, getKv } from "../utils/common.ts";
import { fetchCinemetaMeta } from "../utils/cinemeta.ts";
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
    const cached = await kv.get<string>(key);
    if (cached.value) return cached.value;
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
      await kv.set(key, text, { expireIn: SYNOPSIS_CACHE_TTL_MS });
    } catch {
      // sin cache
    }
  }
  return text;
}

export async function handleSynopsis(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(SYNOPSIS_MANIFEST);
  }

  const metaMatch = subPath.match(/^\/meta\/(movie|series)\/(.+)\.json$/);
  if (metaMatch) {
    const [, type, rawId] = metaMatch;
    const imdbId = parseStremioSubId(rawId).imdbId;

    // deno-lint-ignore no-explicit-any
    let meta: any;
    try {
      meta = await fetchAioMeta(type, rawId);
    } catch (e) {
      const fallback = await fetchCinemetaMeta(type, rawId);
      if (fallback) {
        return jsonResponse({ meta: fallback });
      }
      return jsonResponse({ meta: null, error: (e as Error).message }, { status: 502 });
    }

    if (needsEnrichment(meta.description)) {
      try {
        const enriched = await enrichSynopsis(imdbId, type, meta, meta.description);
        if (enriched) meta.description = enriched;
      } catch {
        // conservar sinopsis de AIOMetadata
      }
    }

    return jsonResponse({ meta });
  }

  return new Response("Not found", { status: 404, headers: cors });
}
