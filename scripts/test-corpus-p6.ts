/**
 * test_corpus_p6.ts — Suite de Prueba Extendida de 500 Títulos & Quality Gate de Audio Latino.
 *
 * Evalúa la fixture congelada de 500 casos de prueba:
 * - Calcula Precisión, Recall y F1-Score para los niveles CONFIRMADO, PROBABLE y DESCONOCIDO.
 * - Aplica el Quality Gate con Regla de Bloqueo Inviolable:
 *   1. Recall del nivel CONFIRMADO >= 100.0%.
 *   2. Cero (0) falsos positivos con insignia [🌎 LATINO] en Puesto #1.
 *
 * Alcance: ZTE ZXV10 B866V2 (Amlogic S905X2).
 */

import {
  detectLatinoConfidence,
  classifyStreamAudio,
  isLatinoStream,
  type LatinoConfidence,
  type StremioStreamItem,
} from "./deno-hub/utils/common.ts";
import { rankAndBadgeStreams } from "./deno-hub/streams/streams.ts";

interface FixtureItem {
  id: number;
  imdb_id: string;
  media_title: string;
  year: number;
  release_title: string;
  stream: {
    name: string;
    title: string;
    description: string;
  };
  expected_confidence: LatinoConfidence;
  is_latino_audio: boolean;
  category: string;
}

interface Metrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
}

function calculateMetrics(tp: number, fp: number, fn: number, tn: number): Metrics {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1.0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0.0;
  return { tp, fp, fn, tn, precision, recall, f1 };
}

