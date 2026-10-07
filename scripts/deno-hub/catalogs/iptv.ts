/**
 * iptv.ts — Canales en vivo de IPTV y LiveTV de combate (fuente iptv-org).
 */

import { cors, jsonResponse } from "../utils/common.ts";

export const IPTV_STREAMS_URL = "https://iptv-org.github.io/api/streams.json";
export const IPTV_LOGOS_URL = "https://iptv-org.github.io/api/logos.json";

export const LIVETV_MANIFEST = {
  id: "com.mejorastremio.livetv",
  version: "1.1.0",
  name: "TV en Vivo",
  description:
    "Catálogo curado de canales en vivo de UFC/MMA/combate y wrestling, fuente iptv-org, cada " +
    "canal verificado con un fetch real antes de sumarlo. Perfil fan de UFC.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["iptv-"],
  catalogs: [{ type: "tv", id: "livetv-combate", name: "TV en Vivo — UFC / MMA / Combate" }],
};

export type LivetvCatalogId = "livetv-combate";

export const LIVETV_CHANNELS: { id: string; catalog: LivetvCatalogId; name: string }[] = [
  { id: "BellatorMMA.us", catalog: "livetv-combate", name: "Bellator MMA" },
  { id: "PFLMMA.us", catalog: "livetv-combate", name: "PFL MMA" },
  { id: "Combate.br", catalog: "livetv-combate", name: "Combate (Grupo Globo, BR)" },
  { id: "ESPN.br", catalog: "livetv-combate", name: "ESPN" },
  { id: "ESPNDeportes.us", catalog: "livetv-combate", name: "ESPN Deportes" },
  { id: "ESPN8TheOcho.us", catalog: "livetv-combate", name: "ESPN8: The Ocho" },
  { id: "MMATV.us", catalog: "livetv-combate", name: "MMA TV" },
  { id: "GloryKickboxing.us", catalog: "livetv-combate", name: "Glory Kickboxing" },
];

// deno-lint-ignore no-explicit-any
export type IptvStream = any;

let livetvCache: { at: number; streams: Map<string, IptvStream>; logos: Map<string, string> } | null = null;
export const LIVETV_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

export async function loadLivetvData() {
  if (livetvCache && Date.now() - livetvCache.at < LIVETV_CACHE_TTL_MS) return livetvCache;
  const [stRes, logoRes] = await Promise.all([
    fetch(IPTV_STREAMS_URL, { signal: AbortSignal.timeout(15000) }),
    fetch(IPTV_LOGOS_URL, { signal: AbortSignal.timeout(15000) }),
  ]);
  const streamsArr: IptvStream[] = stRes.ok ? await stRes.json() : [];
  const logosArr: IptvStream[] = logoRes.ok ? await logoRes.json() : [];
  const streams = new Map<string, IptvStream>();
  for (const s of streamsArr) if (s.channel && !streams.has(s.channel)) streams.set(s.channel, s);
  const logos = new Map<string, string>();
  for (const l of logosArr) if (l.channel && l.in_use && !logos.has(l.channel)) logos.set(l.channel, l.url);
  livetvCache = { at: Date.now(), streams, logos };
  return livetvCache;
}

