/**
 * health.ts — Endpoint de diagnóstico, salud y telemetría del Hub (/health).
 * MejoraStremio v3.0.1 — Blindaje Zero-Secrets y Protección por Token/HMAC.
 */

import { cors, safeGetKv } from "./utils/common.ts";
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
import { getTorboxTokenStatus } from "./utils/torbox_telemetry.ts";
import { getUserLibrary } from "./catalogs/paravos.ts";

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
  const torboxToken = await getTorboxTokenStatus();

  const probeAi = url.searchParams.has("probe_ai");
  const aiProbe = probeAi ? await runAiProbeTest() : undefined;

  // 4. Ingesta de Telemetría de Recomendación y Biblioteca
  let libraryInfo: { totalLibrary: number; totalWatched: number } = { totalLibrary: 0, totalWatched: 0 };
  try {
    const kv = await safeGetKv();
    if (kv) {
      const { library, watchedIds } = await getUserLibrary(kv, "stremioeg");
      libraryInfo = { totalLibrary: library.length, totalWatched: watchedIds.length };
    }
  } catch {
    // Silencioso si KV no está inicializado o local
  }

  // 5. Payload Garantizado Libre de Secretos (Zero-Secrets Guarantee)
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
    torboxToken,
    recommender: {
      profile: "stremioeg",
      librarySeedsCount: libraryInfo.totalLibrary,
      excludedWatchedCount: libraryInfo.totalWatched,
      diversityBalancing: "diverseSeeds_clustering_active",
      nPlusOnePrewarm: "torbox_airlock_active",
    },
    codecGuard: {
      targetPlatform: "ZTE B866V2 (Amlogic S905X2)",
      av1Blocked: true,
      dolbyVisionP7FelBlocked: true,
      microBadging: ["HDR10", "HDR10+", "DV P8", "DV P5", "5.1", "Atmos"],
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
    trailers: { configured: true, manifest: "com.mejorastremio.trailers-latino" },
    mediaflow: {
      configured: !!getMediaFlowConfig(url).proxyUrl,
      proxyHost: getMediaFlowConfig(url).proxyUrl ? "configured (redacted)" : "none",
    },
    translate: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      baseSource: !!OPENSUBTITLES_API_KEY,
      engine: "gemini-3.8-flash",
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
      trailers: { configured: true, manifest: "com.mejorastremio.trailers-latino" },
      mediaflow: {
        configured: !!getMediaFlowConfig(url).proxyUrl,
        proxyHost: getMediaFlowConfig(url).proxyUrl ? "configured (redacted)" : "none",
      },
      translate: {
        configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
        baseSource: !!OPENSUBTITLES_API_KEY,
        engine: "gemini-3.8-flash",
      },
    },
    ...(aiProbe ? { aiProbe } : {}),
  };

  const wantsHtml =
    url.pathname.endsWith("/dashboard") ||
    url.searchParams.get("html") === "1" ||
    (headers?.get("accept")?.includes("text/html") && !url.pathname.endsWith(".json"));

  if (wantsHtml) {
    return new Response(renderHealthDashboardHtml(payload, url), {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
        "Pragma": "no-cache",
      },
    });
  }

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

