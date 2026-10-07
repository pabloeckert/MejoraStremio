/**
 * mediathek.ts — Catálogo y streams directos de Mediathek DE (Tatort, Polizeiruf 110, SOKO Leipzig).
 * Reemplaza el Map en memoria por una caché LRU acotada (máximo 20 temas, TTL 30m).
 */

import { cors, jsonResponse, parseStremioSubId, b64u } from "../utils/common.ts";
import { BoundedLruCache } from "../utils/lru-cache.ts";
import { fetchCinemetaMeta } from "../utils/cinemeta.ts";

export const MVW_API = "https://mediathekviewweb.de/api/query";

export const MEDIATHEK_SHOWS: Record<string, { topic: string; minDur: number }> = {
  "tt0806910": { topic: "Tatort", minDur: 3300 },          // ~89 min
  "tt0806901": { topic: "Polizeiruf 110", minDur: 3300 },  // ~89 min
  "tt0274279": { topic: "SOKO Leipzig", minDur: 2400 },    // ~44 min
};

export const MEDIATHEK_MANIFEST = {
  id: "com.mejorastremio.mediathek",
  version: "1.1.0",
  name: "Mediathek DE (policiales)",
  description:
    "Streams directos de la Mediathek pública alemana (ARD/ZDF/SWR/WDR/NDR/MDR/RBB/BR…) para " +
    "Tatort, Polizeiruf 110 y SOKO Leipzig — audio alemán HD, sin torrents ni debrid. Cada " +
    "stream trae adjunto el subtítulo alemán oficial y una traducción IA al español latino.",
  resources: ["stream"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

export interface MvwFilm {
  channel: string;
  title: string;
  duration: number;
  urlHd: string;
  urlMp4: string;
  urlLow: string;
  urlSub: string;
  ts: number;
  normTitle: string;
}

export const MVW_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

export function normTitleKey(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bteil\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function showCaseTitle(episodeName: string, topic: string): string {
  let n = String(episodeName || "");
  if (/^episode\s+\d+$/i.test(n.trim())) return "";
  const dash = n.match(/^.*?-\s*\d+\s*-\s*(.+)$/);
  if (dash) n = dash[1];
  n = n.replace(new RegExp(`^${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:\\s-]+`, "i"), "")
    .replace(/\(.*?\)/g, "").trim();
  return n;
}

// Bounded LRU Cache: máximo 20 temas de antología alemana
const mvwCacheByTopic = new BoundedLruCache<string, { at: number; films: MvwFilm[] }>(20, MVW_CACHE_TTL_MS);

export async function loadMvwShow(topic: string, minDur: number): Promise<MvwFilm[]> {
  const cached = mvwCacheByTopic.get(topic);
  if (cached && Date.now() - cached.at < MVW_CACHE_TTL_MS) return cached.films;
  const films: MvwFilm[] = [];
  for (let offset = 0; offset < 2400; offset += 100) {
    const r = await fetch(MVW_API, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        queries: [{ fields: ["topic"], query: topic }],
        sortBy: "timestamp",
        sortOrder: "desc",
        future: false,
        offset,
        size: 100,
      }),
      signal: AbortSignal.timeout(15000),
    }).then((x) => x.json()).catch(() => null);

    // deno-lint-ignore no-explicit-any
    const res: any[] = r?.result?.results ?? [];
    for (const x of res) {
      if ((x.duration ?? 0) < minDur) continue;
      if (/Audiodeskription|H[oö]rfassung|klare Sprache|Geb[aä]rden/i.test(x.title)) continue;
      const hd = String(x.url_video_hd || "");
      const mp4 = String(x.url_video || "");
      if (/audio_description|sign_language|\.ad\.|_ad_/i.test(hd + mp4)) continue;
      films.push({
        channel: x.channel,
        title: x.title,
        duration: x.duration,
        urlHd: hd,
        urlMp4: mp4,
        urlLow: x.url_video_low || "",
        urlSub: x.url_subtitle || "",
        ts: x.timestamp || 0,
        normTitle: normTitleKey(String(x.title).replace(/\(.*?\)/g, "").replace(new RegExp(`^${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:\\s-]+`, "i"), "")),
      });
    }
    if (res.length < 100) break;
  }
  mvwCacheByTopic.set(topic, { at: Date.now(), films });
  return films;
}