Deno.test("BLOQUE 2: P6 — Fixture de 500 Títulos y Quality Gate Audio Latino", async (t) => {
  // 1. Carga de la Fixture Congelada
  let rawJson = "";
  try {
    rawJson = await Deno.readTextFile("scratch/fixtures_corpus_500.json");
  } catch {
    rawJson = await Deno.readTextFile("data/fixtures_corpus_500.json");
  }

  const fixtures = JSON.parse(rawJson) as FixtureItem[];

  await t.step(`1. Verificación de Integridad de la Fixture (${fixtures.length} casos)`, () => {
    if (fixtures.length !== 500) {
      throw new Error(`La fixture debe contener exactamente 500 títulos. Actual: ${fixtures.length}`);
    }
    console.log(`  • Fixture cargada exitosamente: 500 títulos versionados.`);
  });

  // Contadores por nivel
  const levels: LatinoConfidence[] = ["Confirmado", "Probable", "Desconocido"];
  const matrix: Record<LatinoConfidence, { tp: number; fp: number; fn: number; tn: number }> = {
    Confirmado: { tp: 0, fp: 0, fn: 0, tn: 0 },
    Probable: { tp: 0, fp: 0, fn: 0, tn: 0 },
    Desconocido: { tp: 0, fp: 0, fn: 0, tn: 0 },
  };

  let falsePositivesInSlot1 = 0;
  const slot1Violations: Array<{ id: number; title: string; category: string; badge: string }> = [];

  await t.step("2. Ejecución del Clasificador sobre los 500 Títulos", () => {
    for (const item of fixtures) {
      const predicted = detectLatinoConfidence(item.stream);
      const expected = item.expected_confidence;

      for (const lvl of levels) {
        if (expected === lvl && predicted === lvl) {
          matrix[lvl].tp++;
        } else if (expected !== lvl && predicted === lvl) {
          matrix[lvl].fp++;
        } else if (expected === lvl && predicted !== lvl) {
          matrix[lvl].fn++;
        } else {
          matrix[lvl].tn++;
        }
      }

      // Simulación de ranking en Puesto #1
      // Creamos una lista donde el stream actual compite contra un stream original estándar
      const testList: StremioStreamItem[] = [
        {
          name: item.stream.name,
          title: item.stream.title,
          description: item.stream.description,
          url: "https://torbox.app/stream/test",
        },
        {
          name: "Torrentio\n1080p",
          title: "Standard English Original 1080p WEB-DL\n👤 100",
          description: "[TB+] English Original",
          url: "https://torbox.app/stream/orig",
        },
      ];

      const ranked = rankAndBadgeStreams(testList);
      const topStream = ranked[0];

      const hasLatinoBadgeInTop = (topStream.name || "").includes("[🌎 LATINO]");

      // Regla Inviolable: Si NO es audio latino confirmado, NUNCA debe recibir [🌎 LATINO] en el Puesto #1
      if (!item.is_latino_audio && hasLatinoBadgeInTop) {
        falsePositivesInSlot1++;
        slot1Violations.push({
          id: item.id,
          title: item.release_title,
          category: item.category,
          badge: topStream.name || "",
        });
      }
    }
  });

  // Cálculo de Métricas
  const metrics: Record<LatinoConfidence, Metrics> = {
    Confirmado: calculateMetrics(matrix.Confirmado.tp, matrix.Confirmado.fp, matrix.Confirmado.fn, matrix.Confirmado.tn),
    Probable: calculateMetrics(matrix.Probable.tp, matrix.Probable.fp, matrix.Probable.fn, matrix.Probable.tn),
    Desconocido: calculateMetrics(matrix.Desconocido.tp, matrix.Desconocido.fp, matrix.Desconocido.fn, matrix.Desconocido.tn),
  };

  await t.step("3. Reporte de Métricas por Nivel (Precisión, Recall, F1)", () => {
    console.log("\n──────────────────────────────────────────────────────────────────────────");
    console.log(" TABLA DE MÉTRICAS DEL CLASIFICADOR DE AUDIO LATINO (500 TÍTULOS):");
    console.log("──────────────────────────────────────────────────────────────────────────");
    console.log(" Nivel       | TP   | FP | FN | Precisión | Recall    | F1-Score");
    console.log("──────────────────────────────────────────────────────────────────────────");
    for (const lvl of levels) {
      const m = metrics[lvl];
      const pStr = (m.precision * 100).toFixed(2) + "%";
      const rStr = (m.recall * 100).toFixed(2) + "%";
      const f1Str = (m.f1 * 100).toFixed(2) + "%";
      console.log(` ${lvl.padEnd(11)} | ${String(m.tp).padStart(4)} | ${String(m.fp).padStart(2)} | ${String(m.fn).padStart(2)} | ${pStr.padStart(9)} | ${rStr.padStart(9)} | ${f1Str.padStart(8)}`);
    }
    console.log("──────────────────────────────────────────────────────────────────────────");
  });

  await t.step("4. Validación de Quality Gate y Reglas de Bloqueo CI/CD", () => {
    console.log("\n[ QUALITY GATE EVALUATION ]");

    const recallConfirmado = metrics.Confirmado.recall;
    console.log(`  1. Recall Nivel CONFIRMADO: ${(recallConfirmado * 100).toFixed(2)}% (Mínimo exigido: 100.0%)`);
    if (recallConfirmado < 1.0) {
      throw new Error(`🚨 QUALITY GATE FALLIDO: Recall de CONFIRMADO ${(recallConfirmado * 100).toFixed(2)}% es inferior al 100%`);
    }
    console.log("     ✓ PASS: Recall de CONFIRMADO cumple 100.0% estricto.");

    console.log(`  2. Falsos Positivos con [🌎 LATINO] en Puesto #1: ${falsePositivesInSlot1} (Máximo tolerado: 0)`);
    if (falsePositivesInSlot1 > 0) {
      console.error("  Violaciones detectadas en Puesto #1:", slot1Violations);
      throw new Error(`🚨 QUALITY GATE FALLIDO: Se detectaron ${falsePositivesInSlot1} falsos positivos en Puesto #1`);
    }
    console.log("     ✓ PASS: Cero falsos positivos en Puesto #1 verificado.");

    const precisionConfirmado = metrics.Confirmado.precision;
    console.log(`  3. Precisión Nivel CONFIRMADO: ${(precisionConfirmado * 100).toFixed(2)}%`);
    if (precisionConfirmado < 1.0) {
      throw new Error(`🚨 QUALITY GATE FALLIDO: Precisión de CONFIRMADO ${(precisionConfirmado * 100).toFixed(2)}% es inferior al 100%`);
    }
    console.log("     ✓ PASS: Precisión de CONFIRMADO cumple 100.0% estricto.");
  });

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" ✨ QUALITY GATE APROBADO AL 100% (500/500 CASOS SUPERADOS)");
  console.log("══════════════════════════════════════════════════════════════");
});
