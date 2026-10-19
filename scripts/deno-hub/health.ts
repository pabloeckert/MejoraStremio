/**
 * health.ts — Endpoint de diagnóstico, salud y telemetría del Hub (/health).
 * MejoraStremio v1.4.2 — Blindaje Zero-Secrets y Protección por Token/HMAC.
 */

import { cors } from "./utils/common.ts";
import { SUBDL_KEY } from "./subtitles/subdl.ts";
import { OPENSUBTITLES_API_KEY } from "./subtitles/opensubtitles.ts";
import { SUBSOURCE_API_KEY } from "./subtitles/subsource.ts";
import { GEMINI_API_KEY, OPENROUTER_API_KEY, runAiProbeTest } from "./translate/gemini.ts";
import { TMDB_KEY } from "./catalogs/tmdb.ts";
import { getMediaFlowConfig, globalMediaFlowCircuitBreaker } from "./streams/mediaflow.ts";
import {
  getScrapersTelemetry,
  getTorboxTelemetry,
  getSystemTelemetry,
  verifyTelemetryAuth,
} from "./telemetry.ts";

export async function handleHealth(reqUrl?: URL, req?: Request): Promise<Response> {
  const url = reqUrl || (req ? new URL(req.url) : new URL("http://localhost/health"));
  const headers = req?.headers;

  // 1. Verificación de Seguridad y Autenticación (HMAC / Token simple)
  const isAuthorized = await verifyTelemetryAuth(url, headers);
  if (!isAuthorized) {
    return new Response(
      JSON.stringify(
        {
          error: "Unauthorized",
          message: "Acceso denegado: token o firma HMAC de telemetría inválida o ausente.",
        },
        null,
        2
      ),
      {
        status: 401,
        headers: {
          ...cors,
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
          "Pragma": "no-cache",
        },
      }
    );
  }

  // 2. Obtención de Métricas y Estado del Circuit Breaker
  const cbStatus = globalMediaFlowCircuitBreaker.getStatus();
  const cb10s = await globalMediaFlowCircuitBreaker.getErrorRate10s();

  // 3. Telemetría de Latencias y Sistema
  const scrapers = getScrapersTelemetry();
  const torbox = getTorboxTelemetry();
  const system = getSystemTelemetry();

  const probeAi = url.searchParams.has("probe_ai");
  const aiProbe = probeAi ? await runAiProbeTest() : undefined;

  // 4. Payload Garantizado Libre de Secretos (Zero-Secrets Guarantee)
  // NUNCA expone tokens de TorBox, claves de API ni URLs internas del proxy.
  const payload = {
    hub: "mejorastremio-hub",
    version: system.version,
    uptimeSeconds: system.uptimeSeconds,
    timestamp: system.timestamp,
    circuitBreaker: {
      state: cbStatus.state,
      errorRate10s: cb10s.rate,
      totalRequests10s: cb10s.total,
      errors10s: cb10s.errors,
      consecutiveFailures: cbStatus.consecutiveFailures,
      consecutiveSuccesses: cbStatus.consecutiveSuccesses,
      cooldownRemainingMs: cbStatus.cooldownRemainingMs,
      halfOpenSuccessThreshold: cbStatus.halfOpenSuccessThreshold ?? 3,
      fallbackToDirectTorbox: cbStatus.fallbackToDirectTorbox,
    },
    latencies: {
      scrapers,
      torbox,
    },
    system: {
      catalog: system.catalog,
    },
    // Compatibilidad total hacia atrás y estructura jerárquica
    smartSync: { active: true, supportedFramerates: ["23.976", "24.0", "25.0", "29.97"] },
    subdl: { configured: !!SUBDL_KEY },
    opensubtitles: { configured: !!OPENSUBTITLES_API_KEY },
    opensubtitlesLatino: { configured: !!OPENSUBTITLES_API_KEY },
    subdivx: { configured: true, proxy: "configured" },
    subsource: { configured: !!SUBSOURCE_API_KEY },
    latino: { configured: true },
    synopsis: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      geminiConfigured: !!GEMINI_API_KEY,
      openrouterConfigured: !!OPENROUTER_API_KEY,
    },
    miniseries: { configured: !!TMDB_KEY },
    shortSeries: { configured: !!TMDB_KEY },
    discover: { configured: !!TMDB_KEY },
    ufc: { configured: true },
    livetv: { configured: true },
    iptv: { configured: true },
    mediathek: { configured: true },
    streams: { configured: true, upstream: "https://torrentio.strem.fun/" },
    mediaflow: {
      configured: !!getMediaFlowConfig(url).proxyUrl,
      proxyHost: getMediaFlowConfig(url).proxyUrl ? "configured (redacted)" : "none",
    },
    translate: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      baseSource: !!OPENSUBTITLES_API_KEY,
      engine: "gemini-flash",
    },
    services: {
      smartSync: { active: true, supportedFramerates: ["23.976", "24.0", "25.0", "29.97"] },
      subdl: { configured: !!SUBDL_KEY },
      opensubtitles: { configured: !!OPENSUBTITLES_API_KEY },
      opensubtitlesLatino: { configured: !!OPENSUBTITLES_API_KEY },
      subdivx: { configured: true, proxy: "configured" },
      subsource: { configured: !!SUBSOURCE_API_KEY },
      latino: { configured: true },
      synopsis: {
        configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
        geminiConfigured: !!GEMINI_API_KEY,
        openrouterConfigured: !!OPENROUTER_API_KEY,
      },
      miniseries: { configured: !!TMDB_KEY },
      shortSeries: { configured: !!TMDB_KEY },
      discover: { configured: !!TMDB_KEY },
      ufc: { configured: true },
      livetv: { configured: true },
      iptv: { configured: true },
      mediathek: { configured: true },
      streams: { configured: true, upstream: "https://torrentio.strem.fun/" },
      mediaflow: {
        configured: !!getMediaFlowConfig(url).proxyUrl,
        proxyHost: getMediaFlowConfig(url).proxyUrl ? "configured (redacted)" : "none",
      },
      translate: {
        configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
        baseSource: !!OPENSUBTITLES_API_KEY,
        engine: "gemini-flash",
      },
    },
    ...(aiProbe ? { aiProbe } : {}),
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}
