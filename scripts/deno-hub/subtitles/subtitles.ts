import { Hono } from "hono";
import { cors } from "hono/middleware";
import { callGemini, buildTranslateSystemPrompt, NL, cleanCueForTranslation } from "../translate/gemini.ts";
import { parseStremioSubId, releaseSimilarity } from "../utils/common.ts";
import { pushDualSubtitles, type SubtitleTrackPayload } from "./smartsync.ts";
import { getOrSetSwrCache } from "../streams/mediaflow.ts";
import { recordScraperLatency } from "../telemetry.ts";

export { cleanCueForTranslation };

export const subtitlesApp = new Hono();

// Habilitar CORS amplio para Stremio Core (Android TV / Web / Desktop)
subtitlesApp.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));

export const SUBTITLES_APP_MANIFEST = {
  id: "com.mejorastremio.subtitles",
  version: "1.4.2",
  name: "MejoraStremio Subtítulos (Multi-Fuente + IA)",
  description: "Ingesta multi-fuente de SubDL, OpenSubtitles v3, SubSource, Wyzie y Traducción IA Gemini Flash sin SDH.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  languages: ["spl", "spa", "es-419"],
};

// ============================================================================
// 1. PURGA Y HIGIENE ANTI-SDH (HEARING IMPAIRED / NOISE REMOVAL)
// ============================================================================

// deno-lint-ignore no-explicit-any
export function filterNonSDH(subtitles: any[]): any[] {
  // deno-lint-ignore no-explicit-any
  return subtitles.filter((sub: any) => {
    if (sub.hearing_impaired || sub.sdh || sub.hi === "1" || sub.hi === true) return false;
    const nameLower = (sub.name || sub.filename || sub.label || "").toLowerCase();
    if (nameLower.includes(".sdh.") || nameLower.includes("sdh") || nameLower.includes("hearing impaired")) {
      return false;
    }
    return true;
  });
}

// ============================================================================
// 2. SANITIZACIÓN REGIONAL (ESPAÑOL LATINO es-419)
// ============================================================================
// deno-lint-ignore no-explicit-any
export function sanitizeLatinSpanishTracks(rawTracks: any[]): any[] {
  // deno-lint-ignore no-explicit-any
  return rawTracks.filter((track: any) => {
    const lang = (track.lang || track.language || "").toLowerCase();
    if (lang === "es-es" || lang === "spanish" || lang === "castellano") return false;
    return ["es-419", "spl", "spa-lat", "es-mx", "es-ar", "pob", "spa"].includes(lang);
  });
}

export async function withScraperTimeout<T>(
  promise: Promise<T[]>,
  timeoutMs = 450,
  scraperName?: string
): Promise<T[]> {
  const start = Date.now();
  let timerId: number | undefined;
  try {
    const timeoutPromise = new Promise<T[]>((resolve) => {
      // @ts-ignore timer
      timerId = setTimeout(() => {
        if (scraperName) {
          recordScraperLatency(scraperName, timeoutMs, true);
        }
        resolve([]);
      }, timeoutMs);
    });

    const result = await Promise.race([
      promise.then((res) => {
        if (timerId !== undefined) clearTimeout(timerId);
        if (scraperName) {
          recordScraperLatency(scraperName, Date.now() - start, false);
        }
        return res;
      }),
      timeoutPromise,
    ]);
    return result;
  } catch {
    if (timerId !== undefined) clearTimeout(timerId);
    if (scraperName) {
      recordScraperLatency(scraperName, Date.now() - start, false);
    }
    return [];
  }
}

