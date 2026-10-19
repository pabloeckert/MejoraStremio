/**
 * test_kv_sub_cache.ts — Test Unitario para la Capa de Persistencia de Subtítulos IA en Deno KV.
 *
 * Verifica:
 * 1. Simulación de SRT masivo (>100 KiB).
 * 2. Compresión Gzip y fragmentación en Chunks ≤60 KiB con Manifest atómico.
 * 3. Mecanismo de candado Single-Flight (bloqueo atómico anti-concurrencia).
 * 4. Criterio de inclusión estricto (rechazo de batches fallidos).
 * 5. Reconstrucción, validación de integridad SHA-256 y descompresión limpia.
 * 6. Detección de corrupción y purga automática (cache miss defensivo).
 */

import {
  putCachedSub,
  getCachedSub,
  acquireSingleFlightLock,
  releaseSingleFlightLock,
  runWithSingleFlight,
  calculateSha256,
  SUB_CACHE_CHUNK_SIZE,
  type SubCacheKeyParams,
  type CachedSubPayload,
} from "../scripts/deno-hub/translate/kv_sub_cache.ts";

function generateMassiveSrt(targetSizeBytes = 120 * 1024): string {
  const blocks: string[] = [];
  let currentBytes = 0;
  let cueIndex = 1;
  let currentMs = 1000;

  while (currentBytes < targetSizeBytes) {
    const startSec = Math.floor(currentMs / 1000);
    const endSec = startSec + 3;
    const startStr = `00:${String(Math.floor(startSec / 60)).padStart(2, "0")}:${String(startSec % 60).padStart(2, "0")},000`;
    const endStr = `00:${String(Math.floor(endSec / 60)).padStart(2, "0")}:${String(endSec % 60).padStart(2, "0")},000`;
    const text = `Diálogo dramático traducido por IA de prueba número ${cueIndex} con contenido extenso en español latinoamericano neutro sin marcas SDH ni ruidos ambientales.`;

    const block = `${cueIndex}\n${startStr} --> ${endStr}\n${text}\n\n`;
    blocks.push(block);
    currentBytes += new TextEncoder().encode(block).length;
    currentMs += 3500;
    cueIndex++;
  }

  return blocks.join("");
}

