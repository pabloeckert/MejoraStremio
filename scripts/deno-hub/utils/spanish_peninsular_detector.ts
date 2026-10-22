/**
 * spanish_peninsular_detector.ts — Clasificador Léxico es-419 vs es-ES y Filtro Peninsular.
 *
 * Implementa:
 * - Detección léxica estricta de modismos peninsulares (España / es-ES).
 * - Protección del slot #1 [🌎 LATINO] mediante exclusión incondicional de variantes peninsulares.
 * - Diccionario exhaustivo de pronombres, conjugaciones de segunda persona plural (vosotros) y argot.
 * - Sustitución léxica neutralizadora para guardrails de post-traducción.
 *
 * Alcance y Target: Android TV ZTE ZXV10 B866V2 (Amlogic S905X2) — 100% Serverless.
 */

import type { StremioStreamItem } from "./common.ts";

/**
 * Pronombres y posesivos peninsulares exclusivos de España.
 */
export const PENINSULAR_PRONOUNS_REGEX =
  /\b(?:vosotros|vosotras|vuestro|vuestra|vuestros|vuestras)\b/i;

/**
 * Conjugaciones verbales de segunda persona plural (vosotros) típicas de España.
 */
export const PENINSULAR_VERBS_REGEX =
  /\b(?:hab[eé]is|hab[íi]ais|ten[eé]is|sab[eé]is|est[aá]is|vais|hac[eé]is|pod[eé]is|quer[eé]is|dej[aá]is|mir[aá]is|escuch[aá]is|pens[aá]is|esper[aá]is|habl[aá]is|ven[íi]s|dec[íi]s|ibais|erais|fuisteis|hicisteis|tuvisteis|dijisteis|visteis|sep[aá]is|hag[aá]is|vay[aá]is|teng[aá]is|com[eé]is|viv[íi]s|cre[eé]is|sent[íi]s|llam[aá]is|ech[aá]is|lleg[aá]is)\b/i;

/**
 * Modismos, léxico cotidiano y expresiones características de España (es-ES).
 */
export const PENINSULAR_SLANG_REGEX =
  /\b(?:vale|t[ií]o|t[ií]a|ordenador|ordenadores|joder|joderse|flipar|flipas|flipando|flipado|chaval|chavales|chavala|chavalas|guay|aparcar|m[oó]vil|m[oó]viles|curro|currar|majo|maja|gilipollas|co[nñ]o|mogoll[oó]n|molar|mola)\b/i;

/**
 * Marcadores de releases y tags peninsulares en nombres de archivos o torrents.
 */
export const PENINSULAR_STREAM_TAGS_REGEX =
  /\b(?:castellano|castellana|espa[nñ]ol[-_ ]?de[-_ ]?espa[nñ]a|es[-_]?es|spain|mejortorrent|dontorrent|wolfmax4k|estrenosdtl|grantorrent|dual[-_ ]?esp)\b|🇪🇸/i;

/**
 * Mapeo canónico de reemplazo de modismos peninsulares a español latinoamericano neutro (es-419).
 */
export const PENINSULAR_TO_LATIN_MAP: Record<string, string> = {
  ordenador: "computadora",
  ordenadores: "computadoras",
  movil: "celular",
  móvil: "celular",
  moviles: "celulares",
  móviles: "celulares",
  aparcar: "estacionar",
  chaval: "joven",
  chavales: "muchachos",
  guay: "genial",
  curro: "trabajo",
  currar: "trabajar",
  vosotros: "ustedes",
  vosotras: "ustedes",
  vuestro: "su",
  vuestra: "su",
  vuestros: "sus",
  vuestras: "sus",
  flipar: "alucinar",
  flipas: "alucinas",
  flipando: "alucinando",
  joder: "carajo",
  majo: "agradable",
  maja: "agradable",
};

export interface PeninsularDetectionResult {
  isPeninsular: boolean;
  score: number;
  matches: string[];
  reasons: string[];
}

