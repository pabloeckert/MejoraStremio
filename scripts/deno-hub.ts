/**
 * deno-hub.ts â€” Hub Ãºnico de Deno Deploy que consolida las 3 apps que antes
 * vivÃ­an separadas (mejorastremio, mejorastremio-latino) mÃ¡s el enriquecedor
 * de sinopsis que nunca se habÃ­a deployado. Un solo Deno.serve que despacha
 * por prefijo de ruta a la lÃ³gica de cada uno â€” la lÃ³gica de negocio de cada
 * addon es la misma que en su script original (deno-subdl-addon.ts,
 * deno-latino-catalog-addon.ts, deno-synopsis-enricher.ts), solo cambia el
 * envoltorio de routing.
 *
 * Rutas:
 *   /subdl/manifest.json      â†’ SubDL ES (sin SDH), subtÃ­tulos
 *   /opensubtitles/manifest.json â†’ OpenSubtitles ES (sin SDH), subtÃ­tulos (API moderna,
 *                                catÃ¡logo grande, filtro real de hearing_impaired â€” ver
 *                                GEMINI.md "SesiÃ³n 2026-08-16")
 *   /opensubtitles-latino/manifest.json â†’ OpenSubtitles Latino (sin SDH), subtÃ­tulos â€” mismo
 *                                mecanismo que /opensubtitles pero con languages="ea" (cÃ³digo
 *                                real de "Spanish (LA)" en la API moderna, distinto de "es"/"sp"
 *                                â€” confirmado 2026-09-02, ver GEMINI.md)
 *   /latino/manifest.json     â†’ Audio Latino (verificado), catÃ¡logo
 *   /synopsis/manifest.json   â†’ MejoraStremio Synopsis IA, proxy de meta
 *   /mediathek/manifest.json  â†’ Mediathek DE (Tatort), streams directos ARD/ZDF/ORF
 *   /translate/manifest.json  â†’ TraducciÃ³n IA â†’ ES latino, subtÃ­tulos generados
 *   /miniseries/manifest.json â†’ Miniseries (1 temporada, â‰¤10 episodios, finalizada), catÃ¡logo
 *   /discover/manifest.json   â†’ Descubrir Maestro (Paso B) â€” servicio+regiÃ³n+paÃ­s+idioma+gÃ©nero
 *                                combinables en una sola pantalla, catÃ¡logo
 *   /ufc/manifest.json        â†’ MMA / UFC (curado) â€” catÃ¡logo fijo para perfil fan de UFC
 *                                (cuenta stremiojn, ver cuentas/stremiojn/GEMINI.md), catÃ¡logo
 *   /livetv/manifest.json     â†’ TV en Vivo â€” canales de combate/deportes + noticias AR (cuenta
 *                                stremiojn), fuente iptv-org (streams resueltos en vivo, cache 10
 *                                min â€” la URL es volÃ¡til, no se hardcodea), catÃ¡logo+meta+stream
 *   /health                   â†’ estado de las 7 sub-funciones (config presente)
 *
 * Deploy: deno.com/deploy â†’ conectar repo pabloeckert/MejoraStremio â†’
 *   entry point: scripts/deno-hub.ts
 *   env vars (Secret): SUBDL_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, TMDB_API_KEY_AISEARCH
 *   opcionales: GEMINI_MODEL, OPENROUTER_MODEL
 *
 * Instalar en Stremio (por funciÃ³n):
 *   https://<proyecto>.deno.dev/subdl/manifest.json
 *   https://<proyecto>.deno.dev/latino/manifest.json
 *   https://<proyecto>.deno.dev/synopsis/manifest.json
 *   https://<proyecto>.deno.dev/miniseries/manifest.json
 *
 * Los 3 `manifest.id` se mantienen idÃ©nticos a los de los scripts originales
 * (com.mejorastremio.subdl / com.mejorastremio.latino-catalog /
 * com.mejorastremio.synopsis-proxy) â€” asÃ­, al migrar los addons ya instalados,
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

// Parsea el id que Stremio pone en las requests de subtÃ­tulos/streams. BUG REAL
// encontrado 2026-09-06: el cliente REAL de Stremio (no mi curl de prueba) manda el id
// asÃ­: "tt123%3A1%3A1/videoHash=x&videoSize=y&filename=z.mkv" â€” o sea (a) los ":" van
// percent-codeados como %3A, y (b) hay un segmento extra "/â€¦=â€¦" pegado con los datos del
// archivo de video. El cÃ³digo viejo hacÃ­a `rawId.split(":")` directo -> con %3A no hay
// ningÃºn ":" literal, asÃ­ que quedaba TODO en imdbId y season/episode = null -> nuestros
// addons devolvÃ­an [] para CUALQUIER serie en el cliente real, y por eso Pablo nunca veÃ­a
// nuestros subtÃ­tulos en la app (solo funcionaban con mi curl, que usa ":" literal).
function parseStremioSubId(rawId: string): {
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

// Similitud de release entre el filename REAL del video y el release/nombre de un
// candidato de subtÃ­tulo â€” tokens en comÃºn / tokens totales (Jaccard simple). Usado
// para elegir la base de /translate cuando hay mÃ¡s de un release circulando (ver
// "desface de El Gran HÃ©roe Americano", 2026-09-09): sin esto, /translate siempre
// tomaba el candidato mÃ¡s descargado en OpenSubtitles, sin importar si correspondÃ­a
// al mismo corte/timing que el stream que el usuario estÃ¡ reproduciendo.
function releaseTokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/\.(mkv|mp4|avi|srt)$/, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !/^(the|a|an|of|and|to|s\d+e\d+)$/.test(t)),
  );
}
function releaseSimilarity(filename: string, release: string): number {
  const a = releaseTokens(filename);
  const b = releaseTokens(release);
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.max(a.size, b.size);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /subdl â€” SubDL ES (sin SDH), subtÃ­tulos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LÃ³gica idÃ©ntica a deno-subdl-addon.ts.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const SUBDL_KEY = Deno.env.get("SUBDL_KEY") ?? "";
const SUBDL_API = "https://api.subdl.com/api/v1/subtitles";
const SUBDL_DL = "https://dl.subdl.com";

const SUBDL_MANIFEST = {
  id: "com.mejorastremio.subdl",
  version: "1.0.0",
  name: "SubDL ES (sin SDH)",
  description:
    "SubtÃ­tulos en espaÃ±ol de SubDL. Filtra hearing-impaired (SDH) automÃ¡ticamente.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

// Detecta BOM UTF-16/UTF-8 y decodifica con el charset correcto. Bug real encontrado
// 2026-09-05: SubDL sirve muchos SRT en UTF-16LE (con BOM FF FE) -- confirmado bajando
// un archivo real de HPI/ACI -- y este cÃ³digo forzaba TextDecoder("utf-8") sin mirar el
// BOM, produciendo exactamente los "caracteres raros" que reportÃ³ Pablo (cada carÃ¡cter
// sale como basura porque UTF-16LE tiene un byte 0x00 intercalado entre cada letra
// ASCII, que un decoder UTF-8 no sabe interpretar). Sin BOM se intenta UTF-8 estricto;
// si falla (secuencia invÃ¡lida) se cae a windows-1252 -- el encoding legado mÃ¡s comÃºn en
// releases viejos, nunca tira error, asÃ­ que siempre devuelve algo legible en vez de
// reemplazar todo por el carÃ¡cter de reemplazo (ï¿½).
function decodeSubtitleText(buf: Uint8Array): string {
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

// Limpia artefactos que aparecen en SRT reales de OpenSubtitles/SubDL, aÃºn despuÃ©s de
// decodificar bien el charset. Encontrado 2026-09-05 en un archivo real de Wild Cards:
// el sub tenÃ­a la secuencia LITERAL de dos caracteres "\r" (barra + r, no un carriage
// return real) al principio de lÃ­neas â€” herramienta de conversiÃ³n rota del uploader.
// En un reproductor eso sale como texto basura ("\r (puerta abierta)"). TambiÃ©n:
// normaliza CRLF/CR reales a LF, saca el carÃ¡cter de reemplazo Unicode suelto, y colapsa
// mÃ¡s de 2 lÃ­neas en blanco seguidas.
function sanitizeSubtitleArtifacts(text: string): string {
  return text
    .replace(/ï»¿/g, "")            // BOM suelto en medio del texto
    .replace(/\r\n?/g, "\n")       // CRLF/CR reales -> LF
    .replace(/\\[rn]/g, " ")       // "\r" / "\n" LITERALES (2 chars, artefacto de conversiÃ³n rota) -> espacio
    .replace(/[ \t]{2,}/g, " ")    // espacios mÃºltiples que puedan quedar
    .replace(/^[ \t]+|[ \t]+$/gm, "") // espacios al borde de cada lÃ­nea
    .replace(/ï¿½/g, "")            // carÃ¡cter de reemplazo Unicode suelto
    // lÃ­nea en blanco que quedÃ³ justo entre el timestamp y el texto de la cue (por
    // haber sacado un "\r" literal que estaba solo en su renglÃ³n)
    .replace(/(-->[^\n]*)\n[ \t]*\n(?=\S)/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

function srtTimeToMs(t: string): number {
  const m = t.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!m) return 0;
  const [, hh, mm, ss, ms] = m;
  return parseInt(hh, 10) * 3600000 + parseInt(mm, 10) * 60000 + parseInt(ss, 10) * 1000 + parseInt(ms, 10);
}

function msToSrtTime(msTotal: number): string {
  if (msTotal < 0) msTotal = 0;
  const ms = Math.floor(msTotal % 1000);
  const totalSec = Math.floor(msTotal / 1000);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE SINCRONIZACIÓN INTELIGENTE (Smart Audio Sync & Framerate Engine)
// ─────────────────────────────────────────────────────────────────────────────
// Resuelve la desincronización y deriva temporal (drift) estructural entre streams
// y subtítulos con metadatos dispares (ej. video WEB-DL 23.976fps vs subtítulo HDTV 25fps).
//
// Fórmulas matemáticas extraídas de la auditoría forense (SubSync & Subtitle-Sync):
//   1. Factor de estiramiento (time-stretch ratio):
//        R = fps_source / fps_target
//        t_new = round(t_original * R) + offset_ms
//   2. PAL (25.0 fps) -> WEB-DL / NTSC Film (23.976 fps):
//        R = 25.0 / 23.976 ≈ 1.042709376... (deriva acumulada: +42.71 ms/s, +153.75s/h)
//   3. WEB-DL / NTSC Film (23.976 fps) -> PAL (25.0 fps):
//        R = 23.976 / 25.0 = 0.95904...      (deriva acumulada: -40.96 ms/s, -147.46s/h)
//   4. Detección heurística de release tags + VideoHash matching.

interface FramerateInfo {
  fps: number;
  standard: "PAL_25" | "NTSC_WEB" | "FILM_24" | "NTSC_TV" | "UNKNOWN";
  tag: string;
  confidence: "high" | "medium" | "low";
}

function detectFramerate(name: string | null | undefined): FramerateInfo {
  if (!name) return { fps: 23.976, standard: "NTSC_WEB", tag: "WEB-DL (asumido)", confidence: "low" };
  const s = String(name).toLowerCase();

  // Señales explícitas de 25 fps (PAL / transmisiones de TV europea/británica)
  if (/\b(pal|hdtv|pdtv|dvb|dvb-t|dvb-s|tf1|ard|zdf|orf|bbc|itv|channel4|rte|25fps|25\.000|50fps|50i)\b/i.test(s)) {
    return { fps: 25.0, standard: "PAL_25", tag: "PAL/HDTV 25fps", confidence: "high" };
  }

  // Señales de 23.976 fps (WEB-DL, rips NTSC, BluRay estándar)
  if (/\b(web-?dl|webrip|web\b|amzn|nf|netflix|dsnp|disney|atvp|apple\s?tv|hmax|max\.web|hulu|bluray|blu-ray|bdrip|brrip|23\.976|23\.98|23\.976fps)\b/i.test(s)) {
    return { fps: 23.976, standard: "NTSC_WEB", tag: "WEB-DL 23.976fps", confidence: "high" };
  }

  // Señales de 24.000 fps (Cinema)
  if (/\b(24fps|24\.000|dci)\b/i.test(s)) {
    return { fps: 24.0, standard: "FILM_24", tag: "Cinema 24fps", confidence: "high" };
  }

  // Señales de 29.97 fps (NTSC Broadcast)
  if (/\b(29\.97|29\.970|59\.94|60i)\b/i.test(s)) {
    return { fps: 29.97, standard: "NTSC_TV", tag: "NTSC Broadcast 29.97fps", confidence: "high" };
  }

  return { fps: 23.976, standard: "NTSC_WEB", tag: "WEB-DL (estándar)", confidence: "low" };
}

interface SmartSyncDecision {
  needsRescale: boolean;
  fromFps: number;
  toFps: number;
  ratio: number;
  actionDescription: string;
  badge: string;
  fpsParam: string;
}

function resolveSmartSync(videoName?: string | null, subName?: string | null): SmartSyncDecision {
  const v = detectFramerate(videoName);
  const s = detectFramerate(subName);

  // Video WEB-DL (23.976) y subtítulo HDTV/PAL (25.0) -> Time-stretch factor 25 / 23.976 ≈ 1.042709
  if (Math.abs(v.fps - 23.976) < 0.05 && Math.abs(s.fps - 25.0) < 0.05) {
    return {
      needsRescale: true,
      fromFps: 25.0,
      toFps: 23.976,
      ratio: 25.0 / 23.976,
      actionDescription: "Estiramiento temporal HDTV/PAL (25fps) -> WEB-DL (23.976fps) [+153.75s/h]",
      badge: "⚡ SmartSync (PAL 25->23.976 WEB)",
      fpsParam: "25to23976",
    };
  }

  // Video HDTV/PAL (25.0) y subtítulo WEB-DL (23.976) -> Time-compression factor 23.976 / 25.0 = 0.95904
  if (Math.abs(v.fps - 25.0) < 0.05 && Math.abs(s.fps - 23.976) < 0.05) {
    return {
      needsRescale: true,
      fromFps: 23.976,
      toFps: 25.0,
      ratio: 23.976 / 25.0,
      actionDescription: "Compresión temporal WEB-DL (23.976fps) -> HDTV/PAL (25fps) [-147.46s/h]",
      badge: "⚡ SmartSync (WEB 23.976->25 PAL)",
      fpsParam: "23976to25",
    };
  }

  // Video Cinema (24.0) y subtítulo PAL (25.0)
  if (Math.abs(v.fps - 24.0) < 0.05 && Math.abs(s.fps - 25.0) < 0.05) {
    return {
      needsRescale: true,
      fromFps: 25.0,
      toFps: 24.0,
      ratio: 25.0 / 24.0,
      actionDescription: "Estiramiento temporal PAL 25fps -> Cinema 24fps",
      badge: "⚡ SmartSync (PAL 25->24fps)",
      fpsParam: "25to24",
    };
  }

  // Coincidencia de framerate nativo
  return {
    needsRescale: false,
    fromFps: v.fps,
    toFps: v.fps,
    ratio: 1.0,
    actionDescription: `Calce nativo directo (${v.tag})`,
    badge: `✅ Sincro Nativo (${v.tag})`,
    fpsParam: "none",
  };
}

export interface CanonicalCue {
  id: number;
  startMs: number;
  endMs: number;
  text: string;
}

export function parseSrtToCues(srt: string): CanonicalCue[] {
  if (!srt) return [];
  const cues: CanonicalCue[] = [];
  const normalized = srt
    .replace(/\uFEFF/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\[rn]/g, " ");

  const blocks = normalized.split(/\n\s*\n/);
  const timestampRegex = /(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{1,3})/;

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    const timeIdx = lines.findIndex((l) => timestampRegex.test(l));
    if (timeIdx === -1) continue;

    const match = lines[timeIdx].match(timestampRegex);
    if (!match) continue;

    const startMs = srtTimeToMs(match[1]);
    const endMs = srtTimeToMs(match[2]);
    if (endMs <= startMs) continue;

    const textLines = lines.slice(timeIdx + 1).map((l) => l.trim()).filter(Boolean);
    if (textLines.length === 0) continue;

    cues.push({
      id: cues.length + 1,
      startMs,
      endMs,
      text: textLines.join("\n"),
    });
  }

  return cues;
}

export function enforceMonotonicClamping(cues: CanonicalCue[]): CanonicalCue[] {
  if (!cues || cues.length === 0) return [];
  // Ordenar estrictamente el array por startMs (y si son iguales, por endMs)
  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  for (let i = 0; i < cues.length - 1; i++) {
    const nextStart = cues[i + 1].startMs;
    // Anti-Collision Clamping: Si Cue[i] termina después o igual a que empiece Cue[i+1], recortar Cue[i]
    if (cues[i].endMs >= nextStart) {
      cues[i].endMs = Math.max(cues[i].startMs + 50, nextStart - 5);
    }
    // Si aún con el clamping el fin quedó menor o igual al inicio (por timestamps idénticos de inicio):
    if (cues[i + 1].startMs <= cues[i].startMs) {
      cues[i + 1].startMs = cues[i].startMs + 5;
      if (cues[i + 1].endMs <= cues[i + 1].startMs) {
        cues[i + 1].endMs = cues[i + 1].startMs + 50;
      }
    }
    if (cues[i].endMs <= cues[i].startMs) {
      cues[i].endMs = cues[i].startMs + 50;
    }
  }

  // Renumerar IDs consecutivos 1..N
  cues.forEach((c, idx) => {
    c.id = idx + 1;
  });

  return cues;
}

export function serializeCuesToSrt(cues: CanonicalCue[]): string {
  if (!cues || !cues.length) return "";
  return cues
    .map((c, idx) => `${idx + 1}\n${msToSrtTime(c.startMs)} --> ${msToSrtTime(c.endMs)}\n${c.text}`)
    .join("\n\n") + "\n";
}

function rescaleSrtFramerate(
  srtText: string,
  fromFps: number,
  toFps: number,
  offsetMs: number = 0,
): string {
  if (!srtText) return "";
  const cues = parseSrtToCues(srtText);
  if (!cues.length) return srtText;

  const ratio = (fromFps && toFps && fromFps !== toFps) ? (fromFps / toFps) : 1.0;

  for (const c of cues) {
    if (ratio !== 1.0 || offsetMs !== 0) {
      c.startMs = Math.max(0, Math.round(c.startMs * ratio + offsetMs));
      c.endMs = Math.max(c.startMs + 50, Math.round(c.endMs * ratio + offsetMs));
    }
  }

  const clamped = enforceMonotonicClamping(cues);
  return serializeCuesToSrt(clamped);
}

function cleanSrt(srtContent: string): string {
  if (!srtContent) return "";
  const cues = parseSrtToCues(srtContent);
  if (!cues.length) return "";

  const urlPattern = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9_-]+\.(?:com|org|net|io|me|tv|es|lat)\b/i;
  const sitePattern = /\b(?:subdivx|opensubtitles|tusubtitulo|subdl|addic7ed|argenteam|yify|yts|cuevana|gnula|cinetorrent|invision)\b/i;
  const creditPattern = /^(?:subt[ií]tulos?(?:\s+(?:por|de))?|traducci[oó]n(?:\s+(?:por|de))?|sincronizaci[oó]n(?:\s+(?:por|de))?|sincro|corregido\s+por|revisi[oó]n|supervisi[oó]n(?:\s+creativa)?|descargado\s+de|subt[ií]tulo\s+ofrecido\s+por|ajustes?\s+de\s+subt[ií]tulos?|adaptaci[oó]n|resync|ripped\s+by|encoded\s+by|synced\s+by|translated\s+by)\b(?:\s*[:\-–—]|\s+[A-ZÁÉÍÓÚÑa-záéíóúñ])/i;
  const soundCuesRegex = /^(?:m[uú]sica|musique|sonido|son|audio|disparos?|tirs?|gritos?|cris?|aplausos?|applaudissements|risas?|rires?|suspiros?|soupirs?|suspira|soupire|llanto|pleurs?|silbidos?|sifflements?|pasos|pas|jadeos?|halètements?|canción|chanson|tose|tousse|canta|chante|viento|vent|trueno|tonnerre|motor|moteur|timbre|sonnerie|teléfono|téléphone|golpes?|coups?|quejidos?|gémissements?|sollozos?|sanglots?|murmullos?|murmures?|ininteligible|inintelligible|chatarra|alarma|alarme|resopla|souffle|explosión|silencio|silence|jadea|bosteza|bâille)\b/i;

  const filteredCues: CanonicalCue[] = [];

  for (const c of cues) {
    const rawLines = c.text.split("\n");
    const isCreditOrWatermarkCue = rawLines.some((l) => {
      const cleanLine = l.replace(/^[•\s\-_=~*|]+|[•\s\-_=~*|]+$/g, "").trim();
      return urlPattern.test(cleanLine) || sitePattern.test(cleanLine) || creditPattern.test(cleanLine);
    });
    if (isCreditOrWatermarkCue) continue;

    const cleanedLines = rawLines
      .map((line) => {
        let l = line;
        l = l.replace(/\[.*?\]/g, "");
        l = l.replace(/\(.*?\)/g, "");
        l = l.replace(/^[A-ZÁÉÍÓÚÑÀÂÇÉÈÊËÎÏÔÙÛÜŸ0-9\s._-]{2,30}:\s*/, "");
        l = l.replace(/[♪♫#*]+/g, "");
        l = l.replace(/<[^>]+>/g, "");
        l = l.replace(/^[•\s\-_=~*|]+|[•\s\-_=~*|]+$/g, "");
        if (soundCuesRegex.test(l.trim())) {
          l = "";
        }
        return l.trim();
      })
      .filter((line) => line.length > 0);

    if (cleanedLines.length > 0) {
      filteredCues.push({
        ...c,
        text: cleanedLines.join("\n"),
      });
    }
  }

  const clamped = enforceMonotonicClamping(filteredCues);
  return serializeCuesToSrt(clamped);
}

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
            return decodeSubtitleText(new Uint8Array(data));
          }
          // Bug real encontrado 2026-09-05: escribir todo el payload y esperar a que
          // termine (await writer.close()) ANTES de empezar a leer del lado readable
          // hace DEADLOCK si el stream de descompresiÃ³n tiene buffer interno limitado
          // y el archivo no es trivialmente chico â€” write() queda esperando que alguien
          // lea, pero nadie lee todavÃ­a. Reproducido de forma aislada (colgaba para
          // siempre, sin tirar error, con un ZIP real de SubDL) y confirmado que hacÃ­a
          // colgar la request ENTERA del endpoint (curl con HTTP 000 tras 60s). Fix:
          // escribir y leer EN PARALELO (Promise.all), no en secuencia.
          const ds = new DecompressionStream("deflate-raw");
          const chunks: Uint8Array[] = [];
          const writePromise = (async () => {
            const writer = ds.writable.getWriter();
            await writer.write(new Uint8Array(data));
            await writer.close();
          })();
          const readPromise = (async () => {
            const reader = ds.readable.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          })();
          await Promise.all([writePromise, readPromise]);
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const result = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { result.set(c, off); off += c.length; }
          return decodeSubtitleText(result);
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
  // Bug real encontrado 2026-09-05: los nombres de parÃ¡metro correctos de la API de
  // SubDL son "season_number"/"episode_number" -- "season"/"episode" (los de antes)
  // los ignora en silencio (sin error) y devuelve TODOS los episodios de TODAS las
  // temporadas mezclados. Confirmado contra la API real: con los nombres viejos, tt14060708
  // devolvÃ­a 20 resultados de las temporadas 1/2/3 combinadas al pedir S1E1 -- exactamente
  // el "subtÃ­tulo de otro capÃ­tulo" que reportÃ³ Pablo como desincronizaciÃ³n.
  let url =
    `${SUBDL_API}?api_key=${SUBDL_KEY}&imdb_id=${imdbId}&languages=ES&subs_per_page=20`;
  if (season != null) url += `&season_number=${season}`;
  if (episode != null) url += `&episode_number=${episode}`;

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

