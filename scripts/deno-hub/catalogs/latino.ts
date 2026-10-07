/**
 * latino.ts — Catálogo de Audio Latino (verificado) para contenido familiar e infantil.
 */

import { cors, jsonResponse } from "../utils/common.ts";
import { fetchCinemetaMeta } from "../utils/cinemeta.ts";

export const LATINO_LOG_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/anti-frustration-log.json";

export const LATINO_MANIFEST = {
  id: "com.mejorastremio.latino-catalog",
  version: "1.0.0",
  name: "Audio Latino (verificado)",
  description:
    "Catálogo de contenido familiar/infantil con audio latino confirmado " +
    "por scripts/anti-frustration.mjs — solo títulos con streams reales.",
  resources: ["catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    { type: "movie", id: "latino-movies", name: "Audio Latino (verificado)" },
    { type: "series", id: "latino-series", name: "Audio Latino (verificado)" },
  ],
};

// deno-lint-ignore no-explicit-any
export type LogEntry = any;

let latinoCache: { at: number; entries: LogEntry[] } | null = null;
export const LATINO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

export async function loadLatinoLog(): Promise<LogEntry[]> {
  if (latinoCache && Date.now() - latinoCache.at < LATINO_CACHE_TTL_MS) return latinoCache.entries;
  const r = await fetch(`${LATINO_LOG_URL}?_=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
  const entries = r.ok ? await r.json() : [];
  latinoCache = { at: Date.now(), entries };
  return entries;
}

export async function posterFor(id: string, type: string): Promise<string | null> {
  const meta = await fetchCinemetaMeta(type, id);
  return meta?.poster ?? null;
}

export async function handleLatino(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(LATINO_MANIFEST);
  }

  const catMatch = subPath.match(/^\/catalog\/(movie|series)\/latino-(movies|series)\.json$/);
  if (catMatch) {
    const [, type] = catMatch;
    const entries = await loadLatinoLog();
    const filtered = entries.filter((e: LogEntry) => e.type === type && e.isFamily && e.latino?.found);

    const metas = await Promise.all(
      filtered.map(async (e: LogEntry) => ({
        id: e.id,
        type: e.type,
        name: e.label || e.name,
        poster: await posterFor(e.id, e.type),
      })),
    );

    return jsonResponse({ metas });
  }

  return new Response("Not found", { status: 404, headers: cors });
}