// ============================================================================
// 3. INGESTA MULTI-FUENTE DE REPOSITORIOS SEGUROS
// ============================================================================
// A) SubDL API v2 (Filtro hi=0)
export async function fetchSubDL(imdbId: string, season?: number, episode?: number) {
  const apiKey = Deno.env.get("SUBDL_API_KEY");
  if (!apiKey) return [];
  try {
    let url = `https://api.subdl.com/api/v2/subtitles?imdb_id=${imdbId}&languages=es&hi=0&unpack=1`;
    if (season && episode) url += `&season=${season}&episode=${episode}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    return (data.subtitles || []).map((sub: any) => ({
      id: `subdl-${sub.sd_id}`,
      url: sub.url,
      lang: "es-419",
      name: `⚡ 1. Latino (SubDL) · ${sub.release_name || "WEB-DL"}`,
      hi: false,
    }));
  } catch {
    return [];
  }
}

// B) OpenSubtitles REST API v3 (Excluye Machine Translation y SDH)
export async function fetchOpenSubtitlesV3(imdbId: string, season?: number, episode?: number) {
  try {
    let url = `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${imdbId.replace("tt", "")}&languages=es-MX,es-419,pob&hearing_impaired=false&machine_translated=exclude`;
    if (season && episode) url += `&season_number=${season}&episode_number=${episode}`;
    const res = await fetch(url, {
      headers: {
        "Api-Key": Deno.env.get("OPENSUBTITLES_API_KEY") || "",
        "User-Agent": "MejoraStremioHub v1.4.0",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    return (data.data || []).map((item: any) => ({
      id: `os-${item.id}`,
      url: item.attributes.files?.[0]?.link,
      lang: "es-419",
      name: `🎬 Latino (OpenSubtitles v3) · ${item.attributes.release || "HD"}`,
      hi: item.attributes.hearing_impaired,
    }));
  } catch {
    return [];
  }
}

// C) SubSource API (Comunitaria)
export async function fetchSubSource(imdbId: string) {
  const apiKey = Deno.env.get("SUBSOURCE_API_KEY");
  if (!apiKey) return [];
  try {
    const res = await fetch(`https://api.subsource.net/v1/subtitles?imdb_id=${imdbId}&language=spanish`, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    return (data.subtitles || []).map((s: any) => ({
      id: `subsrc-${s.id}`,
      url: s.download_url,
      lang: "es-419",
      name: `📡 Latino (SubSource) · ${s.release}`,
      hi: false,
    }));
  } catch {
    return [];
  }
}

