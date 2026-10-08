/**
 * smartsync.ts — Motor canónico de Sincronización Inteligente (Smart Audio Sync & Framerate Engine).
 *
 * Mantiene intactas las fórmulas matemáticas de derivas temporales, anti-collision clamping,
 * purga de marcas auditivas/SDH y emisión de pistas duales ('spl' + 'spa') para Stremio Core.
 */

import { srtTimeToMs, msToSrtTime } from "../utils/common.ts";

export const EUROPEAN_SHOW_IDS = new Set([
  "tt14060708", // HPI: Haut Potentiel Intellectuel
  "tt13854128", // HPI alias
  "tt13000282", // HPI / ACI alias terciario
  "tt9293466",  // Balthazar
  "tt0806910",  // Tatort
  "tt28491873", // Ludwig
  "tt4378376",  // Babylon Berlin
  "tt6905756",  // Der Pass / Pagan Peak
  "tt10598848", // Die Toten von Marnow
  "tt13498564", // Höllental
  "tt27054614", // Crooks
  "tt20863760", // Dear Child
  "tt9184986",  // Barbarians
  "tt10986056", // Criminal: Germany
  "tt0475464",  // Los hombres de Paco
  "tt18482892", // Machos Alfa
  "tt20883126", // Reina Roja
  "tt8690776",  // Sky Rojo
  "tt27950663", // The Marlow Murder Club
  "tt9258854",  // Das Quartett
  "tt5094068",  // Einstein
  "tt6839788",  // Dogs of Berlin
  "tt18827746", // Passenger
]);

export function isEuropeanShowOrContext(imdbId?: string | null, name?: string | null): boolean {
  if (imdbId && EUROPEAN_SHOW_IDS.has(imdbId)) return true;
  if (!name) return false;
  return /\b(hpi|aci|balthazar|tatort|ludwig|tf1|ard|zdf|orf|bbc|itv|channel4|rte|french|deutsch|german)\b/i.test(name);
}

export interface FramerateInfo {
  fps: number;
  standard: "PAL_25" | "NTSC_WEB" | "FILM_24" | "NTSC_TV" | "UNKNOWN";
  tag: string;
  confidence: "high" | "medium" | "low";
}

export function detectFramerate(name: string | null | undefined, imdbId?: string | null): FramerateInfo {
  if (!name) {
    if (isEuropeanShowOrContext(imdbId)) {
      return { fps: 25.0, standard: "PAL_25", tag: "PAL/HDTV 25fps (Europeo)", confidence: "medium" };
    }
    return { fps: 23.976, standard: "NTSC_WEB", tag: "WEB-DL (asumido)", confidence: "low" };
  }
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

  // Heurística de origen: si es serie/película europea y el subtítulo no tiene marcas explícitas de WEB-DL
  if (isEuropeanShowOrContext(imdbId, name)) {
    return { fps: 25.0, standard: "PAL_25", tag: "PAL/HDTV 25fps (Europeo)", confidence: "medium" };
  }

  return { fps: 23.976, standard: "NTSC_WEB", tag: "WEB-DL (estándar)", confidence: "low" };
}

export interface SmartSyncDecision {
  needsRescale: boolean;
  fromFps: number;
  toFps: number;
  ratio: number;
  actionDescription: string;
  badge: string;
  fpsParam: string;
}

export function resolveSmartSync(videoName?: string | null, subName?: string | null, imdbId?: string | null): SmartSyncDecision {
  const v = detectFramerate(videoName, imdbId);
  const s = detectFramerate(subName, imdbId);

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
  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  for (let i = 0; i < cues.length - 1; i++) {
    const nextStart = cues[i + 1].startMs;
    if (cues[i].endMs >= nextStart) {
      cues[i].endMs = Math.max(cues[i].startMs + 50, nextStart - 5);
    }
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

export function rescaleSrtFramerate(
  srtText: string,
  fromFps: number,
  toFps: number,
  offsetMs = 0,
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

export function cleanSrt(srtContent: string): string {
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

export interface SubtitleTrackPayload {
  id: string;
  url: string;
  label: string;
  name?: string;
  lang?: string;
}

export function pushDualSubtitles(
  target: SubtitleTrackPayload[],
  track: SubtitleTrackPayload,
  isLatino = true,
): void {
  if (isLatino) {
    target.push({
      ...track,
      id: `${track.id}-spl`,
      lang: "spl",
    });
    target.push({
      ...track,
      id: `${track.id}-spa`,
      lang: "spa",
    });
  } else {
    target.push({
      ...track,
      id: `${track.id}-spa`,
      lang: "spa",
    });
  }
}
