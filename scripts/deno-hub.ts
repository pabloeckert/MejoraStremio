/**
 * deno-hub.ts — Hub único de Deno Deploy que consolida los microservicios de MejoraStremio.
 *
 * Arquitectura Modular (Fase 4 - Modularización Quirúrgica):
 * - scripts/deno-hub/utils/        -> Utilidades compartidas, CORS, tipos, caché bounded LRU.
 * - scripts/deno-hub/subtitles/    -> SubDL, OpenSubtitles, SubSource, Subdivx, Proxy, Smart Audio Sync.
 * - scripts/deno-hub/streams/      -> Smart Stream Interceptor, normalización Torrentio y badging visual.
 * - scripts/deno-hub/translate/    -> Pipeline de traducción IA Gemini Flash con cola KV y Fast-Window.
 * - scripts/deno-hub/catalogs/     -> Catálogos Latino, Synopsis IA, TMDB Discover, UFC, LiveTV e IPTV.
 * - scripts/deno-hub/health.ts     -> Endpoint de diagnóstico y salud del Hub (/health).
 */

import { cors, jsonResponse } from "./deno-hub/utils/common.ts";
import { handleHealth } from "./deno-hub/health.ts";
import { handleSubtitleProxy } from "./deno-hub/subtitles/proxy.ts";
import { handleSubdl } from "./deno-hub/subtitles/subdl.ts";
import { handleSubdivx } from "./deno-hub/subtitles/subdivx.ts";
import { handleSubsource } from "./deno-hub/subtitles/subsource.ts";
import {
  handleOpenSubtitles,
  OPENSUBTITLES_MANIFEST,
  OPENSUBTITLES_LATINO_MANIFEST,
} from "./deno-hub/subtitles/opensubtitles.ts";
import { handleLatino } from "./deno-hub/catalogs/latino.ts";
import { handleSynopsis } from "./deno-hub/catalogs/synopsis.ts";
import {
  handleMiniseries,
  handleShortSeries,
  handleDiscover,
} from "./deno-hub/catalogs/tmdb.ts";
import { handleUfc } from "./deno-hub/catalogs/ufc.ts";
import { handleLivetv, handleIptv } from "./deno-hub/catalogs/iptv.ts";
import { handleMediathek } from "./deno-hub/catalogs/mediathek.ts";
import { handleTranslate } from "./deno-hub/translate/translate.ts";
import { handleStreams } from "./deno-hub/streams/streams.ts";
import {
  MEJORASTREMIO_HUB_MANIFEST,
  renderConfigureHtml,
  handleUnifiedSubtitles,
  handleUnifiedHub,
  handleMeta,
} from "./deno-hub/unified-hub.ts";
import { subtitlesApp } from "./deno-hub/subtitles/subtitles.ts";
import { handleProxyStream } from "./deno-hub/catalogs/paravos.ts";
import { getLatinoTrailersHotPath } from "./deno-hub/catalogs/trailers.ts";

// Re-exportaciones públicas canónicas para compatibilidad con tests y suites
export {
  MEJORASTREMIO_HUB_MANIFEST,
  renderConfigureHtml,
  handleUnifiedSubtitles,
  handleUnifiedHub,
  handleMeta,
};
export {
  cors,
  jsonResponse,
  parseStremioSubId,
  cleanReleaseName,
  classifyStreamAudio,
  detectLatinoConfidence,
  type LatinoConfidence,
  LATINO_CONFIRMED_REGEX,
  LATINO_PROBABLE_REGEX,
  isLatinoStream,
  isCachedOrInstantStream,
  LATIN_TOKENS,
} from "./deno-hub/utils/common.ts";

export { BoundedLruCache } from "./deno-hub/utils/lru-cache.ts";

export {
  setCompressedKvText,
  getCompressedKvText,
  setCompressedKvJson,
  getCompressedKvJson,
  calculateSha256 as calculateBlobSha256,
  compressGzip,
  decompressGzip,
  KV_BLOB_CHUNK_SIZE,
} from "./deno-hub/utils/kv_blob_cache.ts";

