import { Hono } from "hono";
import { cors } from "hono/middleware";
import { callGemini, buildTranslateSystemPrompt, NL } from "../translate/gemini.ts";
import { parseStremioSubId } from "../utils/common.ts";
import { pushDualSubtitles, type SubtitleTrackPayload } from "./smartsync.ts";

export const subtitlesApp = new Hono();

// Habilitar CORS amplio para Stremio Core (Android TV / Web / Desktop)
subtitlesApp.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));

export const SUBTITLES_APP_MANIFEST = {
  id: "com.mejorastremio.subtitles",
  version: "1.4.0",
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
export function cleanCueForTranslation(text: string): string {
  if (!text) return "";
  return text
    // Elimina acotaciones sonoras entre corchetes: [música], [sighs], [gritos]
    .replace(/\[[^\]]*\]/g, "")
    // Elimina acotaciones sonoras entre paréntesis: (sonnerie), (risas)
    .replace(/\([^)]*\)/g, "")
    // Elimina notas musicales y símbolos especiales
    .replace(/[♪♫#¶]/g, "")
    // Elimina prefijos de hablante en mayúsculas: "MORGANE:", "KARADEC:", "- LUDWIG:"
    .replace(/^[-–—•]?\s*[A-ZÁÉÍÓÚÑÀÂÇÉÈÊËÎÏÔÙÛÜŸ0-9\s._-]{2,30}:\s*/gm, "")
    // Normaliza espacios en blanco duplicados
    .replace(/[ \t]+/g, " ")
    .trim();
}

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

  const [subdlSubs, osSubs, subsrcSubs, wyzieSubs] = await Promise.all([
    fetchSubDL(imdbId, season, episode),
    fetchOpenSubtitlesV3(imdbId, season, episode),
    fetchSubSource(imdbId),
    fetchWyzieSubs(imdbId, season, episode),
  ]);

  const rawCandidates = [...subdlSubs, ...osSubs, ...subsrcSubs, ...wyzieSubs];
  const cleanCandidates = filterNonSDH(sanitizeLatinSpanishTracks(rawCandidates));

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
      label: "⚡ 1. Latino (IA Gemini) · [Traducción Automática]",
      name: "⚡ 1. Latino (IA Gemini) · [Traducción Automática]",
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
