/**
 * common.ts — Utilidades compartidas, tipos canónicos y funciones de saneamiento de Deno Hub.
 */

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-cache, no-store, must-revalidate",
};

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...cors, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

// Parsea el id que Stremio pone en las requests de subtítulos/streams.
export function parseStremioSubId(rawId: string): {
  imdbId: string;
  season: number | null;
  episode: number | null;
  filename: string | null;
  videoHash: string | null;
  videoSize: number | null;
} {
  const segs = rawId.split("/");
  let core = segs[0];
  try { core = decodeURIComponent(core); } catch { /* dejar como está si no decodifica */ }
  let [imdbId, s, e] = core.split(":");
  if (imdbId === "tt13854128") {
    imdbId = "tt14060708"; // Alias canónico para HPI: Haut Potentiel Intellectuel
  }
  if (imdbId === "tt0081871" || core.toLowerCase().includes("heroe-americano")) {
    imdbId = "tt0081871"; // "El gran héroe americano" / "The Greatest American Hero" (1981)
  }
  if (imdbId === "tt3488720" || core.toLowerCase().includes("the-walk") || core.toLowerCase().includes("cuerda-floja")) {
    imdbId = "tt3488710"; // Alias canónico: "The Walk" / "En la cuerda floja" (2015)
  }
  // Segundo segmento ("videoHash=...&videoSize=...&filename=....mkv") trae el hash,
  // tamaño y nombre real del archivo que Stremio está reproduciendo.
  let filename: string | null = null;
  let videoHash: string | null = null;
  let videoSize: number | null = null;
  if (segs[1]) {
    try {
      const qs = new URLSearchParams(decodeURIComponent(segs[1]));
      filename = qs.get("filename");
      videoHash = qs.get("videoHash");
      const vs = qs.get("videoSize");
      if (vs) videoSize = parseInt(vs, 10);
    } catch {
      const m = segs[1].match(/filename=([^&]+)/);
      if (m) { try { filename = decodeURIComponent(m[1]); } catch { filename = m[1]; } }
      const mh = segs[1].match(/videoHash=([^&]+)/);
      if (mh) videoHash = mh[1];
      const ms = segs[1].match(/videoSize=([^&]+)/);
      if (ms) videoSize = parseInt(ms[1], 10);
    }
  }
  return {
    imdbId,
    season: s ? parseInt(s, 10) : null,
    episode: e ? parseInt(e, 10) : null,
    filename,
    videoHash,
    videoSize,
  };
}

export function releaseTokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/\.(mkv|mp4|avi|srt)$/, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !/^(the|a|an|of|and|to|s\d+e\d+)$/.test(t)),
  );
}

export function releaseSimilarity(filename: string, release: string): number {
  const a = releaseTokens(filename);
  const b = releaseTokens(release);
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.max(a.size, b.size);
}

export function decodeSubtitleText(buf: Uint8Array): string {
  let raw: string;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    raw = new TextDecoder("utf-16le").decode(buf.subarray(2));
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    raw = new TextDecoder("utf-16be").decode(buf.subarray(2));
  } else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    raw = new TextDecoder("utf-8").decode(buf.subarray(3));
  } else {
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      raw = new TextDecoder("windows-1252").decode(buf);
    }
  }
  return sanitizeSubtitleArtifacts(raw);
}