export {
  detectFramerate,
  resolveSmartSync,
  PAL_TO_WEBDL_RATIO,
  parseSrtToCues,
  serializeCuesToSrt,
  enforceMonotonicClamping,
  rescaleSrtFramerate,
  cleanSrt,
  pushDualSubtitles,
  EUROPEAN_SHOW_IDS,
  isEuropeanShowOrContext,
  calculateTwoAnchorTransform,
  rescaleSrtWithTwoAnchors,
  checkNonLinearDrift,
  rescaleSrtWithTwoAnchorsValidated,
  MAX_ALLOWED_RESIDUAL_MS,
  PRESERVED_SPEAKER_ACRONYMS,
} from "./deno-hub/subtitles/smartsync.ts";

export {
  checkGeminiDailyQuota,
  recordGeminiUsage,
  checkGemini429Circuit,
  recordGemini429Error,
  recordGeminiSuccess,
  resetGeminiGovernanceForTesting,
  DEFAULT_GEMINI_DAILY_LIMIT,
  INITIAL_429_COOLDOWN_MS,
  MAX_429_COOLDOWN_MS,
} from "./deno-hub/translate/gemini_governance.ts";

export {
  STREAMS_MANIFEST,
  ALLOWED_TORRENTIO_HOSTS,
  sanitizeTorrentioBase,
  rankAndBadgeStreams,
  handleStreams,
} from "./deno-hub/streams/streams.ts";

export {
  MediaFlowCircuitBreaker,
  globalMediaFlowCircuitBreaker,
  getMediaFlowConfig,
  applyMediaFlowToStreams,
  buildMediaFlowStreamUrl,
  shouldProxyMediaStream,
  getOrSetSwrCache,
  TTL_SEGMENTS,
  verifyTorboxInstantStreams,
  queryTorboxApiCheckCached,
} from "./deno-hub/streams/mediaflow.ts";

export { SUBDL_MANIFEST } from "./deno-hub/subtitles/subdl.ts";
export {
  OPENSUBTITLES_MANIFEST,
  OPENSUBTITLES_LATINO_MANIFEST,
} from "./deno-hub/subtitles/opensubtitles.ts";
export { SUBSOURCE_MANIFEST } from "./deno-hub/subtitles/subsource.ts";
export { TRANSLATE_MANIFEST } from "./deno-hub/translate/translate.ts";
export {
  subtitlesApp,
  SUBTITLES_APP_MANIFEST,
  fetchSubDL,
  fetchOpenSubtitlesV3,
  fetchSubSource,
  fetchWyzieSubs,
  translateCuesWithGemini,
  filterNonSDH,
  sanitizeLatinSpanishTracks,
} from "./deno-hub/subtitles/subtitles.ts";
export { handleHealth } from "./deno-hub/health.ts";
export {
  recordScraperLatency,
  recordTorboxLatency,
  calculatePercentiles,
  getScrapersTelemetry,
  getTorboxTelemetry,
  getCatalogRefreshInfo,
  getSystemTelemetry,
  generateHmacSignature,
  verifyTelemetryAuth,
} from "./deno-hub/telemetry.ts";
export {
  timingSafeEqual,
  timingSafeEqualString,
  signProxyUrl,
  verifyProxyUrl,
  canonicalizeUrlForSigning,
  getHmacProxyKeys,
} from "./deno-hub/utils/crypto_security.ts";
export {
  getTorboxTokenStatus,
  formatTorboxPlan,
  defaultTorboxUserFetcher,
  resetTorboxTelemetryCacheForTesting,
} from "./deno-hub/utils/torbox_telemetry.ts";
export {
  buildSignedSubtitleProxyUrl,
} from "./deno-hub/subtitles/proxy.ts";
export {
  getManifestWithVersion,
} from "./deno-hub/unified-hub.ts";
export {
  fetchCinemetaMeta,
  canonicalImdbId,
  sortMetasChronologicalDesc,
  fetchCinemetaCatalogSorted,
} from "./deno-hub/utils/cinemeta.ts";
export {
  DISCOVER_MANIFEST,
  handleDiscover,
  isRecentPremiereQuery,
  DISCOVER_PAGE_KV_TTL_DEFAULT_MS,
  DISCOVER_PAGE_KV_TTL_FRESH_PREMIERES_MS,
} from "./deno-hub/catalogs/tmdb.ts";