// Descarga (sin cache â€” SubDL no tiene lÃ­mite de cupo, a diferencia de OpenSubtitles)
// y desempaqueta si hace falta el SRT real detrÃ¡s de un path de SubDL. dlUrl siempre
// se valida contra dl.subdl.com antes de llegar acÃ¡ (guard anti-SSRF, ver mÃ¡s abajo).
async function downloadSubdlSrt(subdlPath: string): Promise<string | null> {
  const dlUrl = subdlPath.startsWith("http") ? subdlPath : `${SUBDL_DL}${subdlPath}`;
  let dlHost: string;
  try {
    dlHost = new URL(dlUrl).hostname;
  } catch {
    return null;
  }
  if (dlHost !== "dl.subdl.com") return null;
  try {
    const r = await fetch(dlUrl, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    return isZip ? await extractSrtFromZip(buf) : decodeSubtitleText(buf);
  } catch {
    return null;
  }
}

// subPath: la ruta sin el prefijo /subdl (ej "/manifest.json", "/srt/xxx").
// mountBase: origin + "/subdl" â€” para que los links generados (srt) vuelvan a
// pasar por el router del hub.
async function handleSubdl(subPath: string, mountBase: string, reqUrl?: URL): Promise<Response> {
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
    const parsed = parseStremioSubId(rawId);
    const imdbId = parsed.imdbId;
    const season = type === "series" ? parsed.season : null;
    const episode = type === "series" ? parsed.episode : null;

    try {
      const subs = await fetchSubdlSubs(imdbId, season, episode);
      // Pedido de Pablo (2026-09-05): dejar la MAYOR cantidad de opciones verificadas
      // posible para que elija, no la mÃ­nima "segura". Antes esto EXCLUÃA los
      // confirmados SDH por contenido; ahora se los TAGUEA y se los manda al final â€”
      // siguen apareciendo (mÃ¡s opciones), pero ordenados segÃºn su preferencia (limpio
      // primero, SDH solo si no queda otra). SubDL no tiene lÃ­mite de cupo de descarga
      // -> se verifica por contenido un tope generoso de candidatos (15, no todos, para
      // no demorar la respuesta) en vez de confiar ciegamente en su campo `hi` (poco
      // confiable, ver looksLikeSDH).
      const CHECK_LIMIT = 15;
      const toCheck = subs.slice(0, CHECK_LIMIT);
      const rest = subs.slice(CHECK_LIMIT);
      const verdicts = await Promise.all(toCheck.map(async (s) => {
        const text = await downloadSubdlSrt(s.subdlPath);
        return text ? looksLikeSDH(text) : null;
      }));
      const clean = toCheck.filter((_s, idx) => verdicts[idx] !== true);
      const sdhTagged = toCheck.filter((_s, idx) => verdicts[idx] === true);
      const restClean = rest.filter((s) => !isSdhName(s.name));
      const restSdh = rest.filter((s) => isSdhName(s.name));

      // Jerarquía invariable: Español Latinoamericano primero; España al fondo; matching por release
      const sortRegionalPriority = (list: SubdlSub[]) => {
        return [...list].sort((a, b) => {
          const score = (name: string) => {
            const n = name.toLowerCase();
            let pts = 0;
            if (n.includes("latino") || n.includes("latin") || n.includes("mexico") || n.includes("argentina")) pts += 100;
            else if (n.includes("castellano") || n.includes("españa") || n.includes("spain") || n.includes("peninsular")) pts += 10;
            else pts += 50;

            if (parsed.filename) {
              pts += Math.round(releaseSimilarity(parsed.filename, name) * 60);
            }
            return pts;
          };
          return score(b.name) - score(a.name);
        });
      };

      const sortedClean = sortRegionalPriority([...clean, ...restClean]);
      const allSdh = [...sdhTagged, ...restSdh];
      // deno-lint-ignore no-explicit-any
      const subtitles: any[] = [];
      for (const s of [...sortedClean, ...allSdh]) {
        const idx = toCheck.indexOf(s);
        const isSdh = isSdhName(s.name) || (idx >= 0 && verdicts[idx] === true);
        const cleanName = s.name.replace(/\.(zip|srt)$/i, "");
        const baseId = `mshub-subdl-${subs.indexOf(s)}-${imdbId}`;
        const encoded = encodeURIComponent(s.subdlPath);

        const syncDecision = resolveSmartSync(parsed.filename, s.name);

        if (syncDecision.needsRescale) {
          // El Hub detecta discrepancia estructural de framerate y APLICA AUTOMÁTICAMENTE
          // el time-stretch como opción número 1 preferente.
          subtitles.push({
            id: `${baseId}-${syncDecision.fpsParam}`,
            url: `${mountBase}/srt/${encoded}?fps=${syncDecision.fpsParam}&smart=1`,
            lang: "spa",
            label: `[SubDL]${isSdh ? " ⚠️ SDH" : ""} ${syncDecision.badge} ${cleanName}`,
            name: `[SubDL]${isSdh ? " ⚠️ SDH" : ""} ${syncDecision.badge} ${cleanName}`,
          });

          // Opción secundaria: pista sin estirar (original)
          subtitles.push({
            id: baseId,
            url: `${mountBase}/srt/${encoded}`,
            lang: "spa",
            label: `[SubDL]${isSdh ? " ⚠️ SDH" : ""} 📺 Original (${detectFramerate(s.name).tag}) ${cleanName}`,
            name: `[SubDL]${isSdh ? " ⚠️ SDH" : ""} 📺 Original (${detectFramerate(s.name).tag}) ${cleanName}`,
          });
        } else {
          // Coincidencia de framerate nativo: NO se estira en la opción 1 (evita drift artificial)
          subtitles.push({
            id: baseId,
            url: `${mountBase}/srt/${encoded}`,
            lang: "spa",
            label: `[SubDL]${isSdh ? " ⚠️ SDH" : ""} ${syncDecision.badge} ${cleanName}`,
            name: `[SubDL]${isSdh ? " ⚠️ SDH" : ""} ${syncDecision.badge} ${cleanName}`,
          });

          // Opción secundaria: alternativa forzada si los metadatos upstream venían mal etiquetados
          const altFps = Math.abs(detectFramerate(s.name).fps - 25.0) < 0.1 ? "25to23976" : "23976to25";
          const altBadge = altFps === "25to23976" ? "⏱️ Forzar 25->23.976fps" : "⏱️ Forzar 23.976->25fps";
          subtitles.push({
            id: `${baseId}-alt`,
            url: `${mountBase}/srt/${encoded}?fps=${altFps}`,
            lang: "spa",
            label: `[SubDL]${isSdh ? " ⚠️ SDH" : ""} ${altBadge} ${cleanName}`,
            name: `[SubDL]${isSdh ? " ⚠️ SDH" : ""} ${altBadge} ${cleanName}`,
          });
        }
      }
      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const srtMatch = subPath.match(/^\/srt\/(.+)$/);
  if (srtMatch) {
    // Guard anti-SSRF: el path viene de un valor que el cliente controla
    // (encodeURIComponent en el manifest de subtitles, arriba). Sin el chequeo de host
    // dentro de downloadSubdlSrt, cualquiera podrÃ­a pedir /subdl/srt/http://otro-host y
    // este endpoint actuarÃ­a de proxy HTTP abierto no autenticado hacia esa URL.
    const subdlPath = decodeURIComponent(srtMatch[1]);
    let srtText = await downloadSubdlSrt(subdlPath);
    if (!srtText) {
      return new Response("Error descargando o host no permitido", { status: 502, headers: cors });
    }
    const fps = reqUrl?.searchParams?.get("fps");
    const offsetStr = reqUrl?.searchParams?.get("offset");
    const offsetMs = offsetStr ? parseInt(offsetStr, 10) || 0 : 0;
    if (fps === "25to23976" || fps === "pal_to_ntsc") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 23.976, offsetMs);
    } else if (fps === "23976to25" || fps === "ntsc_to_pal") {
      srtText = rescaleSrtFramerate(srtText, 23.976, 25.0, offsetMs);
    } else if (fps === "25to24") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 24.0, offsetMs);
    } else if (fps === "24to25") {
      srtText = rescaleSrtFramerate(srtText, 24.0, 25.0, offsetMs);
    } else if (offsetMs !== 0) {
      srtText = rescaleSrtFramerate(srtText, 1.0, 1.0, offsetMs);
    }
    srtText = cleanSrt(srtText);
    return new Response(srtText, {
      headers: {
        ...cors,
        "Content-Type": "application/x-subrip; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sub.srt"',
      },
    });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /opensubtitles â€” OpenSubtitles ES (sin SDH), subtÃ­tulos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// A diferencia de SubDL (catÃ¡logo chico pero 100% confiable), esta es la
// base de datos grande de OpenSubtitles vÃ­a su API REST moderna
// (api.opensubtitles.com, NO la vieja XML-RPC que usan SubSense/OpenSubtitles
// v3/SubMaker) â€” esa API sÃ­ trae un campo estructurado `hearing_impaired`
// por archivo (confirmado contra la API real, no documentaciÃ³n), a
// diferencia de la base vieja que no tiene ningÃºn dato SDH filtrable (ver
// GEMINI.md, "SesiÃ³n 2026-08-16"). Se busca con `hearing_impaired=exclude`
// server-side, antes de que Stremio vea la lista â€” igual de infalible que
// SubDL, pero con mucha mÃ¡s cobertura (62 subs ES para Matrix vs 3 de SubDL).
//
// Cupo de la API key: 100 descargas/dÃ­a (no de bÃºsquedas), se resetea a las
// 23:59:59 UTC. Por eso la descarga es perezosa (solo al abrir el subtÃ­tulo
// elegido, no al listar) Y cacheada en KV â€” sin cache, cada apertura repetida
// del mismo subtÃ­tulo gastarÃ­a cupo de nuevo.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const OPENSUBTITLES_API_KEY = Deno.env.get("OPENSUBTITLES_API_KEY") ?? "";
const OPENSUBTITLES_API = "https://api.opensubtitles.com/api/v1";
const OPENSUBTITLES_UA = "MejoraStremio v1";
const OPENSUBTITLES_SRT_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dÃ­as â€” un srt ya subido no cambia

