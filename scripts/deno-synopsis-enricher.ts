/**
 * deno-synopsis-enricher.ts — Proxy de metadata Stremio (recurso "meta").
 *
 * NO es un addon de metadata competidor: pasa el meta de AIOMetadata tal cual
 * (título, géneros, cast, poster, background, episodios, etc. — todo intacto)
 * y solo reescribe el campo `description` cuando está corto (<300 caracteres)
 * o parece estar en inglés, vía Gemini con fallback a OpenRouter. Si ambos
 * fallan, devuelve la sinopsis original sin tocar — nunca bloquea la respuesta
 * más de ~4s esperando a la IA. Si AIOMetadata no responde, cae a Cinemeta y
 * devuelve esa respuesta tal cual, sin intentar enriquecer (nunca se inventa
 * contenido sin metadata base real).
 *
 * Mismo patrón sin-dependencias que deno-subdl-addon.ts (Deno.serve nativo).
 *
 * Deploy: deno.com/deploy → conectar repo pabloeckert/MejoraStremio →
 *   entry point: scripts/deno-synopsis-enricher.ts
 *   env vars: GEMINI_API_KEY, OPENROUTER_API_KEY (Secret)
 *   opcionales: GEMINI_MODEL (default gemini-2.5-flash-lite),
 *               OPENROUTER_MODEL (default openrouter/free)
 *
 * Una vez deployado, instalar en Stremio:
 *   https://<proyecto>.deno.dev/manifest.json
 */

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash-lite";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free";

const AIOMETADATA_BASE = "https://aiometadata.elfhosted.com";
const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
const PRESET_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/preset.json";

const AI_BUDGET_MS = 4000;
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

const MANIFEST = {
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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

// ── instanceId de AIOMetadata (leído de preset.json en GitHub raw, cache 10 min) ──
let cachedInstanceId: string | null = null;
let cachedInstanceIdAt = 0;
const INSTANCE_ID_TTL_MS = 10 * 60 * 1000;

async function getInstanceId(): Promise<string> {
  const now = Date.now();
  if (cachedInstanceId && now - cachedInstanceIdAt < INSTANCE_ID_TTL_MS) {
    return cachedInstanceId;
  }
  const r = await fetch(PRESET_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`No se pudo leer preset.json: ${r.status}`);
  const preset = await r.json();
  const id = preset?.aioMetadataConfig?.instanceId;
  if (!id) throw new Error("preset.json sin aioMetadataConfig.instanceId");
  cachedInstanceId = id;
  cachedInstanceIdAt = now;
  return id;
}

// ── Fuentes de meta ───────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function fetchAioMeta(type: string, rawId: string): Promise<any> {
  const instanceId = await getInstanceId();
  const url =
    `${AIOMETADATA_BASE}/stremio/${instanceId}/meta/${type}/${rawId}.json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`AIOMetadata respondió ${r.status}`);
  const d = await r.json();
  if (!d?.meta) throw new Error("AIOMetadata: respuesta sin meta");
  return d.meta;
}

// deno-lint-ignore no-explicit-any
async function fetchCinemetaMeta(type: string, rawId: string): Promise<any | null> {
  try {
    const url = `${CINEMETA_BASE}/meta/${type}/${rawId}.json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.meta ?? null;
  } catch {
    return null;
  }
}

// ── Heurística: ¿la sinopsis necesita enriquecerse? ───────────────────────────
const ENGLISH_HINTS = [
  " the ", " and ", " with ", " from ", " this ", " that ", " their ",
  " were ", " when ", " which ", " who ", " has ", " will ", " story follows",
];
const SPANISH_HINTS = [
  " el ", " la ", " los ", " las ", " de ", " con ", " para ", " una ",
  " uno ", " que ", " su ", " sus ", " es ", " son ", " esta ", " este ",
];

function looksEnglish(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  const en = ENGLISH_HINTS.filter((h) => t.includes(h)).length;
  const es = SPANISH_HINTS.filter((h) => t.includes(h)).length;
  return en >= 2 && en > es;
}

function needsEnrichment(description: string | undefined): boolean {
  // Sin sinopsis original no hay nada de qué partir — no se inventa desde cero.
  if (!description) return false;
  if (description.length < 300) return true;
  return looksEnglish(description);
}

// ── Deno KV (cache de sinopsis, lazy init) ────────────────────────────────────
let kvPromise: Promise<Deno.Kv> | null = null;
function getKv(): Promise<Deno.Kv> {
  if (!kvPromise) kvPromise = Deno.openKv();
  return kvPromise;
}

// ── Llamadas a los proveedores de IA ──────────────────────────────────────────
// deno-lint-ignore no-explicit-any
function buildPrompt(meta: any, description: string): string {
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

async function callGemini(
  prompt: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal,
  });
  if (!r.ok) throw new Error(`Gemini respondió ${r.status}`);
  const d = await r.json();
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: sin texto en la respuesta");
  return String(text).trim();
}

async function callOpenRouter(
  prompt: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "user", content: prompt }],
    }),
    signal,
  });
  if (!r.ok) throw new Error(`OpenRouter respondió ${r.status}`);
  const d = await r.json();
  const text = d?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter: sin texto en la respuesta");
  return String(text).trim();
}

async function enrichSynopsis(
  imdbId: string,
  type: string,
  // deno-lint-ignore no-explicit-any
  meta: any,
  description: string,
): Promise<string | null> {
  const kv = await getKv();
  const key = ["synopsis", imdbId, type];
  const cached = await kv.get<string>(key);
  if (cached.value) return cached.value;

  const deadline = Date.now() + AI_BUDGET_MS;
  const prompt = buildPrompt(meta, description);

  let text: string | null = null;

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) {
    const remaining = deadline - Date.now();
    if (remaining > 500) {
      try {
        text = await callGemini(prompt, geminiKey, AbortSignal.timeout(remaining));
      } catch {
        // sigue al fallback de OpenRouter
      }
    }
  }

  if (!text) {
    const orKey = Deno.env.get("OPENROUTER_API_KEY");
    const remaining = deadline - Date.now();
    if (orKey && remaining > 500) {
      try {
        text = await callOpenRouter(prompt, orKey, AbortSignal.timeout(remaining));
      } catch {
        // ambos fallaron: se devuelve la sinopsis original sin tocar
      }
    }
  }

  if (text) {
    await kv.set(key, text, { expireIn: CACHE_TTL_MS });
  }
  return text;
}

// ── Servidor ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  const path = new URL(req.url).pathname;

  if (path === "/manifest.json") {
    return new Response(JSON.stringify(MANIFEST), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const metaMatch = path.match(/^\/meta\/(movie|series)\/(.+)\.json$/);
  if (metaMatch) {
    const [, type, rawId] = metaMatch;
    const imdbId = rawId.split(":")[0];

    // deno-lint-ignore no-explicit-any
    let meta: any;
    try {
      meta = await fetchAioMeta(type, rawId);
    } catch (e) {
      const fallback = await fetchCinemetaMeta(type, rawId);
      if (fallback) {
        return new Response(JSON.stringify({ meta: fallback }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ meta: null, error: (e as Error).message }),
        { status: 502, headers: cors },
      );
    }

    if (needsEnrichment(meta.description)) {
      try {
        const enriched = await enrichSynopsis(imdbId, type, meta, meta.description);
        if (enriched) meta.description = enriched;
      } catch {
        // se devuelve la sinopsis original de AIOMetadata sin tocar
      }
    }

    return new Response(JSON.stringify({ meta }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response("Not found", { status: 404, headers: cors });
});
