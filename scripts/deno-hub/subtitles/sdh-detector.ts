/**
 * sdh-detector.ts — Heurística canónica de detección de marcas auditivas y subtítulos para personas sordas (SDH).
 */

import { parseSrtToCues } from "./smartsync.ts";

export function isSoundOnly(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || /^[.\-–—#♪*\s]+$/.test(t)) return true;
  const oneLine = t.replace(/\s+/g, " ");
  if (/^[(\[*][^)\]]*[)\]*]$/.test(oneLine)) return true;
  return t.split("\n").every((l) => l.trim() === "" || /^[(\[*][^)\]]*[)\]*]$/.test(l.trim()));
}

export function isSdhName(name: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return /\b(sdh|cc|forced|forzados)\b/i.test(n) || /[\(\[\{](sdh|cc|forced)[\)\]\}]/i.test(n);
}

export function looksLikeSDH(srtText: string): boolean {
  const cues = parseSrtToCues(srtText);
  if (cues.length < 8) return false;
  const soundOnly = cues.filter((c) => isSoundOnly(c.text)).length;
  const bracketed = cues.filter((c) => /[(\[][^)\]\n]{2,50}[)\]]/.test(c.text)).length;
  const capsTag = cues.filter((c) => /[(\[]\s*[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{1,35}[)\]]/.test(c.text)).length;
  return soundOnly / cues.length > 0.02 || bracketed / cues.length > 0.03 || capsTag / cues.length > 0.015;
}
