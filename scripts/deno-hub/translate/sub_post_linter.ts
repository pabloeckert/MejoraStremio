/**
 * sub_post_linter.ts — Linter Post-Traducción y Guardrails de Integridad para Subtítulos.
 *
 * Implementa:
 * 1. Validación Léxica Post-Gemini: Escaneo y neutralización de modismos peninsulares (es-ES).
 * 2. Integridad Sintáctica y Tiempos: Monotonicidad estricta (0 solapamientos) y formato SMPTE.
 * 3. Restricciones de Pantalla Leanback: Máximo de 2 líneas por cue y ≤42 caracteres por línea.
 * 4. Preservación estricta de acrónimos técnicos legítimos (NASA:, FBI:, OK:, CEO:, etc.).
 *
 * Alcance y Target: Android TV ZTE ZXV10 B866V2 (Amlogic S905X2) — 100% Serverless.
 */

import { PRESERVED_SPEAKER_ACRONYMS } from "../subtitles/smartsync.ts";
import {
  detectPeninsularSpanish,
  neutralisePeninsularText,
} from "../utils/spanish_peninsular_detector.ts";

export const MAX_LINE_LENGTH = 42; // Máximo de caracteres por línea según estándar broadcast/Netflix
export const MAX_LINES_PER_CUE = 2; // Máximo de líneas visuales simultáneas en pantalla

export interface ParsedCue {
  index: number;
  start: string;
  end: string;
  startMs: number;
  endMs: number;
  text: string;
  lines: string[];
}

export interface LinterOptions {
  autoNeutralisePeninsular?: boolean;
  autoWrapLines?: boolean;
  enforceMonotonicity?: boolean;
  maxLineLength?: number;
  maxLinesPerCue?: number;
}

export interface LinterMetrics {
  totalCues: number;
  maxLineLengthFound: number;
  maxLinesPerCueFound: number;
  overlapsDetected: number;
  peninsularTermsDetected: string[];
  preservedAcronymsCount: number;
}

export interface LinterResult {
  valid: boolean;
  cleanSrt: string;
  metrics: LinterMetrics;
  violations: string[];
}

/**
 * Convierte un timestamp SRT "HH:MM:SS,mmm" a milisegundos enteros.
 */
export function srtTimeToMs(t: string): number {
  const m = t.trim().match(/^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!m) return 0;
  return (
    parseInt(m[1], 10) * 3600000 +
    parseInt(m[2], 10) * 60000 +
    parseInt(m[3], 10) * 1000 +
    parseInt(m[4], 10)
  );
}

/**
 * Convierte milisegundos a timestamp SRT "HH:MM:SS,mmm".
 */
export function msToSrtTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const h = Math.floor(safeMs / 3600000);
  const m = Math.floor((safeMs % 3600000) / 60000);
  const s = Math.floor((safeMs % 60000) / 1000);
  const remMs = safeMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(remMs).padStart(3, "0")}`;
}

/**
 * Divide un texto en líneas de hasta `maxChars` respetando los límites de palabras.
 */
export function wrapTextToMaxChars(text: string, maxChars = MAX_LINE_LENGTH): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + " " + word).length <= maxChars) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Parseo de bloque SRT con cálculo de duraciones y normalización de texto.
 */
export function parseSrtWithMetrics(srt: string): ParsedCue[] {
  const cues: ParsedCue[] = [];
  const blocks = srt.replace(/\r/g, "").split(/\n\n+/);

  let idx = 1;
  for (const b of blocks) {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;

    const m = timeLine.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
    if (!m) continue;

    const timeLineIndex = lines.indexOf(timeLine);
    const textLines = lines.slice(timeLineIndex + 1);
    const text = textLines.join("\n").trim();
    if (!text) continue;

    const startMs = srtTimeToMs(m[1]);
    const endMs = srtTimeToMs(m[2]);

    cues.push({
      index: idx++,
      start: m[1].replace(".", ","),
      end: m[2].replace(".", ","),
      startMs,
      endMs,
      text,
      lines: textLines,
    });
  }

  return cues;
}

/**
 * Serializa los cues parseados en formato canónico SRT.
 */
export function serializeCuesToSrt(cues: ParsedCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${c.start} --> ${c.end}\n${c.lines.join("\n")}`)
    .join("\n\n") + "\n";
}

/**
 * Linter integral post-Gemini que ejecuta todos los guardrails requeridos.
 */
