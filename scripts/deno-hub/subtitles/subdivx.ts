/**
 * subdivx.ts — Subdivx ES Latino (vía Proxy con Smart Audio Sync).
 */

import { cors, jsonResponse, parseStremioSubId, decodeSubtitleText, b64u } from "../utils/common.ts";
import { resolveSmartSync, rescaleSrtFramerate, cleanSrt, pushDualSubtitles, type SubtitleTrackPayload } from "./smartsync.ts";
import { extractSrtFromZip } from "./subdl.ts";

export const SUBDIVX_PROXY_URL = Deno.env.get("SUBDIVX_PROXY_URL") ?? "https://stremio-subdivx.xor.ar";

export const SUBDIVX_MANIFEST = {
  id: "com.mejorastremio.subdivx",
  version: "1.0.0",
  name: "Subdivx ES Latino (Smart Audio Sync)",
  description:
    "Subtítulos en Español Latino de Subdivx mediante proxy con Smart Audio Sync automático y filtrado SDH.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

export async function handleSubdivx(
  subPath: string,
  mountBase: string,
  reqUrl?: URL,
): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(SUBDIVX_MANIFEST);
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, type, rawId] = subMatch;
    const parsed = parseStremioSubId(rawId);
    let { imdbId, season, episode, filename } = parsed;
    if (!filename && reqUrl) {
      filename = reqUrl.searchParams.get("filename");
    }

    try {
      const proxyBase = SUBDIVX_PROXY_URL.replace(/\/+$/, "");
      const b64EmptyConfig = b64u.encode(JSON.stringify({ apiKey: "" }));
      const targetQuery = type === "series" && season != null && episode != null
        ? `${imdbId}:${season}:${episode}`
        : imdbId;
      const targetUrl = `${proxyBase}/${b64EmptyConfig}/subtitles/${type}/${encodeURIComponent(targetQuery)}.json`;

      const r = await fetch(targetUrl, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      // deno-lint-ignore no-explicit-any
      let subs: any[] = [];
      if (r && r.ok) {
        const d = await r.json().catch(() => null);
        subs = Array.isArray(d?.subtitles) ? d.subtitles : [];
      }

      if (!subs.length) {
        return jsonResponse({ subtitles: [] });
      }

      const subtitles: SubtitleTrackPayload[] = [];
      for (let i = 0; i < Math.min(subs.length, 2); i++) {
        const s = subs[i];
        const subName = (s.label || s.name || `Subdivx ${i + 1}`).slice(0, 25);
        const syncDecision = resolveSmartSync(filename, subName, imdbId);
        const encodedUrl = encodeURIComponent(s.url);
        const baseId = `mshub-subdivx-${i}-${imdbId}`;

        if (syncDecision.needsRescale) {
          pushDualSubtitles(subtitles, {
            id: `${baseId}-${syncDecision.fpsParam}`,
            url: `${mountBase}/srt/${encodedUrl}?fps=${syncDecision.fpsParam}&smart=1`,
            label: `⚡ ${i + 1}. Latino (Sincro) · ${subName}`,
            name: `⚡ ${i + 1}. Latino (Sincro) · ${subName}`,
          }, true);
          if (i === 0) {
            pushDualSubtitles(subtitles, {
              id: baseId,
              url: `${mountBase}/srt/${encodedUrl}`,
              label: `📺 Original · ${subName}`,
              name: `📺 Original · ${subName}`,
            }, true);
          }
        } else {
          pushDualSubtitles(subtitles, {
            id: baseId,
            url: `${mountBase}/srt/${encodedUrl}`,
            label: `✅ ${i + 1}. Latino (Nativo) · ${subName}`,
            name: `✅ ${i + 1}. Latino (Nativo) · ${subName}`,
          }, true);
        }
      }

      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message });
    }
  }

  const srtMatch = subPath.match(/^\/srt\/(.+)$/);
  if (srtMatch) {
    const rawTarget = decodeURIComponent(srtMatch[1]);
    try {
      const r = await fetch(rawTarget, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return new Response("Error upstream Subdivx", { status: 502, headers: cors });
      const buf = new Uint8Array(await r.arrayBuffer());
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      let srtText = isZip ? await extractSrtFromZip(buf) : decodeSubtitleText(buf);
      if (!srtText) return new Response("Error decodificando subtítulo", { status: 502, headers: cors });

      const fps = reqUrl?.searchParams?.get("fps");
      const offsetStr = reqUrl?.searchParams?.get("offset");
      const offsetMs = offsetStr ? parseInt(offsetStr, 10) || 0 : 0;
      if (fps === "25to23976" || fps === "pal_to_ntsc") {
        srtText = rescaleSrtFramerate(srtText, 25.0, 23.976, offsetMs);
      } else if (fps === "23976to25" || fps === "ntsc_to_pal") {
        srtText = rescaleSrtFramerate(srtText, 23.976, 25.0, offsetMs);
      } else if (offsetMs !== 0) {
        srtText = rescaleSrtFramerate(srtText, 1.0, 1.0, offsetMs);
      }

      srtText = cleanSrt(srtText);
      return new Response(srtText, {
        headers: {
          ...cors,
          "Content-Type": "application/x-subrip; charset=utf-8",
          "Content-Disposition": 'attachment; filename="subdivx.srt"',
        },
      });
    } catch (e) {
      return new Response(`Error: ${(e as Error).message}`, { status: 502, headers: cors });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}
