/**
 * translate.ts — Pipeline de Traducción IA (Gemini Flash) a Español Latinoamericano.
 * Fast-Window de 4s (primeras 70 cues) + persistencia por lotes en Deno KV y tareas en segundo plano.
 */

import {
  cors,
  jsonResponse,
  parseStremioSubId,
  decodeSubtitleText,
  releaseSimilarity,
  b64u,
  getKv,
} from "../utils/common.ts";
import {
  OPENSUBTITLES_API_KEY,
  OPENSUBTITLES_API,
  OPENSUBTITLES_UA,
} from "../subtitles/opensubtitles.ts";
import {
  detectFramerate,
  cleanSrt,
  pushDualSubtitles,
  type SubtitleTrackPayload,
} from "../subtitles/smartsync.ts";
import { isSoundOnly } from "../subtitles/sdh-detector.ts";
import { fetchCinemetaMeta } from "../utils/cinemeta.ts";
import {
  MEDIATHEK_SHOWS,
  loadMvwShow,
  matchMvwFilms,
  showCaseTitle,
} from "../catalogs/mediathek.ts";
import {
  fetchSubdlSubs,
  downloadSubdlSrt,
  SUBDL_KEY,
  extractSrtFromZip,
} from "../subtitles/subdl.ts";
import {
  fetchSubSourceSubs,
} from "../subtitles/subsource.ts";
import {
  GEMINI_API_KEY,
  NL,
  sleep,
  callGemini,
  buildTranslateSystemPrompt,
  cleanCueForTranslation,
} from "./gemini.ts";

export const TRANSLATE_MANIFEST = {
  id: "com.mejorastremio.translate",
  version: "1.2.0",
  name: "Traducción IA (Gemini Flash)",
  description:
    "Traducción automática al español latino (vía IA Gemini Flash) para series alemanas y contenido sin subtítulos en español.",
  resources: ["subtitles"],
  types: ["series", "movie"],
  idPrefixes: ["tt"],
  catalogs: [],
};

export const TRANSLATE_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const FAST_WINDOW_BUDGET_MS = 4000;
export const FAST_WINDOW_CUES = 70; // Fast-Window cinematográfica (<4s con thinkingBudget: 0)
export const TRANSLATE_BATCH = 100;
export const TRANSLATE_PARALLEL = 3;

export interface Cue {
  start: string;
  end: string;
  text: string;
}

export function parseEbuTt(xml: string): Cue[] {
  const cues: Cue[] = [];
  const re = /<(?:tt:)?p\b([^>]*)>([\s\S]*?)<\/(?:tt:)?p>/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(xml))) {
    const attrs = mm[1];
    const begin = /begin="([^"]+)"/.exec(attrs)?.[1];
    const end = /end="([^"]+)"/.exec(attrs)?.[1];
    if (!begin || !end) continue;
    const text = mm[2]
      .replace(/<(?:tt:)?br\s*\/?>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
      .replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n")
      .replace(/\n{2,}/g, "\n").trim();
    if (!text) continue;
    const s = normTtmlTime(begin), e = normTtmlTime(end);
    const last = cues[cues.length - 1];
    if (last && last.start === s && last.end === e) last.text += "\n" + text;
    else cues.push({ start: s, end: e, text });
  }
  return cues;
}

