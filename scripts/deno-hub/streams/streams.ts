/**
 * streams.ts — Smart Stream Interceptor (Proxy Inteligente de Streams).
 * Intercepta peticiones de streams hacia Torrentio, reordena con prioridad
 * absoluta al audio latino y aplica badges visuales para TV Box.
 */

import {
  cors,
  jsonResponse,
  classifyStreamAudio,
  isCachedOrInstantStream,
  type StremioStreamItem,
  type StreamAudioCategory,
} from "../utils/common.ts";

export const STREAMS_MANIFEST = {
  id: "com.mejorastremio.streams",
  version: "1.2.0",
  name: "MejoraStremio Streams (Latino Priority)",
  description:
    "Smart Stream Interceptor: proxy inteligente de Torrentio con reordenamiento prioritario a audio latino y etiquetado visual para TV.",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

export const ALLOWED_TORRENTIO_HOSTS = new Set(["torrentio.strem.fun"]);

export function sanitizeTorrentioBase(rawUrl: string): string {
  let candidate = (rawUrl || "https://torrentio.strem.fun/language=latino/").trim();
  try {
    const parsed = new URL(candidate);
    if (!ALLOWED_TORRENTIO_HOSTS.has(parsed.hostname.toLowerCase())) {
      candidate = "https://torrentio.strem.fun/language=latino/";
    }
  } catch {
    candidate = "https://torrentio.strem.fun/language=latino/";
  }
  let u = candidate;
  if (!u.endsWith("/")) u += "/";
  u = u.replace(/\/manifest\.json.*$/, "/");
  if (u.includes("language=spanish")) {
    u = u.replace(/language=spanish/g, "language=latino");
  } else if (!u.includes("language=")) {
    const m = u.match(/^https:\/\/torrentio\.strem\.fun\/([^/]*)\/$/);
    if (m) {
      const seg = m[1] ? `${m[1]}|language=latino` : "language=latino";
      u = `https://torrentio.strem.fun/${seg}/`;
    }
  }
  u = u.replace(/\|+/g, "|").replace(/\/\|/g, "/").replace(/\|\//g, "/");
  return u;
}

export function rankAndBadgeStreams<T extends StremioStreamItem>(streams: T[]): T[] {
  if (!Array.isArray(streams) || streams.length === 0) return [];

  const latinoCached: T[] = [];
  const originalCached: T[] = [];
  const latinoBuffer: T[] = [];
  const originalBuffer: T[] = [];
  const castellanoCached: T[] = [];
  const portugueseCached: T[] = [];
  const castellanoBuffer: T[] = [];
  const portugueseBuffer: T[] = [];

  for (const s of streams) {
    const cat = classifyStreamAudio(s);
    const isFast = isCachedOrInstantStream(s);

    if (cat === "latino") {
      if (isFast) latinoCached.push(s);
      else latinoBuffer.push(s);
    } else if (cat === "original") {
      if (isFast) originalCached.push(s);
      else originalBuffer.push(s);
    } else if (cat === "castellano") {
      if (isFast) castellanoCached.push(s);
      else castellanoBuffer.push(s);
    } else {
      if (isFast) portugueseCached.push(s);
      else portugueseBuffer.push(s);
    }
  }

  const badge = (s: T, cat: StreamAudioCategory, isFast: boolean): T => {
    const raw = (s.name || "Torrentio")
      .replace(/^\[(⚡ INSTANTÁNEO|⏳ REQUIERE BUFFER)\]\s*/g, "")
      .replace(/^\[(🌎 LATINO|🎧 ORIGINAL|🇪🇸 CASTELLANO|🇧🇷 PORTUGUÉS|⚠️ SOLO INGLÉS|🇪🇸 LATINO)\]\s*/g, "")
      .trim();

    const speedPrefix = isFast ? "[⚡ INSTANTÁNEO]" : "[⏳ REQUIERE BUFFER]";
    let langPrefix = "[🎧 ORIGINAL]";
    if (cat === "latino") langPrefix = "[🌎 LATINO]";
    else if (cat === "castellano") langPrefix = "[🇪🇸 CASTELLANO]";
    else if (cat === "portuguese") langPrefix = "[🇧🇷 PORTUGUÉS]";

    return {
      ...s,
      name: `${speedPrefix} ${langPrefix} ${raw}`,
    };
  };

  return [
    ...latinoCached.map((s) => badge(s, "latino", true)),
    ...originalCached.map((s) => badge(s, "original", true)),
    ...latinoBuffer.map((s) => badge(s, "latino", false)),
    ...originalBuffer.map((s) => badge(s, "original", false)),
    ...castellanoCached.map((s) => badge(s, "castellano", true)),
    ...portugueseCached.map((s) => badge(s, "portuguese", true)),
    ...castellanoBuffer.map((s) => badge(s, "castellano", false)),
    ...portugueseBuffer.map((s) => badge(s, "portuguese", false)),
  ];
}

export async function handleStreams(subPath: string, url: URL): Promise<Response> {
  if (subPath === "/manifest.json" || subPath === "/manifest" || subPath === "/" || subPath === "") {
    return jsonResponse(STREAMS_MANIFEST);
  }

  let configSegment = "";
  let type = "";
  let rawId = "";

  const directMatch = subPath.match(/^(?:\/stream)?\/(movie|series)\/(.+)\.json$/);
  if (directMatch) {
    type = directMatch[1];
    rawId = directMatch[2];
  } else {
    const configMatch = subPath.match(/^\/([^/]+)(?:\/stream)?\/(movie|series)\/(.+)\.json$/);
    if (configMatch && configMatch[1] !== "stream") {
      configSegment = configMatch[1];
      type = configMatch[2];
      rawId = configMatch[3];
    } else if (subPath.endsWith("/manifest.json")) {
      return jsonResponse(STREAMS_MANIFEST);
    }
  }

  if (!type || !rawId) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  const envTorrentio =
    (typeof Deno !== "undefined" && Deno.env?.get?.("TORRENTIO_URL")) ||
    (typeof process !== "undefined" && process.env?.TORRENTIO_URL) ||
    "https://torrentio.strem.fun/language=latino/";

  let upstreamBase = sanitizeTorrentioBase(url.searchParams.get("torrentio") || envTorrentio);
  if (configSegment) {
    let safeSegment = configSegment.replace(/[^a-zA-Z0-9_=,|%.-]/g, "");
    if (safeSegment.includes("language=spanish")) {
      safeSegment = safeSegment.replace(/language=spanish/g, "language=latino");
    } else if (!safeSegment.includes("language=")) {
      safeSegment = safeSegment ? `${safeSegment}|language=latino` : "language=latino";
    }
    upstreamBase = `https://torrentio.strem.fun/${safeSegment}/`;
  }

  let cleanId = decodeURIComponent(rawId).split("/")[0];
  if (cleanId.startsWith("tt13854128") || cleanId.startsWith("tt13000282")) {
    cleanId = cleanId.replace(/^tt(?:13854128|13000282)/, "tt14060708");
  }

  // Para "The Walk" / "En la cuerda floja", consultar en paralelo ambos alias:
  // tt3488710 (canónico internacional / TorBox cached) y tt3488720 (trackers hispanos DameTorrents/Cinecalidad)
  const isTheWalk = cleanId.startsWith("tt3488710") || cleanId.startsWith("tt3488720");
  const targetIds = isTheWalk ? ["tt3488710", "tt3488720"] : [cleanId];

  try {
    const responses = await Promise.allSettled(
      targetIds.map(async (tid) => {
        const targetUrl = `${upstreamBase}stream/${type}/${tid}.json`;
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(15000),
          headers: {
            "User-Agent": "MejoraStremio-SmartInterceptor/1.0",
            "Accept": "application/json",
          },
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.streams) ? (data.streams as StremioStreamItem[]) : [];
      })
    );

    const rawStreams: StremioStreamItem[] = [];
    const seen = new Set<string>();

    for (const r of responses) {
      if (r.status === "fulfilled") {
        for (const s of r.value) {
          const key = s.infoHash || s.url || `${s.title}-${s.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            rawStreams.push(s);
          }
        }
      }
    }

    const ranked = rankAndBadgeStreams(rawStreams);
    return jsonResponse({ streams: ranked });
  } catch (err) {
    console.error(`[streams] Error fetching upstream torrentio: ${(err as Error).message}`);
    return jsonResponse({ streams: [] });
  }
}