export {
  handleProxyStream,
  recordPlaybackEvent,
  getProfileHistory,
  buildParaVosCatalog,
  buildHistoryKey,
  hashToken,
  HISTORY_MAX_ITEMS,
  HISTORY_KV_TTL_MS,
  type ProfilePlaybackHistory,
  type HistoryItem,
  type ParaVosCatalogMeta,
} from "./deno-hub/catalogs/paravos.ts";

export {
  isStrictLatinoTrailer,
  getLatinoTrailersHotPath,
  runNightlyTrailerCron,
  fetchTmdbVideos,
  LATINO_CHANNEL_WHITELIST,
  NEGATIVE_TRAILER_TOKENS,
  DAILY_YOUTUBE_SEARCH_BUDGET,
  TRAILER_KV_TTL_MS,
  type TrailerCandidate,
  type TmdbVideoItem,
} from "./deno-hub/catalogs/trailers.ts";

export {
  getCanaryConfig,
  setCanaryConfig,
  isCanaryProfile,
  isCanaryActiveForProfile,
  triggerCanaryRollback,
  CANARY_KV_KEY,
  DEFAULT_CANARY_CONFIG,
  type CanaryFlagConfig,
} from "./deno-hub/utils/canary_governance.ts";

// ═════════════════════════════════════════════════════════════════════════════
// ── Router Central Ultraligero ──────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