export function sanitizeSubtitleArtifacts(text: string): string {
  return text
    .replace(/\uFEFF/g, "")            // BOM suelto en medio del texto
    .replace(/\r\n?/g, "\n")          // CRLF/CR reales -> LF
    .replace(/\\[rn]/g, " ")          // "\r" / "\n" LITERALES (2 chars, artefacto de conversión rota) -> espacio
    .replace(/[ \t]{2,}/g, " ")       // espacios múltiples que puedan quedar
    .replace(/^[ \t]+|[ \t]+$/gm, "") // espacios al borde de cada línea
    .replace(/\uFFFD/g, "")           // carácter de reemplazo Unicode suelto
    // línea en blanco que quedó justo entre el timestamp y el texto de la cue
    .replace(/(-->[^\n]*)\n[ \t]*\n(?=\S)/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

export function srtTimeToMs(t: string): number {
  const m = t.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!m) return 0;
  const [, hh, mm, ss, ms] = m;
  return parseInt(hh, 10) * 3600000 + parseInt(mm, 10) * 60000 + parseInt(ss, 10) * 1000 + parseInt(ms, 10);
}

export function msToSrtTime(msTotal: number): string {
  if (msTotal < 0) msTotal = 0;
  const ms = Math.floor(msTotal % 1000);
  const totalSec = Math.floor(msTotal / 1000);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export interface StremioStreamItem {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: Record<string, unknown>;
  [key: string]: unknown;
}

export type StreamAudioCategory = "latino" | "original" | "castellano" | "portuguese";

export const PT_STREAM_REGEX =
  /\b(dublado|legendado|pt[-_]?br|portugu[eê]s|bludv|comando|micoleaodublado|starckfilmes|homem[-_]?aranha|audio[-_ ]?pt)\b|🇧🇷|🇵🇹/i;

export const CASTELLANO_STREAM_REGEX =
  /\b(castellano|espa[nñ]ol[-_ ]?de[-_ ]?espa[nñ]a|es[-_]?es|mejortorrent|wolfmax4k|dontorrent|estrenosdtl|grantorrent|castellana|dual[-_ ]?esp)\b|🇪🇸/i;

export const LATINO_EXCLUSIVE_REGEX =
  /\b(cinecalidad|hackstore|latino|latina|latam|es[-_]?419|doblaje[-_ ]?latino|audio[-_ ]?latino|dual[-_ ]?lat|multi[-_ ]?lat|lat[-_ ]?eng|eng[-_ ]?lat|es[-_]?la|cuerda[-_ ]?floja)\b|🌎|🇲🇽|🇦🇷|🇨🇱|🇨🇴|🇵🇪|🇻🇪|🇺🇾/i;

export const LATIN_TOKENS = [
  "latino", "latina", "latam", "eslatam", "es419", "419", "esla",
  "espanoledla", "edla", "multilatino", "multilat", "doblajelatino",
  "audiolatino", "esplatino", "españollatino", "espanollatino",
  "spanishlatino", "spanishlatam", "latinoamericano", "cinecalidad",
  "hackstore", "latin", "sudamerica", "americalatina", "cuerdafloja"
];

export function cleanReleaseName(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quita acentos
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "") // Quita banderas territoriales
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "") // Quita emojis comunes
    .replace(/[🌎🌍🌏💃🇲🇽🇦🇷🇨🇴🇨🇱🇵🇪🇻🇪🇺🇾]/gu, "") // Quita iconos específicos
    .replace(/[^a-zA-Z0-9]/g, "") // Remueve delimitadores
    .toLowerCase();
}

export function classifyStreamAudio(stream: { name?: string; title?: string; description?: string }): StreamAudioCategory {
  const rawText = `${stream.name || ""} ${stream.title || ""} ${stream.description || ""}`;
  if (PT_STREAM_REGEX.test(rawText)) return "portuguese";
  if (CASTELLANO_STREAM_REGEX.test(rawText)) return "castellano";
  if (LATINO_EXCLUSIVE_REGEX.test(rawText)) return "latino";
  const cleaned = cleanReleaseName(rawText);
  if (LATIN_TOKENS.some((t) => cleaned.includes(t))) return "latino";
  return "original";
}

export function isLatinoStream(stream: { name?: string; title?: string; description?: string }): boolean {
  return classifyStreamAudio(stream) === "latino";
}

export function isCachedOrInstantStream(stream: { name?: string; title?: string; description?: string }): boolean {
  const text = `${stream.name || ""} ${stream.title || ""} ${stream.description || ""}`.toLowerCase();
  if (/\[(?:tb|torbox|rd|ad|pm|oc|dl)\+\]|\b(?:cached|instant[aá]neo|debrid cache)\b|⚡/i.test(text)) {
    return true;
  }
  if (/\[(?:tb|torbox)\s+download\]|\b(?:uncached|downloading)\b|⏳/i.test(text)) {
    return false;
  }
  const seedMatch = text.match(/👤\s*(\d+)/);
  if (seedMatch) {
    const seeders = parseInt(seedMatch[1], 10);
    return seeders >= 15;
  }
  if (/torbox|realdebrid|alldebrid|premiumize|debrid/i.test(text) && !/download/i.test(text)) {
    return true;
  }
  return false;
}

export const b64u = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
  encode: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};

let kvPromise: Promise<Deno.Kv> | null = null;
export function getKv(): Promise<Deno.Kv> {
  if (!kvPromise) {
    kvPromise = Deno.openKv();
  }
  return kvPromise;
}
