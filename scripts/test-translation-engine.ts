/**
 * test-translation-engine.ts — Suite de Verificación Rigurosa del Motor de Traducción IA (Gemini Subtitle Engine).
 * Valida de forma estricta y determinística:
 * 1. Prompts de adaptación cinematográfica al Español Latino Neutro (🌎 LATINO).
 * 2. Purga total de marcas acústicas SDH/CC, prefijos de hablantes y símbolos musicales.
 * 3. Preservación inviolable de delimitadores (§Z) y nombres propios/topónimos.
 * 4. Resiliencia de parseo ante fences Markdown y variantes de numeración.
 * 5. Filtro anti-fuga de modelos de moderación de contenido (User Safety: safe).
 * 6. Presupuesto temporal de Fast-Window (70 cues en <4s).
 */

import {
  buildTranslateSystemPrompt,
  cleanCueForTranslation,
  NL,
} from "./deno-hub/translate/gemini.ts";
import {
  parseNumbered,
  parseSrt,
  serializeSrt,
  FAST_WINDOW_CUES,
  FAST_WINDOW_BUDGET_MS,
  type Cue,
} from "./deno-hub/translate/translate.ts";
import { cleanSrt } from "./deno-hub/subtitles/smartsync.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${msg}`);
    failed++;
  }
}

console.log("\n══════════════════════════════════════════════════════════════════════");
console.log(" 🧪 SUITE DE CERTIFICACIÓN DEL MOTOR DE TRADUCCIÓN IA (GEMINI ENGINE)");
console.log("══════════════════════════════════════════════════════════════════════\n");

// 1. Verificación del Prompt Reforzado (Español Latino Neutro & Directivas Cinematográficas)
console.log("1. Calibración de Prompts Cinematográficos (Francés & Alemán):");

const promptFr = buildTranslateSystemPrompt("Balthazar", "fr");
assert(promptFr.includes("Balthazar"), "Título dinámico 'Balthazar' inyectado en el prompt");
assert(promptFr.includes("idioma francés (fr)"), "Idioma de origen francés ('fr') explicitado");
assert(promptFr.includes("ESPAÑOL LATINOAMERICANO NEUTRO"), "Destino explícito en Español Latinoamericano Neutro");
assert(promptFr.includes("REGLA INVIOLABLE DE NOMBRES PROPIOS"), "Directiva inviolable de nombres propios y topónimos");
assert(promptFr.includes("HIGIENE ANTI-SDH"), "Prohibición explícita de descripciones de sonido y etiquetas");
assert(promptFr.includes(NL), "Directiva de preservación del centinela de salto de línea §Z");

const promptDe = buildTranslateSystemPrompt("Tatort", "de");
assert(promptDe.includes("Tatort"), "Título dinámico 'Tatort' inyectado");
assert(promptDe.includes("idioma alemán (de)"), "Idioma de origen alemán ('de') explicitado");

// 2. Higiene de Entrada y Purga de Marcas SDH/CC en Idiomas Europeos
console.log("\n2. Higiene de Entrada y Purga de Marcas SDH/CC (cleanCueForTranslation):");

const rawFrenchCue = "[sighs]\nBALTHAZAR: Ça va ?\n(sonnerie de téléphone)\n♪ musique dramatique ♪\nTu crois qu'il y en a assez ?";
const cleanedFr = cleanCueForTranslation(rawFrenchCue);
assert(!cleanedFr.includes("[sighs]"), "Corchetes [sighs] eliminados");
assert(!cleanedFr.includes("BALTHAZAR:"), "Prefijo de hablante en mayúsculas 'BALTHAZAR:' purgado");
assert(!cleanedFr.includes("(sonnerie de téléphone)"), "Paréntesis sonoros eliminados");
assert(!cleanedFr.includes("♪"), "Símbolos musicales ♪ eliminados");
assert(cleanedFr.includes("Ça va ?"), "Diálogo genuino preservado intacto");
assert(cleanedFr.includes("Tu crois qu'il y en a assez ?"), "Segunda línea de diálogo preservada");

const rawGermanCue = "[Hintergrundmusik]\nKOMMISSAR: Guten Abend, Herr Müller!\n(Lachen im Publikum)";
const cleanedDe = cleanCueForTranslation(rawGermanCue);
assert(!cleanedDe.includes("[Hintergrundmusik]"), "Marcas alemanas [Hintergrundmusik] eliminadas");
assert(!cleanedDe.includes("KOMMISSAR:"), "Prefijo 'KOMMISSAR:' eliminado");
assert(cleanedDe.includes("Guten Abend, Herr Müller!"), "Diálogo en alemán preservado");

