/**
 * deno-hub.ts — Hub único de Deno Deploy que consolida las 3 apps que antes
 * vivían separadas (mejorastremio, mejorastremio-latino) más el enriquecedor
 * de sinopsis que nunca se había deployado. Un solo Deno.serve que despacha
 * por prefijo de ruta a la lógica de cada uno — la lógica de negocio de cada
 * addon es la misma que en su script original (deno-subdl-addon.ts,
 * deno-latino-catalog-addon.ts, deno-synopsis-enricher.ts), solo cambia el
 * envoltorio de routing.
 *
 * Rutas:
 *   /subdl/manifest.json      → SubDL ES (sin SDH), subtítulos
 *   /latino/manifest.json     → Audio Latino (verificado), catálogo
 *   /synopsis/manifest.json   → MejoraStremio Synopsis IA, proxy de meta
 *   /miniseries/manifest.json → Miniseries (1 temporada, ≤10 episodios, finalizada), catálogo
 *   /health                   → estado de las 4 sub-funciones (config presente)
 *
 * Deploy: deno.com/deploy → conectar repo pabloeckert/MejoraStremio →
 *   entry point: scripts/deno-hub.ts
 *   env vars (Secret): SUBDL_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, TMDB_API_KEY_AISEARCH
 *   opcionales: GEMINI_MODEL, OPENROUTER_MODEL
 *
 * Instalar en Stremio (por función):
 *   https://<proyecto>.deno.dev/subdl/manifest.json
 *   https://<proyecto>.deno.dev/latino/manifest.json
 *   https://<proyecto>.deno.dev/synopsis/manifest.json
 *   https://<proyecto>.deno.dev/miniseries/manifest.json
 *
 * Los 3 `manifest.id` se mantienen idénticos a los de los scripts originales
 * (com.mejorastremio.subdl / com.mejorastremio.latino-catalog /
 * com.mejorastremio.synopsis-proxy) — así, al migrar los addons ya instalados,
 * update-addon-url.mjs solo cambia el transportUrl, sin duplicar la entrada.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...cors, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

// ════════════════════════════════════════════════════════════════════════
// ── /subdl — SubDL ES (sin SDH), subtítulos ───────────────────────────────
// Lógica idéntica a deno-subdl-addon.ts.
// ════════════════════════════════════════════════════════════════════════

const SUBDL_KEY = Deno.env.get("SUBDL_KEY") ?? "";
const SUBDL_API = "https://api.subdl.com/api/v1/subtitles";
const SUBDL_DL = "https://dl.subdl.com";

const SUBDL_MANIFEST = {
  id: "com.mejorastremio.subdl",
  version: "1.0.0",
  name: "SubDL ES (sin SDH)",
  description:
    "Subtítulos en español de SubDL. Filtra hearing-impaired (SDH) automáticamente.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

async function extractSrtFromZip(buf: Uint8Array): Promise<string | null> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 0;
  while (i < buf.length - 30) {
    if (
      buf[i] === 0x50 && buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x03 && buf[i + 3] === 0x04
    ) {
      const method = view.getUint16(i + 8, true);
      const cSize = view.getUint32(i + 18, true);
      const fnLen = view.getUint16(i + 26, true);
      const exLen = view.getUint16(i + 28, true);
      const fn = new TextDecoder().decode(buf.subarray(i + 30, i + 30 + fnLen));
      const dataStart = i + 30 + fnLen + exLen;

      if (
        fn.toLowerCase().endsWith(".srt") &&
        cSize > 0 &&
        dataStart + cSize <= buf.length
      ) {
        const data = buf.subarray(dataStart, dataStart + cSize);
        try {
          if (method === 0) {
            return new TextDecoder("utf-8").decode(data);
          }
          const ds = new DecompressionStream("deflate-raw");
          const writer = ds.writable.getWriter();
          await writer.write(new Uint8Array(data));
          await writer.close();
          const chunks: Uint8Array[] = [];
          const reader = ds.readable.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const result = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { result.set(c, off); off += c.length; }
          return new TextDecoder("utf-8").decode(result);
        } catch { /* intentar siguiente entrada */ }
      }
      i = dataStart + (cSize || 1);
    } else {
      i++;
    }
  }
  return null;
}