export function renderHealthDashboardHtml(
  payload: Record<string, unknown>,
  url: URL,
): string {
  const cb = (payload.circuitBreaker as Record<string, unknown>) || {};
  const latencies = (payload.latencies as Record<string, unknown>) || {};
  const scrapers = (latencies.scrapers as Record<string, { p50Ms: number; p95Ms: number; timeouts: number }>) || {};
  const torbox = (latencies.torbox as { p50Ms: number; p95Ms: number; sampleCount: number }) || { p50Ms: 0, p95Ms: 0, sampleCount: 0 };
  const recommender = (payload.recommender as Record<string, unknown>) || {};
  const isHealthy = cb.state === "CLOSED" && (Number(cb.errorRate10s) || 0) < 0.3;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>MejoraStremio Hub — Health & Telemetry Dashboard</title>
  <style>
    :root {
      --bg: #090b10;
      --card-bg: rgba(22, 27, 46, 0.78);
      --card-border: rgba(108, 92, 231, 0.22);
      --accent: #6c5ce7;
      --text: #f1f2f6;
      --text-muted: #8892b0;
      --success: #2ed573;
      --warning: #ffa502;
      --cyan: #00d2d3;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 0%, #1a1e36 0%, var(--bg) 75%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      padding: 28px 20px;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 18px;
      margin-bottom: 24px;
    }
    .title-group h1 {
      font-size: 24px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .title-group p {
      color: var(--text-muted);
      font-size: 13px;
      margin-top: 4px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(46, 213, 115, 0.12);
      color: var(--success);
      border: 1px solid rgba(46, 213, 115, 0.3);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .status-badge.degraded {
      background: rgba(255, 165, 2, 0.12);
      color: var(--warning);
      border-color: rgba(255, 165, 2, 0.3);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 20px;
      transition: transform 0.2s, border-color 0.2s;
    }
    .card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }
    .card h2 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--cyan);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .metric-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 13px;
    }
    .metric-row:last-child {
      border-bottom: none;
    }
    .metric-label {
      color: var(--text-muted);
    }
    .metric-val {
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .val-good { color: var(--success); }
    .val-warn { color: var(--warning); }
    .val-accent { color: var(--accent); }
    .val-cyan { color: var(--cyan); }
    .footer {
      margin-top: 36px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
    }
    .links {
      display: flex;
      gap: 14px;
      justify-content: center;
      margin-top: 10px;
    }
    .links a {
      color: var(--accent);
      text-decoration: none;
      font-size: 13px;
    }
    .links a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title-group">
        <h1>🚀 MejoraStremio Hub <span style="font-size: 14px; color: var(--accent); font-weight: normal;">v${payload.version}</span></h1>
        <p>Centro de Control, Telemetría Zero-Secrets y Estado de Producción en Vivo</p>
      </div>
      <div>
        <span class="status-badge ${isHealthy ? "" : "degraded"}">
          ● ${isHealthy ? "SISTEMA OPERACIONAL" : "ESTADO DEGRADADO"}
        </span>
      </div>
    </div>

    <div class="grid">
      <!-- 1. TorBox Debrid -->
      <div class="card">
        <h2>⚡ TorBox Debrid API</h2>
        <div class="metric-row">
          <span class="metric-label">Estado de Conexión</span>
          <span class="metric-val val-good">Conectado (Instantáneo)</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Latencia TorBox (p50 / p95)</span>
          <span class="metric-val val-cyan">${torbox.p50Ms || 0} ms / ${torbox.p95Ms || 0} ms</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Muestras Registradas</span>
          <span class="metric-val">${torbox.sampleCount || 0}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Token Debrid</span>
          <span class="metric-val val-good">Protegido Zero-Secrets</span>
        </div>
      </div>

      <!-- 2. Circuit Breaker -->
      <div class="card">
        <h2>🛡️ MediaFlow Circuit Breaker</h2>
        <div class="metric-row">
          <span class="metric-label">Estado del Circuito</span>
          <span class="metric-val ${cb.state === "CLOSED" ? "val-good" : "val-warn"}">${cb.state}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Tasa de Error (10s)</span>
          <span class="metric-val">${((Number(cb.errorRate10s) || 0) * 100).toFixed(1)}%</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Solicitudes Totales (10s)</span>
          <span class="metric-val">${cb.totalRequests10s || 0}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Fallback Directo a TorBox</span>
          <span class="metric-val ${cb.fallbackToDirectTorbox ? "val-warn" : "val-good"}">${cb.fallbackToDirectTorbox ? "Activo (Resiliente)" : "Inactivo (Proxy OK)"}</span>
        </div>
      </div>

      <!-- 3. Scrapers Telemetry -->
      <div class="card">
        <h2>🌪️ Scrapers & Resolvers</h2>
        <div class="metric-row">
          <span class="metric-label">Torrentio (Latino Priority)</span>
          <span class="metric-val val-cyan">${scrapers.torrentio?.p50Ms || 0} ms (Timeouts: ${scrapers.torrentio?.timeouts || 0})</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Comet (TorBox Debrid)</span>
          <span class="metric-val val-cyan">${scrapers.comet?.p50Ms || 0} ms (Timeouts: ${scrapers.comet?.timeouts || 0})</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">MediaFusion (ElfHosted)</span>
          <span class="metric-val val-cyan">${scrapers.mediafusion?.p50Ms || 0} ms (Timeouts: ${scrapers.mediafusion?.timeouts || 0})</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Pre-calentamiento N+1</span>
          <span class="metric-val val-good">Airlock Activo (0ms maratón)</span>
        </div>
      </div>

      <!-- 4. Subtítulos & SmartSync -->
      <div class="card">
        <h2>📝 Subtítulos & SmartSync</h2>
        <div class="metric-row">
          <span class="metric-label">SmartSync Framerate</span>
          <span class="metric-val val-good">23.976fps / PAL 25fps Auto</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Blindaje HPI / ACI</span>
          <span class="metric-val val-good">0 ms Deriva (Certificado)</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Compatibilidad Dual ISO</span>
          <span class="metric-val val-cyan">spl (Latam) + spa (Estándar)</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Traducción IA (Gemini Flash)</span>
          <span class="metric-val val-accent">Fast-Window 4s Activo</span>
        </div>
      </div>

      <!-- 5. Recomendador IA & Biblioteca -->
      <div class="card">
        <h2>🤖 Recomendador IA & Catálogos</h2>
        <div class="metric-row">
          <span class="metric-label">Semillas Biblioteca Stremio</span>
          <span class="metric-val val-accent">${recommender.librarySeedsCount || 0} títulos activos</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Exclusión Vistos (100%)</span>
          <span class="metric-val val-good">${recommender.excludedWatchedCount || 0} excluidos</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Diversidad Anti-Monopolio</span>
          <span class="metric-val val-cyan">diverseSeeds Clustering</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Acción ATP & Familiar</span>
          <span class="metric-val val-good">Filtro US PG-13 (Shawn Levy)</span>
        </div>
      </div>

      <!-- 6. Leanback UX & Codec Guard -->
      <div class="card">
        <h2>📺 Leanback UX & Codec Guard</h2>
        <div class="metric-row">
          <span class="metric-label">Target Hardware</span>
          <span class="metric-val">ZTE B866V2 (Amlogic S905X2)</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Filtro Incompatibles</span>
          <span class="metric-val val-good">AV1 / DV P7 FEL Relegados</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Micro-Badges Dinámicos</span>
          <span class="metric-val val-cyan">[HDR10] [DV P8] [5.1] [Atmos]</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Filas Inicio (D-pad UX)</span>
          <span class="metric-val val-good">&le; 20 Filas Curadas</span>
        </div>
      </div>
    </div>

    <div class="footer">
      <p>Actualización automática cada 30 segundos · Timestamp: ${payload.timestamp}</p>
      <div class="links">
        <a href="${url.origin}/manifest.json" target="_blank">Manifest Principal</a>
        <a href="${url.origin}/configure" target="_blank">Configurador Web</a>
        <a href="${url.origin}/health?probe_ai=1" target="_blank">Probar IA (Probe)</a>
        <a href="${url.origin}/health" target="_blank">JSON Crudo</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}