export async function handleHubRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const started = Date.now();
  let route = "unknown";
  let res: Response;

  try {
    const unifiedRes = await handleUnifiedHub(path, url.origin, url);
    if (unifiedRes) {
      route = "unified-hub";
      res = unifiedRes;
    } else if (path === "/" || path === "") {
      route = "root";
      res = jsonResponse({
        hub: "mejorastremio-hub",
        routes: [
          "/manifest.json",
          "/configure",
          "/subdl/manifest.json",
          "/opensubtitles/manifest.json",
          "/opensubtitles-latino/manifest.json",
          "/subdivx/manifest.json",
          "/subsource/manifest.json",
          "/latino/manifest.json",
          "/synopsis/manifest.json",
          "/miniseries/manifest.json",
          "/short-series/manifest.json",
          "/discover/manifest.json",
          "/ufc/manifest.json",
          "/livetv/manifest.json",
          "/iptv/manifest.json",
          "/mediathek/manifest.json",
          "/translate/manifest.json",
          "/streams/manifest.json",
          "/health",
        ],
      });
    } else if (path === "/health") {
      route = "health";
      res = await handleHealth(url, req);
    } else if (path.startsWith("/subtitles/proxy")) {
      route = "subtitles-proxy";
      res = await handleSubtitleProxy(url);
    } else if (path.startsWith("/subdl")) {
      route = "subdl";
      const subPath = path.slice("/subdl".length) || "/";
      res = await handleSubdl(subPath, `${url.origin}/subdl`, url);
    } else if (path.startsWith("/subdivx")) {
      route = "subdivx";
      const subPath = path.slice("/subdivx".length) || "/";
      res = await handleSubdivx(subPath, `${url.origin}/subdivx`, url);
    } else if (path.startsWith("/subsource")) {
      route = "subsource";
      const subPath = path.slice("/subsource".length) || "/";
      res = await handleSubsource(subPath, `${url.origin}/subsource`, url);
    } else if (path.startsWith("/opensubtitles-latino")) {
      route = "opensubtitles-latino";
      const subPath = path.slice("/opensubtitles-latino".length) || "/";
      res = await handleOpenSubtitles(
        subPath,
        `${url.origin}/opensubtitles-latino`,
        OPENSUBTITLES_LATINO_MANIFEST,
        "ea",
        "mshub-oslat",
        "OpenSubtitles Latino",
        url,
      );
    } else if (path.startsWith("/opensubtitles")) {
      route = "opensubtitles";
      const subPath = path.slice("/opensubtitles".length) || "/";
      res = await handleOpenSubtitles(
        subPath,
        `${url.origin}/opensubtitles`,
        OPENSUBTITLES_MANIFEST,
        "es",
        "mshub-os",
        "OpenSubtitles",
        url,
      );
    } else if (path.startsWith("/latino")) {
      route = "latino";
      const subPath = path.slice("/latino".length) || "/";
      res = await handleLatino(subPath);
    } else if (path.startsWith("/synopsis")) {
      route = "synopsis";
      const subPath = path.slice("/synopsis".length) || "/";
      res = await handleSynopsis(subPath);
    } else if (path.startsWith("/miniseries")) {
      route = "miniseries";
      const subPath = path.slice("/miniseries".length) || "/";
      res = await handleMiniseries(subPath);
    } else if (path.startsWith("/short-series")) {
      route = "short-series";
      const subPath = path.slice("/short-series".length) || "/";
      res = await handleShortSeries(subPath);
    } else if (path.startsWith("/discover")) {
      route = "discover";
      const subPath = path.slice("/discover".length) || "/";
      res = await handleDiscover(subPath, url);
    } else if (path.startsWith("/ufc")) {
      route = "ufc";
      const subPath = path.slice("/ufc".length) || "/";
      res = await handleUfc(subPath);
    } else if (path.startsWith("/livetv")) {
      route = "livetv";
      const subPath = path.slice("/livetv".length) || "/";
      res = await handleLivetv(subPath);
    } else if (path.startsWith("/iptv")) {
      route = "iptv";
      const subPath = path.slice("/iptv".length) || "/";
      res = await handleIptv(subPath);
    } else if (path.startsWith("/mediathek")) {
      route = "mediathek";
      const subPath = path.slice("/mediathek".length) || "/";
      res = await handleMediathek(subPath, `${url.origin}/mediathek`, `${url.origin}/translate`);
    } else if (path.startsWith("/translate")) {
      route = "translate";
      const subPath = path.slice("/translate".length) || "/";
      res = await handleTranslate(subPath, `${url.origin}/translate`, url);
    } else if (path.startsWith("/streams") || path.startsWith("/stream/")) {
      route = "streams";
      const subPath = path.startsWith("/streams")
        ? (path.slice("/streams".length) || "/")
        : path;
      res = await handleStreams(subPath, url);
    } else if (path.startsWith("/subtitles-app") || path.startsWith("/subtitles-v2")) {
      route = "subtitles-app";
      res = await subtitlesApp.fetch(req);
    } else if (path === "/proxy/stream" || path.startsWith("/proxy/stream")) {
      route = "proxy-stream";
      res = await handleProxyStream(url, req);
    } else if (path.startsWith("/trailer/") || path.startsWith("/trailers/")) {
      route = "trailers";
      const parts = path.split("/").filter(Boolean);
      const type = (parts[1] as "movie" | "tv") || "movie";
      const id = parts[2]?.replace(/\.json$/, "") || "";
      const trailers = await getLatinoTrailersHotPath(id, type, id);
      res = jsonResponse({ trailers });
    } else {
      res = new Response("Not found", { status: 404, headers: cors });
    }
  } catch (e) {
    res = jsonResponse({ error: (e as Error).message }, { status: 500 });
  }

  console.log(`[hub] ${route} ${req.method} ${path} -> ${res.status} (${Date.now() - started}ms)`);
  return res;
}

// ── Keep-Warm Serverless Nativo en Deno Deploy (Cero cuota GitHub Actions) ──
type DenoCronFn = (name: string, schedule: string, handler: () => Promise<void> | void) => void;
if (typeof Deno !== "undefined" && typeof (Deno as unknown as { cron?: DenoCronFn }).cron === "function") {
  (Deno as unknown as { cron: DenoCronFn }).cron("keep-warm-hub", "*/15 * * * *", async () => {
    try {
      const pingUrl = "https://mejorastremio-hub.pabloeckert.deno.net/health";
      const r = await fetch(pingUrl, { signal: AbortSignal.timeout(10000) });
      console.log(`[cron:keep-warm] Ping de salud a ${pingUrl}: status ${r.status}`);
    } catch (e) {
      console.warn(`[cron:keep-warm] Ping de salud falló: ${(e as Error).message}`);
    }
  });
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function" && import.meta.main) {
  const port = parseInt(Deno.env.get("PORT") || "8000", 10);
  Deno.serve({ port }, handleHubRequest);
}