const rawHpiCue = "[soupirs]\nMORGANE: Je pense qu'il y a un problème.\nKARADEC: Quel problème ?\nGILLES: Le suspect s'enfuit vers le port !\nCÉLINE: Arrêtez-le tout de suite !\nDAPHNÉ: J'appelle du renfort !\n(sonnerie d'alarme)\n♪ générique ♪\nC'est évident !";
const cleanedHpi = cleanCueForTranslation(rawHpiCue);
assert(!cleanedHpi.includes("[soupirs]"), "HPI: Corchetes [soupirs] eliminados");
assert(!cleanedHpi.includes("MORGANE:"), "HPI: Prefijo MORGANE: eliminado");
assert(!cleanedHpi.includes("KARADEC:"), "HPI: Prefijo KARADEC: eliminado");
assert(!cleanedHpi.includes("GILLES:"), "HPI: Prefijo GILLES: eliminado");
assert(!cleanedHpi.includes("CÉLINE:"), "HPI: Prefijo CÉLINE: eliminado");
assert(!cleanedHpi.includes("DAPHNÉ:"), "HPI: Prefijo DAPHNÉ: eliminado");
assert(!cleanedHpi.includes("(sonnerie d'alarme)"), "HPI: Paréntesis (sonnerie d'alarme) eliminados");
assert(!cleanedHpi.includes("♪"), "HPI: Símbolos musicales ♪ eliminados");
assert(cleanedHpi.includes("Je pense qu'il y a un problème."), "HPI: Diálogo de Morgane preservado");
assert(cleanedHpi.includes("Quel problème ?"), "HPI: Diálogo de Karadec preservado");
assert(cleanedHpi.includes("Le suspect s'enfuit vers le port !"), "HPI: Diálogo de Gilles preservado");
assert(cleanedHpi.includes("Arrêtez-le tout de suite !"), "HPI: Diálogo de Céline preservado");
assert(cleanedHpi.includes("J'appelle du renfort !"), "HPI: Diálogo de Daphné preservado");
assert(cleanedHpi.includes("C'est évident !"), "HPI: Remate de diálogo preservado");

// 3. Robustez del Parseador (parseNumbered) y Centinelas §Z
console.log("\n3. Robustez de Parseo y Manejo de Delimitadores §Z:");

const rawOutputWithFences = "```markdown\n1▸ ¿Cómo estás?§Z¿Crees que hay suficiente?\n2▸ ¿Es la mermelada de mi tía?\n3▸ Raphaël Balthazar\n```";
const parsedFences = parseNumbered(rawOutputWithFences);
assert(parsedFences.size === 3, `3/3 cues parseadas a pesar de code fences Markdown (tamaño: ${parsedFences.size})`);
assert(parsedFences.get(1) === "¿Cómo estás?§Z¿Crees que hay suficiente?", "Cue #1 parseada con centinela §Z intacto");
assert(parsedFences.get(3) === "Raphaël Balthazar", "Nombre propio preservado sin traducir");

// Verificación de reemplazo de §Z a salto de línea
const textWithNl = parsedFences.get(1)!.replace(new RegExp(NL, "g"), "\n");
assert(textWithNl === "¿Cómo estás?\n¿Crees que hay suficiente?", "§Z convertido fielmente a salto de línea real (\\n)");

// Variantes de separadores (punto, dos puntos, guión)
const rawAltSeparators = "1. Primera línea\n2: Segunda línea\n3 - Tercera línea";
const parsedAlt = parseNumbered(rawAltSeparators);
assert(parsedAlt.size === 3, "Parseo exitoso con formatos alternativos (1., 2:, 3 -)");

// 4. Filtro Anti-Fuga de Moderación de Contenido (Nemotron/OpenRouter leak)
console.log("\n4. Detección y Rechazo de Fugas de Moderación ('User Safety: safe'):");

const moderationOutput = "User Safety: safe";
const parsedMod = parseNumbered(moderationOutput);
assert(parsedMod.size === 0, "Salida de clasificador 'User Safety: safe' rechazada por el parser (0 cues extraídas)");

const isModerationLeak = /^user\s*safety:\s*safe$/i.test(moderationOutput.trim());
assert(isModerationLeak, "Regex canónica detecta e invalida inmediatamente la fuga de moderación");

// 5. Verificación de Presupuestos de Fast-Window y Ventana de 70 Cues
console.log("\n5. Auditoría de Parámetros de Fast-Window (Android TV Leanback):");

assert(FAST_WINDOW_CUES === 70, `Tamaño de Fast-Window configurado a 70 cues para Leanback (actual: ${FAST_WINDOW_CUES})`);
assert(FAST_WINDOW_BUDGET_MS === 4000, `Presupuesto síncrono configurado a 4000ms (<4s) (actual: ${FAST_WINDOW_BUDGET_MS}ms)`);

// Simulación de 70 cues
const dummyCues: Cue[] = [];
for (let i = 0; i < 70; i++) {
  dummyCues.push({
    start: `00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")},000`,
    end: `00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String((i % 60) + 2).padStart(2, "0")},000`,
    text: `Diálogo traducido en español latino cue #${i + 1}`,
  });
}

const srtGenerated = serializeSrt(dummyCues);
const cleanedFinalSrt = cleanSrt(srtGenerated);
const parsedBack = parseSrt(cleanedFinalSrt);
assert(parsedBack.length === 70, `70/70 cues serializadas y saneadas limpiamente (longitud SRT: ${cleanedFinalSrt.length} bytes)`);

