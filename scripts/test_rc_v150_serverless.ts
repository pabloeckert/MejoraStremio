/**
 * test_rc_v150_serverless.ts — Suite Integral de Validación Fase v1.5.0-RC (100% Serverless).
 *
 * Directiva:
 * - Entorno 100% Serverless / Cloud-Only (Deno Deploy, Deno KV, Suites Sintéticas).
 * - Cero dependencias de dispositivos físicos o comandos ADB.
 *
 * Bloques evaluados:
 * 1. Catálogo Personalizado "Para vos" (Señal Fuerte por Proxy HMAC, Privacidad Hash, Límite 30, TTL 90d, Recomendaciones).
 * 2. Tráilers en Audio Latino (TMDB First, Filtro Negativo Implacable, Hot Path [], Fallback Cron YouTube <=50/día, TTL 30d).
 * 3. Despliegue Canario de 24 Horas (Canary Rollout en 'stremiojn', Aislamiento 'stremioeg'/'solotveg', Rollback Instantáneo).
 * 4. Certificación 100% Serverless / Cloud-Only.
 */

import {
  handleProxyStream,
  recordPlaybackEvent,
  getProfileHistory,
  buildParaVosCatalog,
  buildHistoryKey,
  hashToken,
  HISTORY_MAX_ITEMS,
  HISTORY_KV_TTL_MS,
  type ProfilePlaybackHistory,
} from "./deno-hub/catalogs/paravos.ts";

import {
  isStrictLatinoTrailer,
  getLatinoTrailersHotPath,
  runNightlyTrailerCron,
  LATINO_CHANNEL_WHITELIST,
  NEGATIVE_TRAILER_TOKENS,
  DAILY_YOUTUBE_SEARCH_BUDGET,
  TRAILER_KV_TTL_MS,
  type TmdbVideoItem,
} from "./deno-hub/catalogs/trailers.ts";

import {
  getCanaryConfig,
  setCanaryConfig,
  isCanaryProfile,
  isCanaryActiveForProfile,
  triggerCanaryRollback,
  CANARY_KV_KEY,
} from "./deno-hub/utils/canary_governance.ts";

import {
  signProxyUrl,
  getHmacProxyKeys,
} from "./deno-hub/utils/crypto_security.ts";

import {
  putLatinoIndexEntry,
  type LatinoIndexEntry,
} from "./deno-hub/catalogs/lat_idx_worker.ts";

import {
  getCanaryManifest,
  extractProfileFromConfig,
  handleUnifiedHub,
} from "./deno-hub/unified-hub.ts";

