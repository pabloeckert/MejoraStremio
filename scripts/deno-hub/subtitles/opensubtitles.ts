/**
 * opensubtitles.ts — Proveedor de subtítulos OpenSubtitles (API moderna v1).
 * Soporta filtrado estricto "ea" (Latino) y "es" (España), clasificación por contenido anti-SDH,
 * y Smart Audio Sync con entrega dual ('spl' y 'spa').
 */

import { cors, jsonResponse, parseStremioSubId, decodeSubtitleText, releaseSimilarity, getKv } from "../utils/common.ts";
import { resolveSmartSync, rescaleSrtFramerate, cleanSrt, pushDualSubtitles, type SubtitleTrackPayload } from "./smartsync.ts";
import { isSdhName, looksLikeSDH } from "./sdh-detector.ts";

export const OPENSUBTITLES_API_KEY = Deno.env.get("OPENSUBTITLES_API_KEY") ?? "";
export const OPENSUBTITLES_API = "https://api.opensubtitles.com/api/v1";
export const OPENSUBTITLES_UA = "MejoraStremio v1";
export const OPENSUBTITLES_SRT_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

export const OPENSUBTITLES_MANIFEST = {
  id: "com.mejorastremio.opensubtitles",
  version: "1.2.0",
  name: "OpenSubtitles ES (sin SDH)",
  description:
    "Subtítulos en español de OpenSubtitles (API moderna). Filtra hearing-impaired " +
    "(SDH) server-side con el campo real de la API, no por nombre de archivo.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

export const OPENSUBTITLES_LATINO_MANIFEST = {
  id: "com.mejorastremio.opensubtitles-latino",
  version: "1.2.0",
  name: "OpenSubtitles Latino (sin SDH)",
  description:
    "Subtítulos en español LATINOAMERICANO real de OpenSubtitles (API moderna, código de " +
    "idioma \"ea\" — distinto del español genérico/España). Filtra hearing-impaired (SDH) " +
    "server-side con el campo real de la API, no por nombre de archivo.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

export interface OpenSubtitlesSub {
  name: string;
  fileId: number;
}

export async function fetchOpenSubtitlesSubs(
  imdbId: string,
  season: number | null,
  episode: number | null,
  lang = "es",
): Promise<OpenSubtitlesSub[]> {
  const params = new URLSearchParams({ languages: lang });
  if (season != null && episode != null) {
    params.set("parent_imdb_id", imdbId.replace(/^tt0*/, ""));
    params.set("season_number", String(season));
    params.set("episode_number", String(episode));
  } else {
    params.set("imdb_id", imdbId.replace(/^tt0*/, ""));
  }

  const r = await fetch(`${OPENSUBTITLES_API}/subtitles?${params}`, {
    headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) return [];
  const d = await r.json();

  // deno-lint-ignore no-explicit-any
  return ((d?.data ?? []) as any[])
    .map((s) => ({
      name: s.attributes?.release || s.attributes?.files?.[0]?.file_name || "OpenSubtitles ES",
      fileId: s.attributes?.files?.[0]?.file_id as number,
    }))
    .filter((s) => Number.isFinite(s.fileId));
}

export async function downloadOpenSubtitlesSrt(fileId: number): Promise<string | null> {
  const cacheKey = ["opensubtitles-srt", fileId];
  let kv: Deno.Kv | null = null;
  try {
    kv = await getKv();
    const cached = await kv.get<string>(cacheKey);
    if (cached.value) return cached.value;
  } catch {
    kv = null;
  }
  try {
    const dl = await fetch(`${OPENSUBTITLES_API}/download`, {
      method: "POST",
      headers: {
        "Api-Key": OPENSUBTITLES_API_KEY,
        "User-Agent": OPENSUBTITLES_UA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(15000),
    }).then((r) => r.json());
    if (!dl?.link) return null;
    const r = await fetch(dl.link, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const srtText = decodeSubtitleText(new Uint8Array(await r.arrayBuffer()));
    if (kv) {
      try { await kv.set(cacheKey, srtText, { expireIn: OPENSUBTITLES_SRT_CACHE_TTL_MS }); } catch { /* sin cache */ }
    }
    return srtText;
  } catch {
    return null;
  }
}

export async function classifySDHCached(fileId: number): Promise<boolean | null> {
  let kv: Deno.Kv | null = null;
  const verdictKey = ["sdh-verdict", "os", "v2", fileId];
  try {
    kv = await getKv();
    const cached = await kv.get<boolean>(verdictKey);
    if (typeof cached.value === "boolean") return cached.value;
  } catch {
    kv = null;
  }
  const text = await downloadOpenSubtitlesSrt(fileId);
  if (!text) return null;
  const verdict = looksLikeSDH(text);
  if (kv) {
    try { await kv.set(verdictKey, verdict, { expireIn: 180 * 24 * 60 * 60 * 1000 }); } catch { /* sin cache */ }
  }
  return verdict;
}

export async function handleOpenSubtitles(
  subPath: string,
  mountBase: string,
  // deno-lint-ignore no-explicit-any
  manifest: any = OPENSUBTITLES_MANIFEST,
  lang = "es",
  idTag = "mshub-os",
  _nameTag = "OpenSubtitles",
  reqUrl?: URL,
): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(manifest);
  }

  if (!OPENSUBTITLES_API_KEY) {
    return new Response(
      "OPENSUBTITLES_API_KEY no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, , rawId] = subMatch;
    const parsed = parseStremioSubId(rawId);
    if (!parsed.filename && reqUrl) {
      parsed.filename = reqUrl.searchParams.get("filename");
    }
    const { imdbId, season, episode } = parsed;

    try {
      let subs = await fetchOpenSubtitlesSubs(imdbId, season, episode, lang);
      if (!subs.length && lang === "ea") {
        subs = await fetchOpenSubtitlesSubs(imdbId, season, episode, "es");
      }

      const CHECK_LIMIT = 10;
      const toCheck = subs.slice(0, CHECK_LIMIT);
      const rest = subs.slice(CHECK_LIMIT);
      const verdicts = toCheck.length
        ? await Promise.all(toCheck.map((s) => classifySDHCached(s.fileId)))
        : [];
      const clean = toCheck.filter((_s, idx) => verdicts[idx] !== true);
      const sdhTagged = toCheck.filter((_s, idx) => verdicts[idx] === true);
      const restClean = rest.filter((s) => !isSdhName(s.name));
      const restSdh = rest.filter((s) => isSdhName(s.name));

      const sortRegionalPriority = (list: OpenSubtitlesSub[]) => {
        return [...list].sort((a, b) => {
          const score = (name: string) => {
            const n = name.toLowerCase();
            let pts = 0;
            if (n.includes("latino") || n.includes("latin") || n.includes("mexico") || n.includes("argentina")) pts += 100;
            else if (n.includes("castellano") || n.includes("españa") || n.includes("spain") || n.includes("peninsular")) pts += 10;
            else pts += 50;

            if (parsed.filename) {
              pts += Math.round(releaseSimilarity(parsed.filename, name) * 60);
            }
            return pts;
          };
          return score(b.name) - score(a.name);
        });
      };

      const sortedClean = sortRegionalPriority([...clean, ...restClean]);
      const allSdh = [...sdhTagged, ...restSdh];
      const candidates = sortedClean.length ? sortedClean.slice(0, 2) : allSdh.slice(0, 2);

      const subtitles: SubtitleTrackPayload[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const s = candidates[i];
        const baseId = `${idTag}-${subs.indexOf(s)}-${imdbId}`;
        const syncDecision = resolveSmartSync(parsed.filename, s.name, imdbId);
        const cleanName = s.name.replace(/\.(zip|srt)$/i, "").slice(0, 25);
        const isLatino = lang === "ea" || !(/\b(castellano|españa|spain|peninsular)\b/i.test(s.name));
        const prefix = isLatino ? "Latino" : "España";

        if (syncDecision.needsRescale) {
          pushDualSubtitles(subtitles, {
            id: `${baseId}-${syncDecision.fpsParam}`,
            url: `${mountBase}/srt/${s.fileId}?fps=${syncDecision.fpsParam}&smart=1`,
            label: `⚡ ${i + 1}. ${prefix} (Sincro) · ${cleanName}`,
            name: `⚡ ${i + 1}. ${prefix} (Sincro) · ${cleanName}`,
          }, isLatino);

          if (i === 0) {
            pushDualSubtitles(subtitles, {
              id: baseId,
              url: `${mountBase}/srt/${s.fileId}`,
              label: `📺 Original · ${cleanName}`,
              name: `📺 Original · ${cleanName}`,
            }, isLatino);
          }
        } else {
          pushDualSubtitles(subtitles, {
            id: baseId,
            url: `${mountBase}/srt/${s.fileId}`,
            label: `✅ ${i + 1}. ${prefix} (Nativo) · ${cleanName}`,
            name: `✅ ${i + 1}. ${prefix} (Nativo) · ${cleanName}`,
          }, isLatino);
        }
      }
      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const srtMatch = subPath.match(/^\/srt\/(\d+)$/);
  if (srtMatch) {
    const fileId = parseInt(srtMatch[1], 10);
    let srtText = await downloadOpenSubtitlesSrt(fileId);
    if (srtText == null) {
      return new Response("Error descargando el subtítulo de OpenSubtitles", { status: 502, headers: cors });
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
        "Content-Disposition": 'attachment; filename="sub.srt"',
      },
    });
  }

  return new Response("Not found", { status: 404, headers: cors });
}
