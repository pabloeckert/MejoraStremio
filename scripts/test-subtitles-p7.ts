/**
 * test_subtitles_p7.ts — Suite de Verificación de Refinamiento Avanzado de Subtítulos (P7).
 *
 * Valida:
 * 1. SmartSync: Detección y descarte incondicional por drift no lineal (>300ms de residuo).
 * 2. Sanitizador Anti-SDH: Preservación estricta de siglas (NASA:, FBI:, OK:, CEO:) y paréntesis narrativos.
 * 3. Gobernanza Gemini IA: Control de cuota diaria, circuit breaker 429 con backoff exponencial y rotulado [Traducción IA].
 *
 * Alcance exclusivo: Android TV ZTE ZXV10 B866V2.
 */

import {
  checkNonLinearDrift,
  rescaleSrtWithTwoAnchorsValidated,
  cleanSrt,
  parseSrtToCues,
  PRESERVED_SPEAKER_ACRONYMS,
  MAX_ALLOWED_RESIDUAL_MS,
  type SyncAnchor,
} from "./deno-hub/subtitles/smartsync.ts";

import {
  checkGeminiDailyQuota,
  recordGeminiUsage,
  checkGemini429Circuit,
  recordGemini429Error,
  recordGeminiSuccess,
  resetGeminiGovernanceForTesting,
  INITIAL_429_COOLDOWN_MS,
} from "./deno-hub/translate/gemini_governance.ts";

import { cleanCueForTranslation } from "./deno-hub/translate/gemini.ts";
import { handleTranslate } from "./deno-hub/translate/translate.ts";
import { getKv } from "./deno-hub/utils/common.ts";

