/**
 * subdl.ts — Proveedor de subtítulos SubDL ES (sin SDH).
 * Incorpora descompresión segura de ZIPs con protección Anti-ZipBomb, caché LRU bounded
 * en memoria (máximo 50 entradas) + persistencia Deno KV (30 días), y fallback resiliente a OpenSubtitles.
 */

import { cors, jsonResponse, parseStremioSubId, decodeSubtitleText, releaseSimilarity, getKv } from "../utils/common.ts";
import { BoundedLruCache } from "../utils/lru-cache.ts";
import { resolveSmartSync, rescaleSrtFramerate, cleanSrt, pushDualSubtitles, type SubtitleTrackPayload } from "./smartsync.ts";
import { isSdhName, looksLikeSDH } from "./sdh-detector.ts";
import { fetchOpenSubtitlesSubs, downloadOpenSubtitlesSrt } from "./opensubtitles.ts";

export const SUBDL_KEY = Deno.env.get("SUBDL_KEY") ?? "";
export const SUBDL_API = "https://api.subdl.com/api/v1/subtitles";
export const SUBDL_DL = "https://dl.subdl.com";

export const SUBDL_MANIFEST = {
  id: "com.mejorastremio.subdl",
  version: "1.2.0",
  name: "SubDL ES (SmartSync)",
  description:
    "Subtítulos en español desde SubDL con sincronización inteligente y filtro de sordos.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

export async function extractSrtFromZip(buf: Uint8Array): Promise<string | null> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 0;
  while (i < buf.length - 30) {
    if (
      buf[i] === 0x50 && buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x03 && buf[i + 3] === 0x04
    ) {
      const method = view.getUint16(i + 8, true);
      const cSize = view.getUint32(i + 18, true);
      const fnLen = view.getUint16(i + 26, true);
      const exLen = view.getUint16(i + 28, true);
      const fn = new TextDecoder().decode(buf.subarray(i + 30, i + 30 + fnLen));
      const dataStart = i + 30 + fnLen + exLen;

      if (
        fn.toLowerCase().endsWith(".srt") &&
        cSize > 0 &&
        dataStart + cSize <= buf.length
      ) {
        const data = buf.subarray(dataStart, dataStart + cSize);
        try {
          if (method === 0) {
            return decodeSubtitleText(new Uint8Array(data));
          }
          const ds = new DecompressionStream("deflate-raw");
          const chunks: Uint8Array[] = [];
          const MAX_DECOMPRESSED_BYTES = 5 * 1024 * 1024; // 5 MB Anti-ZipBomb
          let accumulatedBytes = 0;
          const writePromise = (async () => {
            const writer = ds.writable.getWriter();
            await writer.write(new Uint8Array(data));
            await writer.close();
          })();
          const readPromise = (async () => {
            const reader = ds.readable.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              accumulatedBytes += value.byteLength;
              if (accumulatedBytes > MAX_DECOMPRESSED_BYTES) {
                await reader.cancel("Protección Zip Bomb: tamaño de descompresión excedió 5MB");
                throw new Error("El archivo descomprimido excede el límite de 5MB");
              }
              chunks.push(value);
            }
          })();
          await Promise.all([writePromise, readPromise]);
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const result = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { result.set(c, off); off += c.length; }
          return decodeSubtitleText(result);
        } catch { /* intentar siguiente entrada */ }
      }
      i = dataStart + (cSize || 1);
    } else {
      i++;
    }
  }
  return null;
}

export interface SubdlSub {
  name: string;
  subdlPath: string;
}

export async function fetchSubdlSubs(
  imdbId: string,
  season: number | null,
  episode: number | null,
): Promise<SubdlSub[]> {
  let url = `${SUBDL_API}?api_key=${SUBDL_KEY}&imdb_id=${imdbId}&languages=ES&subs_per_page=20`;
  if (season != null) url += `&season_number=${season}`;
  if (episode != null) url += `&episode_number=${episode}`;

  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) return [];
  const d = await r.json();

  // deno-lint-ignore no-explicit-any
  return ((d?.subtitles ?? []) as any[])
    .filter((s) => (s.language ?? "").toUpperCase() === "ES" && s.hi === false)
    .map((s) => ({
      name: s.name || s.release_name || "SubDL ES",
      subdlPath: s.url as string,
    }));
}

// Bounded LRU Cache: máximo 50 subtítulos en RAM (~2.5MB), evitando desbordes OOM en Deno Deploy
const subdlMemCache = new BoundedLruCache<string, string>(50, 24 * 60 * 60 * 1000);