export function normTtmlTime(t: string): string {
  const mSec = t.match(/^(\d{2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (mSec) return `${mSec[1]}:${mSec[2]}:${mSec[3]},${mSec[4].padEnd(3, "0")}`;
  const mFr = t.match(/^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (mFr) {
    const ms = Math.round((parseInt(mFr[4], 10) / 25) * 1000);
    return `${mFr[1]}:${mFr[2]}:${mFr[3]},${String(ms).padStart(3, "0")}`;
  }
  return t.replace(".", ",");
}

export function parseSrt(srt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = srt.replace(/\r/g, "").split(/\n\n+/);
  for (const b of blocks) {
    const mt = b.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
    if (!mt) continue;
    const text = b.split("\n").slice(b.split("\n").findIndex((l) => l.includes("-->")) + 1).join("\n").trim();
    if (!text) continue;
    cues.push({ start: mt[1].replace(".", ","), end: mt[2].replace(".", ","), text });
  }
  return cues;
}

export function serializeSrt(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${c.start} --> ${c.end}\n${c.text}`)
    .join("\n\n") + "\n";
}

export const TRANSLATE_SYS = buildTranslateSystemPrompt();

export function parseNumbered(raw: string): Map<number, string> {
  const out = new Map<number, string>();
  const clean = raw.replace(/^```[a-z]*\s*/gim, "").replace(/```\s*$/gim, "");
  const re = /(?:^|\n)\s*(\d+)\s*(?:[▸\.:\-])\s*([\s\S]*?)(?=(?:\n\s*\d+\s*[▸\.:\-])|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out.set(parseInt(m[1], 10), m[2].trim());
  if (out.size === 0) {
    const classicRe = /(^|\n)\s*(\d+)\s*▸\s*([\s\S]*?)(?=\n\s*\d+\s*▸|\s*$)/g;
    while ((m = classicRe.exec(raw))) out.set(parseInt(m[2], 10), m[3].trim());
  }
  return out;
}

export async function translateBatch(
  items: { n: number; text: string }[],
  signal: AbortSignal,
  sysPrompt: string = TRANSLATE_SYS,
): Promise<{ map: Map<number, string>; ok: boolean }> {
  const payload = items.map((it) => `${it.n}▸ ${it.text.replace(/\n/g, NL)}`).join("\n");
  const prompt = `${sysPrompt}\n\n${payload}`;

  const merged = new Map<number, string>();
  for (let attempt = 0; attempt < 3 && merged.size < items.length; attempt++) {
    const todo = attempt === 0 ? items : items.filter((it) => !merged.has(it.n));
    if (!todo.length) break;
    const p = attempt === 0
      ? prompt
      : `${sysPrompt}\n\n${todo.map((it) => `${it.n}▸ ${it.text.replace(/\n/g, NL)}`).join("\n")}`;
    try {
      const parsed = parseNumbered(await callGemini(p, GEMINI_API_KEY, signal));
      for (const it of todo) {
        if (!merged.has(it.n) && parsed.has(it.n)) merged.set(it.n, parsed.get(it.n)!);
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (/429|503/.test(msg) && attempt < 2) await sleep(2000 + attempt * 2000);
      else if (attempt >= 2) console.log(`[translate] batch n0=${items[0]?.n} agotó reintentos: ${msg}`);
    }
  }

  const map = new Map<number, string>();
  for (const it of items) {
    const t = merged.get(it.n);
    map.set(it.n, t ? t.replace(new RegExp(NL, "g"), "\n") : it.text);
  }
  return { map, ok: merged.size >= Math.min(items.length, Math.max(1, Math.floor(items.length * 0.7))) };
}

export async function translateCues(
  cues: Cue[],
  cacheRef: string,
  kv: Deno.Kv | null,
  deadline: number,
  sysPrompt: string = TRANSLATE_SYS,
): Promise<{ texts: string[]; done: boolean; batch0Ok: boolean }> {
  const texts = cues.map((c) => cleanCueForTranslation(c.text));
  const dialogueIdx = cues.map((c, i) => (isSoundOnly(c.text) || !texts[i].trim() ? -1 : i)).filter((i) => i >= 0);

  const batches: number[][] = [];
  if (dialogueIdx.length <= FAST_WINDOW_CUES) {
    batches.push(dialogueIdx);
  } else {
    batches.push(dialogueIdx.slice(0, FAST_WINDOW_CUES));
    for (let i = FAST_WINDOW_CUES; i < dialogueIdx.length; i += TRANSLATE_BATCH) {
      batches.push(dialogueIdx.slice(i, i + TRANSLATE_BATCH));
    }
  }

  const pending = new Set(batches.map((_, i) => i));

  if (kv) {
    await Promise.all([...pending].map(async (bi) => {
      try {
        const hit = await kv.get<Record<string, string>>(["tr-batch", "v9", cacheRef, bi]);
        if (hit.value) {
          for (const idx of batches[bi]) texts[idx] = hit.value[idx] ?? texts[idx];
          pending.delete(bi);
        }
      } catch { /* queda pendiente */ }
    }));
  }

  if (pending.size === 0) {
    return { texts, done: true, batch0Ok: true };
  }

  // Fase 1: Fast Window síncrona
  if (pending.has(0)) {
    const remaining = Math.max(3800, deadline - Date.now());
    const batchIdxs = batches[0];
    const items = batchIdxs.map((idx) => ({ n: idx, text: texts[idx] }));
    const { map, ok } = await translateBatch(items, AbortSignal.timeout(remaining), sysPrompt);
    if (ok) {
      for (const idx of batchIdxs) texts[idx] = map.get(idx) ?? texts[idx];
      pending.delete(0);
      if (kv) {
        const obj: Record<string, string> = {};
        for (const idx of batchIdxs) obj[idx] = texts[idx];
        try { await kv.set(["tr-batch", "v9", cacheRef, 0], obj, { expireIn: TRANSLATE_CACHE_TTL_MS }); } catch { /* sin cache */ }
      }
    }
  }

  // Si queda tiempo dentro del presupuesto de 4s
  for (let bi = 1; bi < batches.length && pending.has(bi) && Date.now() < deadline - 800; bi++) {
    const remaining = Math.max(800, deadline - Date.now());
    const batchIdxs = batches[bi];
    const items = batchIdxs.map((idx) => ({ n: idx, text: texts[idx] }));
    const { map, ok } = await translateBatch(items, AbortSignal.timeout(remaining), sysPrompt);
    if (ok) {
      for (const idx of batchIdxs) texts[idx] = map.get(idx) ?? texts[idx];
      pending.delete(bi);
      if (kv) {
        const obj: Record<string, string> = {};
        for (const idx of batchIdxs) obj[idx] = texts[idx];
        try { await kv.set(["tr-batch", "v9", cacheRef, bi], obj, { expireIn: TRANSLATE_CACHE_TTL_MS }); } catch { /* sin cache */ }
      }
    }
  }

  const isDone = pending.size === 0;

  // Fase 2: Background Task
  if (!isDone && kv) {
    const bgPending = [...pending];
    const bgTask = async () => {
      try {
        for (let round = 0; round < 6 && bgPending.length > 0; round++) {
          const wave = bgPending.splice(0, TRANSLATE_PARALLEL);
          await Promise.all(wave.map(async (bi) => {
            const batchIdxs = batches[bi];
            const items = batchIdxs.map((idx) => ({ n: idx, text: texts[idx] }));
            const { map, ok } = await translateBatch(items, AbortSignal.timeout(18000), sysPrompt);
            if (ok) {
              for (const idx of batchIdxs) texts[idx] = map.get(idx) ?? texts[idx];
              if (kv) {
                const obj: Record<string, string> = {};
                for (const idx of batchIdxs) obj[idx] = texts[idx];
                try { await kv.set(["tr-batch", "v9", cacheRef, bi], obj, { expireIn: TRANSLATE_CACHE_TTL_MS }); } catch { /* sin cache */ }
              }
            }
          }));
        }
        const outCues = cues
          .map((c, i) => ({ ...c, text: texts[i] }))
          .filter((c) => !isSoundOnly(c.text) && c.text.trim().length > 0);
        let finalSrt = serializeSrt(outCues);
        finalSrt = cleanSrt(finalSrt);
        await kv.set(["translate-srt", "v9", cacheRef], finalSrt, { expireIn: TRANSLATE_CACHE_TTL_MS });
      } catch { /* background fallback */ }
    };

    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime && typeof runtime.waitUntil === "function") {
      runtime.waitUntil(bgTask());
    } else {
      bgTask().catch((err) => console.error(`[translate] Background task error: ${(err as Error).message}`));
    }
  }

  return { texts, done: isDone, batch0Ok: !pending.has(0) };
}

export function createSyntheticBaseCues(showTitle?: string): Cue[] {
  const name = showTitle && showTitle !== "Contenido Audiovisual" ? showTitle : "Contenido Audiovisual";
  return [
    {
      start: "00:00:02,000",
      end: "00:00:08,000",
      text: `⚡ Subtítulos Asistidos por IA (Gemini Flash)\n[${name}]`,
    },
    {
      start: "00:00:09,000",
      end: "00:00:16,000",
      text: "Canal Universal de Traducción Activo\nEspañol Latino Neutro (🌎 LATINO)",
    },
    {
      start: "00:00:18,000",
      end: "00:00:26,000",
      text: "Sincronizando flujo de reproducción...\nDisfrute del contenido en MejoraStremio.",
    },
  ];
}

export async function fetchBaseCues(src: {
  t: string;
  u?: string;
  f?: number;
  name?: string;
}): Promise<Cue[]> {
  if (src.t === "synthetic") {
    return createSyntheticBaseCues(src.name);
  }
  if (src.t === "ard" && src.u) {
    const r = await fetch(src.u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`base ARD ${r.status}`);
    return parseEbuTt(await r.text());
  }
  if (src.t === "os" && src.f) {
    const dl = await fetch(`${OPENSUBTITLES_API}/download`, {
      method: "POST",
      headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA, "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: src.f }),
      signal: AbortSignal.timeout(15000),
    }).then((x) => x.json());
    if (!dl?.link) throw new Error("base OS sin link");
    const r = await fetch(dl.link, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`base OS dl ${r.status}`);
    return parseSrt(decodeSubtitleText(new Uint8Array(await r.arrayBuffer())));
  }
  if (src.t === "subdl" && src.u) {
    const srt = await downloadSubdlSrt(src.u);
    if (!srt) throw new Error("base SubDL sin contenido srt");
    return parseSrt(srt);
  }
  if (src.t === "subsource" && src.u) {
    const r = await fetch(src.u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`base SubSource ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    const srt = isZip ? await extractSrtFromZip(buf) : decodeSubtitleText(buf);
    if (!srt) throw new Error("base SubSource sin contenido srt");
    return parseSrt(srt);
  }
  throw new Error("base desconocida");
}

const SDH_NAME_RE = /\b(sdh|hearing[\s._-]*impaired|for the deaf|\[cc\]|\bcc\b|forced\s*sdh)\b/i;

export async function hasViableSpanishSub(
  imdbId: string,
  season: number | null,
  episode: number | null,
  videoFilename?: string | null,
): Promise<{ viable: boolean; reason: string }> {
  if (!OPENSUBTITLES_API_KEY) return { viable: false, reason: "sin OPENSUBTITLES_API_KEY" };

  const p = new URLSearchParams({ languages: "ea", hearing_impaired: "exclude" });
  if (season != null && episode != null) {
    p.set("parent_imdb_id", imdbId.replace(/^tt0*/, ""));
    p.set("season_number", String(season));
    p.set("episode_number", String(episode));
  } else p.set("imdb_id", imdbId.replace(/^tt0*/, ""));

  const r = await fetch(`${OPENSUBTITLES_API}/subtitles?${p}`, {
    headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
    signal: AbortSignal.timeout(10000),
  }).then((x) => x.json()).catch(() => null);

  const data = Array.isArray(r?.data) ? r.data : [];
  if (!data.length) return { viable: false, reason: "cero subtítulos en español latino ('ea') en upstream" };

  // deno-lint-ignore no-explicit-any
  const cleanSubs = data.filter((d: any) => {
    const a = d?.attributes ?? {};
    if (a.hearing_impaired === true) return false;
    const hay = `${a.release ?? ""} ${a.files?.[0]?.file_name ?? ""}`;
    return !SDH_NAME_RE.test(hay);
  });

  if (!cleanSubs.length) return { viable: false, reason: "todos los subtítulos latinos son SDH" };

  if (videoFilename) {
    const videoFps = detectFramerate(videoFilename, imdbId);
    let hasFramerateAndReleaseMatch = false;

    for (const d of cleanSubs) {
      const a = (d as { attributes?: { release?: string; files?: Array<{ file_name?: string }> } })?.attributes ?? {};
      const subName = `${a.release ?? ""} ${a.files?.[0]?.file_name ?? ""}`;
      const subFps = detectFramerate(subName, imdbId);
      const sim = releaseSimilarity(videoFilename, subName);

      if (Math.abs(videoFps.fps - subFps.fps) < 0.05 && sim > 0.25) {
        hasFramerateAndReleaseMatch = true;
        break;
      }
    }

    if (!hasFramerateAndReleaseMatch) {
      return {
        viable: false,
        reason: `Discrepancia insalvable: Video es ${videoFps.tag} pero subtítulos ES son de framerate dispar o baja similitud`,
      };
    }
  }

  return { viable: true, reason: "cobertura ES latino adecuada" };
}

export interface BaseSubMatch {
  fileId: number;
  matchType: "hash" | "release" | "popular";
  releaseName: string;
}

export async function osBaseFileId(
  imdbId: string,
  season: number | null,
  episode: number | null,
  lang: string,
  videoFilename?: string | null,
  videoHash?: string | null,
  _videoSize?: number | null,
  showTitle?: string | null,
): Promise<BaseSubMatch | null> {
  if (!OPENSUBTITLES_API_KEY) return null;

  if (videoHash && videoHash !== "0000000000000000") {
    try {
      const hashParams = new URLSearchParams({ moviehash: videoHash, languages: lang });
      const hashRes = await fetch(`${OPENSUBTITLES_API}/subtitles?${hashParams}`, {
        headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
        signal: AbortSignal.timeout(8000),
      }).then((x) => x.json()).catch(() => null);

      const hashData = Array.isArray(hashRes?.data) ? hashRes.data : [];
      if (hashData.length > 0) {
        const best = hashData[0];
        const fid = best?.attributes?.files?.[0]?.file_id;
        const rel = best?.attributes?.release || best?.attributes?.files?.[0]?.file_name || "Hash Match";
        if (Number.isFinite(fid)) {
          return { fileId: fid, matchType: "hash", releaseName: rel };
        }
      }
    } catch { /* continuar a búsqueda por release */ }
  }

  const p = new URLSearchParams({ languages: lang, order_by: "download_count" });
  if (season != null && episode != null) {
    p.set("parent_imdb_id", imdbId.replace(/^tt0*/, ""));
    p.set("season_number", String(season));
    p.set("episode_number", String(episode));
  } else p.set("imdb_id", imdbId.replace(/^tt0*/, ""));

  const r = await fetch(`${OPENSUBTITLES_API}/subtitles?${p}`, {
    headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
    signal: AbortSignal.timeout(10000),
  }).then((x) => x.json()).catch(() => null);

  // deno-lint-ignore no-explicit-any
  let data: any[] = Array.isArray(r?.data) ? r.data : [];

  if (!data.length && showTitle) {
    const qp = new URLSearchParams({ languages: lang, query: showTitle, order_by: "download_count" });
    if (season != null && episode != null) {
      qp.set("season_number", String(season));
      qp.set("episode_number", String(episode));
    }
    const qr = await fetch(`${OPENSUBTITLES_API}/subtitles?${qp}`, {
      headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
      signal: AbortSignal.timeout(10000),
    }).then((x) => x.json()).catch(() => null);
    if (Array.isArray(qr?.data)) data = qr.data;
  }

  if (!data.length) return null;

  if (videoFilename) {
    let best: { fid: number; score: number; rel: string } | null = null;
    for (const d of data) {
      const a = d?.attributes ?? {};
      const fid = a?.files?.[0]?.file_id;
      if (!Number.isFinite(fid)) continue;
      const hay = `${a.release ?? ""} ${a.files?.[0]?.file_name ?? ""}`;
      const score = releaseSimilarity(videoFilename, hay);
      if (!best || score > best.score) best = { fid, score, rel: hay };
    }
    if (best && best.score > 0) {
      return { fileId: best.fid, matchType: "release", releaseName: best.rel };
    }
  }

  const first = data[0];
  const fid = first?.attributes?.files?.[0]?.file_id;
  const rel = first?.attributes?.release || first?.attributes?.files?.[0]?.file_name || "Top Downloaded";
  return Number.isFinite(fid) ? { fileId: fid, matchType: "popular", releaseName: rel } : null;
}

export async function handleTranslate(
  subPath: string,
  mountBase: string,
  reqUrl?: URL,
): Promise<Response> {
  if (subPath === "/manifest.json") return jsonResponse(TRANSLATE_MANIFEST);

  const listM = subPath.match(/^\/subtitles\/([^/]+)\/(.+)\.json$/);
  if (listM) {
    const [, mediaType, rawId] = listM;
    const { imdbId, season, episode, filename, videoHash, videoSize } = parseStremioSubId(rawId);
    let finalFilename = filename;
    let finalVideoHash = videoHash;
    let finalVideoSize = videoSize;
    if (!finalFilename && reqUrl) finalFilename = reqUrl.searchParams.get("filename") || null;
    if (!finalVideoHash && reqUrl) finalVideoHash = reqUrl.searchParams.get("videoHash") || null;
    if (!finalVideoSize && reqUrl) {
      const vs = reqUrl.searchParams.get("videoSize");
      if (vs) finalVideoSize = parseInt(vs, 10);
    }

    let showTitle = imdbId;
    try {
      const meta = await fetchCinemetaMeta(mediaType || "series", imdbId);
      if (meta?.name) showTitle = meta.name;
    } catch { /* fallback */ }

    const bases: { t: string; u?: string; f?: number; label: string; keyRef: string; matchType?: string; srcLang?: string }[] = [];

    try {
      // 1. ARD Mediathek (Series alemanas registradas)
      const mvwShow = MEDIATHEK_SHOWS[imdbId];
      if (mvwShow && season != null && episode != null) {
        try {
          const meta = await fetchCinemetaMeta("series", imdbId);
          // deno-lint-ignore no-explicit-any
          const vid = (meta?.videos ?? []).find((v: any) => v.season === season && v.number === episode);
          const ct = showCaseTitle(vid?.name ?? "", mvwShow.topic);
          if (ct) {
            const films = matchMvwFilms(await loadMvwShow(mvwShow.topic, mvwShow.minDur), ct).filter((f) => f.urlSub);
            if (films[0]) bases.push({ t: "ard", u: films[0].urlSub, label: "base DE oficial", keyRef: films[0].urlSub, matchType: "oficial", srcLang: "de" });
          }
        } catch { /* ignore */ }
      }

      // 2. OpenSubtitles (Base en inglés en prioridad)
      if (!bases.length) {
        try {
          const en = await osBaseFileId(imdbId, season, episode, "en", finalFilename, finalVideoHash, finalVideoSize, showTitle);
          if (en) {
            const badge = en.matchType === "hash" ? "🎯 100% Hash Match" : en.matchType === "release" ? "✨ Release Match" : "Base EN";
            bases.push({ t: "os", f: en.fileId, label: `${badge} (${en.releaseName})`, keyRef: `os-${en.fileId}`, matchType: en.matchType, srcLang: "en" });
          }
        } catch { /* ignore */ }
      }

      // 3. SubDL (Base en inglés en cascada)
      if (!bases.length && SUBDL_KEY) {
        try {
          const subdlSubs = await fetchSubdlSubs(imdbId, season, episode, "EN");
          if (subdlSubs.length > 0) {
            const bestSubdl = subdlSubs[0];
            bases.push({
              t: "subdl",
              u: bestSubdl.subdlPath,
              label: `SubDL EN (${bestSubdl.name})`,
              keyRef: `subdl-${encodeURIComponent(bestSubdl.subdlPath)}`,
              matchType: "release",
              srcLang: "en",
            });
          }
        } catch { /* ignore */ }
      }

      // 4. SubSource (Base en inglés en cascada)
      if (!bases.length) {
        try {
          const subsourceSubs = await fetchSubSourceSubs(imdbId, season, episode, "english");
          if (subsourceSubs.length > 0) {
            const bestSubsource = subsourceSubs[0];
            bases.push({
              t: "subsource",
              u: bestSubsource.downloadUrl,
              label: `SubSource EN (${bestSubsource.name})`,
              keyRef: `subsource-${encodeURIComponent(bestSubsource.downloadUrl).slice(0, 32)}`,
              matchType: "release",
              srcLang: "en",
            });
          }
        } catch { /* ignore */ }
      }

      // 5. OpenSubtitles en otros idiomas europeos (francés, alemán, italiano, portugués)
      if (!bases.length) {
        try {
          for (const lang of ["fr", "de", "it", "pt"]) {
            const match = await osBaseFileId(imdbId, season, episode, lang, finalFilename, finalVideoHash, finalVideoSize, showTitle);
            if (match) {
              const langBadge = lang.toUpperCase();
              const badge = match.matchType === "hash" ? `🎯 100% Hash Match (${langBadge})` : `Base ${langBadge}`;
              bases.push({ t: "os", f: match.fileId, label: `${badge} (${match.releaseName})`, keyRef: `os-${match.fileId}`, matchType: match.matchType, srcLang: lang });
              break;
            }
          }
        } catch { /* ignore */ }
      }
    } catch {
      // Ignorar para caer en fallback sintético universal
    }

    // 6. GARANTIZADOR UNIVERSAL DE ÚLTIMA INSTANCIA:
    // Si ningún proveedor primario/secundario tiene base, o ante cualquier error,
    // inyectar token sintético resiliente para asegurar que NUNCA devuelva array vacío.
    if (!bases.length) {
      bases.push({
        t: "synthetic",
        label: "IA Universal Fallback",
        keyRef: `syn-${imdbId}-${season ?? 0}-${episode ?? 0}`,
        matchType: "fallback",
        srcLang: "es",
      });
    }

    const subtitles: SubtitleTrackPayload[] = [];
    bases.slice(0, 2).forEach((b, i) => {
      const subData = {
        t: b.t,
        u: b.u,
        f: b.f,
        r: b.keyRef,
        name: showTitle,
        lang: b.srcLang || "en",
      };
      const mainLabel = "⚡ 1. Latino (IA Gemini) · [Traducción Automática]";
      const label = i === 0
        ? mainLabel
        : `🤖 ${i + 1}. Latino (IA Gemini) · [Traducción Automática]`;
      pushDualSubtitles(subtitles, {
        id: `ia-es-${i}`,
        url: `${mountBase}/gen/${b64u.enc(JSON.stringify(subData))}.srt`,
        label,
        name: label,
      }, true);
    });

    return jsonResponse({ subtitles });
  }

  const genM = subPath.match(/^\/gen\/([^/]+?)(?:\.srt)?$/);
  const xM = subPath.match(/^\/x\/([^/]+?)(?:\.srt)?$/);
  if (genM || xM) {
    let src: { t: string; u?: string; f?: number; r: string; name?: string; lang?: string };
    try {
      if (xM) {
        const u = b64u.dec(xM[1]);
        src = { t: "ard", u, r: u, name: "Mediathek DE", lang: "de" };
      } else {
        src = JSON.parse(b64u.dec(genM![1]));
      }
    } catch {
      return new Response("token inválido", { status: 400, headers: cors });
    }

    // Si es token sintético universal, entregar cues informativos instantáneamente (<5ms)
    if (src.t === "synthetic") {
      const synthCues = createSyntheticBaseCues(src.name);
      const srt = cleanSrt(serializeSrt(synthCues));
      return new Response(srt, {
        headers: {
          ...cors,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="es-latino.srt"',
          "X-Translate-FastWindow": "true",
          "X-Translate-Complete": "true",
          "X-Translate-Synthetic": "true",
        },
      });
    }

    const cacheKey = ["translate-srt", "v9", src.r];
    let kv: Deno.Kv | null = null;
    try {
      kv = await getKv();
      const hit = await kv.get<string>(cacheKey);
      if (hit.value) {
        return new Response(hit.value, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
      }
    } catch { kv = null; }

    try {
      let baseCues: Cue[] = [];
      try {
        baseCues = await fetchBaseCues(src);
      } catch (err) {
        console.warn(`[translate] Falló descarga de base (${src.t}): ${(err as Error).message}, usando fallback sintético`);
        baseCues = createSyntheticBaseCues(src.name);
      }

      if (!baseCues.length) {
        baseCues = createSyntheticBaseCues(src.name);
      }

      const sysPrompt = buildTranslateSystemPrompt(src.name || "Contenido Audiovisual", src.lang || "en");
      const { texts, done, batch0Ok } = await translateCues(baseCues, src.r, kv, Date.now() + FAST_WINDOW_BUDGET_MS, sysPrompt);
      if (!batch0Ok) {
        console.warn(`[translate] Batch 0 no pudo traducirse en el presupuesto de FastWindow (${src.r}), entregando fallback informativo`);
        const synthCues = createSyntheticBaseCues(src.name);
        const srt = cleanSrt(serializeSrt(synthCues));
        return new Response(srt, {
          headers: {
            ...cors,
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": 'attachment; filename="es-latino.srt"',
            "X-Translate-FastWindow": "true",
            "X-Translate-Complete": "false",
            "X-Translate-Pending": "true",
          },
        });
      }
      const outCues = baseCues
        .map((c, i) => ({ ...c, text: texts[i] }))
        .filter((c) => !isSoundOnly(c.text) && c.text.trim().length > 0);
      let srt = serializeSrt(outCues);
      srt = cleanSrt(srt);

      if (kv && done) {
        try { await kv.set(cacheKey, srt, { expireIn: TRANSLATE_CACHE_TTL_MS }); } catch { /* sin cache */ }
      }
      return new Response(srt, {
        headers: {
          ...cors,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="es-latino.srt"',
          "X-Translate-FastWindow": "true",
          "X-Translate-Complete": String(done),
        },
      });
    } catch (e) {
      console.warn(`[translate] Error en pipeline generativo: ${(e as Error).message}, entregando fallback sintético`);
      const synthCues = createSyntheticBaseCues(src.name);
      const srt = cleanSrt(serializeSrt(synthCues));
      return new Response(srt, {
        headers: {
          ...cors,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="es-latino.srt"',
          "X-Translate-Fallback": "true",
          "X-Translate-Error": (e as Error).message.slice(0, 80),
        },
      });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}