// D) Wyzie Subs API
export async function fetchWyzieSubs(imdbId: string, season?: number, episode?: number) {
  const apiKey = Deno.env.get("WYZIE_API_KEY");
  try {
    let url = `https://sub.wyzie.ru/search?id=${imdbId}&language=es&sdh=false`;
    if (season && episode) url += `&season=${season}&episode=${episode}`;
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    return (data || []).map((w: any) => ({
      id: `wyzie-${w.id}`,
      url: w.url,
      lang: "es-419",
      name: `🔍 Latino (Wyzie) · ${w.display_name}`,
      hi: false,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// 4. MOTOR DE TRADUCCIÓN IA GEMINI FLASH (<1.5s FAST-WINDOW)
// ============================================================================
export async function translateCuesWithGemini(cues: string[], title: string): Promise<string[]> {
  if (!cues || cues.length === 0) return [];
  const cleaned = cues.map((c) => cleanCueForTranslation(c));
  const prompt = buildTranslateSystemPrompt(title, "en");
  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("OPENROUTER_API_KEY") || "";
  if (!apiKey) return cleaned;

  const numberedLines = cleaned
    .map((c, i) => `${i + 1}▸ ${c.replace(/\n/g, NL)}`)
    .join("\n");

  try {
    const rawReply = await callGemini(
      `${prompt}\n\nLÍNEAS A TRADUCIR:\n${numberedLines}`,
      apiKey,
      AbortSignal.timeout(3500),
    );
    const translatedMap = new Map<number, string>();
    for (const line of rawReply.split("\n")) {
      const m = line.match(/^(\d+)[\s▸.:\-]+(.*)$/);
      if (m) {
        const idx = parseInt(m[1], 10);
        translatedMap.set(idx, m[2].replace(new RegExp(NL, "g"), "\n").trim());
      }
    }
    return cleaned.map((c, i) => translatedMap.get(i + 1) || c);
  } catch {
    return cleaned;
  }
}

// ============================================================================
// 5. ENRUTADOR HONO Y AGREGADOR DE SUBTÍTULOS STREMIO
// ============================================================================

subtitlesApp.get("/manifest.json", (c) => c.json(SUBTITLES_APP_MANIFEST));

subtitlesApp.get("/subtitles/:type/:id", async (c) => {
  const type = c.req.param("type");
  const rawId = c.req.param("id");
  const reqUrl = new URL(c.req.url);
  return await handleSubtitlesRoute(type, rawId, reqUrl);
});

subtitlesApp.get("/:config/subtitles/:type/:id", async (c) => {
  const type = c.req.param("type");
  const rawId = c.req.param("id");
  const reqUrl = new URL(c.req.url);
  return await handleSubtitlesRoute(type, rawId, reqUrl);
});

async function handleSubtitlesRoute(_type: string, rawId: string, reqUrl: URL): Promise<Response> {
  const parsed = parseStremioSubId(rawId);
  const imdbId = parsed.imdbId;
  const season = parsed.season ?? undefined;
  const episode = parsed.episode ?? undefined;

  // Control de Latencia y Caché: SWR en Deno KV (5-15 min) + timeout de 450 ms por scraper
  const cacheKey = ["subtitles_agg_v142", imdbId, season ?? 0, episode ?? 0];
  const rawCandidates = await getOrSetSwrCache(
    cacheKey,
    async () => {
      const results = await Promise.allSettled([
        withScraperTimeout(fetchSubDL(imdbId, season, episode), 450, "subdl"),
        withScraperTimeout(fetchOpenSubtitlesV3(imdbId, season, episode), 450, "opensubtitles"),
        withScraperTimeout(fetchSubSource(imdbId), 450, "subsource"),
        withScraperTimeout(fetchWyzieSubs(imdbId, season, episode), 450, "wyziesubs"),
      ]);
      return results.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
    },
    15 * 60 * 1000,
    5 * 60 * 1000,
  );

  const cleanCandidates = filterNonSDH(sanitizeLatinSpanishTracks(rawCandidates));

  // Pre-selección por metadatos del cliente (filename, bytesize, videoHash)
  if (parsed.filename || parsed.videoHash || parsed.videoSize) {
    cleanCandidates.sort((a, b) => {
      if (parsed.videoHash) {
        const aHash = (a.videoHash || "").toLowerCase();
        const bHash = (b.videoHash || "").toLowerCase();
        const targetHash = parsed.videoHash.toLowerCase();
        if (aHash && aHash === targetHash && bHash !== targetHash) return -1;
        if (bHash && bHash === targetHash && aHash !== targetHash) return 1;
      }
      if (parsed.videoSize && a.bytesize && b.bytesize) {
        const diffA = Math.abs(a.bytesize - parsed.videoSize);
        const diffB = Math.abs(b.bytesize - parsed.videoSize);
        if (diffA !== diffB) return diffA - diffB;
      }
      const simA = releaseSimilarity(parsed.filename || "", a.name || a.filename || "");
      const simB = releaseSimilarity(parsed.filename || "", b.name || b.filename || "");
      return simB - simA;
    });
  }

  const subtitles: SubtitleTrackPayload[] = [];

  for (const track of cleanCandidates) {
    if (!track.url) continue;
    pushDualSubtitles(subtitles, {
      id: track.id,
      url: track.url,
      label: track.name,
      name: track.name,
    }, true);
  }

  // Garantía universal anti-array vacío: si no hay subtítulos comunitarios,
  // inyectar subtítulo sintético IA garantizado
  if (subtitles.length === 0) {
    const origin = reqUrl.origin;
    pushDualSubtitles(subtitles, {
      id: "ia-fallback-synthetic",
      url: `${origin}/translate/gen/fallback.srt`,
      label: "⚡ 1. Latino (IA Gemini) · [Traducción IA]",
      name: "⚡ 1. Latino (IA Gemini) · [Traducción IA]",
    }, true);
  }

  return new Response(JSON.stringify({ subtitles }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
      "Pragma": "no-cache",
    },
  });
}
