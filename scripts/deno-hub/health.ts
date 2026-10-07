/**
 * health.ts — Endpoint de diagnóstico y salud del Hub (/health).
 */

import { jsonResponse } from "./utils/common.ts";
import { SUBDL_KEY } from "./subtitles/subdl.ts";
import { OPENSUBTITLES_API_KEY } from "./subtitles/opensubtitles.ts";
import { SUBDIVX_PROXY_URL } from "./subtitles/subdivx.ts";
import { SUBSOURCE_API_KEY } from "./subtitles/subsource.ts";
import { GEMINI_API_KEY, OPENROUTER_API_KEY } from "./translate/gemini.ts";
import { TMDB_KEY } from "./catalogs/tmdb.ts";

export function handleHealth(): Response {
  return jsonResponse({
    hub: "mejorastremio-hub",
    timestamp: new Date().toISOString(),
    smartSync: { active: true, supportedFramerates: ["23.976", "24.0", "25.0", "29.97"] },
    subdl: { configured: !!SUBDL_KEY },
    opensubtitles: { configured: !!OPENSUBTITLES_API_KEY },
    opensubtitlesLatino: { configured: !!OPENSUBTITLES_API_KEY },
    subdivx: { configured: true, proxy: SUBDIVX_PROXY_URL },
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
    translate: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      baseSource: !!OPENSUBTITLES_API_KEY,
      engine: "gemini-flash",
    },
  });
}