export async function handleLivetv(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(LIVETV_MANIFEST);
  }

  const catMatch = subPath.match(/^\/catalog\/tv\/(livetv-combate)\.json$/);
  if (catMatch) {
    const catalogId = catMatch[1] as LivetvCatalogId;
    const { logos } = await loadLivetvData();
    const metas = LIVETV_CHANNELS.filter((c) => c.catalog === catalogId).map((c) => ({
      id: `iptv-${c.id}`,
      type: "tv",
      name: c.name,
      poster: logos.get(c.id) ?? null,
    }));
    return jsonResponse({ metas });
  }

  const metaMatch = subPath.match(/^\/meta\/tv\/iptv-(.+)\.json$/);
  if (metaMatch) {
    const ch = LIVETV_CHANNELS.find((c) => c.id === metaMatch[1]);
    if (!ch) return new Response("Not found", { status: 404, headers: cors });
    const { logos } = await loadLivetvData();
    return jsonResponse({
      meta: { id: `iptv-${ch.id}`, type: "tv", name: ch.name, poster: logos.get(ch.id) ?? null },
    });
  }

  const streamMatch = subPath.match(/^\/stream\/tv\/iptv-(.+)\.json$/);
  if (streamMatch) {
    const ch = LIVETV_CHANNELS.find((c) => c.id === streamMatch[1]);
    if (!ch) return new Response("Not found", { status: 404, headers: cors });
    const { streams } = await loadLivetvData();
    const s = streams.get(ch.id);
    if (!s) return jsonResponse({ streams: [] });
    const headers: Record<string, string> = {};
    if (s.user_agent) headers["User-Agent"] = s.user_agent;
    if (s.referrer) headers["Referer"] = s.referrer;
    // deno-lint-ignore no-explicit-any
    const stream: any = { url: s.url, title: `${ch.name} (en vivo)${s.quality ? " · " + s.quality : ""}` };
    if (Object.keys(headers).length) {
      stream.behaviorHints = { notWebReady: false, proxyHeaders: { request: headers } };
    }
    return jsonResponse({ streams: [stream] });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

export const IPTV_CHANNELS_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/iptv-channels.json";
export const IPTV_CATALOG_IDS = ["iptv-ar", "iptv-es", "iptv-latam", "iptv-intl"] as const;
export const IPTV_CATALOG_NAMES: Record<string, string> = {
  "iptv-ar": "TV en Vivo — Argentina",
  "iptv-es": "TV en Vivo — España",
  "iptv-latam": "TV en Vivo — Latinoamérica",
  "iptv-intl": "TV en Vivo — Internacional",
};
export const IPTV_GENRES = [
  "Noticias", "Películas", "Series", "Documentales", "Cultura",
  "Infantil", "Música", "Entretenimiento", "General",
];

export interface IptvChannel {
  id: string;
  name: string;
  catalog: string;
  country: string;
  genre: string;
  logo: string | null;
  url: string;
  quality: string | null;
  userAgent: string | null;
  referrer: string | null;
}

export const IPTV_MANIFEST = {
  id: "com.mejorastremio.iptv",
  version: "1.0.0",
  name: "TV en Vivo (IPTV)",
  description:
    "Canales de TV en vivo — Argentina, España, Latinoamérica (castellano) e Internacional " +
    "(idioma original). Fuente iptv-org (señales públicas legítimas); cada canal verificado " +
    "en vivo antes de listarlo. Filtrable por género.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["mshub-iptv-"],
  catalogs: IPTV_CATALOG_IDS.map((id) => ({
    type: "tv",
    id,
    name: IPTV_CATALOG_NAMES[id],
    extra: [
      { name: "genre", options: ["Todos", ...IPTV_GENRES], isRequired: false },
      { name: "skip", isRequired: false },
    ],
  })),
};

let iptvCache: { at: number; channels: IptvChannel[] } | null = null;
export const IPTV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function loadIptvChannels(): Promise<IptvChannel[]> {
  if (iptvCache && Date.now() - iptvCache.at < IPTV_CACHE_TTL_MS) return iptvCache.channels;
  try {
    const r = await fetch(IPTV_CHANNELS_URL, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`iptv-channels.json → ${r.status}`);
    const j = await r.json();
    const channels: IptvChannel[] = Array.isArray(j?.channels) ? j.channels : [];
    iptvCache = { at: Date.now(), channels };
    return channels;
  } catch (e) {
    if (iptvCache) return iptvCache.channels;
    throw e;
  }
}

export async function handleIptv(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") return jsonResponse(IPTV_MANIFEST);

  const catM = subPath.match(/^\/catalog\/tv\/(iptv-[a-z]+)(?:\/(.+?))?\.json$/);
  if (catM) {
    const [, catalogId, extraStr] = catM;
    if (!IPTV_CATALOG_IDS.includes(catalogId as typeof IPTV_CATALOG_IDS[number])) {
      return jsonResponse({ metas: [] });
    }
    const extra = new URLSearchParams(extraStr ?? "");
    const genre = extra.get("genre");
    const skip = parseInt(extra.get("skip") ?? "0", 10) || 0;
    const all = await loadIptvChannels();
    let list = all.filter((c) => c.catalog === catalogId);
    if (genre && genre !== "Todos") list = list.filter((c) => c.genre === genre);
    const metas = list.slice(skip, skip + 100).map((c) => ({
      id: `mshub-iptv-${c.id}`,
      type: "tv",
      name: c.name,
      poster: c.logo,
      posterShape: "square",
      logo: c.logo ?? undefined,
      genres: [c.genre],
    }));
    return jsonResponse({ metas });
  }

  const metaM = subPath.match(/^\/meta\/tv\/(.+)\.json$/);
  if (metaM) {
    const chId = decodeURIComponent(metaM[1]).replace(/^mshub-iptv-/, "");
    const ch = (await loadIptvChannels()).find((c) => c.id === chId);
    if (!ch) return new Response("Not found", { status: 404, headers: cors });
    return jsonResponse({
      meta: {
        id: `mshub-iptv-${ch.id}`,
        type: "tv",
        name: ch.name,
        poster: ch.logo,
        posterShape: "square",
        logo: ch.logo ?? undefined,
        background: ch.logo ?? undefined,
        genres: [ch.genre],
        description: `Canal en vivo · ${ch.genre}${ch.quality ? " · " + ch.quality : ""}`,
      },
    });
  }

  const streamM = subPath.match(/^\/stream\/tv\/(.+)\.json$/);
  if (streamM) {
    const chId = decodeURIComponent(streamM[1]).replace(/^mshub-iptv-/, "");
    const ch = (await loadIptvChannels()).find((c) => c.id === chId);
    if (!ch) return jsonResponse({ streams: [] });
    const reqHeaders: Record<string, string> = {};
    if (ch.userAgent) reqHeaders["User-Agent"] = ch.userAgent;
    if (ch.referrer) reqHeaders["Referer"] = ch.referrer;
    // deno-lint-ignore no-explicit-any
    const stream: any = {
      url: ch.url,
      title: `${ch.name} · EN VIVO${ch.quality ? " · " + ch.quality : ""}`,
      behaviorHints: { notWebReady: true },
    };
    if (Object.keys(reqHeaders).length) {
      stream.behaviorHints.proxyHeaders = { request: reqHeaders };
    }
    return jsonResponse({ streams: [stream] });
  }

  return new Response("Not found", { status: 404, headers: cors });
}
