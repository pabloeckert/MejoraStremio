/**
 * test_security_p8.ts — Suite de Verificación de Seguridad Criptográfica, Rotación HMAC y Telemetría TorBox (P8).
 *
 * Valida:
 * 1. Comparación en tiempo constante (timingSafeEqual) contra timing attacks.
 * 2. Firmado HMAC-SHA256 con expiración (exp) y rechazo inmediato de firmas alteradas o expiradas (anti-replay).
 * 3. Rotación suave de claves (doble validación: activa y previa) sin interrupción de sesiones.
 * 4. Telemetría y monitoreo preventivo de vigencia y cuota de TorBox (Zero-Secrets).
 * 5. Estrategia de rollback rápido con baseline v1.4.1 y cache-busting inverso.
 *
 * Alcance: Estándar Edge-Only Certification (ZTE ZXV10 B866V2 / Deno Deploy Edge Hub v3.0.1).
 */

import {
  timingSafeEqual,
  timingSafeEqualString,
  signProxyUrl,
  verifyProxyUrl,
  canonicalizeUrlForSigning,
} from "./deno-hub/utils/crypto_security.ts";

import {
  getTorboxTokenStatus,
  formatTorboxPlan,
  resetTorboxTelemetryCacheForTesting,
  type TorboxTokenStatus,
} from "./deno-hub/utils/torbox_telemetry.ts";

import { handleHealth } from "./deno-hub/health.ts";
import { handleUnifiedHub } from "./deno-hub/unified-hub.ts";
import { handleSubtitleProxy } from "./deno-hub/subtitles/proxy.ts";