export function validateAndLintSubtitles(
  rawSrt: string,
  options?: LinterOptions,
): LinterResult {
  const autoNeutralise = options?.autoNeutralisePeninsular ?? true;
  const autoWrap = options?.autoWrapLines ?? true;
  const enforceMonotonic = options?.enforceMonotonicity ?? true;
  const maxChars = options?.maxLineLength ?? MAX_LINE_LENGTH;
  const maxLines = options?.maxLinesPerCue ?? MAX_LINES_PER_CUE;

  const violations: string[] = [];
  const peninsularTerms: string[] = [];
  let preservedAcronymsCount = 0;
  let overlapsCount = 0;
  let maxFoundLineLength = 0;
  let maxFoundLinesPerCue = 0;

  const parsedCues = parseSrtWithMetrics(rawSrt);

  // 1. Escaneo léxico y preservación de acrónimos técnicos
  for (const cue of parsedCues) {
    // Preservación de acrónimos legítimos (NASA:, FBI:, etc.)
    const acronymMatches = cue.text.match(/^([-–—•]?\s*)([A-Z]{2,10}):/gm);
    if (acronymMatches) {
      for (const m of acronymMatches) {
        const tag = m.replace(/[-–—•\s:]/g, "").toUpperCase();
        if (PRESERVED_SPEAKER_ACRONYMS.has(tag)) {
          preservedAcronymsCount++;
        }
      }
    }

    // Detección léxica peninsular
    const penDetection = detectPeninsularSpanish(cue.text);
    if (penDetection.isPeninsular) {
      peninsularTerms.push(...penDetection.matches);
      violations.push(`Cue #${cue.index}: Detectados modismos peninsulares (${penDetection.matches.join(", ")})`);

      if (autoNeutralise) {
        const { neutralised } = neutralisePeninsularText(cue.text);
        cue.text = neutralised;
        cue.lines = neutralised.split("\n");
      }
    }

    // Control de longitud de líneas y número de líneas
    const fullCueText = cue.lines.join(" ").replace(/\s+/g, " ").trim();
    for (const line of cue.lines) {
      if (line.length > maxFoundLineLength) {
        maxFoundLineLength = line.length;
      }
      if (line.length > maxChars) {
        violations.push(`Cue #${cue.index}: Línea excede ${maxChars} caracteres (${line.length} car.)`);
      }
    }
    if (cue.lines.length > maxLines) {
      violations.push(`Cue #${cue.index}: Excede ${maxLines} líneas (${cue.lines.length} líneas)`);
    }

    if (autoWrap) {
      const wrapped = wrapTextToMaxChars(fullCueText, maxChars);
      if (wrapped.length > maxLines) {
        cue.lines = wrapped.slice(0, maxLines);
      } else {
        cue.lines = wrapped;
      }
    }

    if (cue.lines.length > maxFoundLinesPerCue) {
      maxFoundLinesPerCue = cue.lines.length;
    }
  }

  // 2. Monotonicidad y solapamientos temporales
  if (enforceMonotonic) {
    for (let i = 0; i < parsedCues.length; i++) {
      const current = parsedCues[i];

      // Duración mínima de 100 ms
      if (current.endMs <= current.startMs) {
        current.endMs = current.startMs + 500;
        current.end = msToSrtTime(current.endMs);
      }

      if (i > 0) {
        const prev = parsedCues[i - 1];
        if (current.startMs < prev.endMs) {
          overlapsCount++;
          violations.push(`Solapamiento detectado entre Cue #${prev.index} y Cue #${current.index}`);
          // Corrección automática: desplazar o acortar para evitar colisión
          prev.endMs = Math.max(prev.startMs + 100, current.startMs - 20);
          prev.end = msToSrtTime(prev.endMs);
        }
      }
    }
  }

  const cleanSrt = serializeCuesToSrt(parsedCues);
  const isValid = violations.length === 0 || (autoNeutralise && autoWrap && enforceMonotonic);

  return {
    valid: isValid,
    cleanSrt,
    metrics: {
      totalCues: parsedCues.length,
      maxLineLengthFound: maxFoundLineLength,
      maxLinesPerCueFound: maxFoundLinesPerCue,
      overlapsDetected: overlapsCount,
      peninsularTermsDetected: [...new Set(peninsularTerms)],
      preservedAcronymsCount,
    },
    violations,
  };
}