const OPENSUBTITLES_MANIFEST = {
  id: "com.mejorastremio.opensubtitles",
  version: "1.0.0",
  name: "OpenSubtitles ES (sin SDH)",
  description:
    "SubtÃ­tulos en espaÃ±ol de OpenSubtitles (API moderna). Filtra hearing-impaired " +
    "(SDH) server-side con el campo real de la API, no por nombre de archivo.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

// "ea" = Spanish (LA), cÃ³digo separado de "es" (genÃ©rico) y "sp" (Spanish EU) â€” confirmado
// contra GET /api/v1/infos/languages de la API real el 2026-09-02 (nunca antes verificado; las
// pruebas viejas con es-419/es-MX/es-AR/lat contra SubSense no aplicaban a esta API). Primera
// fuente de subtÃ­tulos del proyecto que puede filtrar la variante latina de verdad, en vez de
// depender de que el uploader la haya mencionado en el nombre del archivo (ver GEMINI.md,
// "SubtÃ­tulos, variante latino vs. EspaÃ±a").
const OPENSUBTITLES_LATINO_MANIFEST = {
  id: "com.mejorastremio.opensubtitles-latino",
  version: "1.0.0",
  name: "OpenSubtitles Latino (sin SDH)",
  description:
    "SubtÃ­tulos en espaÃ±ol LATINOAMERICANO real de OpenSubtitles (API moderna, cÃ³digo de " +
    "idioma \"ea\" â€” distinto del espaÃ±ol genÃ©rico/EspaÃ±a). Filtra hearing-impaired (SDH) " +
    "server-side con el campo real de la API, no por nombre de archivo.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

interface OpenSubtitlesSub { name: string; fileId: number }

async function fetchOpenSubtitlesSubs(
  imdbId: string,
  season: number | null,
  episode: number | null,
  lang: string = "es",
): Promise<OpenSubtitlesSub[]> {
  // Sin hearing_impaired=exclude a propÃ³sito (bug real encontrado 2026-09-05, ver
  // looksLikeSDH): el parÃ¡metro es inconsistente en la API real de OpenSubtitles â€”
  // medido para HPI/ACI, "exclude" devolvÃ­a 1 candidato de 2 totales, pero "only"
  // (que deberÃ­a mostrar justo el que "exclude" sacÃ³) daba 0 -- contradictorio, la
  // metadata de la fuente no es confiable. Se trae el pool COMPLETO (mÃ¡s opciones
  // reales para elegir, pedido explÃ­cito de Pablo) y se clasifica por contenido acÃ¡
  // mismo (ver classifySDHCached mÃ¡s abajo), no confiando en el flag del proveedor.
  const params = new URLSearchParams({ languages: lang });
  if (season != null && episode != null) {
    params.set("parent_imdb_id", imdbId.replace(/^tt0*/, ""));
    params.set("season_number", String(season));
    params.set("episode_number", String(episode));
  } else {
    params.set("imdb_id", imdbId.replace(/^tt0*/, ""));
  }

  const r = await fetch(`${OPENSUBTITLES_API}/subtitles?${params}`, {
    headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) return [];
  const d = await r.json();

  // deno-lint-ignore no-explicit-any
  return ((d?.data ?? []) as any[])
    .map((s) => ({
      name: s.attributes?.release || s.attributes?.files?.[0]?.file_name || "OpenSubtitles ES",
      fileId: s.attributes?.files?.[0]?.file_id as number,
    }))
    .filter((s) => Number.isFinite(s.fileId));
}

// Descarga+cachea (90d) el SRT real de un file_id de OpenSubtitles. ExtraÃ­do a funciÃ³n
// propia para reusarlo tanto al servir /srt/:fileId como al clasificar SDH por
// contenido ANTES de listar el subtÃ­tulo (ver handleOpenSubtitles mÃ¡s abajo) â€” asÃ­ el
// listado no duplica la descarga cuando el usuario despuÃ©s elige ese mismo subtÃ­tulo.
async function downloadOpenSubtitlesSrt(fileId: number): Promise<string | null> {
  const cacheKey = ["opensubtitles-srt", fileId];
  let kv: Deno.Kv | null = null;
  try {
    kv = await getKv();
    const cached = await kv.get<string>(cacheKey);
    if (cached.value) return cached.value;
  } catch {
    kv = null;
  }
  try {
    const dl = await fetch(`${OPENSUBTITLES_API}/download`, {
      method: "POST",
      headers: {
        "Api-Key": OPENSUBTITLES_API_KEY,
        "User-Agent": OPENSUBTITLES_UA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(15000),
    }).then((r) => r.json());
    if (!dl?.link) return null;
    const r = await fetch(dl.link, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    // decodeSubtitleText (no r.text()) por las dudas: OpenSubtitles normalmente sirve
    // UTF-8 limpio, pero algÃºn upload legado podrÃ­a no serlo -- mismo cuidado que se
    // aplicÃ³ a SubDL tras encontrar el bug real de encoding ahÃ­.
    const srtText = decodeSubtitleText(new Uint8Array(await r.arrayBuffer()));
    if (kv) {
      try { await kv.set(cacheKey, srtText, { expireIn: OPENSUBTITLES_SRT_CACHE_TTL_MS }); } catch { /* sin cache, no crÃ­tico */ }
    }
    return srtText;
  } catch {
    return null;
  }
}

// VerificaciÃ³n por CONTENIDO de si un subtÃ­tulo es realmente SDH, para cuando el
// campo `hearing_impaired` del proveedor miente (confirmado 2026-09-05: OpenSubtitles
// devolviÃ³ hi:false en un archivo lleno de "(SUSPIRA)"/"(CANTURREA)"/letras de canciÃ³n â€”
// ver looksLikeSDH mÃ¡s abajo). Solo se activa con pocos candidatos (<=5): para un tÃ­tulo
// masivo con 50 opciones no vale la pena gastar cupo de descarga en verificar todas, el
// usuario ya tiene de sobra para elegir. El veredicto queda cacheado para siempre (un
// archivo no cambia) asÃ­ que el costo real es una sola descarga por archivo, para
// siempre, compartida entre todos los que usan el hub.
async function classifySDHCached(fileId: number): Promise<boolean | null> {
  let kv: Deno.Kv | null = null;
  // "v2": versionado a propÃ³sito -- looksLikeSDH ya se recalibrÃ³ una vez (2026-09-05,
  // umbral viejo 6%/15% no detectaba un caso real confirmado) y un veredicto cacheado
  // con el umbral anterior quedarÃ­a pegado 180 dÃ­as si la clave no cambia con Ã©l.
  const verdictKey = ["sdh-verdict", "os", "v2", fileId];
  try {
    kv = await getKv();
    const cached = await kv.get<boolean>(verdictKey);
    if (typeof cached.value === "boolean") return cached.value;
  } catch {
    kv = null;
  }
  const text = await downloadOpenSubtitlesSrt(fileId);
  if (!text) return null;
  const verdict = looksLikeSDH(text);
  if (kv) {
    try { await kv.set(verdictKey, verdict, { expireIn: 180 * 24 * 60 * 60 * 1000 }); } catch { /* sin cache */ }
  }
  return verdict;
}

async function handleOpenSubtitles(
  subPath: string,
  mountBase: string,
  // deno-lint-ignore no-explicit-any
  manifest: any = OPENSUBTITLES_MANIFEST,
  lang: string = "es",
  idTag: string = "mshub-os",
  nameTag: string = "OpenSubtitles",
  reqUrl?: URL,
): Promise<Response> {
  if (!OPENSUBTITLES_API_KEY) {
    return new Response(
      "OPENSUBTITLES_API_KEY no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(manifest);
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, , rawId] = subMatch;
    const parsed = parseStremioSubId(rawId);
    const { imdbId, season, episode } = parsed;

    try {
      const subs = await fetchOpenSubtitlesSubs(imdbId, season, episode, lang);
      // Pedido de Pablo (2026-09-05): la MAYOR cantidad de opciones verificadas
      // posible, no la mÃ­nima "segura" -- taguear y mandar al final los confirmados
      // SDH por contenido en vez de sacarlos de la lista. VerificaciÃ³n de contenido
      // hasta 10 candidatos (gasta cupo real de OpenSubtitles, 100 descargas/dÃ­a â€”
      // por eso el tope, no ilimitado); mÃ¡s allÃ¡ de eso quedan sin verificar pero
      // igual en la lista (mejor mostrarlos sin el doble chequeo que no mostrarlos).
      const CHECK_LIMIT = 10;
      const toCheck = subs.slice(0, CHECK_LIMIT);
      const rest = subs.slice(CHECK_LIMIT);
      const verdicts = toCheck.length
        ? await Promise.all(toCheck.map((s) => classifySDHCached(s.fileId)))
        : [];
      const clean = toCheck.filter((_s, idx) => verdicts[idx] !== true);
      const sdhTagged = toCheck.filter((_s, idx) => verdicts[idx] === true);
      const restClean = rest.filter((s) => !isSdhName(s.name));
      const restSdh = rest.filter((s) => isSdhName(s.name));

      // Jerarquía invariable: Español Latinoamericano primero; España al fondo; matching por release
      const sortRegionalPriority = (list: OpenSubtitlesSub[]) => {
        return [...list].sort((a, b) => {
          const score = (name: string) => {
            const n = name.toLowerCase();
            let pts = 0;
            if (n.includes("latino") || n.includes("latin") || n.includes("mexico") || n.includes("argentina")) pts += 100;
            else if (n.includes("castellano") || n.includes("españa") || n.includes("spain") || n.includes("peninsular")) pts += 10;
            else pts += 50;

            if (parsed.filename) {
              pts += Math.round(releaseSimilarity(parsed.filename, name) * 60);
            }
            return pts;
          };
          return score(b.name) - score(a.name);
        });
      };

      const sortedClean = sortRegionalPriority([...clean, ...restClean]);
      const allSdh = [...sdhTagged, ...restSdh];
      // deno-lint-ignore no-explicit-any
      const subtitles: any[] = [];
      for (const s of [...sortedClean, ...allSdh]) {
        const isSdh = isSdhName(s.name) || (toCheck.indexOf(s) >= 0 && verdicts[toCheck.indexOf(s)] === true);
        const baseId = `${idTag}-${subs.indexOf(s)}-${imdbId}`;
        const disp = `[${nameTag}]${isSdh ? " ⚠️ SDH" : ""}`;

        const syncDecision = resolveSmartSync(parsed.filename, s.name);

        if (syncDecision.needsRescale) {
          // El Hub detecta discrepancia estructural de framerate y APLICA AUTOMÁTICAMENTE
          // el time-stretch como opción número 1 preferente.
          subtitles.push({
            id: `${baseId}-${syncDecision.fpsParam}`,
            url: `${mountBase}/srt/${s.fileId}?fps=${syncDecision.fpsParam}&smart=1`,
            lang: "spa",
            label: `${disp} ${syncDecision.badge} ${s.name}`,
            name: `${disp} ${syncDecision.badge} ${s.name}`,
          });

          // Opción secundaria: pista sin estirar (original)
          subtitles.push({
            id: baseId,
            url: `${mountBase}/srt/${s.fileId}`,
            lang: "spa",
            label: `${disp} 📺 Original (${detectFramerate(s.name).tag}) ${s.name}`,
            name: `${disp} 📺 Original (${detectFramerate(s.name).tag}) ${s.name}`,
          });
        } else {
          // Coincidencia de framerate nativo: NO se estira en la opción 1 (evita drift artificial)
          subtitles.push({
            id: baseId,
            url: `${mountBase}/srt/${s.fileId}`,
            lang: "spa",
            label: `${disp} ${syncDecision.badge} ${s.name}`,
            name: `${disp} ${syncDecision.badge} ${s.name}`,
          });

          // Opción secundaria: alternativa forzada si los metadatos upstream venían mal etiquetados
          const altFps = Math.abs(detectFramerate(s.name).fps - 25.0) < 0.1 ? "25to23976" : "23976to25";
          const altBadge = altFps === "25to23976" ? "⏱️ Forzar 25->23.976fps" : "⏱️ Forzar 23.976->25fps";
          subtitles.push({
            id: `${baseId}-alt`,
            url: `${mountBase}/srt/${s.fileId}?fps=${altFps}`,
            lang: "spa",
            label: `${disp} ${altBadge} ${s.name}`,
            name: `${disp} ${altBadge} ${s.name}`,
          });
        }
      }
      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const srtMatch = subPath.match(/^\/srt\/(\d+)$/);
  if (srtMatch) {
    const fileId = parseInt(srtMatch[1], 10);
    let srtText = await downloadOpenSubtitlesSrt(fileId);
    if (srtText == null) {
      return new Response("Error descargando el subtítulo de OpenSubtitles", { status: 502, headers: cors });
    }
    const fps = reqUrl?.searchParams?.get("fps");
    const offsetStr = reqUrl?.searchParams?.get("offset");
    const offsetMs = offsetStr ? parseInt(offsetStr, 10) || 0 : 0;
    if (fps === "25to23976" || fps === "pal_to_ntsc") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 23.976, offsetMs);
    } else if (fps === "23976to25" || fps === "ntsc_to_pal") {
      srtText = rescaleSrtFramerate(srtText, 23.976, 25.0, offsetMs);
    } else if (fps === "25to24") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 24.0, offsetMs);
    } else if (fps === "24to25") {
      srtText = rescaleSrtFramerate(srtText, 24.0, 25.0, offsetMs);
    } else if (offsetMs !== 0) {
      srtText = rescaleSrtFramerate(srtText, 1.0, 1.0, offsetMs);
    }
    srtText = cleanSrt(srtText);
    return new Response(srtText, {
      headers: {
        ...cors,
        "Content-Type": "application/x-subrip; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sub.srt"',
      },
    });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ── /subtitles/proxy — Proxy Sanitizador y Re-sincronizador de Subtítulos ───
async function handleSubtitleProxy(url: URL): Promise<Response> {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return new Response("Falta el parametro url", { status: 400, headers: cors });
  }

  let host = "";
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    return new Response("URL invalida", { status: 400, headers: cors });
  }

  const allowed = [
    "dl.subdl.com",
    "api.opensubtitles.com",
    "opensubtitles.org",
    "api.subdl.com",
    "strem.fun",
    "stremio-subdivx.xor.ar",
    "subdivx.com",
    "www.subdivx.com",
    "mejorastremio-hub.pabloeckert.deno.net",
  ];
  if (!allowed.some((h) => host === h || host.endsWith("." + h))) {
    return new Response("Host no permitido para proxy de subtitulos", { status: 403, headers: cors });
  }

  try {
    const r = await fetch(targetUrl, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return new Response(`Upstream error ${r.status}`, { status: 502, headers: cors });
    const buf = new Uint8Array(await r.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    let srtText = isZip ? await extractSrtFromZip(buf) : decodeSubtitleText(buf);
    if (!srtText) return new Response("No se pudo decodificar el subtítulo", { status: 502, headers: cors });

    const fps = url.searchParams.get("fps");
    const offsetStr = url.searchParams.get("offset");
    const offsetMs = offsetStr ? parseInt(offsetStr, 10) || 0 : 0;
    const fromFps = url.searchParams.get("fromFps") ? parseFloat(url.searchParams.get("fromFps")!) : null;
    const toFps = url.searchParams.get("toFps") ? parseFloat(url.searchParams.get("toFps")!) : null;

    if (fromFps && toFps) {
      srtText = rescaleSrtFramerate(srtText, fromFps, toFps, offsetMs);
    } else if (fps === "25to23976" || fps === "pal_to_ntsc") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 23.976, offsetMs);
    } else if (fps === "23976to25" || fps === "ntsc_to_pal") {
      srtText = rescaleSrtFramerate(srtText, 23.976, 25.0, offsetMs);
    } else if (fps === "25to24") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 24.0, offsetMs);
    } else if (fps === "24to25") {
      srtText = rescaleSrtFramerate(srtText, 24.0, 25.0, offsetMs);
    } else if (offsetMs !== 0) {
      srtText = rescaleSrtFramerate(srtText, 1.0, 1.0, offsetMs);
    }

    const cleaned = cleanSrt(srtText);
    const format = url.searchParams.get("format");
    const contentType = format === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8";

    return new Response(cleaned, {
      headers: {
        ...cors,
        "Content-Type": contentType,
        "Content-Disposition": 'attachment; filename="sub.srt"',
      },
    });
  } catch (e) {
    return new Response(`Error proxying subtitle: ${(e as Error).message}`, { status: 500, headers: cors });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── /subdivx — Subdivx ES Latino (vía Proxy con Smart Audio Sync) ───────────
// ─────────────────────────────────────────────────────────────────────────────
const SUBDIVX_PROXY_URL = Deno.env.get("SUBDIVX_PROXY_URL") ?? "https://stremio-subdivx.xor.ar";

const SUBDIVX_MANIFEST = {
  id: "com.mejorastremio.subdivx",
  version: "1.0.0",
  name: "Subdivx ES Latino (Smart Audio Sync)",
  description:
    "Subtítulos en Español Latino de Subdivx mediante proxy con Smart Audio Sync automático y filtrado SDH.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

async function handleSubdivx(
  subPath: string,
  mountBase: string,
  reqUrl?: URL,
): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(SUBDIVX_MANIFEST);
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, type, rawId] = subMatch;
    const parsed = parseStremioSubId(rawId);
    const { imdbId, season, episode, filename } = parsed;

    try {
      const proxyBase = SUBDIVX_PROXY_URL.replace(/\/+$/, "");
      const b64EmptyConfig = b64u.enc(JSON.stringify({ apiKey: "" }));
      const targetQuery = type === "series" && season != null && episode != null
        ? `${imdbId}:${season}:${episode}`
        : imdbId;
      const targetUrl = `${proxyBase}/${b64EmptyConfig}/subtitles/${type}/${encodeURIComponent(targetQuery)}.json`;

      const r = await fetch(targetUrl, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      // deno-lint-ignore no-explicit-any
      let subs: any[] = [];
      if (r && r.ok) {
        const d = await r.json().catch(() => null);
        subs = Array.isArray(d?.subtitles) ? d.subtitles : [];
      }

      if (!subs.length) {
        return jsonResponse({ subtitles: [] });
      }

      // deno-lint-ignore no-explicit-any
      const subtitles: any[] = [];
      for (let i = 0; i < subs.length && i < 15; i++) {
        const s = subs[i];
        const subName = s.label || s.name || `Subdivx ${i + 1}`;
        const syncDecision = resolveSmartSync(filename, subName);
        const encodedUrl = encodeURIComponent(s.url);
        const baseId = `mshub-subdivx-${i}-${imdbId}`;

        if (syncDecision.needsRescale) {
          subtitles.push({
            id: `${baseId}-${syncDecision.fpsParam}`,
            url: `${mountBase}/srt/${encodedUrl}?fps=${syncDecision.fpsParam}&smart=1`,
            lang: "spa",
            label: `[Subdivx] ${syncDecision.badge} ${subName}`,
            name: `[Subdivx] ${syncDecision.badge} ${subName}`,
          });
          subtitles.push({
            id: baseId,
            url: `${mountBase}/srt/${encodedUrl}`,
            lang: "spa",
            label: `[Subdivx] 📺 Original (${detectFramerate(subName).tag}) ${subName}`,
            name: `[Subdivx] 📺 Original (${detectFramerate(subName).tag}) ${subName}`,
          });
        } else {
          subtitles.push({
            id: baseId,
            url: `${mountBase}/srt/${encodedUrl}`,
            lang: "spa",
            label: `[Subdivx] ${syncDecision.badge} ${subName}`,
            name: `[Subdivx] ${syncDecision.badge} ${subName}`,
          });
          const altFps = Math.abs(detectFramerate(subName).fps - 25.0) < 0.1 ? "25to23976" : "23976to25";
          const altBadge = altFps === "25to23976" ? "⏱️ Forzar 25->23.976fps" : "⏱️ Forzar 23.976->25fps";
          subtitles.push({
            id: `${baseId}-alt`,
            url: `${mountBase}/srt/${encodedUrl}?fps=${altFps}`,
            lang: "spa",
            label: `[Subdivx] ${altBadge} ${subName}`,
            name: `[Subdivx] ${altBadge} ${subName}`,
          });
        }
      }

      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message });
    }
  }

  const srtMatch = subPath.match(/^\/srt\/(.+)$/);
  if (srtMatch) {
    const rawTarget = decodeURIComponent(srtMatch[1]);
    try {
      const r = await fetch(rawTarget, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return new Response("Error upstream Subdivx", { status: 502, headers: cors });
      const buf = new Uint8Array(await r.arrayBuffer());
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      let srtText = isZip ? await extractSrtFromZip(buf) : decodeSubtitleText(buf);
      if (!srtText) return new Response("Error decodificando subtítulo", { status: 502, headers: cors });

      const fps = reqUrl?.searchParams?.get("fps");
      const offsetStr = reqUrl?.searchParams?.get("offset");
      const offsetMs = offsetStr ? parseInt(offsetStr, 10) || 0 : 0;
      if (fps === "25to23976" || fps === "pal_to_ntsc") {
        srtText = rescaleSrtFramerate(srtText, 25.0, 23.976, offsetMs);
      } else if (fps === "23976to25" || fps === "ntsc_to_pal") {
        srtText = rescaleSrtFramerate(srtText, 23.976, 25.0, offsetMs);
      } else if (offsetMs !== 0) {
        srtText = rescaleSrtFramerate(srtText, 1.0, 1.0, offsetMs);
      }

      srtText = cleanSrt(srtText);
      return new Response(srtText, {
        headers: {
          ...cors,
          "Content-Type": "application/x-subrip; charset=utf-8",
          "Content-Disposition": 'attachment; filename="subdivx.srt"',
        },
      });
    } catch (e) {
      return new Response(`Error: ${(e as Error).message}`, { status: 502, headers: cors });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /latino â€” Audio Latino (verificado), catÃ¡logo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LÃ³gica idÃ©ntica a deno-latino-catalog-addon.ts.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const LATINO_LOG_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/anti-frustration-log.json";
const CINEMETA = "https://v3-cinemeta.strem.io";

const LATINO_MANIFEST = {
  id: "com.mejorastremio.latino-catalog",
  version: "1.0.0",
  name: "Audio Latino (verificado)",
  description:
    "CatÃ¡logo de contenido familiar/infantil con audio latino confirmado " +
    "por scripts/anti-frustration.mjs â€” solo tÃ­tulos con streams reales.",
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /ufc â€” MMA / UFC (curado), catÃ¡logo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Lista fija (no depende de ningÃºn archivo de datos) â€” perfil fan de UFC/MMA:
// realities de captaciÃ³n de talento UFC, drama de gimnasio de MMA y wrestling.
// IDs de IMDb verificados vÃ­a TMDB/bÃºsqueda real, no adivinados (ver
// cuentas/stremiojn/GEMINI.md para el detalle de la curaciÃ³n).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const UFC_MANIFEST = {
  id: "com.mejorastremio.ufc-catalog",
  version: "1.0.0",
  name: "MMA / UFC (curado)",
  description:
    "CatÃ¡logo curado para perfil fan de UFC: realities de captaciÃ³n de talento MMA " +
    "(Dana White's Contender Series, The Ultimate Fighter), drama de gimnasio de MMA " +
    "(Kingdom, Cobra Kai), reality de aptitud fÃ­sica (Physical: 100) y wrestling (WWE Raw/SmackDown).",
  resources: ["catalog"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [{ type: "series", id: "ufc-series", name: "MMA / UFC (curado)" }],
};

const UFC_TITLES: { id: string; name: string }[] = [
  { id: "tt10845410", name: "Dana White's Contender Series" },
  { id: "tt0445912", name: "The Ultimate Fighter" },
  { id: "tt3673794", name: "Kingdom" },
  { id: "tt7221388", name: "Cobra Kai" },
  { id: "tt25274446", name: "Physical: 100" },
  { id: "tt0185103", name: "WWE Raw" },
  { id: "tt0227972", name: "WWE SmackDown" },
];

async function handleUfc(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(UFC_MANIFEST);
  }

  if (subPath === "/catalog/series/ufc-series.json") {
    const metas = await Promise.all(
      UFC_TITLES.map(async (t) => ({
        id: t.id,
        type: "series",
        name: t.name,
        poster: await posterFor(t.id, "series"),
      })),
    );
    return jsonResponse({ metas });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /livetv â€” TV en Vivo (curado), catÃ¡logo + meta + stream â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Fuente: iptv-org (github.com/iptv-org/iptv), datos pÃºblicos de canales de
// aire/cable legÃ­timos con streams m3u8. Lista de canales ALLOWLIST fija
// (11 ids, verificados con fetch real antes de sumarlos â€” descartados los
// que dieron 403/404/timeout o vienen marcados "Geo-blocked"/"Not 24/7" en
// la propia data de iptv-org), pero la URL de stream se resuelve EN VIVO
// contra la API pÃºblica (cache 10 min) en cada consulta â€” a diferencia de
// /ufc, acÃ¡ la URL es volÃ¡til (es un endpoint de streaming real, no un id
// estable de IMDb) y hardcodearla se pudrirÃ­a rÃ¡pido.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const IPTV_STREAMS_URL = "https://iptv-org.github.io/api/streams.json";
const IPTV_LOGOS_URL = "https://iptv-org.github.io/api/logos.json";

const LIVETV_MANIFEST = {
  id: "com.mejorastremio.livetv",
  version: "1.1.0",
  name: "TV en Vivo",
  description:
    "CatÃ¡logo curado de canales en vivo de UFC/MMA/combate y wrestling, fuente iptv-org, cada " +
    "canal verificado con un fetch real antes de sumarlo. Perfil fan de UFC.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["iptv-"],
  catalogs: [{ type: "tv", id: "livetv-combate", name: "TV en Vivo â€” UFC / MMA / Combate" }],
};

type LivetvCatalogId = "livetv-combate";

const LIVETV_CHANNELS: { id: string; catalog: LivetvCatalogId; name: string }[] = [
  { id: "BellatorMMA.us", catalog: "livetv-combate", name: "Bellator MMA" },
  { id: "PFLMMA.us", catalog: "livetv-combate", name: "PFL MMA" },
  { id: "Combate.br", catalog: "livetv-combate", name: "Combate (Grupo Globo, BR)" },
  { id: "ESPN.br", catalog: "livetv-combate", name: "ESPN" },
  { id: "ESPNDeportes.us", catalog: "livetv-combate", name: "ESPN Deportes" },
  { id: "ESPN8TheOcho.us", catalog: "livetv-combate", name: "ESPN8: The Ocho" },
  { id: "MMATV.us", catalog: "livetv-combate", name: "MMA TV" },
  { id: "GloryKickboxing.us", catalog: "livetv-combate", name: "Glory Kickboxing" },
];

// deno-lint-ignore no-explicit-any
type IptvStream = any;

let livetvCache: { at: number; streams: Map<string, IptvStream>; logos: Map<string, string> } | null = null;
const LIVETV_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

async function loadLivetvData() {
  if (livetvCache && Date.now() - livetvCache.at < LIVETV_CACHE_TTL_MS) return livetvCache;
  const [stRes, logoRes] = await Promise.all([
    fetch(IPTV_STREAMS_URL, { signal: AbortSignal.timeout(15000) }),
    fetch(IPTV_LOGOS_URL, { signal: AbortSignal.timeout(15000) }),
  ]);
  const streamsArr: IptvStream[] = stRes.ok ? await stRes.json() : [];
  const logosArr: IptvStream[] = logoRes.ok ? await logoRes.json() : [];
  const streams = new Map<string, IptvStream>();
  for (const s of streamsArr) if (s.channel && !streams.has(s.channel)) streams.set(s.channel, s);
  const logos = new Map<string, string>();
  for (const l of logosArr) if (l.channel && l.in_use && !logos.has(l.channel)) logos.set(l.channel, l.url);
  livetvCache = { at: Date.now(), streams, logos };
  return livetvCache;
}

async function handleLivetv(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(LIVETV_MANIFEST);
  }

  const catMatch = subPath.match(/^\/catalog\/tv\/(livetv-combate)\.json$/);
  if (catMatch) {
    const catalogId = catMatch[1] as LivetvCatalogId;
    const { logos } = await loadLivetvData();
    const metas = LIVETV_CHANNELS.filter((c) => c.catalog === catalogId).map((c) => ({
      id: `iptv-${c.id}`,
      type: "tv",
      name: c.name,
      poster: logos.get(c.id) ?? null,
    }));
    return jsonResponse({ metas });
  }

  const metaMatch = subPath.match(/^\/meta\/tv\/iptv-(.+)\.json$/);
  if (metaMatch) {
    const ch = LIVETV_CHANNELS.find((c) => c.id === metaMatch[1]);
    if (!ch) return new Response("Not found", { status: 404, headers: cors });
    const { logos } = await loadLivetvData();
    return jsonResponse({
      meta: { id: `iptv-${ch.id}`, type: "tv", name: ch.name, poster: logos.get(ch.id) ?? null },
    });
  }

  const streamMatch = subPath.match(/^\/stream\/tv\/iptv-(.+)\.json$/);
  if (streamMatch) {
    const ch = LIVETV_CHANNELS.find((c) => c.id === streamMatch[1]);
    if (!ch) return new Response("Not found", { status: 404, headers: cors });
    const { streams } = await loadLivetvData();
    const s = streams.get(ch.id);
    if (!s) return jsonResponse({ streams: [] });
    const headers: Record<string, string> = {};
    if (s.user_agent) headers["User-Agent"] = s.user_agent;
    if (s.referrer) headers["Referer"] = s.referrer;
    // deno-lint-ignore no-explicit-any
    const stream: any = { url: s.url, title: `${ch.name} (en vivo)${s.quality ? " Â· " + s.quality : ""}` };
    if (Object.keys(headers).length) {
      stream.behaviorHints = { notWebReady: false, proxyHeaders: { request: headers } };
    }
    return jsonResponse({ streams: [stream] });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /iptv â€” TV en Vivo (IPTV), secciÃ³n general de stremioeg â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Fuente: data/iptv-channels.json, generado por scripts/build-iptv-catalog.mjs
// (iptv-org, canales pÃºblicos legÃ­timos, cada stream VERIFICADO vivo con un GET
// real antes de incluirlo â€” 2Ã—/semana vÃ­a iptv-refresh.yml). El hub lee ese
// archivo de raw.githubusercontent (cache 6h), mismo patrÃ³n que /synopsis con
// preset.json. CatÃ¡logos: Argentina / EspaÃ±a / LatinoamÃ©rica (castellano) +
// Internacional (idioma original). Filtro por gÃ©nero (Noticias/PelÃ­culas/Series/
// Documentales/Cultura/Infantil/MÃºsica/Entretenimiento/General).
// Orden: alfabÃ©tico â€” la TV en vivo no tiene fecha de estreno, asÃ­ que la "ley
// dura" de fecha desc no aplica acÃ¡ (excepciÃ³n explÃ­cita).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const IPTV_CHANNELS_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/iptv-channels.json";
const IPTV_CATALOG_IDS = ["iptv-ar", "iptv-es", "iptv-latam", "iptv-intl"] as const;
const IPTV_CATALOG_NAMES: Record<string, string> = {
  "iptv-ar": "TV en Vivo â€” Argentina",
  "iptv-es": "TV en Vivo â€” EspaÃ±a",
  "iptv-latam": "TV en Vivo â€” LatinoamÃ©rica",
  "iptv-intl": "TV en Vivo â€” Internacional",
};
const IPTV_GENRES = [
  "Noticias", "PelÃ­culas", "Series", "Documentales", "Cultura",
  "Infantil", "MÃºsica", "Entretenimiento", "General",
];

interface IptvChannel {
  id: string; name: string; catalog: string; country: string; genre: string;
  logo: string | null; url: string; quality: string | null;
  userAgent: string | null; referrer: string | null;
}

const IPTV_MANIFEST = {
  id: "com.mejorastremio.iptv",
  version: "1.0.0",
  name: "TV en Vivo (IPTV)",
  description:
    "Canales de TV en vivo â€” Argentina, EspaÃ±a, LatinoamÃ©rica (castellano) e Internacional " +
    "(idioma original). Fuente iptv-org (seÃ±ales pÃºblicas legÃ­timas); cada canal verificado " +
    "en vivo antes de listarlo. Filtrable por gÃ©nero.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["mshub-iptv-"],
  catalogs: IPTV_CATALOG_IDS.map((id) => ({
    type: "tv",
    id,
    name: IPTV_CATALOG_NAMES[id],
    extra: [
      { name: "genre", options: ["Todos", ...IPTV_GENRES], isRequired: false },
      { name: "skip", isRequired: false },
    ],
  })),
};

let iptvCache: { at: number; channels: IptvChannel[] } | null = null;
const IPTV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function loadIptvChannels(): Promise<IptvChannel[]> {
  if (iptvCache && Date.now() - iptvCache.at < IPTV_CACHE_TTL_MS) return iptvCache.channels;
  try {
    const r = await fetch(IPTV_CHANNELS_URL, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`iptv-channels.json â†’ ${r.status}`);
    const j = await r.json();
    const channels: IptvChannel[] = Array.isArray(j?.channels) ? j.channels : [];
    iptvCache = { at: Date.now(), channels };
    return channels;
  } catch (e) {
    if (iptvCache) return iptvCache.channels; // stale-while-error
    throw e;
  }
}

async function handleIptv(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") return jsonResponse(IPTV_MANIFEST);

  // /catalog/tv/<catalogId>.json  Ã³  /catalog/tv/<catalogId>/genre=Noticias.json
  const catM = subPath.match(/^\/catalog\/tv\/(iptv-[a-z]+)(?:\/(.+?))?\.json$/);
  if (catM) {
    const [, catalogId, extraStr] = catM;
    if (!IPTV_CATALOG_IDS.includes(catalogId as typeof IPTV_CATALOG_IDS[number])) {
      return jsonResponse({ metas: [] });
    }
    const extra = new URLSearchParams(extraStr ?? "");
    const genre = extra.get("genre");
    const skip = parseInt(extra.get("skip") ?? "0", 10) || 0;
    const all = await loadIptvChannels();
    let list = all.filter((c) => c.catalog === catalogId);
    if (genre && genre !== "Todos") list = list.filter((c) => c.genre === genre);
    const metas = list.slice(skip, skip + 100).map((c) => ({
      id: `mshub-iptv-${c.id}`,
      type: "tv",
      name: c.name,
      poster: c.logo,
      posterShape: "square",
      logo: c.logo ?? undefined,
      genres: [c.genre],
    }));
    return jsonResponse({ metas });
  }

  // meta / stream â€” id `mshub-iptv-<channel-id>`. Sin ":" a propÃ³sito: el cliente real de Stremio
  // percent-codea ":" a "%3A" en el path (ver "SesiÃ³n 2026-09-06"), con "-" el id atraviesa la
  // URL intacto. Igual se decodifica y se saca el prefijo por las dudas.
  const metaM = subPath.match(/^\/meta\/tv\/(.+)\.json$/);
  if (metaM) {
    const chId = decodeURIComponent(metaM[1]).replace(/^mshub-iptv-/, "");
    const ch = (await loadIptvChannels()).find((c) => c.id === chId);
    if (!ch) return new Response("Not found", { status: 404, headers: cors });
    return jsonResponse({
      meta: {
        id: `mshub-iptv-${ch.id}`,
        type: "tv",
        name: ch.name,
        poster: ch.logo,
        posterShape: "square",
        logo: ch.logo ?? undefined,
        background: ch.logo ?? undefined,
        genres: [ch.genre],
        description: `Canal en vivo Â· ${ch.genre}${ch.quality ? " Â· " + ch.quality : ""}`,
      },
    });
  }

  const streamM = subPath.match(/^\/stream\/tv\/(.+)\.json$/);
  if (streamM) {
    const chId = decodeURIComponent(streamM[1]).replace(/^mshub-iptv-/, "");
    const ch = (await loadIptvChannels()).find((c) => c.id === chId);
    if (!ch) return jsonResponse({ streams: [] });
    const reqHeaders: Record<string, string> = {};
    if (ch.userAgent) reqHeaders["User-Agent"] = ch.userAgent;
    if (ch.referrer) reqHeaders["Referer"] = ch.referrer;
    // deno-lint-ignore no-explicit-any
    const stream: any = {
      url: ch.url,
      title: `${ch.name} Â· EN VIVO${ch.quality ? " Â· " + ch.quality : ""}`,
      behaviorHints: { notWebReady: true },
    };
    if (Object.keys(reqHeaders).length) {
      stream.behaviorHints.proxyHeaders = { request: reqHeaders };
    }
    return jsonResponse({ streams: [stream] });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /synopsis â€” MejoraStremio Synopsis IA, proxy de meta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LÃ³gica idÃ©ntica a deno-synopsis-enricher.ts.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const AIOMETADATA_BASE = "https://aiometadata.elfhosted.com";
const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
const PRESET_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/preset.json";

const AI_BUDGET_MS = 4000;
const SYNOPSIS_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dÃ­as

const SYNOPSIS_MANIFEST = {
  id: "com.mejorastremio.synopsis-proxy",
  version: "1.0.0",
  name: "MejoraStremio Synopsis IA",
  description:
    "Proxy de metadata: pasa AIOMetadata intacto y solo reescribe la sinopsis " +
    "cuando estÃ¡ corta o en inglÃ©s (Gemini, fallback OpenRouter). Cae a " +
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
async function fetchAioMeta(type: string, rawId: string): Promise<any> {
  const instanceId = await getInstanceId();
  const url = `${AIOMETADATA_BASE}/stremio/${instanceId}/meta/${type}/${rawId}.json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`AIOMetadata respondiÃ³ ${r.status}`);
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
    "ReescribÃ­ esta sinopsis en espaÃ±ol latino, mÃ¡s rica y detallada que el " +
    "original. No inventes giros de trama ni eventos especÃ­ficos que no estÃ©n " +
    "ya insinuados en el texto original â€” solo expandÃ­ tono, ambientaciÃ³n, " +
    "contexto y premisa. DevolvÃ© solo la sinopsis reescrita, sin comentarios " +
    "ni encabezados.\n\n" +
    `TÃ­tulo: ${title}${year ? ` (${year})` : ""}\n` +
    `GÃ©nero: ${genres || "desconocido"}\n` +
    `Sinopsis actual: ${description}`
  );
}

const GEMINI_SAFETY_OFF = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

async function callGemini(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const model = GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // Tatort es contenido policial (violencia, crimen) — sin esto Gemini
      // bloquea lotes con descripciones de escenas y la traducción sale a medias.
      safetySettings: GEMINI_SAFETY_OFF,
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    }),
    signal,
  });
  if (!r.ok) {
    // Si el modelo específico da 404, intentar fallback a gemini-1.5-flash
    if (r.status === 404 && model !== "gemini-1.5-flash") {
      const fbUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
      const fb = await fetch(fbUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          safetySettings: GEMINI_SAFETY_OFF,
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
        }),
        signal,
      });
      if (fb.ok) {
        const d = await fb.json();
        const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return String(text).trim();
      }
    }
    throw new Error(`Gemini respondió ${r.status}`);
  }
  const d = await r.json();
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: sin texto (" + (d?.candidates?.[0]?.finishReason || JSON.stringify(d).slice(0, 120)) + ")");
  return String(text).trim();
}

async function callOpenRouter(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: "user", content: prompt }] }),
    signal,
  });
  if (!r.ok) throw new Error(`OpenRouter respondiÃ³ ${r.status}`);
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
  // KV es solo cache (90 dÃ­as) â€” si no estÃ¡ disponible (ej. no hay database
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
      // sin cache, no es crÃ­tico
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
        // se devuelve la sinopsis original de AIOMetadata sin tocar
      }
    }

    return jsonResponse({ meta });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /miniseries â€” 1 temporada, â‰¤10 episodios, finalizada (catÃ¡logo) â”€â”€â”€â”€â”€â”€â”€
// TMDB Discover TV no soporta filtrar por temporadas/episodios (confirmado
// contra su doc oficial) â€” pero SÃ soporta `with_type=2` (Miniseries, segÃºn
// la clasificaciÃ³n propia de TMDB), sumado el 2026-08-28 tras confirmar el
// parÃ¡metro contra la doc oficial de Discover TV â€” antes el candidate pool
// era "cualquier show Ended por popularidad", con muy poco acierto real al
// filtrar despuÃ©s por temporadas/episodios (de ahÃ­ la cobertura floja ya
// documentada, ~2 tÃ­tulos). Con with_type=2 el pool ya viene pre-filtrado
// por la propia clasificaciÃ³n de TMDB, asÃ­ que la tasa de acierto del
// filtro de detalle deberÃ­a subir mucho â€” se mantiene igual como red de
// seguridad, porque "Miniseries" en TMDB no garantiza â‰¤10 episodios exactos.
// Se arma en dos pasos: Discover trae candidatos por tipo+popularidad+
// status=Ended, y un fetch de detalle por tÃ­tulo filtra por
// number_of_seasons/number_of_episodes. Requiere bastantes llamadas a TMDB
// por refresh, por eso se cachea agresivo (12h) y se acota el trabajo por
// request con un presupuesto de tiempo (deja lo que ya juntÃ³ si se pasa).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const TMDB_KEY = Deno.env.get("TMDB_API_KEY_AISEARCH") ?? "";
const TMDB_API = "https://api.themoviedb.org/3";

const MINISERIES_MANIFEST = {
  id: "com.mejorastremio.miniseries",
  version: "1.0.0",
  name: "Miniseries",
  description:
    "Series de 1 sola temporada, 10 episodios o menos, finalizadas â€” armado " +
    "vÃ­a TMDB Discover (with_type=Miniseries) + filtro de detalle por " +
    "temporadas/episodios, que Discover no soporta de forma directa.",
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
        // Nombres tal cual los devuelve TMDB (genre/tv/list?language=es-ES) â€” mezcla
        // inglÃ©s/espaÃ±ol real de TMDB, no una traducciÃ³n nuestra (mismo mix que ya
        // se ve en los catÃ¡logos de AIOMetadata, ver GEMINI.md "Metadata en espaÃ±ol").
        // Deben calzar exacto con detail.genres[].name para que el filtro matchee.
        options: [
          "Todos",
          "Action & Adventure",
          "AnimaciÃ³n",
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
  releaseInfo?: string;
  _d?: string;
}

let miniseriesCache: { at: number; metas: MiniseriesMeta[]; partial: boolean } | null = null;
const MINISERIES_FULL_TTL_MS = 12 * 60 * 60 * 1000; // 12h si el barrido terminÃ³ completo
const MINISERIES_PARTIAL_TTL_MS = 60 * 60 * 1000; // 1h si se cortÃ³ por presupuesto
const MINISERIES_BUDGET_MS = 20000;
const MINISERIES_DISCOVER_PAGES = 2;

// deno-lint-ignore no-explicit-any
async function tmdbGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params });
  const r = await fetch(`${TMDB_API}${path}?${qs}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`TMDB ${path} respondiÃ³ ${r.status}`);
  return await r.json();
}

async function buildMiniseriesCatalog(): Promise<{ metas: MiniseriesMeta[]; partial: boolean }> {
  const deadline = Date.now() + MINISERIES_BUDGET_MS;
  const candidates: number[] = [];

  for (let page = 1; page <= MINISERIES_DISCOVER_PAGES; page++) {
    if (Date.now() > deadline) return { metas: [], partial: true };
    try {
      const d = await tmdbGet("/discover/tv", {
        sort_by: "first_air_date.desc", // fecha desc siempre (ley dura 2026-09-07), nunca popularidad
        with_status: "3",
        with_type: "2", // Miniseries (clasificaciÃ³n propia de TMDB) â€” ver comentario arriba
        "vote_count.gte": "10",
        "first_air_date.lte": new Date().toISOString().slice(0, 10), // sin no-estrenadas al tope
        language: "es-ES",
        page: String(page),
      });
      // deno-lint-ignore no-explicit-any
      for (const s of (d?.results ?? []) as any[]) candidates.push(s.id);
    } catch {
      break; // se sigue con lo que ya se juntÃ³
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
          releaseInfo: (detail.first_air_date ?? "").slice(0, 4) || undefined,
          _d: detail.first_air_date ?? "",
        });
      }
    } catch {
      // se salta este candidato, sigue con el resto
    }
  }

  metas.sort((a, b) => (b._d ?? "").localeCompare(a._d ?? "")); // fecha desc siempre
  for (const m of metas) delete m._d;
  return { metas, partial };
}

async function getMiniseriesCatalog(): Promise<MiniseriesMeta[]> {
  const ttl = miniseriesCache?.partial ? MINISERIES_PARTIAL_TTL_MS : MINISERIES_FULL_TTL_MS;
  if (miniseriesCache && Date.now() - miniseriesCache.at < ttl) return miniseriesCache.metas;

  const stale = miniseriesCache?.metas ?? [];
  try {
    const { metas, partial } = await buildMiniseriesCatalog();
    // si el barrido no encontrÃ³ nada Ãºtil, mejor devolver lo viejo que una lista vacÃ­a
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
        if (genre && genre !== "Todos") metas = metas.filter((m) => m.genres.includes(genre));
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /short-series â€” series con episodios de 30 minutos o menos (catÃ¡logo) â”€
// Mismo problema que Miniseries: TMDB Discover TV no soporta filtrar por
// duraciÃ³n de episodio, asÃ­ que se arma en dos pasos (candidate pool por
// popularidad + fetch de detalle por tÃ­tulo chequeando episode_run_time).
// A diferencia de Miniseries, acÃ¡ NO se filtra por with_status â€” el
// formato "episodio corto" incluye tanto sitcoms en emisiÃ³n como shows ya
// terminados, no tiene sentido excluir contenido activo. Pedido de Pablo,
// sesiÃ³n 2026-08-28 (noche), junto con el catÃ¡logo de pelÃ­culas cortas
// (tmdb.discover.movie.short-form.pablo065, ese sÃ­ resuelto directo en
// preset.json porque Discover Movie SÃ soporta with_runtime).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const SHORT_SERIES_MANIFEST = {
  id: "com.mejorastremio.short-series",
  version: "1.1.0",
  name: "Comedias Cortas (30 min o menos)",
  description:
    "Sitcoms y comedias live-action cuyos episodios duran 30 minutos o menos. " +
    "TMDB Discover (comedia, sin animaciÃ³n) + confirmaciÃ³n por episode_run_time.",
  resources: ["catalog"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [{
    type: "series",
    id: "short-series",
    name: "Comedias Cortas (â‰¤30 min)",
    extra: [{ name: "skip" }],
  }],
};

interface ShortSeriesMeta {
  id: string;
  type: "series";
  name: string;
  poster: string | null;
  description: string;
  genres: string[];
  runtime: number;
  releaseInfo?: string;
  _d?: string;
}

let shortSeriesCache: { at: number; metas: ShortSeriesMeta[]; partial: boolean } | null = null;
const SHORT_SERIES_FULL_TTL_MS = 12 * 60 * 60 * 1000;
const SHORT_SERIES_PARTIAL_TTL_MS = 60 * 60 * 1000;
const SHORT_SERIES_BUDGET_MS = 24000;
const SHORT_SERIES_DISCOVER_PAGES = 5;

async function buildShortSeriesCatalog(): Promise<{ metas: ShortSeriesMeta[]; partial: boolean }> {
  const deadline = Date.now() + SHORT_SERIES_BUDGET_MS;
  const candidates: number[] = [];

  for (let page = 1; page <= SHORT_SERIES_DISCOVER_PAGES; page++) {
    if (Date.now() > deadline) return { metas: [], partial: true };
    try {
      const d = await tmdbGet("/discover/tv", {
        sort_by: "first_air_date.desc", // fecha desc siempre (ley dura 2026-09-07), nunca popularidad
        // with_runtime SÃ funciona en /discover/tv (la doc de la sesiÃ³n
        // 2026-08-28 estaba equivocada) â€” pre-filtra a formato corto. Es un
        // filtro laxo (incluye shows sin dato de runtime), por eso abajo se
        // confirma con episode_run_time del detalle.
        "with_runtime.lte": "30",
        "vote_count.gte": "40", // piso de calidad; el ruido lo saca without_genres, no popularidad
        "first_air_date.lte": new Date().toISOString().slice(0, 10),
        // Comedia + sin animaciÃ³n/kids/noticias/talk/soap: "series â‰¤30min" a
        // secas es 90% anime y dibujos (es lo que domina el formato corto a
        // nivel mundial). Acotarlo a comedia live-action lo vuelve el catÃ¡logo
        // Ãºtil para la cuenta â€” sitcoms para "algo cortito".
        with_genres: "35",
        without_genres: "16,10762,10763,10766,10767",
        language: "es-ES",
        page: String(page),
      });
      // deno-lint-ignore no-explicit-any
      for (const s of (d?.results ?? []) as any[]) candidates.push(s.id);
    } catch {
      break;
    }
  }

  const metas: ShortSeriesMeta[] = [];
  const seen = new Set<string>();
  let partial = false;

  // ConfirmaciÃ³n de detalle en paralelo (de a 8) â€” el fetch por tÃ­tulo era el
  // cuello de botella y dejaba el catÃ¡logo en ~7 resultados.
  for (let i = 0; i < candidates.length; i += 8) {
    if (Date.now() > deadline) { partial = true; break; }
    const batch = candidates.slice(i, i + 8);
    const details = await Promise.all(batch.map((id) =>
      tmdbGet(`/tv/${id}`, { language: "es-ES", append_to_response: "external_ids" }).catch(() => null)
    ));
    for (const detail of details) {
      const imdbId = detail?.external_ids?.imdb_id;
      // deno-lint-ignore no-explicit-any
      const runtimes = (detail?.episode_run_time ?? []) as any[];
      const maxRuntime = runtimes.length ? Math.max(...runtimes) : null;
      if (imdbId && !seen.has(imdbId) && maxRuntime !== null && maxRuntime > 0 && maxRuntime <= 30) {
        seen.add(imdbId);
        metas.push({
          id: imdbId,
          type: "series",
          name: detail.name,
          poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null,
          description: detail.overview ?? "",
          // deno-lint-ignore no-explicit-any
          genres: ((detail.genres ?? []) as any[]).map((g) => g.name),
          runtime: maxRuntime,
          releaseInfo: (detail.first_air_date ?? "").slice(0, 4) || undefined,
          _d: detail.first_air_date ?? "",
        });
      }
    }
  }

  metas.sort((a, b) => (b._d ?? "").localeCompare(a._d ?? "")); // fecha desc siempre
  for (const m of metas) delete m._d;
  return { metas, partial };
}

async function getShortSeriesCatalog(): Promise<ShortSeriesMeta[]> {
  const ttl = shortSeriesCache?.partial ? SHORT_SERIES_PARTIAL_TTL_MS : SHORT_SERIES_FULL_TTL_MS;
  if (shortSeriesCache && Date.now() - shortSeriesCache.at < ttl) return shortSeriesCache.metas;

  const stale = shortSeriesCache?.metas ?? [];
  try {
    const { metas, partial } = await buildShortSeriesCatalog();
    if (metas.length === 0 && stale.length > 0) return stale;
    shortSeriesCache = { at: Date.now(), metas, partial };
    return metas;
  } catch {
    return stale;
  }
}

async function handleShortSeries(subPath: string): Promise<Response> {
  if (!TMDB_KEY) {
    return new Response(
      "TMDB_API_KEY_AISEARCH no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(SHORT_SERIES_MANIFEST);
  }

  const catalogMatch = subPath.match(/^\/catalog\/series\/short-series(?:\/([^/]+))?\.json$/);
  if (catalogMatch) {
    try {
      let metas = await getShortSeriesCatalog();
      const extraStr = catalogMatch[1];
      if (extraStr) {
        const extra = new URLSearchParams(extraStr);
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /discover â€” Descubrir Maestro (Paso B): servicio+regiÃ³n+paÃ­s+idioma+
// gÃ©nero combinables como filtros simultÃ¡neos de un solo catÃ¡logo. TMDB
// Discover soporta los 4 ejes en una sola query (with_watch_providers+
// watch_region, with_origin_country, with_original_language, with_genres);
// el protocolo de Stremio no permite esto en un catÃ¡logo nativo de
// AIOMetadata (cada catÃ¡logo ahÃ­ es un preset fijo) â€” acÃ¡ cada eje es un
// "extra" del manifest con sus opciones, asÃ­ que el cliente de Stremio
// dibuja un dropdown por eje y los combina en la request al catÃ¡logo.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// provider_id reales de TMDB (verificados contra /watch/providers/movie en
// vivo, no adivinados â€” algunos ids cambian con el tiempo si el servicio se
// relanza, ej. HBO Max â†’ Max en 2023 mantuvo el id 1899).
const SERVICE_IDS: Record<string, number> = {
  "Netflix": 8,
  "Disney+": 337,
  "Prime Video": 9,
  "HBO Max": 1899,
  "Paramount+": 2303,
  "Hulu": 15,
  "Peacock": 386,
  "Apple TV+": 350,
  "Starz": 43,
  "Mubi": 11,
  "Criterion Channel": 258,
  "Shudder": 99,
  "Acorn TV": 87,
  "BritBox": 151,
  "Crunchyroll": 283,
};
const DISCOVER_WATCH_REGION = "AR"; // disponibilidad real para Pablo, no "world"/US genÃ©rico

const COUNTRY_IDS: Record<string, string> = {
  "Argentina": "AR", "EspaÃ±a": "ES", "Francia": "FR", "Alemania": "DE",
  "Italia": "IT", "Reino Unido": "GB", "Portugal": "PT", "MÃ©xico": "MX",
  "Colombia": "CO", "Chile": "CL", "Brasil": "BR", "PerÃº": "PE",
  "Estados Unidos": "US", "CanadÃ¡": "CA", "Australia": "AU", "Nueva Zelanda": "NZ",
  "JapÃ³n": "JP", "Corea": "KR", "China": "CN", "TaiwÃ¡n": "TW",
  "Tailandia": "TH", "Hong Kong": "HK", "India": "IN",
};
// Uniones OR (pipe-delimited, TMDB con with_origin_country) â€” un pseudo-paÃ­s
// "regional" que no existe como cÃ³digo ISO propio.
const REGION_IDS: Record<string, string> = {
  "LatinoamÃ©rica": "AR|MX|CO|CL|BR|PE",
  "Europa": "ES|FR|DE|IT|GB|PT",
  "NorteamÃ©rica": "US|CA",
  "Asia": "JP|KR|CN|TW|TH|HK|IN",
  "OceanÃ­a": "AU|NZ",
};

const LANGUAGE_IDS: Record<string, string> = {
  "EspaÃ±ol": "es", "InglÃ©s": "en", "FrancÃ©s": "fr", "AlemÃ¡n": "de",
  "Italiano": "it", "PortuguÃ©s": "pt", "JaponÃ©s": "ja", "Coreano": "ko",
  "Chino": "zh", "Hindi": "hi", "TailandÃ©s": "th",
};

const GENRE_IDS_MOVIE: Record<string, number> = {
  "AcciÃ³n": 28, "Aventura": 12, "AnimaciÃ³n": 16, "Comedia": 35, "Crimen": 80,
  "Documental": 99, "Drama": 18, "Familia": 10751, "FantasÃ­a": 14,
  "Historia": 36, "Terror": 27, "MÃºsica": 10402, "Misterio": 9648,
  "Romance": 10749, "Ciencia FicciÃ³n": 878, "Thriller": 53, "BÃ©lica": 10752,
  "Western": 37,
};
const GENRE_IDS_SERIES: Record<string, number> = {
  "AcciÃ³n y Aventura": 10759, "AnimaciÃ³n": 16, "Comedia": 35, "Crimen": 80,
  "Documental": 99, "Drama": 18, "Familia": 10751, "Infantil": 10762,
  "Misterio": 9648, "Noticias": 10763, "Reality": 10764,
  "Ciencia FicciÃ³n y FantasÃ­a": 10765, "Telenovela": 10766, "Talk Show": 10767,
  "BÃ©lica y PolÃ­tica": 10768, "Western": 37,
};

function discoverExtra(genreMap: Record<string, number>) {
  return [
    { name: "service", options: ["Todos", ...Object.keys(SERVICE_IDS)], isRequired: false },
    { name: "region", options: ["Todos", ...Object.keys(REGION_IDS)], isRequired: false },
    { name: "country", options: ["Todos", ...Object.keys(COUNTRY_IDS)], isRequired: false },
    { name: "language", options: ["Todos", ...Object.keys(LANGUAGE_IDS)], isRequired: false },
    { name: "genre", options: ["Todos", ...Object.keys(genreMap)], isRequired: false },
    { name: "skip" },
  ];
}

const DISCOVER_MANIFEST = {
  id: "com.mejorastremio.discover-master",
  version: "1.0.0",
  name: "Descubrir Maestro",
  description:
    "CatÃ¡logo Ãºnico con servicio de streaming, regiÃ³n, paÃ­s, idioma y gÃ©nero " +
    "combinables como filtros simultÃ¡neos (TMDB Discover) â€” a diferencia de " +
    "AIOMetadata, donde cada eje es un catÃ¡logo fijo separado.",
  resources: ["catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    { type: "movie", id: "discover-master", name: "Descubrir Maestro", extra: discoverExtra(GENRE_IDS_MOVIE) },
    { type: "series", id: "discover-master", name: "Descubrir Maestro", extra: discoverExtra(GENRE_IDS_SERIES) },
  ],
};

// tmdbId -> imdbId. En memoria (vive mientras el isolate estÃ© caliente) â€”
// evita repetir el fetch de external_ids en refreshes sucesivos del mismo
// tÃ­tulo; no es crÃ­tico si se pierde en un cold start, se repuebla solo.
const imdbIdCache = new Map<number, string | null>();

async function resolveImdbId(tmdbId: number): Promise<string | null> {
  if (imdbIdCache.has(tmdbId)) return imdbIdCache.get(tmdbId)!;
  try {
    const d = await tmdbGet(`/movie/${tmdbId}/external_ids`, {});
    const id = d?.imdb_id ?? null;
    imdbIdCache.set(tmdbId, id);
    return id;
  } catch {
    return null;
  }
}
async function resolveImdbIdTv(tmdbId: number): Promise<string | null> {
  if (imdbIdCache.has(tmdbId)) return imdbIdCache.get(tmdbId)!;
  try {
    const d = await tmdbGet(`/tv/${tmdbId}/external_ids`, {});
    const id = d?.imdb_id ?? null;
    imdbIdCache.set(tmdbId, id);
    return id;
  } catch {
    return null;
  }
}

async function handleDiscover(subPath: string, url: URL): Promise<Response> {
  if (!TMDB_KEY) {
    return new Response(
      "TMDB_API_KEY_AISEARCH no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(DISCOVER_MANIFEST);
  }

  // /discover/recent â€” helper interno (no es un catÃ¡logo de Stremio) usado por
  // monthly-digest.mjs: tÃ­tulo "de tu gusto" estrenado en los Ãºltimos N dÃ­as,
  // por paÃ­s/gÃ©nero. Reusa exactamente los mismos SERVICE_IDS/COUNTRY_IDS/
  // GENRE_IDS que discover-master, pero ordenado por fecha desc en vez de
  // popularidad y con la fecha de estreno en la respuesta (discover-master la
  // recorta a propÃ³sito porque no la necesita).
  if (subPath.startsWith("/recent")) {
    const qs = url.searchParams;
    const type = qs.get("type") === "series" ? "series" : "movie";
    const country = qs.get("country");
    const genre = qs.get("genre");
    const days = Math.min(60, Math.max(1, parseInt(qs.get("days") ?? "35", 10)));
    const genreMap = type === "movie" ? GENRE_IDS_MOVIE : GENRE_IDS_SERIES;
    // Gotcha real de TMDB: el filtro de query para movies es "primary_release_date"
    // pero el campo que trae DE VUELTA cada resultado es "release_date" (para tv
    // ambos coinciden en "first_air_date").
    const queryDateField = type === "movie" ? "primary_release_date" : "first_air_date";
    const responseDateField = type === "movie" ? "release_date" : "first_air_date";
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const params: Record<string, string> = {
      sort_by: `${queryDateField}.desc`,
      language: "es-ES",
      "vote_count.gte": "5",
      [`${queryDateField}.gte`]: since,
      [`${queryDateField}.lte`]: new Date().toISOString().slice(0, 10),
    };
    if (country && COUNTRY_IDS[country]) params.with_origin_country = COUNTRY_IDS[country];
    if (genre && genreMap[genre]) params.with_genres = String(genreMap[genre]);
    try {
      const path = type === "movie" ? "/discover/movie" : "/discover/tv";
      const d = await tmdbGet(path, params);
      // deno-lint-ignore no-explicit-any
      const results = ((d?.results ?? []) as any[]).slice(0, 10);
      const items = results.map((r) => ({
        name: r.title ?? r.name,
        date: r[responseDateField] ?? null,
        overview: (r.overview ?? "").slice(0, 160),
      }));
      return jsonResponse({ type, country: country ?? null, genre: genre ?? null, items });
    } catch (e) {
      return jsonResponse({ items: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const catalogMatch = subPath.match(/^\/catalog\/(movie|series)\/discover-master(?:\/([^/]+))?\.json$/);
  if (!catalogMatch) {
    return new Response("Not found", { status: 404, headers: cors });
  }
  const [, type, extraStr] = catalogMatch;
  const genreMap = type === "movie" ? GENRE_IDS_MOVIE : GENRE_IDS_SERIES;

  const extra = new URLSearchParams(extraStr ?? "");
  const service = extra.get("service");
  const region = extra.get("region");
  const country = extra.get("country");
  const language = extra.get("language");
  const genre = extra.get("genre");
  const skip = parseInt(extra.get("skip") ?? "0", 10);
  const page = Math.floor(skip / 20) + 1;

  // Orden por fecha de estreno/emisiÃ³n desc â€” SIEMPRE, sin popularidad (ley dura
  // de Pablo, 2026-09-07). vote_count.gte se mantiene como piso de calidad (no es
  // popularidad, es confianza en el dato â€” dogma feedback_quality_over_quantity).
  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
  const params: Record<string, string> = {
    sort_by: `${dateField}.desc`,
    language: "es-ES",
    page: String(page),
    "vote_count.gte": "20",
  };
  // Series: sacar telediarios y talk shows â€” se cuelan con with_origin_country
  // por paÃ­s (ej. "Alemania + Crimen" traÃ­a Tagesschau) y nunca son lo buscado.
  if (type === "series") params.without_genres = "10763,10767";
  if (service && service !== "Todos" && SERVICE_IDS[service]) {
    params.with_watch_providers = String(SERVICE_IDS[service]);
    params.watch_region = DISCOVER_WATCH_REGION;
  }
  // paÃ­s puntual gana sobre regiÃ³n si ambos vienen seteados (evita una
  // combinaciÃ³n contradictoria silenciosa).
  if (country && country !== "Todos" && COUNTRY_IDS[country]) {
    params.with_origin_country = COUNTRY_IDS[country];
  } else if (region && region !== "Todos" && REGION_IDS[region]) {
    params.with_origin_country = REGION_IDS[region];
  }
  if (language && language !== "Todos" && LANGUAGE_IDS[language]) {
    params.with_original_language = LANGUAGE_IDS[language];
  }
  if (genre && genre !== "Todos" && genreMap[genre]) {
    params.with_genres = String(genreMap[genre]);
  }

  try {
    const path = type === "movie" ? "/discover/movie" : "/discover/tv";
    const d = await tmdbGet(path, params);
    // deno-lint-ignore no-explicit-any
    const results = (d?.results ?? []) as any[];

    const resolved = await Promise.all(results.map(async (r) => {
      const imdbId = type === "movie"
        ? await resolveImdbId(r.id)
        : await resolveImdbIdTv(r.id);
      if (!imdbId) return null;
      const d0 = (r.release_date ?? r.first_air_date ?? "") as string;
      return {
        id: imdbId,
        type,
        name: r.title ?? r.name,
        poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
        description: r.overview ?? "",
        releaseInfo: d0 ? d0.slice(0, 4) : undefined,
        _d: d0,
      };
    }));

    const metas = resolved
      .filter((m) => m !== null)
      .sort((a, b) => (b!._d).localeCompare(a!._d))  // fecha desc, garantÃ­a extra sobre el orden de TMDB
      // deno-lint-ignore no-explicit-any
      .map(({ _d, ...m }: any) => m);
    return jsonResponse({ metas });
  } catch (e) {
    return jsonResponse({ metas: [], error: (e as Error).message }, { status: 500 });
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /mediathek â€” streams directos de la Mediathek alemana (Tatort) â”€â”€â”€â”€â”€â”€â”€â”€
// La antologÃ­a Tatort (tt0806910) casi no tiene cobertura en los indexers de
// torrents (los releases se nombran por Folge/caso, no SxxExx, asÃ­ que
// Torrentio/Comet no los mapean al esquema season=aÃ±o de Cinemeta). Pero la
// ARD/SWR/WDR/NDR/â€¦ mantienen online cientos de episodios en la Mediathek
// pÃºblica, con MP4 progresivo directo + subtÃ­tulo alemÃ¡n oficial (EBU-TT-D).
// Este addon los expone como streams y adjunta, en el propio stream, un
// subtÃ­tulo en espaÃ±ol latino generado por /translate a partir de esa pista
// alemana (perfectamente sincronizada con el mismo archivo).
//
// Fuente: MediathekViewWeb (mediathekviewweb.de/api/query) â€” API JSON pÃºblica
// que agrega las Filmlisten de todos los canales pÃºblicos alemanes + ORF.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const MVW_API = "https://mediathekviewweb.de/api/query";

// Series policiales alemanas de antologÃ­a (episodios autoconclusivos por tÃ­tulo de
// caso) que estÃ¡n en la Mediathek pÃºblica. Todas comparten el mismo esquema:
// buscar por `topic`, matchear el tÃ­tulo del caso contra la Filmliste.
const MEDIATHEK_SHOWS: Record<string, { topic: string; minDur: number }> = {
  "tt0806910": { topic: "Tatort", minDur: 3300 },          // ~89 min
  "tt0806901": { topic: "Polizeiruf 110", minDur: 3300 },  // ~89 min
  "tt0274279": { topic: "SOKO Leipzig", minDur: 2400 },    // ~44 min
};

const MEDIATHEK_MANIFEST = {
  id: "com.mejorastremio.mediathek",
  version: "1.1.0",
  name: "Mediathek DE (policiales)",
  description:
    "Streams directos de la Mediathek pÃºblica alemana (ARD/ZDF/SWR/WDR/NDR/MDR/RBB/BRâ€¦) para " +
    "Tatort, Polizeiruf 110 y SOKO Leipzig â€” audio alemÃ¡n HD, sin torrents ni debrid. Cada " +
    "stream trae adjunto el subtÃ­tulo alemÃ¡n oficial y una traducciÃ³n IA al espaÃ±ol latino.",
  resources: ["stream"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

interface MvwFilm {
  channel: string;
  title: string;
  duration: number;
  urlHd: string;
  urlMp4: string;
  urlLow: string;
  urlSub: string;
  ts: number;
  normTitle: string;
}

const MVW_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function normTitleKey(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bteil\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "Odenthal - 81 - Der Stelzenmann" -> "Der Stelzenmann"  (formato Tatort)
// "Tatort: Das Haus am Ende der StraÃŸe" -> "Das Haus am Ende der StraÃŸe"
// "Goldraub" -> "Goldraub"  (Polizeiruf/SOKO: el nombre ya es el tÃ­tulo del caso)
// "Episode 12" -> ""  (placeholder de Cinemeta sin tÃ­tulo real â†’ no se puede matchear)
function showCaseTitle(episodeName: string, topic: string): string {
  let n = String(episodeName || "");
  if (/^episode\s+\d+$/i.test(n.trim())) return "";
  const dash = n.match(/^.*?-\s*\d+\s*-\s*(.+)$/); // "Detective - NN - TÃ­tulo"
  if (dash) n = dash[1];
  n = n.replace(new RegExp(`^${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:\\s-]+`, "i"), "")
    .replace(/\(.*?\)/g, "").trim();
  return n;
}

const mvwCacheByTopic = new Map<string, { at: number; films: MvwFilm[] }>();

async function loadMvwShow(topic: string, minDur: number): Promise<MvwFilm[]> {
  const cached = mvwCacheByTopic.get(topic);
  if (cached && Date.now() - cached.at < MVW_CACHE_TTL_MS) return cached.films;
  const films: MvwFilm[] = [];
  for (let offset = 0; offset < 2400; offset += 100) {
    const r = await fetch(MVW_API, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        queries: [{ fields: ["topic"], query: topic }],
        sortBy: "timestamp",
        sortOrder: "desc",
        future: false,
        offset,
        size: 100,
      }),
      signal: AbortSignal.timeout(15000),
    }).then((x) => x.json()).catch(() => null);
    // deno-lint-ignore no-explicit-any
    const res: any[] = r?.result?.results ?? [];
    for (const x of res) {
      if ((x.duration ?? 0) < minDur) continue; // descarta trailers/clips, deja solo episodios completos
      if (/Audiodeskription|H[oÃ¶]rfassung|klare Sprache|Geb[aÃ¤]rden/i.test(x.title)) continue;
      const hd = String(x.url_video_hd || "");
      const mp4 = String(x.url_video || "");
      if (/audio_description|sign_language|\.ad\.|_ad_/i.test(hd + mp4)) continue;
      films.push({
        channel: x.channel,
        title: x.title,
        duration: x.duration,
        urlHd: hd,
        urlMp4: mp4,
        urlLow: x.url_video_low || "",
        urlSub: x.url_subtitle || "",
        ts: x.timestamp || 0,
        normTitle: normTitleKey(String(x.title).replace(/\(.*?\)/g, "").replace(new RegExp(`^${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:\\s-]+`, "i"), "")),
      });
    }
    if (res.length < 100) break;
  }
  mvwCacheByTopic.set(topic, { at: Date.now(), films });
  return films;
}

function matchMvwFilms(films: MvwFilm[], caseTitle: string): MvwFilm[] {
  const key = normTitleKey(caseTitle);
  if (key.length < 3) return [];
  const exact = films.filter((f) => f.normTitle === key);
  if (exact.length) return dedupeFilms(exact);
  const contains = films.filter(
    (f) =>
      (key.length >= 6 && f.normTitle.includes(key)) ||
      (f.normTitle.length >= 6 && key.includes(f.normTitle)),
  );
  return dedupeFilms(contains);
}

function dedupeFilms(films: MvwFilm[]): MvwFilm[] {
  const best = new Map<string, MvwFilm>();
  for (const f of films) {
    const k = `${f.channel}|${f.normTitle}|${Math.round(f.duration / 30)}`;
    const cur = best.get(k);
    if (!cur || (!cur.urlHd && f.urlHd) || (!cur.urlSub && f.urlSub)) best.set(k, f);
  }
  return [...best.values()].sort((a, b) => (b.urlSub ? 1 : 0) - (a.urlSub ? 1 : 0) || b.ts - a.ts);
}

const b64u = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};

async function handleMediathek(subPath: string, mountBase: string, translateMount: string): Promise<Response> {
  if (subPath === "/manifest.json") return jsonResponse(MEDIATHEK_MANIFEST);

  const m = subPath.match(/^\/stream\/series\/(.+)\.json$/);
  if (!m) return new Response("Not found", { status: 404, headers: cors });

  const { imdbId, season: sNum, episode: eNum } = parseStremioSubId(m[1]);
  const sRaw = sNum != null ? String(sNum) : "";
  const eRaw = eNum != null ? String(eNum) : "";
  const show = MEDIATHEK_SHOWS[imdbId];
  if (!show || !sRaw || !eRaw) return jsonResponse({ streams: [] });

  try {
    const meta = await fetchCinemetaMeta("series", imdbId);
    const vid = (meta?.videos ?? []).find(
      // deno-lint-ignore no-explicit-any
      (v: any) => String(v.season) === sRaw && String(v.number) === eRaw,
    );
    const caseTitle = showCaseTitle(vid?.name ?? "", show.topic);
    if (!caseTitle) return jsonResponse({ streams: [] });

    const films = await loadMvwShow(show.topic, show.minDur);
    const matched = matchMvwFilms(films, caseTitle);

    const streams = matched.slice(0, 6).map((f) => {
      const video = f.urlHd || f.urlMp4 || f.urlLow;
      const quality = f.urlHd ? "1080p" : f.urlMp4 ? "720p" : "360p";
      const subs: { id: string; url: string; lang: string }[] = [];
      if (f.urlSub) {
        subs.push({ id: "de-oficial", url: f.urlSub, lang: "ger" });
        subs.push({
          id: "es-latino-ia",
          url: `${translateMount}/x/${b64u.enc(f.urlSub)}.srt`,
          lang: "spa",
        });
      }
      return {
        name: `Mediathek DE\n${quality}`,
        title: `${f.channel} Â· ${caseTitle}\nðŸ‡©ðŸ‡ª audio alemÃ¡n${f.urlSub ? " Â· sub DE oficial + IAâ†’ES latino" : ""} Â· ${Math.round(f.duration / 60)}min`,
        url: video,
        subtitles: subs,
        behaviorHints: { notWebReady: /\.m3u8($|\?)/.test(video), bingeGroup: `mediathek-${imdbId}` },
      };
    });

    return jsonResponse({ streams });
  } catch (e) {
    return jsonResponse({ streams: [], error: (e as Error).message }, { status: 500 });
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /translate â€” subtÃ­tulo ES latino generado por IA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Para contenido alemÃ¡n (u otro) que NO tiene ningÃºn subtÃ­tulo en espaÃ±ol
// pre-hecho en ninguna fuente (Tatort: OpenSubtitles.com tiene 1 en toda la
// historia de la serie; SubDL 0). Toma la mejor pista base disponible
// â€”alemÃ¡n oficial de la Mediathek si es Tatort, si no alemÃ¡n/inglÃ©s de
// OpenSubtitles.comâ€” y la traduce al espaÃ±ol latino con IA (Gemini, fallback
// OpenRouter), en lotes paralelos. Cachea el SRT resultante 90 dÃ­as en KV.
//
// Se auto-limita: si ya existe algÃºn subtÃ­tulo ES real en OpenSubtitles.com
// para ese tÃ­tulo, no ofrece nada (no ensucia la lista de contenido que ya
// estÃ¡ bien cubierto). Solo aparece donde de verdad hace falta.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const TRANSLATE_MANIFEST = {
  id: "com.mejorastremio.translate",
  version: "1.0.0",
  name: "TraducciÃ³n IA â†’ ES latino",
  description:
    "Genera un subtÃ­tulo en espaÃ±ol latino traduciendo con IA la mejor pista alemana o " +
    "inglesa disponible. Pensado para contenido alemÃ¡n sin subs ES (Tatort y similares). " +
    "Cachea 90 dÃ­as â€” la primera apertura de un episodio tarda ~20-40s, despuÃ©s es instantÃ¡nea.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

const TRANSLATE_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Fast-Window Sync: Límite estricto de corte síncrono a 4 segundos
// para responderle de inmediato a Stremio (evita timeout de 10-15s en Android TV).
const FAST_WINDOW_BUDGET_MS = 4000;
const FAST_WINDOW_CUES = 70; // Primeros ~10 minutos de diálogo
const TRANSLATE_BATCH = 100;
const TRANSLATE_PARALLEL = 3;
const NL = "âŽ"; // sentinel para saltos de lÃ­nea internos al mandar a la IA
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Cue { start: string; end: string; text: string }

// Una cue "solo sonido" no se traduce (y de hecho se descarta del SRT final):
// "(spannungsvolle Musik)", "[TÃ¼r quietscht]", ".", "â™ª ... â™ª", lÃ­neas todas
// entre parÃ©ntesis. Para alguien que mira en alemÃ¡n con subs ES son ruido.
function isSoundOnly(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || /^[.\-â€“â€”#â™ª*\s]+$/.test(t)) return true;
  const oneLine = t.replace(/\s+/g, " ");
  // toda la cue entre ( ), [ ] o * * (los 3 estilos de acotaciÃ³n sonora de la
  // Mediathek): "(spannungsvolle Musik)", "[TÃ¼r quietscht]", "* Musik *"
  if (/^[(\[*][^)\]]*[)\]*]$/.test(oneLine)) return true;
  return t.split("\n").every((l) => l.trim() === "" || /^[(\[*][^)\]]*[)\]*]$/.test(l.trim()));
}

// HeurÃ­stica de contenido para SDH real, para cuando el flag del proveedor (SubDL
// "hi", OpenSubtitles "hearing_impaired") viene mal cargado en la fuente. Confirmado
// 2026-09-05 con evidencia real: OpenSubtitles devolviÃ³ hi:false en un archivo de HPI/ACI
// lleno de "(SUSPIRA)"/"(CANTURREA)"/letras de canciÃ³n entre â™ª; SubDL devuelve hi:false
// para TODOS sus resultados sin excepciÃ³n, incluidos archivos con "Hi" en el nombre. No
// hay forma de confiar ciegamente en el campo â€” se cuenta quÃ© fracciÃ³n de las cues son
// puramente descripciÃ³n de sonido (isSoundOnly) o tienen una acotaciÃ³n entre parÃ©ntesis/
// corchetes intercalada en el diÃ¡logo. Umbral conservador (mejor un falso negativo
// ocasional que descartar un subtÃ­tulo real por error) â€” requiere al menos 8 cues para
// no arriesgar un veredicto con muestra chica.
function isSdhName(name: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return /\b(sdh|cc|forced|forzados)\b/i.test(n) || /[\(\[\{](sdh|cc|forced)[\)\]\}]/i.test(n);
}

function looksLikeSDH(srtText: string): boolean {
  const cues = parseSrt(srtText);
  if (cues.length < 8) return false;
  const soundOnly = cues.filter((c) => isSoundOnly(c.text)).length;
  const bracketed = cues.filter((c) => /[(\[][^)\]\n]{2,50}[)\]]/.test(c.text)).length;
  // SeÃ±al fuerte y especÃ­fica: una acotaciÃ³n TODO EN MAYÃšSCULAS entre parÃ©ntesis/
  // corchetes -- "(SUSPIRA)", "(CANTURREA)", "(SE OYE UN GOLPE)" -- el diÃ¡logo real casi
  // nunca usa mayÃºsculas sostenidas, asÃ­ que esto casi no da falsos positivos.
  const capsTag = cues.filter((c) => /[(\[]\s*[A-ZÃÃ‰ÃÃ“ÃšÃ‘][A-ZÃÃ‰ÃÃ“ÃšÃ‘\s]{1,35}[)\]]/.test(c.text)).length;
  // Calibrado 2026-09-05 contra un caso real confirmado (HPI/ACI 1x01: 964 cues, 4.3%
  // sonido puro, 5.5% con acotaciÃ³n entre parÃ©ntesis, ejemplos reales "(SUSPIRA)",
  // "(CANTURREA)", "(RESOPLA)", "(Disparo)", "(Llanto)") -- el umbral viejo (6%/15%)
  // dejaba pasar este caso de punta a punta. Bajado a un piso que sÃ­ lo detecta, sin
  // ser tan sensible como para marcar un subtÃ­tulo limpio por 1-2 cues sueltas.
  return soundOnly / cues.length > 0.02 || bracketed / cues.length > 0.03 || capsTag / cues.length > 0.015;
}

// EBU-TT-D / TTML (Mediathek alemana) -> cues
function parseEbuTt(xml: string): Cue[] {
  const cues: Cue[] = [];
  const re = /<(?:tt:)?p\b([^>]*)>([\s\S]*?)<\/(?:tt:)?p>/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(xml))) {
    const attrs = mm[1];
    const begin = /begin="([^"]+)"/.exec(attrs)?.[1];
    const end = /end="([^"]+)"/.exec(attrs)?.[1];
    if (!begin || !end) continue;
    const text = mm[2]
      .replace(/<(?:tt:)?br\s*\/?>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
      .replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n")
      .replace(/\n{2,}/g, "\n").trim();
    if (!text) continue;
    const s = normTtmlTime(begin), e = normTtmlTime(end);
    const last = cues[cues.length - 1];
    if (last && last.start === s && last.end === e) last.text += "\n" + text;
    else cues.push({ start: s, end: e, text });
  }
  return cues;
}

// "00:01:02.240" | "00:01:02:12" (frames) -> "00:01:02,240"
function normTtmlTime(t: string): string {
  const mSec = t.match(/^(\d{2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (mSec) return `${mSec[1]}:${mSec[2]}:${mSec[3]},${mSec[4].padEnd(3, "0")}`;
  const mFr = t.match(/^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (mFr) {
    const ms = Math.round((parseInt(mFr[4], 10) / 25) * 1000);
    return `${mFr[1]}:${mFr[2]}:${mFr[3]},${String(ms).padStart(3, "0")}`;
  }
  return t.replace(".", ",");
}

function parseSrt(srt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = srt.replace(/\r/g, "").split(/\n\n+/);
  for (const b of blocks) {
    const mt = b.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
    if (!mt) continue;
    const text = b.split("\n").slice(b.split("\n").findIndex((l) => l.includes("-->")) + 1).join("\n").trim();
    if (!text) continue;
    cues.push({ start: mt[1].replace(".", ","), end: mt[2].replace(".", ","), text });
  }
  return cues;
}

function serializeSrt(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${c.start} --> ${c.end}\n${c.text}`)
    .join("\n\n") + "\n";
}

const TRANSLATE_SYS =
  "Sos traductor profesional de subtÃ­tulos. TraducÃ­ del alemÃ¡n (o inglÃ©s) al ESPAÃ‘OL " +
  "LATINOAMERICANO NEUTRO â€” el registro de doblaje: nada de 'vosotros', nada de 'coger' " +
  "por agarrar, trato 'usted'/'tÃº' segÃºn la formalidad, modismos neutros (ni argentino, " +
  "ni mexicano, ni espaÃ±ol de EspaÃ±a). Es una serie policial alemana (Tatort). ConservÃ¡ " +
  "el tono y las malas palabras. RecibÃ­s lÃ­neas numeradas '<n>â–¸ <texto>'. DevolvÃ© " +
  "EXACTAMENTE las mismas lÃ­neas numeradas '<n>â–¸ <traducciÃ³n>', una por lÃ­nea, mismo n, " +
  `misma cantidad, sin texto extra. El sÃ­mbolo ${NL} es un salto de lÃ­nea interno: dejalo donde estÃ¡.`;

// Parsea la respuesta numerada del modelo. Devuelve map n->texto.
function parseNumbered(raw: string): Map<number, string> {
  const out = new Map<number, string>();
  const re = /(^|\n)\s*(\d+)\s*â–¸\s*([\s\S]*?)(?=\n\s*\d+\s*â–¸|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.set(parseInt(m[2], 10), m[3].trim());
  return out;
}

// Traduce un lote. Devuelve el mapa n->texto (con fallback al original en las
// lÃ­neas que la IA no devolviÃ³) y `ok` = si la IA cubriÃ³ â‰¥90% del lote (para
// decidir si vale cachearlo). OpenRouter free quedÃ³ descartado del camino de
// subtÃ­tulos: su router tarda >40s por request. Gemini flash-lite hace 80
// lÃ­neas en ~5s y aguanta rÃ¡fagas paralelas sin rate-limit.
async function translateBatch(
  items: { n: number; text: string }[],
  signal: AbortSignal,
): Promise<{ map: Map<number, string>; ok: boolean }> {
  const payload = items.map((it) => `${it.n}â–¸ ${it.text.replace(/\n/g, NL)}`).join("\n");
  const prompt = `${TRANSLATE_SYS}\n\n${payload}`;

  const merged = new Map<number, string>();
  for (let attempt = 0; attempt < 4 && merged.size < items.length; attempt++) {
    // Tras el primer intento, se re-piden SOLO las lÃ­neas que faltan â€” un lote
    // mÃ¡s chico parsea mejor y no re-gasta tiempo en lo ya traducido.
    const todo = attempt === 0 ? items : items.filter((it) => !merged.has(it.n));
    if (!todo.length) break;
    const p = attempt === 0
      ? prompt
      : `${TRANSLATE_SYS}\n\n${todo.map((it) => `${it.n}â–¸ ${it.text.replace(/\n/g, NL)}`).join("\n")}`;
    try {
      const parsed = parseNumbered(await callGemini(p, GEMINI_API_KEY, signal));
      for (const it of todo) {
        if (!merged.has(it.n) && parsed.has(it.n)) merged.set(it.n, parsed.get(it.n)!);
      }
    } catch (e) {
      const msg = (e as Error).message;
      // 429 (cuota) / 503 (sobrecarga) de Gemini: esperar y reintentar.
      if (/429|503/.test(msg) && attempt < 3) await sleep(3500 + attempt * 3500);
      else if (attempt >= 3) console.log(`[translate] batch n0=${items[0]?.n} agotÃ³ reintentos: ${msg}`);
    }
  }

  const map = new Map<number, string>();
  for (const it of items) {
    const t = merged.get(it.n);
    map.set(it.n, t ? t.replace(new RegExp(NL, "g"), "\n") : it.text);
  }
  // â‰¥80% traducido = se acepta y se cachea (el resto queda en alemÃ¡n). Un puÃ±ado
  // de lÃ­neas sueltas sin traducir no justifica que cada apertura rehaga 30s.
  return { map, ok: merged.size >= items.length * 0.8 };
}

// Traduce solo las cues de diÃ¡logo, con cache por-lote en KV para que un
// reintento (o el pre-warm) no rehaga lo ya hecho. cacheRef identifica la
// pista base (url ARD o os-<fileId>).
async function translateCues(
  cues: Cue[],
  cacheRef: string,
  kv: Deno.Kv | null,
  deadline: number,
): Promise<{ texts: string[]; done: boolean }> {
  const texts = cues.map((c) => c.text);
  const dialogueIdx = cues.map((c, i) => (isSoundOnly(c.text) ? -1 : i)).filter((i) => i >= 0);

  // Dividir en lotes: Lote 0 es Fast-Window (primeras 70 cues / ~10 min), el resto en lotes de 100
  const batches: number[][] = [];
  if (dialogueIdx.length <= FAST_WINDOW_CUES) {
    batches.push(dialogueIdx);
  } else {
    batches.push(dialogueIdx.slice(0, FAST_WINDOW_CUES));
    for (let i = FAST_WINDOW_CUES; i < dialogueIdx.length; i += TRANSLATE_BATCH) {
      batches.push(dialogueIdx.slice(i, i + TRANSLATE_BATCH));
    }
  }

  // Estado por lote: pendiente hasta que quede cacheado o traducido
  const pending = new Set(batches.map((_, i) => i));

  // Primera pasada: leer de KV lo ya hecho
  if (kv) {
    await Promise.all([...pending].map(async (bi) => {
      try {
        const hit = await kv.get<Record<string, string>>(["tr-batch", "v8", cacheRef, bi]);
        if (hit.value) {
          for (const idx of batches[bi]) texts[idx] = hit.value[idx] ?? texts[idx];
          pending.delete(bi);
        }
      } catch { /* queda pendiente */ }
    }));
  }

  // Si ya todo está en cache KV, salir inmediatamente
  if (pending.size === 0) {
    return { texts, done: true };
  }

  // Fase 1 Síncrona: Traducir Lote 0 (Fast Window) dentro del límite estricto de 4s
  if (pending.has(0)) {
    const remaining = Math.max(1000, deadline - Date.now());
    const batchIdxs = batches[0];
    const items = batchIdxs.map((idx) => ({ n: idx, text: texts[idx] }));
    const { map, ok } = await translateBatch(items, AbortSignal.timeout(remaining));
    for (const idx of batchIdxs) texts[idx] = map.get(idx) ?? texts[idx];
    if (ok) {
      pending.delete(0);
      if (kv) {
        const obj: Record<string, string> = {};
        for (const idx of batchIdxs) obj[idx] = texts[idx];
        try { await kv.set(["tr-batch", "v8", cacheRef, 0], obj, { expireIn: TRANSLATE_CACHE_TTL_MS }); } catch { /* sin cache */ }
      }
    }
  }

  // Si aún queda presupuesto antes de los 4s, intentar lotes subsiguientes
  for (let bi = 1; bi < batches.length && pending.has(bi) && Date.now() < deadline - 800; bi++) {
    const remaining = Math.max(800, deadline - Date.now());
    const batchIdxs = batches[bi];
    const items = batchIdxs.map((idx) => ({ n: idx, text: texts[idx] }));
    const { map, ok } = await translateBatch(items, AbortSignal.timeout(remaining));
    for (const idx of batchIdxs) texts[idx] = map.get(idx) ?? texts[idx];
    if (ok) {
      pending.delete(bi);
      if (kv) {
        const obj: Record<string, string> = {};
        for (const idx of batchIdxs) obj[idx] = texts[idx];
        try { await kv.set(["tr-batch", "v8", cacheRef, bi], obj, { expireIn: TRANSLATE_CACHE_TTL_MS }); } catch { /* sin cache */ }
      }
    }
  }

  const isDone = pending.size === 0;

  // Fase 2 Asíncrona (Background Job): Si quedan lotes posteriores pendientes, continuar en segundo plano sin bloquear
  if (!isDone && kv) {
    const bgPending = [...pending];
    const bgTask = async () => {
      try {
        for (let round = 0; round < 6 && bgPending.length > 0; round++) {
          const wave = bgPending.splice(0, TRANSLATE_PARALLEL);
          await Promise.all(wave.map(async (bi) => {
            const batchIdxs = batches[bi];
            const items = batchIdxs.map((idx) => ({ n: idx, text: texts[idx] }));
            const { map, ok } = await translateBatch(items, AbortSignal.timeout(18000));
            for (const idx of batchIdxs) texts[idx] = map.get(idx) ?? texts[idx];
            if (ok && kv) {
              const obj: Record<string, string> = {};
              for (const idx of batchIdxs) obj[idx] = texts[idx];
              try { await kv.set(["tr-batch", "v8", cacheRef, bi], obj, { expireIn: TRANSLATE_CACHE_TTL_MS }); } catch { /* sin cache */ }
            }
          }));
        }
        // Cachear el subtítulo completo en KV para subsecuentes consultas / seeks
        const outCues = cues.map((c, i) => ({ ...c, text: texts[i] })).filter((c) => !isSoundOnly(c.text));
        const finalSrt = serializeSrt(outCues);
        await kv.set(["translate-srt", "v8", cacheRef], finalSrt, { expireIn: TRANSLATE_CACHE_TTL_MS });
      } catch { /* background fallback silencioso */ }
    };

    // Invocar en background vía waitUntil si está disponible o tarea asíncrona
    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime && typeof runtime.waitUntil === "function") {
      runtime.waitUntil(bgTask());
    } else {
      bgTask();
    }
  }

  return { texts, done: isDone };
}

async function fetchBaseCues(src: { t: string; u?: string; f?: number }): Promise<Cue[]> {
  if (src.t === "ard" && src.u) {
    const r = await fetch(src.u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`base ARD ${r.status}`);
    return parseEbuTt(await r.text());
  }
  if (src.t === "os" && src.f) {
    const dl = await fetch(`${OPENSUBTITLES_API}/download`, {
      method: "POST",
      headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA, "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: src.f }),
      signal: AbortSignal.timeout(15000),
    }).then((x) => x.json());
    if (!dl?.link) throw new Error("base OS sin link");
    const r = await fetch(dl.link, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`base OS dl ${r.status}`);
    // decodeSubtitleText (no r.text()) â€” mismo cuidado de charset/artefactos que las
    // rutas de servido directo, asÃ­ la traducciÃ³n no arranca de un texto ya corrupto.
    return parseSrt(decodeSubtitleText(new Uint8Array(await r.arrayBuffer())));
  }
  throw new Error("base desconocida");
}

// Marcadores de SDH a nivel nombre de archivo / release — barato, sin descargar nada.
const SDH_NAME_RE = /\b(sdh|hearing[\s._-]*impaired|for the deaf|\[cc\]|\bcc\b|forced\s*sdh)\b/i;

async function hasViableSpanishSub(
  imdbId: string,
  season: number | null,
  episode: number | null,
  videoFilename?: string | null,
): Promise<{ viable: boolean; reason: string }> {
  if (!OPENSUBTITLES_API_KEY) return { viable: false, reason: "sin OPENSUBTITLES_API_KEY" };

  const p = new URLSearchParams({ languages: "es,sp,ea", hearing_impaired: "exclude" });
  if (season != null && episode != null) {
    p.set("parent_imdb_id", imdbId.replace(/^tt0*/, ""));
    p.set("season_number", String(season));
    p.set("episode_number", String(episode));
  } else p.set("imdb_id", imdbId.replace(/^tt0*/, ""));

  const r = await fetch(`${OPENSUBTITLES_API}/subtitles?${p}`, {
    headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
    signal: AbortSignal.timeout(10000),
  }).then((x) => x.json()).catch(() => null);

  const data = Array.isArray(r?.data) ? r.data : [];
  if (!data.length) return { viable: false, reason: "cero subtítulos en español en upstream" };

  // Nivel 1: filtrar SDH
  // deno-lint-ignore no-explicit-any
  const cleanSubs = data.filter((d: any) => {
    const a = d?.attributes ?? {};
    if (a.hearing_impaired === true) return false;
    const hay = `${a.release ?? ""} ${a.files?.[0]?.file_name ?? ""}`;
    return !SDH_NAME_RE.test(hay);
  });

  if (!cleanSubs.length) return { viable: false, reason: "todos los subtítulos en español son SDH" };

  // Nivel 2: Si Stremio envió el filename real del video, verificar si algún subtítulo ES coincide en framerate y corte
  if (videoFilename) {
    const videoFps = detectFramerate(videoFilename);
    let hasFramerateAndReleaseMatch = false;

    // deno-lint-ignore no-explicit-any
    for (const d of cleanSubs) {
      const a = (d as any)?.attributes ?? {};
      const subName = `${a.release ?? ""} ${a.files?.[0]?.file_name ?? ""}`;
      const subFps = detectFramerate(subName);
      const sim = releaseSimilarity(videoFilename, subName);

      // Si hay coincidencia de framerate estructural y similitud de release
      if (Math.abs(videoFps.fps - subFps.fps) < 0.05 && sim > 0.15) {
        hasFramerateAndReleaseMatch = true;
        break;
      }
    }

    if (!hasFramerateAndReleaseMatch) {
      return {
        viable: false,
        reason: `Discrepancia insalvable: Video es ${videoFps.tag} pero subtítulos ES son de framerate dispar o corte incompatible`,
      };
    }
  }

  // Título cubierto si sobrevivieron opciones limpias compatibles
  return { viable: true, reason: "cobertura ES adecuada" };
}

interface BaseSubMatch {
  fileId: number;
  matchType: "hash" | "release" | "popular";
  releaseName: string;
}

async function osBaseFileId(
  imdbId: string,
  season: number | null,
  episode: number | null,
  lang: string,
  videoFilename?: string | null,
  videoHash?: string | null,
  _videoSize?: number | null,
): Promise<BaseSubMatch | null> {
  if (!OPENSUBTITLES_API_KEY) return null;

  // 1. Prioridad Absoluta Zero-Trust: Emparejamiento 100% por VideoHash
  if (videoHash && videoHash !== "0000000000000000") {
    try {
      const hashParams = new URLSearchParams({ moviehash: videoHash, languages: lang });
      const hashRes = await fetch(`${OPENSUBTITLES_API}/subtitles?${hashParams}`, {
        headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
        signal: AbortSignal.timeout(8000),
      }).then((x) => x.json()).catch(() => null);

      const hashData = Array.isArray(hashRes?.data) ? hashRes.data : [];
      if (hashData.length > 0) {
        const best = hashData[0];
        const fid = best?.attributes?.files?.[0]?.file_id;
        const rel = best?.attributes?.release || best?.attributes?.files?.[0]?.file_name || "Hash Match";
        if (Number.isFinite(fid)) {
          return { fileId: fid, matchType: "hash", releaseName: rel };
        }
      }
    } catch { /* continuar a búsqueda por release */ }
  }

  // 2. Búsqueda por IMDb ID y emparejamiento por similitud de release
  const p = new URLSearchParams({ languages: lang, hearing_impaired: "exclude", order_by: "download_count" });
  if (season != null && episode != null) {
    p.set("parent_imdb_id", imdbId.replace(/^tt0*/, ""));
    p.set("season_number", String(season));
    p.set("episode_number", String(episode));
  } else p.set("imdb_id", imdbId.replace(/^tt0*/, ""));

  const r = await fetch(`${OPENSUBTITLES_API}/subtitles?${p}`, {
    headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
    signal: AbortSignal.timeout(10000),
  }).then((x) => x.json()).catch(() => null);

  // deno-lint-ignore no-explicit-any
  const data: any[] = Array.isArray(r?.data) ? r.data : [];
  if (!data.length) return null;

  if (videoFilename) {
    let best: { fid: number; score: number; rel: string } | null = null;
    for (const d of data) {
      const a = d?.attributes ?? {};
      const fid = a?.files?.[0]?.file_id;
      if (!Number.isFinite(fid)) continue;
      const hay = `${a.release ?? ""} ${a.files?.[0]?.file_name ?? ""}`;
      const score = releaseSimilarity(videoFilename, hay);
      if (!best || score > best.score) best = { fid, score, rel: hay };
    }
    if (best && best.score > 0) {
      return { fileId: best.fid, matchType: "release", releaseName: best.rel };
    }
  }

  const first = data[0];
  const fid = first?.attributes?.files?.[0]?.file_id;
  const rel = first?.attributes?.release || first?.attributes?.files?.[0]?.file_name || "Top Downloaded";
  return Number.isFinite(fid) ? { fileId: fid, matchType: "popular", releaseName: rel } : null;
}

async function handleTranslate(subPath: string, mountBase: string): Promise<Response> {
  if (subPath === "/manifest.json") return jsonResponse(TRANSLATE_MANIFEST);

  // ── listar: /subtitles/:type/:id.json ──────────────────────────────
  const listM = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (listM) {
    const [, , rawId] = listM;
    const { imdbId, season, episode, filename, videoHash, videoSize } = parseStremioSubId(rawId);
    try {
      // Detonante IA: se activa si no hay subtítulos ES o si los existentes presentan
      // discrepancias de framerate insalvables con el stream del usuario.
      const spanCheck = await hasViableSpanishSub(imdbId, season, episode, filename);
      if (spanCheck.viable) {
        return jsonResponse({ subtitles: [] });
      }
      console.log(`[translate] Detonando fallback IA para ${imdbId}: ${spanCheck.reason}`);

      const bases: { t: string; u?: string; f?: number; label: string; keyRef: string; matchType?: string }[] = [];

      const mvwShow = MEDIATHEK_SHOWS[imdbId];
      if (mvwShow && season != null && episode != null) {
        const meta = await fetchCinemetaMeta("series", imdbId);
        // deno-lint-ignore no-explicit-any
        const vid = (meta?.videos ?? []).find((v: any) => v.season === season && v.number === episode);
        const ct = showCaseTitle(vid?.name ?? "", mvwShow.topic);
        if (ct) {
          const films = matchMvwFilms(await loadMvwShow(mvwShow.topic, mvwShow.minDur), ct).filter((f) => f.urlSub);
          if (films[0]) bases.push({ t: "ard", u: films[0].urlSub, label: "base DE oficial", keyRef: films[0].urlSub, matchType: "oficial" });
        }
      }
      if (!bases.length) {
        // Capturar subtítulo en inglés que empareje 100% con el hash o release del video
        const en = await osBaseFileId(imdbId, season, episode, "en", filename, videoHash, videoSize);
        if (en) {
          const badge = en.matchType === "hash" ? "🎯 100% Hash Match" : en.matchType === "release" ? "✨ Release Match" : "Base EN";
          bases.push({ t: "os", f: en.fileId, label: `${badge} (${en.releaseName})`, keyRef: `os-${en.fileId}`, matchType: en.matchType });
        } else {
          // Si no hay inglés, probar base alemana
          const de = await osBaseFileId(imdbId, season, episode, "de", filename, videoHash, videoSize);
          if (de) {
            const badge = de.matchType === "hash" ? "🎯 100% Hash Match" : "Base DE";
            bases.push({ t: "os", f: de.fileId, label: `${badge} (${de.releaseName})`, keyRef: `os-${de.fileId}`, matchType: de.matchType });
          }
        }
      }

      const subtitles = bases.map((b, i) => ({
        id: `ia-es-${i}`,
        url: `${mountBase}/gen/${b64u.enc(JSON.stringify({ t: b.t, u: b.u, f: b.f, r: b.keyRef }))}.srt`,
        lang: "spa",
        label: `[IA→ES latino] ${b.label}`,
        name: `[IA→ES latino] ${b.label}`,
      }));
      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message }, { status: 500 });
    }
  }

  // â”€â”€ generar: /gen/<token>.srt  y  /x/<b64 url ARD>.srt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const genM = subPath.match(/^\/gen\/([^/]+?)(?:\.srt)?$/);
  const xM = subPath.match(/^\/x\/([^/]+?)(?:\.srt)?$/);
  if (genM || xM) {
    let src: { t: string; u?: string; f?: number; r: string };
    try {
      if (xM) {
        const u = b64u.dec(xM[1]);
        src = { t: "ard", u, r: u };
      } else {
        src = JSON.parse(b64u.dec(genM![1]));
      }
    } catch {
      return new Response("token invÃ¡lido", { status: 400, headers: cors });
    }

    const cacheKey = ["translate-srt", "v8", src.r];
    let kv: Deno.Kv | null = null;
    try {
      kv = await getKv();
      const hit = await kv.get<string>(cacheKey);
      if (hit.value) {
        return new Response(hit.value, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
      }
    } catch { kv = null; }

    try {
      const baseCues = await fetchBaseCues(src);
      if (!baseCues.length) return new Response("subtÃ­tulo base vacÃ­o", { status: 502, headers: cors });

      const { texts, done } = await translateCues(baseCues, src.r, kv, Date.now() + FAST_WINDOW_BUDGET_MS);
      // El SRT final descarta las cues de puro sonido (ruido para quien mira en alemÃ¡n).
      const outCues = baseCues
        .map((c, i) => ({ ...c, text: texts[i] }))
        .filter((c) => !isSoundOnly(c.text));
      const srt = serializeSrt(outCues);

      // Completa â†’ cache 90 dÃ­as. Parcial (algÃºn lote nunca parseÃ³ â€” tÃ­pico:
      // una escena que la IA se niega a devolver) â†’ igual se cachea el SRT pero
      // 2 dÃ­as, asÃ­ las aperturas repetidas son instantÃ¡neas mientras el resto
      // ya estÃ¡ traducido; se re-genera solo pasado ese plazo por si mejora.
      if (kv) {
        const ttl = done ? TRANSLATE_CACHE_TTL_MS : 2 * 24 * 60 * 60 * 1000;
        try { await kv.set(cacheKey, srt, { expireIn: ttl }); } catch { /* sin cache */ }
      }
      return new Response(srt, {
        headers: {
          ...cors,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="es-latino.srt"',
          "X-Translate-FastWindow": "true",
          "X-Translate-Complete": String(done),
        },
      });
    } catch (e) {
      return new Response("Error generando traducciÃ³n: " + (e as Error).message, { status: 502, headers: cors });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ /health â€” estado de config de las sub-funciones â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// ════════════════════════════════════════════════════════════════════════════
// ── /streams — Smart Stream Interceptor (Proxy Inteligente de Streams) ──────
// Intercepta peticiones de streams hacia Torrentio, reordena con prioridad
// absoluta al audio latino y aplica badges visuales para TV Box.
// ════════════════════════════════════════════════════════════════════════════

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

export const STREAMS_MANIFEST = {
  id: "com.mejorastremio.streams",
  version: "1.0.0",
  name: "MejoraStremio Streams (Latino Priority)",
  description:
    "Smart Stream Interceptor: proxy inteligente de Torrentio con reordenamiento prioritario a audio latino y etiquetado visual para TV.",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

export const LATINO_STREAM_REGEX =
  /\b(latino|latina|dual|spa|spanish|espanol|español|castellano)\b|cinecalidad|dual[-_.]?lat|\[lat\]|\(lat\)|[-_.]lat[-_.]|\blat\b|🇲🇽|🇦🇷|🇨🇱|🇨🇴|🇵🇪/i;

export function isLatinoStream(stream: { name?: string; title?: string; description?: string }): boolean {
  const text = `${stream.name || ""} ${stream.title || ""} ${stream.description || ""}`;
  return LATINO_STREAM_REGEX.test(text);
}

export function sanitizeTorrentioBase(rawUrl: string): string {
  let u = (rawUrl || "https://torrentio.strem.fun/").trim();
  if (!u.endsWith("/")) u += "/";
  u = u.replace(/\/manifest\.json.*$/, "/");
  u = u.replace(/([/|])language=[^|/]+/gi, "$1");
  u = u.replace(/\|+/g, "|").replace(/\/\|/g, "/").replace(/\|\//g, "/");
  return u;
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

export function rankAndBadgeStreams<T extends StremioStreamItem>(streams: T[]): T[] {
  if (!Array.isArray(streams) || streams.length === 0) return [];

  const latinoCached: T[] = [];
  const otherCached: T[] = [];
  const latinoBuffer: T[] = [];
  const otherBuffer: T[] = [];

  for (const s of streams) {
    const isLat = isLatinoStream(s);
    const isFast = isCachedOrInstantStream(s);

    if (isLat && isFast) latinoCached.push(s);
    else if (!isLat && isFast) otherCached.push(s);
    else if (isLat && !isFast) latinoBuffer.push(s);
    else otherBuffer.push(s);
  }

  const badge = (s: T, isLat: boolean, isFast: boolean): T => {
    const raw = (s.name || "Torrentio")
      .replace(/^\[(⚡ INSTANTÁNEO|⏳ REQUIERE BUFFER)\]\s*/g, "")
      .replace(/^\[(🇪🇸 LATINO|⚠️ SOLO INGLÉS)\]\s*/g, "")
      .trim();

    const speedPrefix = isFast ? "[⚡ INSTANTÁNEO]" : "[⏳ REQUIERE BUFFER]";
    const langPrefix = isLat ? "[🇪🇸 LATINO]" : "[⚠️ SOLO INGLÉS]";

    return {
      ...s,
      name: `${speedPrefix} ${langPrefix} ${raw}`,
    };
  };

  return [
    ...latinoCached.map((s) => badge(s, true, true)),
    ...otherCached.map((s) => badge(s, false, true)),
    ...latinoBuffer.map((s) => badge(s, true, false)),
    ...otherBuffer.map((s) => badge(s, false, false)),
  ];
}

export async function handleStreams(subPath: string, url: URL): Promise<Response> {
  if (subPath === "/manifest.json" || subPath === "/manifest" || subPath === "/" || subPath === "") {
    return jsonResponse(STREAMS_MANIFEST);
  }

  let configSegment = "";
  let type = "";
  let rawId = "";

  const directMatch = subPath.match(/^(?:\/stream)?\/(movie|series)\/(.+)\.json$/);
  if (directMatch) {
    type = directMatch[1];
    rawId = directMatch[2];
  } else {
    const configMatch = subPath.match(/^\/([^/]+)(?:\/stream)?\/(movie|series)\/(.+)\.json$/);
    if (configMatch && configMatch[1] !== "stream") {
      configSegment = configMatch[1];
      type = configMatch[2];
      rawId = configMatch[3];
    } else if (subPath.endsWith("/manifest.json")) {
      return jsonResponse(STREAMS_MANIFEST);
    }
  }

  if (!type || !rawId) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  const envTorrentio =
    (typeof Deno !== "undefined" && Deno.env?.get?.("TORRENTIO_URL")) ||
    (typeof process !== "undefined" && process.env?.TORRENTIO_URL) ||
    "https://torrentio.strem.fun/";

  let upstreamBase = url.searchParams.get("torrentio") || envTorrentio;
  if (configSegment) {
    upstreamBase = `https://torrentio.strem.fun/${configSegment}/`;
  }
  upstreamBase = sanitizeTorrentioBase(upstreamBase);

  const cleanId = decodeURIComponent(rawId).split("/")[0];
  const targetUrl = `${upstreamBase}stream/${type}/${cleanId}.json`;

  try {
    const upstreamRes = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "MejoraStremio-SmartInterceptor/1.0",
        "Accept": "application/json",
      },
    });

    if (!upstreamRes.ok) {
      return jsonResponse({ streams: [] });
    }

    const data = await upstreamRes.json();
    const rawStreams: StremioStreamItem[] = Array.isArray(data?.streams) ? data.streams : [];
    const ranked = rankAndBadgeStreams(rawStreams);

    return jsonResponse({ streams: ranked });
  } catch (err) {
    console.error(`[streams] Error fetching upstream torrentio: ${(err as Error).message}`);
    return jsonResponse({ streams: [] });
  }
}

function handleHealth(): Response {
  return jsonResponse({
    hub: "mejorastremio-hub",
    timestamp: new Date().toISOString(),
    smartSync: { active: true, supportedFramerates: ["23.976", "24.0", "25.0", "29.97"] },
    subdl: { configured: !!SUBDL_KEY },
    opensubtitles: { configured: !!OPENSUBTITLES_API_KEY },
    opensubtitlesLatino: { configured: !!OPENSUBTITLES_API_KEY },
    subdivx: { configured: true, proxy: SUBDIVX_PROXY_URL },
    latino: { configured: true },
    synopsis: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      geminiConfigured: !!GEMINI_API_KEY,
      openrouterConfigured: !!OPENROUTER_API_KEY,
    },
    miniseries: { configured: !!TMDB_KEY },
    shortSeries: { configured: !!TMDB_KEY },
    discover: { configured: !!TMDB_KEY },
    ufc: { configured: true },
    livetv: { configured: true },
    iptv: { configured: true },
    mediathek: { configured: true },
    streams: { configured: true, upstream: "https://torrentio.strem.fun/" },
    translate: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      baseSource: !!OPENSUBTITLES_API_KEY,
      engine: "gemini-flash",
    },
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ Router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export async function handleHubRequest(req: Request): Promise<Response> {
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
          "/opensubtitles/manifest.json",
          "/opensubtitles-latino/manifest.json",
          "/subdivx/manifest.json",
          "/latino/manifest.json",
          "/synopsis/manifest.json",
          "/miniseries/manifest.json",
          "/short-series/manifest.json",
          "/discover/manifest.json",
          "/ufc/manifest.json",
          "/livetv/manifest.json",
          "/iptv/manifest.json",
          "/mediathek/manifest.json",
          "/translate/manifest.json",
          "/streams/manifest.json",
          "/health",
        ],
      });
    } else if (path === "/health") {
      route = "health";
      res = handleHealth();
    } else if (path.startsWith("/subtitles/proxy")) {
      route = "subtitles-proxy";
      res = await handleSubtitleProxy(url);
    } else if (path.startsWith("/subdl")) {
      route = "subdl";
      const subPath = path.slice("/subdl".length) || "/";
      res = await handleSubdl(subPath, `${url.origin}/subdl`, url);
    } else if (path.startsWith("/subdivx")) {
      route = "subdivx";
      const subPath = path.slice("/subdivx".length) || "/";
      res = await handleSubdivx(subPath, `${url.origin}/subdivx`, url);
    } else if (path.startsWith("/opensubtitles-latino")) {
      // Debe ir ANTES que "/opensubtitles" — ese startsWith también matchea este path.
      route = "opensubtitles-latino";
      const subPath = path.slice("/opensubtitles-latino".length) || "/";
      res = await handleOpenSubtitles(
        subPath,
        `${url.origin}/opensubtitles-latino`,
        OPENSUBTITLES_LATINO_MANIFEST,
        "ea",
        "mshub-oslat",
        "OpenSubtitles Latino",
        url,
      );
    } else if (path.startsWith("/opensubtitles")) {
      route = "opensubtitles";
      const subPath = path.slice("/opensubtitles".length) || "/";
      res = await handleOpenSubtitles(
        subPath,
        `${url.origin}/opensubtitles`,
        OPENSUBTITLES_MANIFEST,
        "es",
        "mshub-os",
        "OpenSubtitles",
        url,
      );
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
    } else if (path.startsWith("/short-series")) {
      route = "short-series";
      const subPath = path.slice("/short-series".length) || "/";
      res = await handleShortSeries(subPath);
    } else if (path.startsWith("/discover")) {
      route = "discover";
      const subPath = path.slice("/discover".length) || "/";
      res = await handleDiscover(subPath, url);
    } else if (path.startsWith("/ufc")) {
      route = "ufc";
      const subPath = path.slice("/ufc".length) || "/";
      res = await handleUfc(subPath);
    } else if (path.startsWith("/livetv")) {
      route = "livetv";
      const subPath = path.slice("/livetv".length) || "/";
      res = await handleLivetv(subPath);
    } else if (path.startsWith("/iptv")) {
      route = "iptv";
      const subPath = path.slice("/iptv".length) || "/";
      res = await handleIptv(subPath);
    } else if (path.startsWith("/mediathek")) {
      route = "mediathek";
      const subPath = path.slice("/mediathek".length) || "/";
      res = await handleMediathek(subPath, `${url.origin}/mediathek`, `${url.origin}/translate`);
    } else if (path.startsWith("/translate")) {
      route = "translate";
      const subPath = path.slice("/translate".length) || "/";
      res = await handleTranslate(subPath, `${url.origin}/translate`);
    } else if (path.startsWith("/streams") || path.startsWith("/stream/")) {
      route = "streams";
      const subPath = path.startsWith("/streams")
        ? (path.slice("/streams".length) || "/")
        : path;
      res = await handleStreams(subPath, url);
    } else {
      res = new Response("Not found", { status: 404, headers: cors });
    }
  } catch (e) {
    res = jsonResponse({ error: (e as Error).message }, { status: 500 });
  }

  // Logging centralizado por ruta.
  console.log(`[hub] ${route} ${req.method} ${path} -> ${res.status} (${Date.now() - started}ms)`);
  return res;
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(handleHubRequest);
}