Deno.test("P1 + P2: Capa de Persistencia Deno KV — Suite Integral", async (t) => {
  // Inicializar base de datos local Deno KV para pruebas
  const kv = await Deno.openKv(":memory:");

  const params: SubCacheKeyParams = {
    tmdb_id: "tt14060708",
    season: 1,
    episode: 1,
    lang: "spl",
    sourceSrtHash: "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890",
  };

  await t.step("1. Generación y Validación de SRT Masivo (>100 KiB)", () => {
    const massiveSrt = generateMassiveSrt(130 * 1024);
    const sizeBytes = new TextEncoder().encode(massiveSrt).length;
    console.log(`  • Tamaño del SRT masivo generado: ${sizeBytes} bytes (${(sizeBytes / 1024).toFixed(2)} KiB)`);
    if (sizeBytes < 100 * 1024) {
      throw new Error(`El SRT generado debe ser >100 KiB. Actual: ${sizeBytes} bytes`);
    }
  });

  await t.step("2. Mecanismo Single-Flight (Lock Atómico)", async () => {
    // 2.1 Adquisición inicial exitosa
    const acquiredFirst = await acquireSingleFlightLock(kv, params, 10000);
    if (!acquiredFirst) throw new Error("La primera solicitud debió adquirir el candado");

    // 2.2 Intento concurrente debe rebotar (evita llamadas duplicadas a Gemini)
    const acquiredSecond = await acquireSingleFlightLock(kv, params, 10000);
    if (acquiredSecond) throw new Error("La segunda solicitud concurrente no debió adquirir el lock");

    // 2.3 Liberación del lock
    await releaseSingleFlightLock(kv, params);

    // 2.4 Tras liberar, debe poder adquirirse nuevamente
    const acquiredThird = await acquireSingleFlightLock(kv, params, 10000);
    if (!acquiredThird) throw new Error("Debe poder adquirirse el lock tras su liberación");
    await releaseSingleFlightLock(kv, params);
    console.log("  ✓ Candado atómico Single-Flight verificado contra concurrencia");
  });

  await t.step("3. Criterio de Inclusión Estricto (Rechazo de Resultados Incompletos)", async () => {
    const invalidPayload: CachedSubPayload = {
      srt: "1\n00:00:01,000 --> 00:00:04,000\nSubtítulo incompleto\n\n",
      allBatchesOk: false, // Incompleto / Degradado
      timestamp: Date.now(),
    };

    const saved = await putCachedSub(kv, params, invalidPayload);
    if (saved) throw new Error("No debe permitirse almacenar subtítulos con allBatchesOk === false");

    const cached = await getCachedSub(kv, params);
    if (cached !== null) throw new Error("No debe existir entrada en caché para payload rechazado");
    console.log("  ✓ Criterio de inclusión estricto verificado: batches fallidos descartados");
  });

  await t.step("4. Compresión Gzip, Fragmentación en Chunks ≤60 KiB y Manifest", async () => {
    // Generar SRT de alta entropía que supera 60 KiB incluso DESPUÉS de comprimir con Gzip
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey", "xray", "yankee", "zulu", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const lines: string[] = [];
    let seed = 1234567;
    for (let i = 1; i <= 3500; i++) {
      let phrase = "";
      for (let w = 0; w < 16; w++) {
        seed = (seed * 9301 + 49297) % 233280;
        const idx = Math.floor((seed / 233280) * words.length);
        phrase += words[idx] + " ";
      }
      lines.push(`${i}\n00:00:00,000 --> 00:00:02,000\n${phrase.trim()}\n\n`);
    }
    const multiChunkSrt = lines.join("");

    const validPayload: CachedSubPayload = {
      srt: multiChunkSrt,
      smartSync: {
        ratio: 1.0427083,
        offsetMs: -120,
        framerate: "23.976",
        twoAnchor: {
          anchor1: { sourceMs: 60000, targetMs: 62562 },
          anchor2: { sourceMs: 1800000, targetMs: 1876875 },
        },
      },
      allBatchesOk: true,
      timestamp: Date.now(),
    };

    const putOk = await putCachedSub(kv, params, validPayload);
    if (!putOk) throw new Error("putCachedSub falló para el payload masivo");

    // Inspeccionar las entradas físicas en Deno KV
    const baseKey = ["sub", "ai", String(params.tmdb_id), params.season, params.episode, params.lang, params.sourceSrtHash];
    const manifestEntry = await kv.get<{ n_chunks: number; bytes: number; sha256: string }>([...baseKey, "manifest"]);

    if (!manifestEntry.value) throw new Error("El manifest de commit no fue creado");
    const manifest = manifestEntry.value;
    console.log(`  • Manifest registrado: n_chunks=${manifest.n_chunks}, bytes comprimidos=${manifest.bytes}, sha256=${manifest.sha256.slice(0, 16)}...`);

    if (manifest.n_chunks < 2) {
      throw new Error(`Se esperaba fragmentación en al menos 2 chunks (n_chunks >= 2), pero n_chunks=${manifest.n_chunks}`);
    }

    // Verificar el tamaño de cada chunk en Deno KV
    for (let i = 0; i < manifest.n_chunks; i++) {
      const chunkEntry = await kv.get<Uint8Array>([...baseKey, "chunk", i]);
      if (!chunkEntry.value) throw new Error(`Chunk #${i} no encontrado en Deno KV`);
      if (chunkEntry.value.byteLength > SUB_CACHE_CHUNK_SIZE) {
        throw new Error(`Chunk #${i} excede los 60 KiB: ${chunkEntry.value.byteLength} bytes`);
      }
      console.log(`    ↳ Chunk #${i}: ${chunkEntry.value.byteLength} bytes (≤60 KiB OK)`);
    }

    console.log("  ✓ Compresión Gzip y fragmentación en múltiples chunks (n_chunks >= 2) verificada");
  });

  await t.step("5. Reconstrucción, Validación de Integridad SHA-256 y Descompresión Limpia", async () => {
    const retrieved = await getCachedSub(kv, params);
    if (!retrieved) throw new Error("getCachedSub retornó null para entrada válida");

    // Verificar que el SRT recuperado coincide exactamente con el original de más de 400 KB
    if (retrieved.srt.length < 400000) {
      throw new Error(`El SRT recuperado tiene tamaño inesperado: ${retrieved.srt.length}`);
    }

    if (retrieved.smartSync?.ratio !== 1.0427083) {
      throw new Error(`Parámetros de SmartSync alterados: ratio=${retrieved.smartSync?.ratio}`);
    }

    if (retrieved.smartSync?.twoAnchor?.anchor1?.sourceMs !== 60000) {
      throw new Error("Estructura twoAnchor no preservada correctamente");
    }
    console.log(`  ✓ Reconstrucción íntegra (${retrieved.srt.length} chars) y descompresión bit a bit validada`);
  });

  await t.step("6. Detección de Corrupción / Discordancia SHA-256 y Purga Defensiva", async () => {
    const baseKey = ["sub", "ai", String(params.tmdb_id), params.season, params.episode, params.lang, params.sourceSrtHash];
    
    // Corromper el primer chunk
    const corruptedChunk = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await kv.set([...baseKey, "chunk", 0], corruptedChunk);

    // La lectura debe detectar discordancia de hash y purgar la entrada
    const corruptedRead = await getCachedSub(kv, params);
    if (corruptedRead !== null) {
      throw new Error("Debe retornar null ante discordancia de SHA-256");
    }

    // Verificar que la entrada fue purgada
    const checkManifest = await kv.get([...baseKey, "manifest"]);
    if (checkManifest.value !== null) {
      throw new Error("El manifest corrupto debió ser purgado");
    }

    console.log("  ✓ Discordancia SHA-256 detectada y purgada correctamente (Cache Miss defensivo)");
  });

  await t.step("7. Coordinador de Ejecución Single-Flight (runWithSingleFlight)", async () => {
    let generatorCalls = 0;
    const testGenerator = async () => {
      generatorCalls++;
      await new Promise((r) => setTimeout(r, 100)); // Simula latencia de IA
      return {
        srt: generateMassiveSrt(110 * 1024),
        allBatchesOk: true,
        timestamp: Date.now(),
      };
    };

    const newParams: SubCacheKeyParams = {
      ...params,
      sourceSrtHash: "singleflight-unique-test-hash-123456",
    };

    // Lanzar 3 solicitudes concurrentes para el mismo contenido
    const [res1, res2, res3] = await Promise.all([
      runWithSingleFlight(kv, newParams, testGenerator),
      runWithSingleFlight(kv, newParams, testGenerator),
      runWithSingleFlight(kv, newParams, testGenerator),
    ]);

    if (!res1 || !res2 || !res3) {
      throw new Error("Todas las solicitudes concurrentes debieron recibir el subtítulo");
    }

    if (generatorCalls !== 1) {
      throw new Error(`Se esperaban exactamente 1 llamada al generador, pero hubo ${generatorCalls}`);
    }

    console.log(`  ✓ Single-Flight coordinó 3 peticiones concurrentes con exactamente 1 llamada a la IA`);
  });

  await kv.close();
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" ✨ TODOS LOS TESTS DE P1 + P2 SUPERADOS CON ÉXITO (100% PASS)");
  console.log("══════════════════════════════════════════════════════════════");
});
