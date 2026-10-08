/**
 * subsource.ts — Proveedor de subtítulos SubSource ES (sin SDH).
 */

import { cors, jsonResponse, parseStremioSubId, decodeSubtitleText } from "../utils/common.ts";
import { resolveSmartSync, rescaleSrtFramerate, cleanSrt, pushDualSubtitles, type SubtitleTrackPayload } from "./smartsync.ts";
import { extractSrtFromZip } from "./subdl.ts";

export const SUBSOURCE_API_KEY = (typeof Deno !== "undefined" && Deno.env?.get?.("SUBSOURCE_API_KEY")) || "";
export const SUBSOURCE_API = "https://api.subsource.net/api/v1";

export const SUBSOURCE_MANIFEST = {
  id: "com.mejorastremio.subsource",
  version: "1.2.0",
  name: "SubSource ES (sin SDH)",
  description:
    "Subtítulos en español de SubSource con filtrado hearing-impaired (sin SDH) y smart audio sync.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

export interface SubSourceCandidate {
  name: string;
  downloadUrl: string;
  hearingImpaired?: boolean;
}

export async function fetchSubSourceSubs(
  imdbId: string,
  season: number | null,
  episode: number | null,
): Promise<SubSourceCandidate[]> {
  if (!SUBSOURCE_API_KEY) return [];
  try {
    let url = `${SUBSOURCE_API}/subtitles?imdb_id=${imdbId}&language=spanish`;
    if (season != null) url += `&season=${season}`;
    if (episode != null) url += `&episode=${episode}`;

    const r = await fetch(url, {
      headers: {
        "X-API-Key": SUBSOURCE_API_KEY,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    const subs = Array.isArray(d?.subtitles) ? d.subtitles : Array.isArray(d?.data) ? d.data : [];
    // deno-lint-ignore no-explicit-any
    return subs.filter((s: any) => !s.hearing_impaired && !s.hi).map((s: any) => ({
      name: s.release_name || s.name || "SubSource ES",
      downloadUrl: s.download_url || s.url || "",
      hearingImpaired: !!(s.hearing_impaired || s.hi),
    })).filter((s: SubSourceCandidate) => !!s.downloadUrl);
  } catch {
    return [];
  }
}

export async function downloadSubSourceSrt(downloadUrl: string): Promise<string | null> {
  let dlHost: string;
  try {
    dlHost = new URL(downloadUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!dlHost.endsWith("subsource.net")) return null;
  try {
    const headers: Record<string, string> = {};
    if (SUBSOURCE_API_KEY) headers["X-API-Key"] = SUBSOURCE_API_KEY;
    const r = await fetch(downloadUrl, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    return isZip ? await extractSrtFromZip(buf) : decodeSubtitleText(buf);
  } catch {
    return null;
  }
}

export async function handleSubsource(
  subPath: string,
  mountBase: string,
  reqUrl?: URL,
): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(SUBSOURCE_MANIFEST);
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, type, rawId] = subMatch;
    const parsed = parseStremioSubId(rawId);
    if (!parsed.filename && reqUrl) {
      parsed.filename = reqUrl.searchParams.get("filename");
    }
    const imdbId = parsed.imdbId;
    const season = type === "series" ? parsed.season : null;
    const episode = type === "series" ? parsed.episode : null;

    try {
      const candidates = await fetchSubSourceSubs(imdbId, season, episode);
      const subtitles: SubtitleTrackPayload[] = [];

      for (let i = 0; i < Math.min(candidates.length, 2); i++) {
        const s = candidates[i];
        const baseId = `mshub-subsrc-${i}-${imdbId}`;
        const encoded = encodeURIComponent(s.downloadUrl);
        const cleanName = s.name.replace(/\.(srt|zip)$/i, "").slice(0, 25);
        const syncDecision = resolveSmartSync(parsed.filename, s.name, imdbId);

        if (syncDecision.needsRescale) {
          pushDualSubtitles(subtitles, {
            id: `${baseId}-${syncDecision.fpsParam}`,
            url: `${mountBase}/srt/${encoded}?fps=${syncDecision.fpsParam}&smart=1`,
            label: `⚡ ${i + 1}. Latino (Sincro) · ${cleanName}`,
            name: `⚡ ${i + 1}. Latino (Sincro) · ${cleanName}`,
          }, true);
          if (i === 0) {
            pushDualSubtitles(subtitles, {
              id: baseId,
              url: `${mountBase}/srt/${encoded}`,
              label: `📺 Original · ${cleanName}`,
              name: `📺 Original · ${cleanName}`,
            }, true);
          }
        } else {
          pushDualSubtitles(subtitles, {
            id: baseId,
            url: `${mountBase}/srt/${encoded}`,
            label: `✅ ${i + 1}. Latino (Nativo) · ${cleanName}`,
            name: `✅ ${i + 1}. Latino (Nativo) · ${cleanName}`,
          }, true);
        }
      }

      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const srtMatch = subPath.match(/^\/srt\/(.+)$/);
  if (srtMatch) {
    const downloadUrl = decodeURIComponent(srtMatch[1]);
    let srtText = await downloadSubSourceSrt(downloadUrl);
    if (!srtText) {
      return new Response("Error descargando o host no permitido", { status: 502, headers: cors });
    }
    const fps = reqUrl?.searchParams?.get("fps");
    const offsetStr = reqUrl?.searchParams?.get("offset");
    const offsetMs = offsetStr ? parseInt(offsetStr, 10) || 0 : 0;
    if (fps === "25to23976" || fps === "pal_to_ntsc") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 23.976, offsetMs);
    } else if (fps === "23976to25" || fps === "ntsc_to_pal") {
      srtText = rescaleSrtFramerate(srtText, 23.976, 25.0, offsetMs);
    } else if (fps === "25to24") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 24.0, offsetMs);
    } else if (fps === "24to25") {
      srtText = rescaleSrtFramerate(srtText, 24.0, 25.0, offsetMs);
    } else if (offsetMs !== 0) {
      srtText = rescaleSrtFramerate(srtText, 1.0, 1.0, offsetMs);
    }
    srtText = cleanSrt(srtText);
    return new Response(srtText, {
      headers: {
        ...cors,
        "Content-Type": "application/x-subrip; charset=utf-8",
        "Content-Disposition": 'attachment; filename="subsource.srt"',
      },
    });
  }

  return new Response("Not found", { status: 404, headers: cors });
}