Deno.test("BLOQUE 5: P7 — Suite de Refinamiento Avanzado de Subtítulos", async (t) => {
  const kv = await getKv();

  // ───────────────────────────────────────────────────────────────────────────
  // 1. SMARTSYNC: CONTROL DE DRIFT NO LINEAL (>300ms)
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("1. SmartSync: Descarte Incondicional por Drift No Lineal (>300ms)", () => {
    // Anclas base de inicio (0s) y fin (60s)
    const anchor1: SyncAnchor = { subMs: 0, audioMs: 0 };
    const anchor2: SyncAnchor = { subMs: 60000, audioMs: 60000 };

    // Caso A: Pista con deriva lineal normal (residuo 40ms <= 300ms)
    const linearTestAnchors: SyncAnchor[] = [
      { subMs: 15000, audioMs: 15020 }, // residuo: 20ms
      { subMs: 30000, audioMs: 30040 }, // residuo: 40ms
      { subMs: 45000, audioMs: 44990 }, // residuo: 10ms
    ];

    const resultA = checkNonLinearDrift(anchor1, anchor2, linearTestAnchors, MAX_ALLOWED_RESIDUAL_MS);
    if (!resultA.valid || resultA.isNonLinearDrift) {
      throw new Error(`Pista lineal legítima fue rechazada erróneamente: maxResidual=${resultA.maxResidualMs}ms`);
    }
    if (resultA.maxResidualMs !== 40) {
      throw new Error(`Residuo máximo esperado 40ms, obtenido: ${resultA.maxResidualMs}ms`);
    }

    const sampleSrt = `1\n00:00:01,000 --> 00:00:04,000\nHola mundo\n\n2\n00:00:30,000 --> 00:00:35,000\nDiálogo intermedio\n`;
    const rescaledA = rescaleSrtWithTwoAnchorsValidated(sampleSrt, anchor1, anchor2, linearTestAnchors);
    if (!rescaledA.valid || !rescaledA.srt) {
      throw new Error(`Reescalado de pista lineal válida falló: ${rescaledA.error}`);
    }

    // Caso B: Pista con corte comercial o descalce no lineal (residuo 1200ms > 300ms)
    const nonLinearTestAnchors: SyncAnchor[] = [
      { subMs: 15000, audioMs: 15050 }, // residuo: 50ms (OK)
      { subMs: 30000, audioMs: 31200 }, // residuo: 1200ms (Corte comercial/edición alternativa!)
      { subMs: 45000, audioMs: 46250 }, // residuo: 1250ms
    ];

    const resultB = checkNonLinearDrift(anchor1, anchor2, nonLinearTestAnchors, MAX_ALLOWED_RESIDUAL_MS);
    if (resultB.valid || !resultB.isNonLinearDrift) {
      throw new Error("Pista con drift no lineal no fue detectada como inválida");
    }
    if (resultB.maxResidualMs < 1200) {
      throw new Error(`Residuo reportado insuficiente: ${resultB.maxResidualMs}ms`);
    }

    // Descarte incondicional: srt debe ser null para que el pipeline evalúe la siguiente pista
    const rescaledB = rescaleSrtWithTwoAnchorsValidated(sampleSrt, anchor1, anchor2, nonLinearTestAnchors);
    if (rescaledB.valid || rescaledB.srt !== null) {
      throw new Error("Pista con drift no lineal no retornó srt: null para descarte");
    }

    console.log("  ✓ SmartSync validado: Pista lineal aceptada (40ms), pista con corte comercial descartada (1250ms > 300ms)");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. SANITIZADOR ANTI-SDH: BLINDAJE DE EXCEPCIONES
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("2. Anti-SDH: Preservación Estricta de Siglas Legítimas y Paréntesis Narrativos", () => {
    // 2.1 Preservación de siglas legítimas de hablantes en mayúsculas
    const srtWithAcronyms = `1
00:00:01,000 --> 00:00:04,000
NASA: Houston, tenemos un problema.

2
00:00:05,000 --> 00:00:08,000
FBI: ¡Abran la puerta de inmediato!

3
00:00:09,000 --> 00:00:12,000
CEO: La adquisición fue aprobada por el directorio.

4
00:00:13,000 --> 00:00:16,000
OK: Vamos a proceder con el plan B.

5
00:00:17,000 --> 00:00:20,000
MORGANE: Bonjour tout le monde.

6
00:00:21,000 --> 00:00:24,000
NARRADOR: Hace mucho tiempo en una galaxia lejana.
`;

    const cleanedAcronyms = cleanSrt(srtWithAcronyms);
    const cues = parseSrtToCues(cleanedAcronyms);

    const cue1 = cues.find((c) => c.text.includes("NASA:"));
    const cue2 = cues.find((c) => c.text.includes("FBI:"));
    const cue3 = cues.find((c) => c.text.includes("CEO:"));
    const cue4 = cues.find((c) => c.text.includes("OK:"));

    if (!cue1 || !cue2 || !cue3 || !cue4) {
      throw new Error(`Siglas legítimas fueron purgadas erróneamente: NASA=${!!cue1}, FBI=${!!cue2}, CEO=${!!cue3}, OK=${!!cue4}`);
    }

    // Asegurar que hablantes genéricos SDH sí fueron purgados
    if (cleanedAcronyms.includes("MORGANE:") || cleanedAcronyms.includes("NARRADOR:")) {
      throw new Error("Etiquetas SDH genéricas (MORGANE, NARRADOR) no fueron purgadas");
    }
    if (!cleanedAcronyms.includes("Bonjour tout le monde") || !cleanedAcronyms.includes("Hace mucho tiempo")) {
      throw new Error("El diálogo tras purgar la etiqueta SDH fue mutilado");
    }

    // 2.2 Preservación de paréntesis narrativos en minúsculas y purga de acotaciones sonoras
    const srtWithParens = `1
00:00:01,000 --> 00:00:04,000
(en voz baja) No le digas a nadie sobre esto.

2
00:00:05,000 --> 00:00:08,000
El informe fue elaborado por la (NASA) en secreto.

3
00:00:09,000 --> 00:00:12,000
(APLAUSOS)

4
00:00:13,000 --> 00:00:16,000
[MÚSICA SUAVE]

5
00:00:17,000 --> 00:00:20,000
Hola (sonriendo tímidamente) ¿cómo estás? (música)
`;

    const cleanedParens = cleanSrt(srtWithParens);

    if (!cleanedParens.includes("(en voz baja)")) {
      throw new Error("Paréntesis narrativo '(en voz baja)' fue purgado erróneamente");
    }
    if (!cleanedParens.includes("(NASA)")) {
      throw new Error("Sigla en paréntesis '(NASA)' fue purgada erróneamente");
    }
    if (!cleanedParens.includes("(sonriendo tímidamente)")) {
      throw new Error("Paréntesis narrativo '(sonriendo tímidamente)' fue purgado erróneamente");
    }

    // Ruidos sonoros deben estar purgados
    if (cleanedParens.includes("APLAUSOS") || cleanedParens.includes("MÚSICA SUAVE") || cleanedParens.includes("(música)")) {
      throw new Error("Acotaciones sonoras (APLAUSOS, MÚSICA) no fueron purgadas");
    }

    // 2.3 Validación en cleanCueForTranslation
    const cueTrans = cleanCueForTranslation("NASA: Preparando encendido. (en suspenso) [DISPAROS]");
    if (!cueTrans.includes("NASA:") || !cueTrans.includes("(en suspenso)") || cueTrans.includes("DISPAROS")) {
      throw new Error(`cleanCueForTranslation falló preservación/purga: '${cueTrans}'`);
    }

    console.log("  ✓ Anti-SDH validado: NASA:, FBI:, CEO:, OK:, (en voz baja) y (NASA) intactos; ruidos purgados");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. GOBERNANZA GEMINI IA: CONTROL DE CUOTA DIARIA
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("3. Gobernanza Gemini IA: Control de Cuota Diaria y Fallback", async () => {
    await resetGeminiGovernanceForTesting(kv);

    // Con cuota limpia -> permitido
    const initialQuota = await checkGeminiDailyQuota(kv, 10);
    if (!initialQuota.allowed || initialQuota.used !== 0 || initialQuota.remaining !== 10) {
      throw new Error(`Estado inicial de cuota inesperado: ${JSON.stringify(initialQuota)}`);
    }

    // Registrar 5 consumos
    await recordGeminiUsage(kv, 5);
    const midQuota = await checkGeminiDailyQuota(kv, 10);
    if (!midQuota.allowed || midQuota.used !== 5 || midQuota.remaining !== 5) {
      throw new Error(`Cuota intermedia errónea: ${JSON.stringify(midQuota)}`);
    }

    // Registrar 5 consumos más para alcanzar el tope de 10
    await recordGeminiUsage(kv, 5);
    const exhaustedQuota = await checkGeminiDailyQuota(kv, 10);
    if (exhaustedQuota.allowed || exhaustedQuota.used !== 10 || exhaustedQuota.remaining !== 0) {
      throw new Error(`Cuota no reportó agotamiento: ${JSON.stringify(exhaustedQuota)}`);
    }

    console.log("  ✓ Control de cuota diaria validado: Límite respetado y bloqueo preventivo activado");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. GOBERNANZA GEMINI IA: CIRCUIT BREAKER 429 CON BACKOFF EXPONENCIAL
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("4. Gobernanza Gemini IA: Circuito 429 con Backoff Exponencial", async () => {
    await resetGeminiGovernanceForTesting(kv);

    // Estado inicial: CLOSED
    const initialCircuit = await checkGemini429Circuit(kv);
    if (initialCircuit.state !== "CLOSED" || !initialCircuit.allowed) {
      throw new Error(`Estado inicial del circuito inesperado: ${initialCircuit.state}`);
    }

    // Registrar primer 429
    const trip1 = await recordGemini429Error(kv);
    if (trip1.state !== "OPEN" || trip1.consecutive429 !== 1 || trip1.cooldownMs !== INITIAL_429_COOLDOWN_MS) {
      throw new Error(`Primer disparo del circuito inválido: ${JSON.stringify(trip1)}`);
    }

    // Comprobar que en estado OPEN rechaza llamadas inmediatamente
    const openCheck = await checkGemini429Circuit(kv);
    if (openCheck.state !== "OPEN" || openCheck.allowed || openCheck.cooldownRemainingMs <= 0) {
      throw new Error(`Circuito OPEN permitió llamada: ${JSON.stringify(openCheck)}`);
    }

    // Registrar segundo 429 (backoff exponencial: 30s * 2 = 60s)
    const trip2 = await recordGemini429Error(kv);
    if (trip2.cooldownMs !== 60_000 || trip2.consecutive429 !== 2) {
      throw new Error(`Backoff exponencial no duplicó cooldown: ${JSON.stringify(trip2)}`);
    }

    // Registrar éxito -> restablecimiento a CLOSED
    await recordGeminiSuccess(kv);
    const closedCheck = await checkGemini429Circuit(kv);
    if (closedCheck.state !== "CLOSED" || !closedCheck.allowed) {
      throw new Error(`Circuito no se restableció a CLOSED tras éxito: ${closedCheck.state}`);
    }

    console.log("  ✓ Circuito 429 validado: Transición OPEN inmediata, backoff exponencial 30s->60s y reseteo a CLOSED");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. ETIQUETADO MANDATORIO [Traducción IA] EN EL HUB
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("5. Etiquetado Mandatorio [Traducción IA] en Endpoint /translate", async () => {
    const res = await handleTranslate(
      "/subtitles/series/tt0081871:1:1.json",
      "http://127.0.0.1:8787/translate",
    );
    if (res.status !== 200) {
      throw new Error(`Endpoint /translate respondió HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.subtitles || data.subtitles.length === 0) {
      throw new Error("No se devolvieron subtítulos desde /translate");
    }

    for (const sub of data.subtitles) {
      if (!sub.name.includes("[Traducción IA]")) {
        throw new Error(`Pista carece del rotulado mandatorio [Traducción IA]: '${sub.name}'`);
      }
    }

    console.log(`  ✓ Etiquetado mandatorio validado: ${data.subtitles.length} pistas con rotulado [Traducción IA]`);
  });

  await resetGeminiGovernanceForTesting(kv);
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" ✨ TODOS LOS TESTS DE P7 SUPERADOS CON ÉXITO (100% PASS)");
  console.log("══════════════════════════════════════════════════════════════");
});
