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

// Re-exportaciones públicas canónicas para compatibilidad con tests y suites
export {
  cors,
  jsonResponse,
  parseStremioSubId,
  cleanReleaseName,
  classifyStreamAudio,
  isLatinoStream,
  isCachedOrInstantStream,
  LATIN_TOKENS,
} from "./deno-hub/utils/common.ts";

export {
  detectFramerate,
  resolveSmartSync,
  parseSrtToCues,
  serializeCuesToSrt,
  enforceMonotonicClamping,
  rescaleSrtFramerate,
  cleanSrt,
  pushDualSubtitles,
  EUROPEAN_SHOW_IDS,
  isEuropeanShowOrContext,
} from "./deno-hub/subtitles/smartsync.ts";

export {
  STREAMS_MANIFEST,
  ALLOWED_TORRENTIO_HOSTS,
  sanitizeTorrentioBase,
  rankAndBadgeStreams,
  handleStreams,
} from "./deno-hub/streams/streams.ts";

export { SUBDL_MANIFEST } from "./deno-hub/subtitles/subdl.ts";
export {
  OPENSUBTITLES_MANIFEST,
  OPENSUBTITLES_LATINO_MANIFEST,
} from "./deno-hub/subtitles/opensubtitles.ts";
export { SUBSOURCE_MANIFEST } from "./deno-hub/subtitles/subsource.ts";
export { TRANSLATE_MANIFEST } from "./deno-hub/translate/translate.ts";
export { handleHealth } from "./deno-hub/health.ts";

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
    if (path === "/" || path === "") {
      route = "root";
      res = jsonResponse({
        hub: "mejorastremio-hub",
        routes: [
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
      res = handleHealth();
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
    } else {
      res = new Response("Not found", { status: 404, headers: cors });
    }
  } catch (e) {
    res = jsonResponse({ error: (e as Error).message }, { status: 500 });
  }

  console.log(`[hub] ${route} ${req.method} ${path} -> ${res.status} (${Date.now() - started}ms)`);
  return res;
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function" && import.meta.main) {
  const port = parseInt(Deno.env.get("PORT") || "8000", 10);
  Deno.serve({ port }, handleHubRequest);
}
