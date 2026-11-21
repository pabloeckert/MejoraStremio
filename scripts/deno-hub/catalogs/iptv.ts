/**
 * iptv.ts — Canales en vivo de IPTV y LiveTV de combate (fuente iptv-org).
 */

import { cors, jsonResponse } from "../utils/common.ts";

export const IPTV_STREAMS_URL = "https://iptv-org.github.io/api/streams.json";
export const IPTV_LOGOS_URL = "https://iptv-org.github.io/api/logos.json";

export const LIVETV_MANIFEST = {
  id: "com.mejorastremio.livetv",
  version: "1.2.0",
  name: "TV en Vivo",
  description:
    "Catálogo curado de canales en vivo de UFC, MMA, Boxeo y deportes de combate " +
    "(ESPN Latinoamérica, Fox Sports AR, TyC Sports, Fight Network, Bellator, PFL, Glory y más), " +
    "fuente iptv-org con sondeo multi-señal en tiempo real. Perfil fan de UFC.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["iptv-"],
  catalogs: [{ type: "tv", id: "livetv-combate", name: "TV en Vivo — UFC / MMA / Combate" }],
};

export type LivetvCatalogId = "livetv-combate";

export const LIVETV_CHANNELS: { id: string; catalog: LivetvCatalogId; name: string }[] = [
  { id: "ESPNLatinAmerica.us", catalog: "livetv-combate", name: "ESPN Latinoamérica (UFC / Combate)" },
  { id: "ESPN2LatinAmerica.us", catalog: "livetv-combate", name: "ESPN 2 Latinoamérica (UFC / Boxeo)" },
  { id: "FoxSports.ar", catalog: "livetv-combate", name: "Fox Sports Argentina (UFC / Combate)" },
  { id: "ESPNPremium.ar", catalog: "livetv-combate", name: "ESPN Premium Argentina" },
  { id: "TyCSports.ar", catalog: "livetv-combate", name: "TyC Sports (Boxeo / Deportes AR)" },
  { id: "ESPN.us", catalog: "livetv-combate", name: "ESPN USA (UFC Live)" },
  { id: "ESPN2.us", catalog: "livetv-combate", name: "ESPN 2 USA" },
  { id: "FoxSports1.us", catalog: "livetv-combate", name: "Fox Sports 1 USA" },
  { id: "FightNetwork.ca", catalog: "livetv-combate", name: "Fight Network (MMA / Combate 24/7)" },
  { id: "BellatorMMA.us", catalog: "livetv-combate", name: "Bellator MMA" },
  { id: "PFLMMA.us", catalog: "livetv-combate", name: "PFL MMA" },
  { id: "GloryKickboxing.us", catalog: "livetv-combate", name: "Glory Kickboxing" },
  { id: "MMATVcom.ru", catalog: "livetv-combate", name: "MMA-TV.com (MMA 24/7)" },
  { id: "FightBox.nl", catalog: "livetv-combate", name: "FightBox (MMA / Kickboxing)" },
  { id: "HardKnocksFightingChampionship.pl", catalog: "livetv-combate", name: "Hard Knocks Fighting (MMA)" },
  { id: "TNAWrestlingChannel.pl", catalog: "livetv-combate", name: "TNA Wrestling" },
  { id: "ESPN.br", catalog: "livetv-combate", name: "ESPN Brasil" },
];

// deno-lint-ignore no-explicit-any
export type IptvStream = any;

let livetvCache: { at: number; streams: Map<string, IptvStream[]>; logos: Map<string, string> } | null = null;
export const LIVETV_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

export async function loadLivetvData() {
  if (livetvCache && Date.now() - livetvCache.at < LIVETV_CACHE_TTL_MS) return livetvCache;
  const [stRes, logoRes] = await Promise.all([
    fetch(IPTV_STREAMS_URL, { signal: AbortSignal.timeout(15000) }),
    fetch(IPTV_LOGOS_URL, { signal: AbortSignal.timeout(15000) }),
  ]);
  const streamsArr: IptvStream[] = stRes.ok ? await stRes.json() : [];
  const logosArr: IptvStream[] = logoRes.ok ? await logoRes.json() : [];
  const streams = new Map<string, IptvStream[]>();
  for (const s of streamsArr) {
    if (!s.channel || !s.url) continue;
    const list = streams.get(s.channel);
    if (list) list.push(s);
    else streams.set(s.channel, [s]);
  }
  const logos = new Map<string, string>();
  for (const l of logosArr) if (l.channel && l.in_use && l.url && !logos.has(l.channel)) logos.set(l.channel, l.url);
  for (const l of logosArr) if (l.channel && l.url && !logos.has(l.channel)) logos.set(l.channel, l.url);
  livetvCache = { at: Date.now(), streams, logos };
  return livetvCache;
}

function parseQualityScore(q: unknown): number {
  const m = String(q || "").match(/(\d{3,4})/);
  return m ? parseInt(m[1], 10) : 0;
}