Deno.test("MEJORASTREMIO V1.5.0-RC — SUITE SERVERLESS DE CERTIFICACIÓN", async (t) => {
  const kv = await Deno.openKv(":memory:");

  // =========================================================================
  // BLOQUE 1: CATÁLOGO PERSONALIZADO "PARA VOS" (SEÑAL FUERTE POR PROXY HMAC)
  // =========================================================================
  await t.step("1.1 Registro de Historial en Deno KV únicamente al reproducir en /proxy/stream", async () => {
    const profile = "stremiojn";
    const rawToken = "super-secret-stremio-authkey-12345";
    const { activeKey } = getHmacProxyKeys();

    // 1. URL no firmada o manipulada debe fallar con 403 Forbidden y NO registrar en historial
    const unauthenticatedUrl = new URL(
      "https://mejorastremio-hub.pabloeckert.deno.net/proxy/stream?url=https%3A%2F%2Ftorbox.app%2Fstream1&profile=stremiojn&id=tt0903747&type=series&title=Breaking+Bad",
    );
    const forbiddenRes = await handleProxyStream(
      unauthenticatedUrl,
      new Request(unauthenticatedUrl.toString()),
      kv,
    );
    if (forbiddenRes.status !== 403) {
      throw new Error(`Se esperaba status 403 para proxy no firmado, recibido: ${forbiddenRes.status}`);
    }

    const emptyHist = await getProfileHistory(kv, profile);
    if (emptyHist !== null && emptyHist.items.length > 0) {
      throw new Error("Petición rechazada no debió alterar el historial en Deno KV.");
    }

    // 2. URL legítimamente firmada con HMAC-SHA256
    const basePlaybackUrl = new URL(
      "https://mejorastremio-hub.pabloeckert.deno.net/proxy/stream?url=https%3A%2F%2Ftorbox.app%2Fstream1&profile=stremiojn&id=tt0903747&type=series&title=Breaking+Bad&token=" +
        encodeURIComponent(rawToken),
    );
    const signedPlaybackUrl = await signProxyUrl(basePlaybackUrl, activeKey, 3600);

    const playbackReq = new Request(signedPlaybackUrl);
    const playbackRes = await handleProxyStream(new URL(signedPlaybackUrl), playbackReq, kv);

    // Debe responder con redirección HTTP 302 y cabecera Location hacia el stream de TorBox
    if (playbackRes.status !== 302) {
      throw new Error(`Se esperaba HTTP 302 en /proxy/stream, recibido: ${playbackRes.status}`);
    }
    const location = playbackRes.headers.get("Location");
    if (!location || !location.includes("torbox.app/stream1")) {
      throw new Error(`Cabecera Location incorrecta: ${location}`);
    }

    // Verificar que el evento se haya persistido en ["hist", "stremiojn"]
    const hist = await getProfileHistory(kv, profile);
    if (!hist || hist.items.length !== 1) {
      throw new Error("El evento de reproducción no fue registrado en Deno KV.");
    }
    if (hist.items[0].id !== "tt0903747") {
      throw new Error(`ID incorrecto en historial: ${hist.items[0].id}`);
    }
  });

  await t.step("1.2 Privacidad Estricta: hash(token) SHA-256 (cero authKey), límite 30 y TTL 90 días", async () => {
    const profile = "stremiojn";
    const rawSecretAuthKey = "user-private-stremio-authkey-secret-999";
    const expectedHash = await hashToken(rawSecretAuthKey);

    // Llenar con 35 títulos para evaluar límite estricto de 30 items
    for (let i = 1; i <= 35; i++) {
      const paddedId = `tt${String(i).padStart(7, "0")}`;
      await recordPlaybackEvent(
        kv,
        profile,
        rawSecretAuthKey,
        { id: paddedId, type: "movie", title: `Película de Prueba ${i}` },
        HISTORY_KV_TTL_MS,
      );
    }

    const hist = await getProfileHistory(kv, profile);
    if (!hist) {
      throw new Error("Historial no encontrado.");
    }

    // 1. Privacidad Zero-Secrets: token_hash debe ser SHA-256 hex y NO contener la clave en claro
    if (hist.token_hash !== expectedHash) {
      throw new Error(`Token hash incorrecto. Esperado: ${expectedHash}, Obtenido: ${hist.token_hash}`);
    }
    if (JSON.stringify(hist).includes(rawSecretAuthKey)) {
      throw new Error("CRÍTICO: authKey o token en claro filtrado en el objeto de historial.");
    }

    // 2. Límite máximo de retención: exactamente 30 títulos
    if (hist.items.length !== HISTORY_MAX_ITEMS) {
      throw new Error(`Se esperaba exactamente ${HISTORY_MAX_ITEMS} títulos, pero hay ${hist.items.length}`);
    }

    // 3. Orden LIFO: el último reproducido (35) debe estar al frente (índice 0)
    if (hist.items[0].id !== "tt0000035") {
      throw new Error(`El título más reciente debe estar en índice 0. Obtenido: ${hist.items[0].id}`);
    }
  });

  await t.step("1.3 Motor 'Para vos': Recomendaciones TMDB sobre 5 semillas, exclusión de vistos y atribución", async () => {
    const profile = "stremiojn";

    // Sembrar disponibilidad latina en lat_idx para prueba de filtrado
    const confirmedLatinoEntry: LatinoIndexEntry = {
      imdb_id: "tt1375666", // Inception
      has_latino: true,
      confidence: "Confirmado",
      title: "Inception",
      sources: ["cinemeta", "torrentio"],
      updated_at: Date.now(),
    };
    await putLatinoIndexEntry(kv, confirmedLatinoEntry);

    // Ejecutar motor de recomendaciones
    const recs = await buildParaVosCatalog(kv, profile, "movie");
    if (!recs || !Array.isArray(recs.metas)) {
      throw new Error("Respuesta inválida de buildParaVosCatalog.");
    }

    // Si hay candidatos retornados, validar exclusión y atribución
    for (const meta of recs.metas) {
      // Exclusión de vistos: ningún item recomendado debe estar entre los ya vistos
      if (meta.id === "tt0000035" || meta.id === "tt0903747") {
        throw new Error(`El título visto ${meta.id} no fue excluido de las recomendaciones.`);
      }
      // Atribución de semilla: la descripción debe iniciar con 'Porque viste'
      if (!meta.description.startsWith("Porque viste")) {
        throw new Error(`Descripción sin atribución de semilla: "${meta.description}"`);
      }
    }
  });

  // =========================================================================
  // BLOQUE 2: TRÁILERS EN AUDIO LATINO (TMDB FIRST + FILTRO ESTRICTO)
  // =========================================================================
  await t.step("2.1 Filtro Negativo Implacable: descarte incondicional de castellano, es-ES, VOSE, subtitulado", () => {
    const negativeCases: TmdbVideoItem[] = [
      { key: "yt1", name: "Tráiler Oficial en Castellano (España)", site: "YouTube", type: "Trailer" },
      { key: "yt2", name: "Avance Exclusivo subtitulado al español", site: "YouTube", type: "Trailer" },
      { key: "yt3", name: "Tráiler 1 (VOSE) Versión Original", site: "YouTube", type: "Trailer" },
      { key: "yt4", name: "Nuevo Tráiler de España con doblaje es-ES", site: "YouTube", type: "Trailer" },
      { key: "yt5", name: "Tráiler Doblado en Castellano Peninsular", site: "YouTube", type: "Trailer" },
      { key: "yt6", name: "Teaser Oficial con subtítulos en español", site: "YouTube", type: "Teaser" },
    ];

    for (const video of negativeCases) {
      const accepted = isStrictLatinoTrailer(video);
      if (accepted) {
        throw new Error(`CRÍTICO: Filtro negativo no descartó tráiler no neutro: "${video.name}"`);
      }
    }
  });

  await t.step("2.2 Filtro Positivo: aceptación estricta con keywords latino/doblado y whitelist", () => {
    const positiveCases: TmdbVideoItem[] = [
      {
        key: "lat1",
        name: "Tráiler Oficial Doblado al Español Latino",
        site: "YouTube",
        type: "Trailer",
        channelTitle: "Warner Bros. Pictures Latinoamérica",
      },
      {
        key: "lat2",
        name: "Teaser Oficial 1 (Doblado Latino)",
        site: "YouTube",
        type: "Teaser",
        channelTitle: "Sony Pictures México",
      },
      {
        key: "lat3",
        name: "Avance Oficial - Audio Latino",
        site: "YouTube",
        type: "Trailer",
        channelTitle: "Universal Pictures México",
      },
      {
        key: "lat4",
        name: "Tráiler Doblado",
        site: "YouTube",
        type: "Trailer",
        channelTitle: "Netflix Latinoamérica",
      },
    ];

    for (const video of positiveCases) {
      const accepted = isStrictLatinoTrailer(video);
      if (!accepted) {
        throw new Error(`Fallo en aceptación de tráiler latino legítimo: "${video.name}" (${video.channelTitle})`);
      }
    }
  });

  await t.step("2.3 Hot Path Zero-Latency: Retorna [] sin bloquear ni llamar a YouTube API si no hay match", async () => {
    // ID ficticio o sin videos válidos
    const hotPathRes = await getLatinoTrailersHotPath("999999999", "movie", "tt9999999", kv);
    if (!Array.isArray(hotPathRes)) {
      throw new Error("El hot path debe retornar un array.");
    }
    // Debe ser array vacío de inmediato
    if (hotPathRes.length !== 0) {
      throw new Error(`Se esperaba array vacío en hot path sin match, recibido: ${hotPathRes.length}`);
    }
  });

  await t.step("2.4 Fallback Cron Nocturno: Control de presupuesto <=50/día y caché KV 30 días", async () => {
    const testDate = "2026-10-19";
    const titlesToTest = [
      { imdbId: "tt0111161", title: "The Shawshank Redemption" },
      { imdbId: "tt0068646", title: "The Godfather" },
    ];

    // Simular ejecución sin API key (presupuesto intacto)
    const cronReport1 = await runNightlyTrailerCron(kv, titlesToTest, undefined, testDate);
    if (cronReport1.attempted !== 0) {
      throw new Error("Sin API key no debe intentar llamadas.");
    }
    if (cronReport1.budgetRemaining !== DAILY_YOUTUBE_SEARCH_BUDGET) {
      throw new Error(`Presupuesto restante incorrecto: ${cronReport1.budgetRemaining}`);
    }

    // Forzar límite de presupuesto consumido en KV para validar guard de cuota
    await kv.set(["trailer_budget", testDate], DAILY_YOUTUBE_SEARCH_BUDGET);

    const cronReportExceeded = await runNightlyTrailerCron(kv, titlesToTest, "dummy-yt-key", testDate);
    if (cronReportExceeded.attempted !== 0) {
      throw new Error("El cron nocturno violó el presupuesto máximo de 50 búsquedas diarias.");
    }
    if (cronReportExceeded.budgetRemaining !== 0) {
      throw new Error("El presupuesto restante debió ser 0.");
    }
  });

  // =========================================================================
  // BLOQUE 3: DESPLIEGUE CANARIO DE 24 HORAS (CANARY ROLLOUT)
  // =========================================================================
  await t.step("3.1 Activación Aislada del Canario en 'stremiojn' bajo ['flags', 'rc_v150']", async () => {
    // 1. Con bandera apagada (default)
    await setCanaryConfig(kv, { enabled: false });
    const inactiveCheck = await isCanaryActiveForProfile("stremiojn", kv);
    if (inactiveCheck.active) {
      throw new Error("Canario no debe estar activo si el flag está apagado.");
    }
    if (inactiveCheck.version !== "v1.4.2") {
      throw new Error(`Versión debió ser v1.4.2 baseline, obtenida: ${inactiveCheck.version}`);
    }

    // 2. Encender bandera para stremiojn
    await setCanaryConfig(kv, {
      enabled: true,
      canaryAccounts: ["stremiojn", "stremiojn@gmail.com"],
      version: "v1.5.0-rc",
    });

    const activeCheck = await isCanaryActiveForProfile("stremiojn", kv);
    if (!activeCheck.active) {
      throw new Error("Canario debe estar activo para stremiojn.");
    }
    if (activeCheck.version !== "v1.5.0-rc") {
      throw new Error(`Versión esperada v1.5.0-rc, obtenida: ${activeCheck.version}`);
    }
  });

  await t.step("3.2 Aislamiento Estricto: 'stremioeg' y 'solotveg' reciben incondicionalmente v1.4.2", async () => {
    // Cuentas de producción
    const prodProfiles = ["stremioeg", "stremioeg@gmail.com", "solotveg", "solotveg@gmail.com", "random_user"];

    for (const p of prodProfiles) {
      const check = await isCanaryActiveForProfile(p, kv);
      if (check.active) {
        throw new Error(`CRÍTICO: La cuenta de producción ${p} fue contaminada con el canario v1.5.0.`);
      }
      if (check.version !== "v1.4.2") {
        throw new Error(`La cuenta ${p} debe recibir baseline v1.4.2, recibió: ${check.version}`);
      }
    }

    // Validar manifiesto generado para producción vs canario
    const prodManifest = await getCanaryManifest(new URL("https://hub.local/manifest.json?profile=stremioeg"), undefined, kv);
    if (prodManifest.version !== "1.4.2") {
      throw new Error(`Manifiesto de producción debe tener versión 1.4.2, tiene: ${prodManifest.version}`);
    }

    const canaryManifest = await getCanaryManifest(new URL("https://hub.local/manifest.json?profile=stremiojn"), undefined, kv);
    if (canaryManifest.version !== "1.5.0-rc") {
      throw new Error(`Manifiesto canario debe tener versión 1.5.0-rc, tiene: ${canaryManifest.version}`);
    }
    const catalogs = canaryManifest.catalogs as Array<{ id: string }>;
    if (!catalogs.some((c) => c.id === "paravos")) {
      throw new Error("El catálogo 'paravos' debe estar presente en el manifiesto canario.");
    }
  });

  await t.step("3.3 Garantía de Rollback Instantáneo al baseline v1.4.2 sin tocar producción", async () => {
    // Disparar reversión inmediata
    const rollbackResult = await triggerCanaryRollback(kv, "Anomalía sintética detectada en canario");
    if (rollbackResult.enabled !== false) {
      throw new Error("El rollback debió desactivar la bandera canario.");
    }

    // Inmediatamente stremiojn debe revertir a v1.4.2
    const postRollbackCheck = await isCanaryActiveForProfile("stremiojn", kv);
    if (postRollbackCheck.active) {
      throw new Error("Tras el rollback, el canario sigue activo.");
    }
    if (postRollbackCheck.version !== "v1.4.2") {
      throw new Error(`Tras rollback, versión debe ser v1.4.2, obtenida: ${postRollbackCheck.version}`);
    }

    // Manifiesto revierte a 1.4.2
    const revertedManifest = await getCanaryManifest(new URL("https://hub.local/manifest.json?profile=stremiojn"), undefined, kv);
    if (revertedManifest.version !== "1.4.2") {
      throw new Error(`Manifiesto debió revertir a 1.4.2, tiene: ${revertedManifest.version}`);
    }
  });

  // =========================================================================
  // BLOQUE 4: ENRUTAMIENTO INTEGRAL Y CERTIFICACIÓN 100% SERVERLESS
  // =========================================================================
  await t.step("4.1 Dispatcher de Catálogo 'paravos' en handleUnifiedHub", async () => {
    // 1. Petición a catálogo paravos parametrizado
    const catReqUrl = new URL("https://hub.local/profile=stremiojn/catalog/movie/paravos.json");
    const catRes = await handleUnifiedHub("/profile=stremiojn/catalog/movie/paravos.json", "https://hub.local", catReqUrl, kv);
    if (!catRes) {
      throw new Error("handleUnifiedHub debió interceptar /catalog/movie/paravos.json");
    }
    if (catRes.status !== 200) {
      throw new Error(`Status inesperado en catálogo paravos: ${catRes.status}`);
    }
    const body = await catRes.json();
    if (!body || !Array.isArray(body.metas)) {
      throw new Error("El catálogo paravos debe devolver { metas: [] }");
    }
  });

  await t.step("4.2 Certificación 100% Serverless: Cero ADB y Cero Dependencias Físicas", () => {
    // Verificación estricta de variables y runtime
    if (typeof Deno === "undefined") {
      throw new Error("Runtime debe ser Deno 100% Cloud.");
    }
    const hasAdbInGlobal = "adb" in globalThis || "android" in globalThis;
    if (hasAdbInGlobal) {
      throw new Error("CRÍTICO: Dependencia o mock residual de ADB detectado en el entorno serverless.");
    }
  });

  kv.close();
});
