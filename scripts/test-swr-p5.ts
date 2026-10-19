/**
 * test_swr_p5.ts — Suite de Verificación de Estrategia SWR y Segmentación de Cachés (P5).
 *
 * Valida:
 * 1. Segmentación de TTL por Tipo (Catálogos 24-48h, Streams 15min + 5min stale).
 * 2. Control de Thundering Herd y deduplicación atómica de revalidaciones en background.
 * 3. Verificación obligatoria en tiempo real de streams [⚡ INSTANTÁNEO] en respuestas stale.
 * 4. Degradación defensiva a [⏳ REQUIERE BUFFER] si TorBox ya no tiene el hash cacheado.
 *
 * Alcance exclusivo: Android TV ZTE ZXV10 B866V2.
 */

import {
  getOrSetSwrCache,
  TTL_SEGMENTS,
  verifyTorboxInstantStreams,
  type TorboxCacheChecker,
} from "./deno-hub/utils/swr_cache.ts";
import { getKv, type StremioStreamItem } from "./deno-hub/utils/common.ts";

Deno.test("BLOQUE 4: P5 — Suite de Estrategia SWR y Segmentación de Cachés", async (t) => {
  const kv = await getKv();

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Segmentación de TTL por Tipo
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("1. Validación de Segmentación de TTLs por Tipo", () => {
    // Catálogos y Metadatos: 24h a 48h
    if (TTL_SEGMENTS.CATALOG_METADATA.freshMs !== 24 * 60 * 60 * 1000) {
      throw new Error(`Ventana fresca de catálogo inválida: ${TTL_SEGMENTS.CATALOG_METADATA.freshMs}`);
    }
    if (TTL_SEGMENTS.CATALOG_METADATA.totalTtlMs !== 48 * 60 * 60 * 1000) {
      throw new Error(`TTL total de catálogo inválido: ${TTL_SEGMENTS.CATALOG_METADATA.totalTtlMs}`);
    }

    // Streams de Scrapers: 15 min fresco + 5 min stale (20 min total)
    if (TTL_SEGMENTS.SCRAPER_STREAMS.freshMs !== 15 * 60 * 1000) {
      throw new Error(`Ventana fresca de streams inválida: ${TTL_SEGMENTS.SCRAPER_STREAMS.freshMs}`);
    }
    if (TTL_SEGMENTS.SCRAPER_STREAMS.staleMs !== 5 * 60 * 1000) {
      throw new Error(`Ventana stale de streams inválida: ${TTL_SEGMENTS.SCRAPER_STREAMS.staleMs}`);
    }
    if (TTL_SEGMENTS.SCRAPER_STREAMS.totalTtlMs !== 20 * 60 * 1000) {
      throw new Error(`TTL total de streams inválido: ${TTL_SEGMENTS.SCRAPER_STREAMS.totalTtlMs}`);
    }

    // Subtítulos
    if (TTL_SEGMENTS.SUBTITLES.freshMs !== 15 * 60 * 1000) {
      throw new Error(`Ventana fresca de subtítulos inválida: ${TTL_SEGMENTS.SUBTITLES.freshMs}`);
    }

    console.log("  ✓ Segmentación de TTLs validada: Catálogos (24h/48h), Streams (15m/20m)");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Entrega Inmediata en Caché Fresca
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("2. Entrega Inmediata con Caché Fresca (Zero Network Overhead)", async () => {
    const key = ["test_fresh", Date.now()];
    let fetchCount = 0;

    const fetcher = async () => {
      fetchCount++;
      return { msg: "fresh_payload", version: 1 };
    };

    // Primera llamada (miss) -> puebla
    const r1 = await getOrSetSwrCache(key, fetcher, { ttlMs: 10000, staleMs: 5000 });
    if (r1.msg !== "fresh_payload" || fetchCount !== 1) {
      throw new Error("Fallo en poblar caché inicial");
    }

    // Segunda llamada (fresh hit) -> debe retornar sin invocar fetcher
    const r2 = await getOrSetSwrCache(key, fetcher, { ttlMs: 10000, staleMs: 5000 });
    if (r2.msg !== "fresh_payload" || fetchCount !== 1) {
      throw new Error(`Fallo en entrega fresca: fetcher invocado ${fetchCount} veces (esperado 1)`);
    }

    console.log("  ✓ Caché fresca retornada inmediatamente con cero llamadas de red");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Control de Thundering Herd y Deduplicación Atómica
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("3. Control de Thundering Herd (Deduplicación de Revalidación en Background)", async () => {
    const testKey = ["test_thundering", Date.now()];
    let backgroundRevalidations = 0;

    // Poblar inicialmente con timestamp forzado a STALE (freshMs expirado, dentro de staleMs)
    const freshWindowMs = 200; // 200ms fresco
    const staleWindowMs = 1000; // 1000ms stale
    const initialData = { value: "old_stale_data", counter: 0 };

    await kv.set(testKey, {
      data: initialData,
      timestamp: Date.now() - 300, // 300ms de antigüedad -> STALE
    }, { expireIn: 60000 });

    const slowFetcher = async () => {
      backgroundRevalidations++;
      await new Promise((r) => setTimeout(r, 80)); // Simula latencia de scraper
      return { value: "fresh_new_data", counter: backgroundRevalidations };
    };

    // Lanzar 20 peticiones concurrentes simultáneas contra la clave stale
    const concurrentRequests = Array.from({ length: 20 }, () =>
      getOrSetSwrCache(testKey, slowFetcher, {
        ttlMs: freshWindowMs,
        staleMs: staleWindowMs,
        isStreamsData: false,
      })
    );

    const results = await Promise.all(concurrentRequests);

    // Verificar que las 20 peticiones recibieron el dato stale INMEDIATAMENTE sin esperar los 80ms
    for (const res of results) {
      if (res.value !== "old_stale_data") {
        throw new Error(`Se esperaba dato stale 'old_stale_data', se recibió '${res.value}'`);
      }
    }

    // Esperar a que la revalidación en background termine
    await new Promise((r) => setTimeout(r, 150));

    // Verificar que el slowFetcher fue ejecutado EXACTAMENTE UNA VEZ (cero thundering herd)
    if (backgroundRevalidations !== 1) {
      throw new Error(`Thundering herd detectado: fetcher invocado ${backgroundRevalidations} veces en vez de 1`);
    }

    // Verificar que la caché quedó actualizada con el dato fresco
    const updatedEntry = await kv.get<{ data: { value: string; counter: number } }>(testKey);
    if (updatedEntry.value?.data.value !== "fresh_new_data") {
      throw new Error(`La caché no se actualizó tras la revalidación: ${updatedEntry.value?.data.value}`);
    }

    // Verificar que el candado atómico fue liberado
    const lockKey = ["swr", "lock", ...testKey];
    const lockCheck = await kv.get(lockKey);
    if (lockCheck.value !== null) {
      throw new Error("El candado atómico de SWR no fue liberado al terminar la revalidación");
    }

    console.log("  ✓ 20 peticiones concurrentes atendidas con stale y exactamente 1 revalidación (0 Thundering Herd)");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Verificación Obligatoria para Streams Instantáneos [⚡ INSTANTÁNEO]
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("4. Verificación Obligatoria en Tiempo Real de Streams [⚡ INSTANTÁNEO]", async () => {
    const hashCached = "1111111111111111111111111111111111111111";
    const hashEvicted = "2222222222222222222222222222222222222222";

    const testStreams: StremioStreamItem[] = [
      {
        name: "[⚡ INSTANTÁNEO] [🌎 LATINO] [TB+] Torrentio\n1080p",
        title: "Pelicula.Activa.1080p.Dual.Latino\n👤 50 · 💾 4.2 GB",
        infoHash: hashCached,
        url: `https://torbox.app/stream/${hashCached}`,
      },
      {
        name: "[⚡ INSTANTÁNEO] [🎧 ORIGINAL] [TB+] Torrentio\n1080p",
        title: "Pelicula.Evicted.From.Torbox.1080p\n👤 20 · 💾 3.1 GB",
        infoHash: hashEvicted,
        url: `https://torbox.app/stream/${hashEvicted}`,
      },
      {
        name: "[⏳ REQUIERE BUFFER] [🌎 LATINO] Torrentio\n720p",
        title: "Pelicula.P2P.Normal.720p.Latino\n👤 10 · 💾 1.5 GB",
        infoHash: "3333333333333333333333333333333333333333",
      },
    ];

    // Simular checker de TorBox: solo hashCached está en la caché debrid de TorBox
    const mockTorboxChecker: TorboxCacheChecker = async (hashes) => {
      const active = new Set<string>();
      if (hashes.includes(hashCached)) active.add(hashCached);
      return active;
    };

    // Ejecutar verificación sobre la lista de streams
    const verified = await verifyTorboxInstantStreams(testStreams, mockTorboxChecker);

    // Stream 1 (hashCached): debe conservar [⚡ INSTANTÁNEO]
    const s1 = verified[0];
    if (!s1.name?.includes("[⚡ INSTANTÁNEO]") || !s1.name?.includes("[TB+]")) {
      throw new Error(`El stream verificado debió conservar [⚡ INSTANTÁNEO]. Actual: ${s1.name}`);
    }

    // Stream 2 (hashEvicted): debe haber sido degradado a [⏳ REQUIERE BUFFER] y [TB download]
    const s2 = verified[1];
    if (s2.name?.includes("[⚡ INSTANTÁNEO]") || s2.name?.includes("[TB+]")) {
      throw new Error(`🚨 FALSA DISPONIBILIDAD: Stream no cacheado en TorBox conservó [⚡ INSTANTÁNEO]. Actual: ${s2.name}`);
    }
    if (!s2.name?.includes("[⏳ REQUIERE BUFFER]") || !s2.name?.includes("[TB download]")) {
      throw new Error(`El stream purgado debió ser degradado a [⏳ REQUIERE BUFFER] [TB download]. Actual: ${s2.name}`);
    }

    // Stream 3 (P2P normal): inalterado
    const s3 = verified[2];
    if (!s3.name?.includes("[⏳ REQUIERE BUFFER]")) {
      throw new Error(`El stream P2P normal fue alterado incorrectamente: ${s3.name}`);
    }

    console.log("  ✓ Verificación en tiempo real ejecutada: Hash en TorBox conservado, hash eviccionado degradado a [⏳ REQUIERE BUFFER]");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Integración E2E de SWR con Streams Stale y TorBox Checker
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("5. Integración SWR con Streams Stale y Validación TorBox", async () => {
    const streamKey = ["test_stream_swr", Date.now()];
    const hashGood = "4444444444444444444444444444444444444444";
    const hashBad = "5555555555555555555555555555555555555555";

    const cachedStreams: StremioStreamItem[] = [
      {
        name: "[⚡ INSTANTÁNEO] [🌎 LATINO] [TB+] Torrentio",
        title: "Movie.Good.1080p",
        infoHash: hashGood,
      },
      {
        name: "[⚡ INSTANTÁNEO] [🌎 LATINO] [TB+] Torrentio",
        title: "Movie.Bad.1080p",
        infoHash: hashBad,
      },
    ];

    // Grabar entrada STALE en Deno KV
    await kv.set(streamKey, {
      data: cachedStreams,
      timestamp: Date.now() - 20000, // 20s de antigüedad (stale)
    }, { expireIn: 60000 });

    const mockChecker: TorboxCacheChecker = async (_hashes) => {
      // Simular que hashBad fue eliminado de TorBox
      return new Set([hashGood]);
    };

    const result = await getOrSetSwrCache<StremioStreamItem[]>(
      streamKey,
      async () => cachedStreams,
      {
        ttlMs: 5000,
        staleMs: 30000,
        type: "streams",
        isStreamsData: true,
        torboxChecker: mockChecker,
      }
    );

    if (result[0].name?.includes("[⚡ INSTANTÁNEO]") !== true) {
      throw new Error("Stream bueno debió conservar [⚡ INSTANTÁNEO]");
    }
    if (result[1].name?.includes("[⚡ INSTANTÁNEO]") === true) {
      throw new Error("Stream malo no debió conservar [⚡ INSTANTÁNEO]");
    }
    if (!result[1].name?.includes("[⏳ REQUIERE BUFFER]")) {
      throw new Error("Stream malo debió recibir [⏳ REQUIERE BUFFER]");
    }

    console.log("  ✓ getOrSetSwrCache protegió streams instantáneos en respuesta stale al 100%");
  });

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" ✨ TODOS LOS TESTS DE P5 SUPERADOS CON ÉXITO (100% PASS)");
  console.log("══════════════════════════════════════════════════════════════");
});