function buildLivetvHeaders(s: IptvStream): Record<string, string> {
  const headers: Record<string, string> = {};
  if (s.user_agent) headers["User-Agent"] = s.user_agent;
  if (s.referrer) headers["Referer"] = s.referrer;
  return headers;
}

async function probeLivetvStream(s: IptvStream): Promise<boolean> {
  try {
    const headers = buildLivetvHeaders(s);
    const r = await fetch(s.url, { method: "GET", headers, signal: AbortSignal.timeout(3500) });
    if (!r.ok) {
      await r.body?.cancel();
      return false;
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (/mpegurl|vnd\.apple|video\//i.test(ct) && !ct.includes("mpegurl")) {
      await r.body?.cancel();
      return true;
    }
    const reader = r.body?.getReader();
    if (!reader) return /mpegurl|video/i.test(ct);
    const { value } = await reader.read();
    await reader.cancel().catch(() => {});
    const head = value ? new TextDecoder().decode(value.slice(0, 256)) : "";
    return head.includes("#EXTM3U") || /mpegurl|video/i.test(ct);
  } catch {
    return false;
  }
}

export async function handleLivetv(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json" || subPath === "/" || subPath === "") {
    return jsonResponse(LIVETV_MANIFEST);
  }

  const catMatch = subPath.match(/^\/catalog\/tv\/(livetv-combate)(?:\/.+)?\.json$/);
  if (catMatch) {
    const catalogId = catMatch[1] as LivetvCatalogId;
    const { logos } = await loadLivetvData();
    const metas = LIVETV_CHANNELS.filter((c) => c.catalog === catalogId).map((c) => {
      const logo = logos.get(c.id) ?? undefined;
      return {
        id: `iptv-${c.id}`,
        type: "tv",
        name: c.name,
        poster: logo ?? null,
        posterShape: "square",
        logo,
      };
    });
    return jsonResponse({ metas });
  }

  const metaMatch = subPath.match(/^\/meta\/tv\/iptv-(.+)\.json$/);
  if (metaMatch) {
    const chId = decodeURIComponent(metaMatch[1]);
    const ch = LIVETV_CHANNELS.find((c) => c.id === chId);
    if (!ch) return new Response("Not found", { status: 404, headers: cors });
    const { logos } = await loadLivetvData();
    const logo = logos.get(ch.id) ?? undefined;
    return jsonResponse({
      meta: {
        id: `iptv-${ch.id}`,
        type: "tv",
        name: ch.name,
        poster: logo ?? null,
        posterShape: "square",
        logo,
        description: `Canal deportivo / combate en vivo · ${ch.name}`,
      },
    });
  }

  const streamMatch = subPath.match(/^\/stream\/tv\/iptv-(.+)\.json$/);
  if (streamMatch) {
    const chId = decodeURIComponent(streamMatch[1]);
    const ch = LIVETV_CHANNELS.find((c) => c.id === chId);
    if (!ch) return new Response("Not found", { status: 404, headers: cors });
    const { streams } = await loadLivetvData();
    const rawCandidates = streams.get(ch.id) || [];
    if (rawCandidates.length === 0) return jsonResponse({ streams: [] });

    // Deduplicar por URL antes de sondear
    const uniqueCandidates: IptvStream[] = [];
    const seenUrls = new Set<string>();
    for (const c of rawCandidates) {
      if (c?.url && !seenUrls.has(c.url)) {
        seenUrls.add(c.url);
        uniqueCandidates.push(c);
      }
    }

    const toProbe = uniqueCandidates.slice(0, 5);
    const probeResults = await Promise.all(toProbe.map((s) => probeLivetvStream(s)));
    const alive = toProbe.filter((_, idx) => probeResults[idx]);

    const sortSignals = (arr: IptvStream[]) =>
      [...arr].sort((a, b) => {
        const qDiff = parseQualityScore(b.quality) - parseQualityScore(a.quality);
        if (qDiff !== 0) return qDiff;
        const aHttps = String(a.url).startsWith("https://") ? 1 : 0;
        const bHttps = String(b.url).startsWith("https://") ? 1 : 0;
        return bHttps - aHttps;
      });

    const formatStream = (s: IptvStream, label: string) => {
      const headers = buildLivetvHeaders(s);
      // deno-lint-ignore no-explicit-any
      const stream: any = {
        url: s.url,
        title: `${ch.name} · ${label}${s.quality ? " · " + s.quality : ""}`,
        behaviorHints: { notWebReady: true },
      };
      if (Object.keys(headers).length) {
        stream.behaviorHints.proxyHeaders = { request: headers };
      }
      return stream;
    };

    if (alive.length > 0) {
      const selected = sortSignals(alive).slice(0, 3);
      return jsonResponse({
        streams: selected.map((s, i) => formatStream(s, `Señal ${i + 1} (en vivo)`)),
      });
    }

    // Fallback si todos fallan desde la IP Edge (posible geo-bloqueo al worker, pero válido en casa del usuario)
    const fallback = sortSignals(uniqueCandidates).slice(0, 3);
    return jsonResponse({
      streams: fallback.map((s, i) => formatStream(s, `Señal ${i + 1} (Señal alternativa)`)),
    });
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