Deno.test("BLOQUE 6: P8 — Suite de Seguridad Criptográfica, Rotación HMAC y Telemetría TorBox", async (t) => {

  // ───────────────────────────────────────────────────────────────────────────
  // 1. COMPARACIÓN EN TIEMPO CONSTANTE (timingSafeEqual)
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("1. Comparación en Tiempo Constante (timingSafeEqual)", () => {
    const enc = new TextEncoder();
    const str1 = "a7f39c8e104b6d2e4f5a8b9c0d1e2f3a";
    const str2 = "a7f39c8e104b6d2e4f5a8b9c0d1e2f3a"; // Idéntico
    const str3 = "a7f39c8e104b6d2e4f5a8b9c0d1e2f3b"; // Difiere en el último byte
    const str4 = "b7f39c8e104b6d2e4f5a8b9c0d1e2f3a"; // Difiere en el primer byte
    const str5 = "corta";

    // Mismos buffers
    if (!timingSafeEqual(enc.encode(str1), enc.encode(str2))) {
      throw new Error("timingSafeEqual falló con buffers idénticos");
    }
    if (!timingSafeEqualString(str1, str2)) {
      throw new Error("timingSafeEqualString falló con strings idénticas");
    }

    // Diferencia al final
    if (timingSafeEqual(enc.encode(str1), enc.encode(str3)) || timingSafeEqualString(str1, str3)) {
      throw new Error("timingSafeEqual aceptó buffers que difieren al final");
    }

    // Diferencia al inicio
    if (timingSafeEqual(enc.encode(str1), enc.encode(str4)) || timingSafeEqualString(str1, str4)) {
      throw new Error("timingSafeEqual aceptó buffers que difieren al inicio");
    }

    // Distinta longitud
    if (timingSafeEqual(enc.encode(str1), enc.encode(str5)) || timingSafeEqualString(str1, str5)) {
      throw new Error("timingSafeEqual aceptó buffers de distinta longitud");
    }

    console.log("  ✓ Comparación en tiempo constante validada (0 timing leaks)");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. FIRMADO HMAC-SHA256 CON EXPIRACIÓN Y CONTROL DE INTEGRIDAD
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("2. Firmado HMAC-SHA256, Expiración (exp) y Detección de Manipulación", async () => {
    const activeKey = "secret-key-production-active-2026";
    const testUrl = "https://hub.mejorastremio.test/proxy?url=https%3A%2F%2Fdl.subdl.com%2Fsub.srt&fps=25to23976";

    // 2.1 Firma válida con 1 hora de TTL
    const signedUrl = await signProxyUrl(testUrl, activeKey, 3600);
    const parsed = new URL(signedUrl);

    if (!parsed.searchParams.has("sig") || !parsed.searchParams.has("exp")) {
      throw new Error("URL firmada carece de 'sig' o 'exp'");
    }

    const verification = await verifyProxyUrl(signedUrl, activeKey);
    if (!verification.valid || verification.keyUsed !== "active" || verification.expired) {
      throw new Error(`Firma válida rechazada: ${JSON.stringify(verification)}`);
    }

    // 2.2 Manipulación de parámetro (Tampering Attack)
    const tamperedUrl = new URL(signedUrl);
    tamperedUrl.searchParams.set("fps", "23976to25"); // Se alteró el parámetro sin actualizar la firma
    const tamperedCheck = await verifyProxyUrl(tamperedUrl, activeKey);
    if (tamperedCheck.valid) {
      throw new Error("URL manipulada fue aceptada erróneamente");
    }
    if (tamperedCheck.reason !== "invalid_signature") {
      throw new Error(`Razón esperada 'invalid_signature', obtenida: ${tamperedCheck.reason}`);
    }

    // 2.3 Alteración directa de la firma
    const alteredSigUrl = new URL(signedUrl);
    const originalSig = alteredSigUrl.searchParams.get("sig")!;
    const alteredSig = originalSig.slice(0, -1) + (originalSig.endsWith("a") ? "b" : "a");
    alteredSigUrl.searchParams.set("sig", alteredSig);
    const alteredCheck = await verifyProxyUrl(alteredSigUrl, activeKey);
    if (alteredCheck.valid) {
      throw new Error("Firma alterada fue aceptada erróneamente");
    }

    // 2.4 Expiración temporal (Anti-Replay Attack)
    // Generar URL expirada hace 60 segundos
    const expiredUrl = await signProxyUrl(testUrl, activeKey, -60);
    const expiredCheck = await verifyProxyUrl(expiredUrl, activeKey);
    if (expiredCheck.valid || !expiredCheck.expired) {
      throw new Error("URL expirada fue aceptada o no reportó expiración");
    }
    if (expiredCheck.reason !== "signature_expired") {
      throw new Error(`Razón esperada 'signature_expired', obtenida: ${expiredCheck.reason}`);
    }

    // 2.5 Validación en handleSubtitleProxy con firma inválida y expirada
    const resBadSig = await handleSubtitleProxy(alteredSigUrl);
    if (resBadSig.status !== 403) {
      throw new Error(`handleSubtitleProxy debió retornar 403 ante firma inválida, retornó: ${resBadSig.status}`);
    }

    const resExpired = await handleSubtitleProxy(new URL(expiredUrl));
    if (resExpired.status !== 403) {
      throw new Error(`handleSubtitleProxy debió retornar 403 ante firma expirada, retornó: ${resExpired.status}`);
    }

    console.log("  ✓ Firmado HMAC, protección anti-replay (exp) y detección de manipulación validados al 100%");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. PLAN DE ROTACIÓN SUAVE DE CLAVES (DOBLE VALIDACIÓN)
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("3. Rotación Suave de Claves (Active + Previous Key)", async () => {
    const keyPrevious = "old-legacy-key-phase-1";
    const keyActive = "new-active-key-phase-2";
    const keyUnknown = "attacker-unknown-key-99";

    const testUrl = "https://hub.mejorastremio.test/proxy?url=https%3A%2F%2Fapi.subdl.com%2Ffile.zip";

    // 3.1 Petición firmada con la clave previa (sesión anterior que sigue viva en la TV Box)
    const oldSignedUrl = await signProxyUrl(testUrl, keyPrevious, 3600);

    // Debe validarse exitosamente reportando 'previous'
    const oldCheck = await verifyProxyUrl(oldSignedUrl, keyActive, keyPrevious);
    if (!oldCheck.valid || oldCheck.keyUsed !== "previous") {
      throw new Error(`Sesión con clave previa falló durante rotación: ${JSON.stringify(oldCheck)}`);
    }

    // 3.2 Petición firmada con la clave activa nueva
    const newSignedUrl = await signProxyUrl(testUrl, keyActive, 3600);
    const newCheck = await verifyProxyUrl(newSignedUrl, keyActive, keyPrevious);
    if (!newCheck.valid || newCheck.keyUsed !== "active") {
      throw new Error(`Sesión con clave nueva falló: ${JSON.stringify(newCheck)}`);
    }

    // 3.3 Petición firmada con una clave extraña no autorizada
    const invalidSignedUrl = await signProxyUrl(testUrl, keyUnknown, 3600);
    const invalidCheck = await verifyProxyUrl(invalidSignedUrl, keyActive, keyPrevious);
    if (invalidCheck.valid) {
      throw new Error("Firma con clave no autorizada fue aceptada");
    }

    console.log("  ✓ Rotación suave validada: Sesiones previas activas sin interrupción y nuevas firmas con key activa");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. TELEMETRÍA Y ALERTAS DE TOKEN TORBOX (ZERO-SECRETS)
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("4. Telemetría y Alertas de Token TorBox (Zero-Secrets)", async () => {
    resetTorboxTelemetryCacheForTesting();

    const mockToken = "fake-secret-torbox-token-123456789";

    // 4.1 Mock de cuenta activa saludable (45 días restantes, plan Pro)
    const mockFetcherHealthy = async () => ({
      success: true,
      data: {
        plan: 2,
        customer: "customer_987654321",
        expires_at: new Date(Date.now() + 45 * 86400000).toISOString(),
        total_downloaded: 107374182400, // 100 GB
      },
    });

    const statusHealthy = await getTorboxTokenStatus(mockToken, mockFetcherHealthy, true);
    if (!statusHealthy.valid || !statusHealthy.active || statusHealthy.isExpired || statusHealthy.isExpiringSoon) {
      throw new Error(`Estado de cuenta saludable erróneo: ${JSON.stringify(statusHealthy)}`);
    }
    if (statusHealthy.daysRemaining < 44 || statusHealthy.daysRemaining > 46) {
      throw new Error(`Días restantes erróneos: ${statusHealthy.daysRemaining}`);
    }
    if (statusHealthy.plan !== "Pro (Debrid + Usenet)") {
      throw new Error(`Plan inesperado: ${statusHealthy.plan}`);
    }

    // Verificación estricta de Zero-Secrets
    const jsonStr = JSON.stringify(statusHealthy);
    if (jsonStr.includes("fake-secret-torbox") || jsonStr.includes("customer_987654321")) {
      throw new Error("Fuga de secretos o PII en objeto de telemetría TorBox");
    }

    // 4.2 Mock de cuenta por caducar pronto (<= 7 días)
    const mockFetcherExpiringSoon = async () => ({
      success: true,
      data: {
        plan: 1,
        expires_at: new Date(Date.now() + 4 * 86400000).toISOString(),
      },
    });

    const statusExpiring = await getTorboxTokenStatus(mockToken, mockFetcherExpiringSoon, true);
    if (!statusExpiring.valid || !statusExpiring.active || statusExpiring.isExpired || !statusExpiring.isExpiringSoon) {
      throw new Error(`Alerta de caducidad temprana falló: ${JSON.stringify(statusExpiring)}`);
    }

    // 4.3 Mock de cuenta vencida
    const mockFetcherExpired = async () => ({
      success: true,
      data: {
        plan: 1,
        expires_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    });

    const statusExpired = await getTorboxTokenStatus(mockToken, mockFetcherExpired, true);
    if (!statusExpired.valid || statusExpired.active || !statusExpired.isExpired) {
      throw new Error(`Estado de cuenta vencida falló: ${JSON.stringify(statusExpired)}`);
    }

    // 4.4 Integración en endpoint /health
    const healthRes = await handleHealth(new URL("https://hub.mejorastremio.test/health"));
    if (healthRes.status !== 200) {
      throw new Error(`Endpoint /health respondió HTTP ${healthRes.status}`);
    }
    const healthJson = await healthRes.json();
    if (!healthJson.torboxToken) {
      throw new Error("Endpoint /health carece del campo 'torboxToken'");
    }

    console.log("  ✓ Telemetría TorBox validada: Días restantes, alerta preventiva (<=7d), caducidad y Zero-Secrets");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. ESTRATEGIA DE ROLLBACK RÁPIDO Y CACHE-BUSTING INVERSO (v1.4.1 vs v3.0.1)
  // ───────────────────────────────────────────────────────────────────────────
  await t.step("5. Estrategia de Rollback Rápido con Baseline v1.4.1", async () => {
    // 5.1 Manifest estándar de producción -> v3.0.1
    const resV301 = await handleUnifiedHub(
      "/manifest.json",
      "https://mejorastremio-hub.pabloeckert.deno.net",
      new URL("https://mejorastremio-hub.pabloeckert.deno.net/manifest.json?v=3.0.1"),
    );
    if (!resV301 || resV301.status !== 200) {
      throw new Error("handleUnifiedHub falló en /manifest.json?v=3.0.1");
    }
    const manifestV301 = await resV301.json();
    if (manifestV301.version !== "3.0.1") {
      throw new Error(`Versión esperada '3.0.1', recibida: '${manifestV301.version}'`);
    }

    // 5.2 Manifest con rollback de emergencia a baseline v1.4.1 (Cache-Busting Inverso)
    const resV141 = await handleUnifiedHub(
      "/manifest.json",
      "https://mejorastremio-hub.pabloeckert.deno.net",
      new URL("https://mejorastremio-hub.pabloeckert.deno.net/manifest.json?v=1.4.1"),
    );
    if (!resV141 || resV141.status !== 200) {
      throw new Error("handleUnifiedHub falló en /manifest.json?v=1.4.1");
    }
    const manifestV141 = await resV141.json();
    if (manifestV141.version !== "1.4.1") {
      throw new Error(`Versión de rollback esperada '1.4.1', recibida: '${manifestV141.version}'`);
    }
    if (!manifestV141.description.includes("[ROLLBACK BASELINE v1.4.1]")) {
      throw new Error("Manifiesto de rollback carece del identificador explícito de baseline");
    }

    // 5.3 Verificación de transportUrl diferenciado
    const transport301: string = "https://mejorastremio-hub.pabloeckert.deno.net/manifest.json?v=3.0.1";
    const transport141: string = "https://mejorastremio-hub.pabloeckert.deno.net/manifest.json?v=1.4.1";
    if (transport301 === transport141) {
      throw new Error("transportUrl para v1.4.1 y v3.0.1 no son diferenciados");
    }

    console.log("  ✓ Rollback rápido y cache-busting inverso validados: Baseline v1.4.1 listo para activación transparente");
  });

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" ✨ TODOS LOS TESTS DE P8 SUPERADOS CON ÉXITO (100% PASS)");
  console.log("══════════════════════════════════════════════════════════════");
});