/**
 * Analiza un fragmento de texto o título buscando indicadores léxicos de español peninsular (es-ES).
 */
export function detectPeninsularSpanish(text: string): PeninsularDetectionResult {
  if (!text || typeof text !== "string") {
    return { isPeninsular: false, score: 0, matches: [], reasons: [] };
  }

  const matches: string[] = [];
  const reasons: string[] = [];
  let score = 0;

  // 1. Tags explícitos de stream (Castellano / España / es-ES)
  const tagMatches = text.match(new RegExp(PENINSULAR_STREAM_TAGS_REGEX.source, "gi"));
  if (tagMatches) {
    score += tagMatches.length * 5;
    matches.push(...tagMatches);
    reasons.push("tags_release_castellano");
  }

  // 2. Pronombres de vosotros
  const pronounMatches = text.match(new RegExp(PENINSULAR_PRONOUNS_REGEX.source, "gi"));
  if (pronounMatches) {
    score += pronounMatches.length * 4;
    matches.push(...pronounMatches);
    reasons.push("pronombres_vosotros");
  }

  // 3. Conjugaciones verbales en -áis / -éis / -ís
  const verbMatches = text.match(new RegExp(PENINSULAR_VERBS_REGEX.source, "gi"));
  if (verbMatches) {
    score += verbMatches.length * 3;
    matches.push(...verbMatches);
    reasons.push("conjugaciones_peninsulares");
  }

  // 4. Modismos y vocabulario específico
  const slangMatches = text.match(new RegExp(PENINSULAR_SLANG_REGEX.source, "gi"));
  if (slangMatches) {
    score += slangMatches.length * 2;
    matches.push(...slangMatches);
    reasons.push("modismos_lexicos_espana");
  }

  const isPeninsular = score >= 2;
  return {
    isPeninsular,
    score,
    matches: [...new Set(matches.map((m) => m.toLowerCase()))],
    reasons: [...new Set(reasons)],
  };
}

/**
 * Relega o descarta de forma incondicional del slot #1 [🌎 LATINO] cualquier stream
 * que contenga léxico peninsular confirmado.
 */
export function enforceLatinStreamPurity(stream: StremioStreamItem): {
  isPureLatin: boolean;
  detection: PeninsularDetectionResult;
} {
  const metadata = `${stream.name || ""} ${stream.title || ""} ${stream.description || ""}`;
  const detection = detectPeninsularSpanish(metadata);

  return {
    isPureLatin: !detection.isPeninsular,
    detection,
  };
}

/**
 * Normaliza y neutraliza modismos peninsulares en un texto de subtítulo a español neutro (es-419).
 */
export function neutralisePeninsularText(text: string): {
  neutralised: string;
  replacementsCount: number;
} {
  let count = 0;
  let result = text;

  for (const [peninsular, latin] of Object.entries(PENINSULAR_TO_LATIN_MAP)) {
    const reg = new RegExp(`\\b${peninsular}\\b`, "gi");
    if (reg.test(result)) {
      result = result.replace(reg, (match) => {
        count++;
        // Preservar mayúscula inicial si existía
        if (match[0] === match[0].toUpperCase()) {
          return latin.charAt(0).toUpperCase() + latin.slice(1);
        }
        return latin;
      });
    }
  }

  // Reemplazo de verbos comunes de vosotros
  result = result.replace(/\bten[eé]is\b/gi, () => { count++; return "tienen"; });
  result = result.replace(/\bsab[eé]is\b/gi, () => { count++; return "saben"; });
  result = result.replace(/\best[aá]is\b/gi, () => { count++; return "están"; });
  result = result.replace(/\bhac[eé]is\b/gi, () => { count++; return "hacen"; });
  result = result.replace(/\bpod[eé]is\b/gi, () => { count++; return "pueden"; });
  result = result.replace(/\bquer[eé]is\b/gi, () => { count++; return "quieren"; });
  result = result.replace(/\bdec[íi]s\b/gi, () => { count++; return "dicen"; });

  return { neutralised: result, replacementsCount: count };
}