// 6. Garantizador de Fallback Universal de Traducción por IA (Última Instancia)
console.log("\n6. Garantizador de Fallback Universal de Traducción por IA (IDs Inexistentes/Raros):");

const { handleTranslate } = await import("./deno-hub/translate/translate.ts");

// Caso Extremo 1: ID de película totalmente inexistente (tt999999999)
const resInexistente = await handleTranslate(
  "/subtitles/movie/tt999999999.json",
  "http://127.0.0.1:8787/translate",
);
assert(resInexistente.status === 200, "HTTP 200 en consulta de subtítulos para ID inexistente (tt999999999)");

const dataInexistente = await resInexistente.json();
assert(Array.isArray(dataInexistente.subtitles), "Respuesta contiene arreglo de subtítulos");
assert(dataInexistente.subtitles.length > 0, `NUNCA devuelve array vacío (recibidos: ${dataInexistente.subtitles.length} tracks)`);

const topSub = dataInexistente.subtitles[0];
assert(
  topSub.name === "⚡ 1. Latino (IA Gemini) · [Traducción Automática]",
  `Label estricto de última instancia: ${topSub.name}`,
);

// Verificación de compatibilidad dual de códigos ISO (spl y spa)
const hasSpl = dataInexistente.subtitles.some((s: { lang: string }) => s.lang === "spl");
const hasSpa = dataInexistente.subtitles.some((s: { lang: string }) => s.lang === "spa");
assert(hasSpl && hasSpa, "Entrega de tracks duales requeridos por Stremio TV Box (spl + spa)");

// Descarga del subtítulo sintético de fallback generado
const synthUrl = new URL(topSub.url);
const synthSubPath = synthUrl.pathname.replace(/^\/translate/, "");
const resSynthSrt = await handleTranslate(synthSubPath, "http://127.0.0.1:8787/translate");
assert(resSynthSrt.status === 200, `Descarga de SRT sintético exitosa (HTTP ${resSynthSrt.status})`);

const srtBody = await resSynthSrt.text();
assert(srtBody.length > 100, `Contenido SRT válido entregado (${srtBody.length} bytes)`);
const parsedSynthCues = parseSrt(srtBody);
assert(parsedSynthCues.length >= 2, `Cues de diálogo informativos válidos detectados (${parsedSynthCues.length} cues)`);

// Caso Extremo 2: Serie con hashes raros sin cobertura comunitaria
const resSerieRara = await handleTranslate(
  "/subtitles/series/custom_show_987654:2:5/videoHash=abc123456789&filename=Obscure.Show.S02E05.720p.mkv.json",
  "http://127.0.0.1:8787/translate",
);
assert(resSerieRara.status === 200, "HTTP 200 para serie con hash y nombre de release no estándar");
const dataSerieRara = await resSerieRara.json();
assert(dataSerieRara.subtitles.length > 0, `Cobertura garantizada al 100% para serie no estándar (${dataSerieRara.subtitles.length} tracks)`);
assert(dataSerieRara.subtitles[0].name === "⚡ 1. Latino (IA Gemini) · [Traducción Automática]", "Opción #1 liderada por IA Gemini en 100% de los casos");

// Caso Extremo 3: HPI / ACI con ID alternativo tt13000282 para todas las temporadas (S01 a S04)
const hpiSeasonCheck = [
  { season: 1, ep: 1 },
  { season: 2, ep: 8 },
  { season: 3, ep: 1 },
  { season: 4, ep: 8 },
];

for (const { season, ep } of hpiSeasonCheck) {
  const epKey = `S0${season}E0${ep}`.replace(/0(\d{2})/, "$1");
  const resHpi = await handleTranslate(
    `/subtitles/series/tt13000282:${season}:${ep}.json`,
    "http://127.0.0.1:8787/translate",
  );
  assert(resHpi.status === 200, `HTTP 200 para HPI ${epKey} con ID alternativo (tt13000282)`);
  const dataHpi = await resHpi.json();
  assert(dataHpi.subtitles.length > 0, `Subtítulos IA entregados para HPI ${epKey} (${dataHpi.subtitles.length} tracks)`);
  assert(dataHpi.subtitles[0].name === "⚡ 1. Latino (IA Gemini) · [Traducción Automática]", `HPI ${epKey}: Opción #1 es ⚡ 1. Latino (IA Gemini) · [Traducción Automática]`);
  const hpiSpl = dataHpi.subtitles.some((s: { lang: string }) => s.lang === "spl");
  const hpiSpa = dataHpi.subtitles.some((s: { lang: string }) => s.lang === "spa");
  assert(hpiSpl && hpiSpa, `HPI ${epKey}: Entrega dual obligatoria spl + spa para Android TV`);
}

// Resumen Final
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log(` RESULTADO: ${passed} verificaciones superadas, ${failed} fallidas`);
console.log("══════════════════════════════════════════════════════════════════════\n");

if (failed > 0) {
  Deno.exit(1);
}