export function matchMvwFilms(films: MvwFilm[], caseTitle: string): MvwFilm[] {
  const key = normTitleKey(caseTitle);
  if (key.length < 3) return [];
  const exact = films.filter((f) => f.normTitle === key);
  if (exact.length) return dedupeFilms(exact);
  const contains = films.filter(
    (f) =>
      (key.length >= 6 && f.normTitle.includes(key)) ||
      (f.normTitle.length >= 6 && key.includes(f.normTitle)),
  );
  return dedupeFilms(contains);
}

export function dedupeFilms(films: MvwFilm[]): MvwFilm[] {
  const best = new Map<string, MvwFilm>();
  for (const f of films) {
    const k = `${f.channel}|${f.normTitle}|${Math.round(f.duration / 30)}`;
    const cur = best.get(k);
    if (!cur || (!cur.urlHd && f.urlHd) || (!cur.urlSub && f.urlSub)) best.set(k, f);
  }
  return [...best.values()].sort((a, b) => (b.urlSub ? 1 : 0) - (a.urlSub ? 1 : 0) || b.ts - a.ts);
}

export async function handleMediathek(subPath: string, _mountBase: string, translateMount: string): Promise<Response> {
  if (subPath === "/manifest.json") return jsonResponse(MEDIATHEK_MANIFEST);

  const m = subPath.match(/^\/stream\/series\/(.+)\.json$/);
  if (!m) return new Response("Not found", { status: 404, headers: cors });

  const { imdbId, season: sNum, episode: eNum } = parseStremioSubId(m[1]);
  const sRaw = sNum != null ? String(sNum) : "";
  const eRaw = eNum != null ? String(eNum) : "";
  const show = MEDIATHEK_SHOWS[imdbId];
  if (!show || !sRaw || !eRaw) return jsonResponse({ streams: [] });

  try {
    const meta = await fetchCinemetaMeta("series", imdbId);
    const vid = (meta?.videos ?? []).find(
      // deno-lint-ignore no-explicit-any
      (v: any) => String(v.season) === sRaw && String(v.number) === eRaw,
    );
    const caseTitle = showCaseTitle(vid?.name ?? "", show.topic);
    if (!caseTitle) return jsonResponse({ streams: [] });

    const films = await loadMvwShow(show.topic, show.minDur);
    const matched = matchMvwFilms(films, caseTitle);

    const streams = matched.slice(0, 6).map((f) => {
      const video = f.urlHd || f.urlMp4 || f.urlLow;
      const quality = f.urlHd ? "1080p" : f.urlMp4 ? "720p" : "360p";
      const subs: { id: string; url: string; lang: string }[] = [];
      if (f.urlSub) {
        subs.push({ id: "de-oficial", url: f.urlSub, lang: "ger" });
        subs.push({
          id: "es-latino-ia-spl",
          url: `${translateMount}/x/${b64u.enc(f.urlSub)}.srt`,
          lang: "spl",
        });
        subs.push({
          id: "es-latino-ia-spa",
          url: `${translateMount}/x/${b64u.enc(f.urlSub)}.srt`,
          lang: "spa",
        });
      }
      return {
        name: `Mediathek DE\n${quality}`,
        title: `${f.channel} · ${caseTitle}\n🇩🇪 audio alemán${f.urlSub ? " · sub DE oficial + IA→ES latino" : ""} · ${Math.round(f.duration / 60)}min`,
        url: video,
        subtitles: subs,
        behaviorHints: { notWebReady: /\.m3u8($|\?)/.test(video), bingeGroup: `mediathek-${imdbId}` },
      };
    });

    return jsonResponse({ streams });
  } catch (e) {
    return jsonResponse({ streams: [], error: (e as Error).message }, { status: 500 });
  }
}