interface SubdlSub { name: string; subdlPath: string }

async function fetchSubdlSubs(
  imdbId: string,
  season: number | null,
  episode: number | null,
): Promise<SubdlSub[]> {
  let url =
    `${SUBDL_API}?api_key=${SUBDL_KEY}&imdb_id=${imdbId}&languages=ES&subs_per_page=20`;
  if (season != null) url += `&season=${season}`;
  if (episode != null) url += `&episode=${episode}`;

  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) return [];
  const d = await r.json();

  // deno-lint-ignore no-explicit-any
  return ((d?.subtitles ?? []) as any[])
    .filter((s) => (s.language ?? "").toUpperCase() === "ES" && s.hi === false)
    .map((s) => ({
      name: s.name || s.release_name || "SubDL ES",
      subdlPath: s.url as string,
    }));
}

// subPath: la ruta sin el prefijo /subdl (ej "/manifest.json", "/srt/xxx").
// mountBase: origin + "/subdl" — para que los links generados (srt) vuelvan a
// pasar por el router del hub.
async function handleSubdl(subPath: string, mountBase: string): Promise<Response> {
  if (!SUBDL_KEY) {
    return new Response(
      "SUBDL_KEY no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(SUBDL_MANIFEST);
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, type, rawId] = subMatch;
    const parts = rawId.split(":");
    const imdbId = parts[0];
    const season = type === "series" && parts[1] ? parseInt(parts[1], 10) : null;
    const episode = type === "series" && parts[2] ? parseInt(parts[2], 10) : null;

    try {
      const subs = await fetchSubdlSubs(imdbId, season, episode);
      const subtitles = subs.map((s, idx) => ({
        id: `subdl-${idx}-${imdbId}`,
        url: `${mountBase}/srt/${encodeURIComponent(s.subdlPath)}`,
        lang: "spa",
        name: `[SubDL] ${s.name.replace(/\.(zip|srt)$/i, "")}`,
      }));
      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const srtMatch = subPath.match(/^\/srt\/(.+)$/);
  if (srtMatch) {
    const subdlPath = decodeURIComponent(srtMatch[1]);
    const dlUrl = subdlPath.startsWith("http") ? subdlPath : `${SUBDL_DL}${subdlPath}`;

    // Guard anti-SSRF: dlUrl viene de un path que el cliente controla (encodeURIComponent en el
    // manifest de subtitles, arriba). Sin este chequeo, cualquiera puede pedir
    // /subdl/srt/http://cualquier-host y este endpoint actúa de proxy HTTP abierto no
    // autenticado hacia esa URL. Los subtítulos reales siempre vienen de dl.subdl.com — cualquier
    // otro host se rechaza.
    let dlHost: string;
    try {
      dlHost = new URL(dlUrl).hostname;
    } catch {
      return new Response("URL inválida", { status: 400, headers: cors });
    }
    if (dlHost !== "dl.subdl.com") {
      return new Response("Host no permitido", { status: 400, headers: cors });
    }

    try {
      const r = await fetch(dlUrl, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) {
        return new Response("SubDL error: " + r.status, { status: 502, headers: cors });
      }
      const buf = new Uint8Array(await r.arrayBuffer());
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      const srtText = isZip ? await extractSrtFromZip(buf) : new TextDecoder().decode(buf);

      if (!srtText) {
        return new Response("No se encontró SRT en el ZIP", { status: 502, headers: cors });
      }
      return new Response(srtText, {
        headers: {
          ...cors,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="sub.srt"',
        },
      });
    } catch (e) {
      return new Response("Error descargando: " + (e as Error).message, { status: 502, headers: cors });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ════════════════════════════════════════════════════════════════════════
// ── /latino — Audio Latino (verificado), catálogo ─────────────────────────
// Lógica idéntica a deno-latino-catalog-addon.ts.
// ════════════════════════════════════════════════════════════════════════

const LATINO_LOG_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/anti-frustration-log.json";
const CINEMETA = "https://v3-cinemeta.strem.io";

const LATINO_MANIFEST = {
  id: "com.mejorastremio.latino-catalog",
  version: "1.0.0",
  name: "Audio Latino (verificado)",
  description:
    "Catálogo de contenido familiar/infantil con audio latino confirmado " +
    "por scripts/anti-frustration.mjs — solo títulos con streams reales.",
  resources: ["catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    { type: "movie", id: "latino-movies", name: "Audio Latino (verificado)" },
    { type: "series", id: "latino-series", name: "Audio Latino (verificado)" },
  ],
};

// deno-lint-ignore no-explicit-any
type LogEntry = any;

let latinoCache: { at: number; entries: LogEntry[] } | null = null;
const LATINO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

async function loadLatinoLog(): Promise<LogEntry[]> {
  if (latinoCache && Date.now() - latinoCache.at < LATINO_CACHE_TTL_MS) return latinoCache.entries;
  const r = await fetch(`${LATINO_LOG_URL}?_=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
  const entries = r.ok ? await r.json() : [];
  latinoCache = { at: Date.now(), entries };
  return entries;
}

async function posterFor(id: string, type: string): Promise<string | null> {
  try {
    const r = await fetch(`${CINEMETA}/meta/${type}/${id}.json`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.meta?.poster ?? null;
  } catch {
    return null;
  }
}

async function handleLatino(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(LATINO_MANIFEST);
  }

  const catMatch = subPath.match(/^\/catalog\/(movie|series)\/latino-(movies|series)\.json$/);
  if (catMatch) {
    const [, type] = catMatch;
    const entries = await loadLatinoLog();
    const filtered = entries.filter((e: LogEntry) => e.type === type && e.isFamily && e.latino?.found);

    const metas = await Promise.all(
      filtered.map(async (e: LogEntry) => ({
        id: e.id,
        type: e.type,
        name: e.label || e.name,
        poster: await posterFor(e.id, e.type),
      })),
    );

    return jsonResponse({ metas });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ════════════════════════════════════════════════════════════════════════
// ── /synopsis — MejoraStremio Synopsis IA, proxy de meta ──────────────────
// Lógica idéntica a deno-synopsis-enricher.ts.
// ════════════════════════════════════════════════════════════════════════

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-lite-latest";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const AIOMETADATA_BASE = "https://aiometadata.elfhosted.com";
const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
const PRESET_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/preset.json";

const AI_BUDGET_MS = 4000;
const SYNOPSIS_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

const SYNOPSIS_MANIFEST = {
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

// deno-lint-ignore no-explicit-any
async function fetchAioMeta(type: string, rawId: string): Promise<any> {
  const instanceId = await getInstanceId();
  const url = `${AIOMETADATA_BASE}/stremio/${instanceId}/meta/${type}/${rawId}.json`;
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
  if (!description) return false;
  if (description.length < 300) return true;
  return looksEnglish(description);
}

let kvPromise: Promise<Deno.Kv> | null = null;
function getKv(): Promise<Deno.Kv> {
  if (!kvPromise) kvPromise = Deno.openKv();
  return kvPromise;
}

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

async function callGemini(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
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

async function callOpenRouter(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: "user", content: prompt }] }),
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
  const key = ["synopsis", imdbId, type];
  // KV es solo cache (90 días) — si no está disponible (ej. no hay database
  // asignada a la app), el enriquecimiento debe seguir funcionando igual,
  // solo sin cachear entre requests.
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
        // sigue al fallback de OpenRouter
      }
    }
  }

  if (!text && OPENROUTER_API_KEY) {
    const remaining = deadline - Date.now();
    if (remaining > 500) {
      try {
        text = await callOpenRouter(prompt, OPENROUTER_API_KEY, AbortSignal.timeout(remaining));
      } catch {
        // ambos fallaron: se devuelve la sinopsis original sin tocar
      }
    }
  }

  if (text && kv) {
    try {
      await kv.set(key, text, { expireIn: SYNOPSIS_CACHE_TTL_MS });
    } catch {
      // sin cache, no es crítico
    }
  }
  return text;
}

async function handleSynopsis(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(SYNOPSIS_MANIFEST);
  }

  const metaMatch = subPath.match(/^\/meta\/(movie|series)\/(.+)\.json$/);
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
        return jsonResponse({ meta: fallback });
      }
      return jsonResponse({ meta: null, error: (e as Error).message }, { status: 502 });
    }

    if (needsEnrichment(meta.description)) {
      try {
        const enriched = await enrichSynopsis(imdbId, type, meta, meta.description);
        if (enriched) meta.description = enriched;
      } catch {
        // se devuelve la sinopsis original de AIOMetadata sin tocar
      }
    }

    return jsonResponse({ meta });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ════════════════════════════════════════════════════════════════════════
// ── /miniseries — 1 temporada, ≤10 episodios, finalizada (catálogo) ───────
// TMDB Discover TV no soporta filtrar por temporadas/episodios (confirmado
// contra su doc oficial) — se arma en dos pasos: Discover trae candidatos
// por popularidad+status=Ended, y un fetch de detalle por título filtra por
// number_of_seasons/number_of_episodes. Requiere bastantes llamadas a TMDB
// por refresh, por eso se cachea agresivo (12h) y se acota el trabajo por
// request con un presupuesto de tiempo (deja lo que ya juntó si se pasa).
// ════════════════════════════════════════════════════════════════════════

const TMDB_KEY = Deno.env.get("TMDB_API_KEY_AISEARCH") ?? "";
const TMDB_API = "https://api.themoviedb.org/3";

const MINISERIES_MANIFEST = {
  id: "com.mejorastremio.miniseries",
  version: "1.0.0",
  name: "Miniseries",
  description:
    "Series de 1 sola temporada, 10 episodios o menos, finalizadas — armado " +
    "vía TMDB Discover + filtro de detalle (Discover no soporta este filtro " +
    "directo).",
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
        // Nombres tal cual los devuelve TMDB (genre/tv/list?language=es-ES) — mezcla
        // inglés/español real de TMDB, no una traducción nuestra (mismo mix que ya
        // se ve en los catálogos de AIOMetadata, ver CLAUDE.md "Metadata en español").
        // Deben calzar exacto con detail.genres[].name para que el filtro matchee.
        options: [
          "None",
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

interface MiniseriesMeta {
  id: string;
  type: "series";
  name: string;
  poster: string | null;
  description: string;
  genres: string[];
}

let miniseriesCache: { at: number; metas: MiniseriesMeta[]; partial: boolean } | null = null;
const MINISERIES_FULL_TTL_MS = 12 * 60 * 60 * 1000; // 12h si el barrido terminó completo
const MINISERIES_PARTIAL_TTL_MS = 60 * 60 * 1000; // 1h si se cortó por presupuesto
const MINISERIES_BUDGET_MS = 20000;
const MINISERIES_DISCOVER_PAGES = 2;

// deno-lint-ignore no-explicit-any
async function tmdbGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params });
  const r = await fetch(`${TMDB_API}${path}?${qs}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`TMDB ${path} respondió ${r.status}`);
  return await r.json();
}

async function buildMiniseriesCatalog(): Promise<{ metas: MiniseriesMeta[]; partial: boolean }> {
  const deadline = Date.now() + MINISERIES_BUDGET_MS;
  const candidates: number[] = [];

  for (let page = 1; page <= MINISERIES_DISCOVER_PAGES; page++) {
    if (Date.now() > deadline) return { metas: [], partial: true };
    try {
      const d = await tmdbGet("/discover/tv", {
        sort_by: "popularity.desc",
        with_status: "3",
        "vote_count.gte": "20",
        language: "es-ES",
        page: String(page),
      });
      // deno-lint-ignore no-explicit-any
      for (const s of (d?.results ?? []) as any[]) candidates.push(s.id);
    } catch {
      break; // se sigue con lo que ya se juntó
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
        });
      }
    } catch {
      // se salta este candidato, sigue con el resto
    }
  }

  return { metas, partial };
}

async function getMiniseriesCatalog(): Promise<MiniseriesMeta[]> {
  const ttl = miniseriesCache?.partial ? MINISERIES_PARTIAL_TTL_MS : MINISERIES_FULL_TTL_MS;
  if (miniseriesCache && Date.now() - miniseriesCache.at < ttl) return miniseriesCache.metas;

  const stale = miniseriesCache?.metas ?? [];
  try {
    const { metas, partial } = await buildMiniseriesCatalog();
    // si el barrido no encontró nada útil, mejor devolver lo viejo que una lista vacía
    if (metas.length === 0 && stale.length > 0) return stale;
    miniseriesCache = { at: Date.now(), metas, partial };
    return metas;
  } catch {
    return stale;
  }
}

async function handleMiniseries(subPath: string): Promise<Response> {
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
        if (genre && genre !== "None") metas = metas.filter((m) => m.genres.includes(genre));
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

// ════════════════════════════════════════════════════════════════════════
// ── /health — estado de config de las 4 sub-funciones ─────────────────────
// ════════════════════════════════════════════════════════════════════════

function handleHealth(): Response {
  return jsonResponse({
    hub: "mejorastremio-hub",
    timestamp: new Date().toISOString(),
    subdl: { configured: !!SUBDL_KEY },
    latino: { configured: true },
    synopsis: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      geminiConfigured: !!GEMINI_API_KEY,
      openrouterConfigured: !!OPENROUTER_API_KEY,
    },
    miniseries: { configured: !!TMDB_KEY },
  });
}

// ════════════════════════════════════════════════════════════════════════
// ── Router ──────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname;
  const started = Date.now();
  let route = "unknown";
  let res: Response;

  try {
    if (path === "/" || path === "") {
      route = "root";
      res = jsonResponse({
        hub: "mejorastremio-hub",
        routes: [
          "/subdl/manifest.json",
          "/latino/manifest.json",
          "/synopsis/manifest.json",
          "/miniseries/manifest.json",
          "/health",
        ],
      });
    } else if (path === "/health") {
      route = "health";
      res = handleHealth();
    } else if (path.startsWith("/subdl")) {
      route = "subdl";
      const subPath = path.slice("/subdl".length) || "/";
      res = await handleSubdl(subPath, `${url.origin}/subdl`);
    } else if (path.startsWith("/latino")) {
      route = "latino";
      const subPath = path.slice("/latino".length) || "/";
      res = await handleLatino(subPath);
    } else if (path.startsWith("/synopsis")) {
      route = "synopsis";
      const subPath = path.slice("/synopsis".length) || "/";
      res = await handleSynopsis(subPath);
    } else if (path.startsWith("/miniseries")) {
      route = "miniseries";
      const subPath = path.slice("/miniseries".length) || "/";
      res = await handleMiniseries(subPath);
    } else {
      res = new Response("Not found", { status: 404, headers: cors });
    }
  } catch (e) {
    res = jsonResponse({ error: (e as Error).message }, { status: 500 });
  }

  // Logging centralizado por ruta.
  console.log(`[hub] ${route} ${req.method} ${path} -> ${res.status} (${Date.now() - started}ms)`);
  return res;
});