export async function downloadSubdlSrt(subdlPath: string): Promise<string | null> {
  // 1. Memoria rápida LRU
  const memCached = subdlMemCache.get(subdlPath);
  if (memCached) {
    return memCached;
  }

  // 2. Deno KV persistente (30 días)
  try {
    const kv = await getKv();
    const cached = await kv.get<string>(["subdl_srt_cache_v2", subdlPath]);
    if (cached?.value) {
      subdlMemCache.set(subdlPath, cached.value);
      return cached.value;
    }
  } catch {
    // Si KV no está disponible, continuar al fetch
  }

  const dlUrl = subdlPath.startsWith("http") ? subdlPath : `${SUBDL_DL}${subdlPath}`;
  let dlHost: string;
  try {
    dlHost = new URL(dlUrl).hostname;
  } catch {
    return null;
  }
  if (dlHost !== "dl.subdl.com") return null;

  try {
    const r = await fetch(dlUrl, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) {
      if (r.status === 429) {
        console.warn(`[subdl] Rate limit 429 excedido en SubDL: ${dlUrl}`);
      }
      return null;
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    const srt = isZip ? await extractSrtFromZip(buf) : decodeSubtitleText(buf);
    if (srt) {
      subdlMemCache.set(subdlPath, srt);
      try {
        const kv = await getKv();
        await kv.set(["subdl_srt_cache_v2", subdlPath], srt, { expireIn: 30 * 86400 * 1000 });
      } catch {
        // Ignorar fallo de escritura KV
      }
    }
    return srt;
  } catch {
    return null;
  }
}

export async function handleSubdl(subPath: string, mountBase: string, reqUrl?: URL): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(SUBDL_MANIFEST);
  }

  if (!SUBDL_KEY) {
    return new Response(
      "SUBDL_KEY no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, type, rawId] = subMatch;
    const parsed = parseStremioSubId(rawId);
    const imdbId = parsed.imdbId;
    const season = type === "series" ? parsed.season : null;
    const episode = type === "series" ? parsed.episode : null;

    try {
      const subs = await fetchSubdlSubs(imdbId, season, episode);
      const CHECK_LIMIT = 15;
      const toCheck = subs.slice(0, CHECK_LIMIT);
      const rest = subs.slice(CHECK_LIMIT);
      const verdicts = await Promise.all(toCheck.map(async (s) => {
        const text = await downloadSubdlSrt(s.subdlPath);
        return text ? looksLikeSDH(text) : null;
      }));
      const clean = toCheck.filter((_s, idx) => verdicts[idx] !== true);
      const sdhTagged = toCheck.filter((_s, idx) => verdicts[idx] === true);
      const restClean = rest.filter((s) => !isSdhName(s.name));
      const restSdh = rest.filter((s) => isSdhName(s.name));

      const sortRegionalPriority = (list: SubdlSub[]) => {
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
        const cleanName = s.name.replace(/\.(zip|srt)$/i, "").slice(0, 25);
        const baseId = `mshub-subdl-${subs.indexOf(s)}-${imdbId}`;
        const encoded = encodeURIComponent(s.subdlPath);

        const syncDecision = resolveSmartSync(parsed.filename, s.name, imdbId);
        const metaParams = `imdb=${encodeURIComponent(imdbId)}${season != null ? `&season=${season}` : ""}${episode != null ? `&episode=${episode}` : ""}`;

        if (syncDecision.needsRescale) {
          pushDualSubtitles(subtitles, {
            id: `${baseId}-${syncDecision.fpsParam}`,
            url: `${mountBase}/srt/${encoded}?fps=${syncDecision.fpsParam}&smart=1&${metaParams}`,
            label: `⚡ ${i + 1}. Latino (Sincro) · ${cleanName}`,
            name: `⚡ ${i + 1}. Latino (Sincro) · ${cleanName}`,
          }, true);

          if (i === 0) {
            pushDualSubtitles(subtitles, {
              id: baseId,
              url: `${mountBase}/srt/${encoded}?${metaParams}`,
              label: `📺 Original · ${cleanName}`,
              name: `📺 Original · ${cleanName}`,
            }, true);
          }
        } else {
          pushDualSubtitles(subtitles, {
            id: baseId,
            url: `${mountBase}/srt/${encoded}?${metaParams}`,
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
    const subdlPath = decodeURIComponent(srtMatch[1]);
    let srtText = await downloadSubdlSrt(subdlPath);
    if (!srtText) {
      const fallbackImdb = reqUrl?.searchParams?.get("imdb");
      if (fallbackImdb) {
        try {
          const s = reqUrl?.searchParams?.get("season");
          const e = reqUrl?.searchParams?.get("episode");
          const seasonNum = s ? parseInt(s, 10) : null;
          const episodeNum = e ? parseInt(e, 10) : null;
          const osSubs = await fetchOpenSubtitlesSubs(fallbackImdb, seasonNum, episodeNum, "es");
          if (osSubs.length > 0) {
            srtText = await downloadOpenSubtitlesSrt(osSubs[0].fileId);
            console.log(`[subdl] Fallback exitoso a OpenSubtitles para ${fallbackImdb}`);
          }
        } catch {
          // Ignorar fallo de fallback
        }
      }
    }
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
        "Content-Disposition": 'attachment; filename="sub.srt"',
      },
    });
  }

  return new Response("Not found", { status: 404, headers: cors });
}
