/**
 * deno-latino-catalog-addon.ts — Catálogo Stremio de contenido familiar/infantil
 * con audio latino confirmado, servido desde data/anti-frustration-log.json.
 *
 * Cada entrada del log con `isFamily=true` y `latino.found=true` aparece acá.
 * El log se lee en vivo desde GitHub (raw), así que se actualiza solo cada vez
 * que scripts/anti-frustration.mjs agrega o revisa un título — no hace falta
 * redeployar este addon para que aparezcan títulos nuevos.
 *
 * Deploy: deno.com/deploy → conectar repo pabloeckert/MejoraStremio →
 *   entry point: scripts/deno-latino-catalog-addon.ts
 *   sin env vars.
 *
 * Una vez deployado, instalar en Stremio:
 *   https://<proyecto>.deno.dev/manifest.json
 *
 * Requiere: Deno Deploy (gratis, sin tarjeta). No requiere node ni npm.
 */

const LOG_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/anti-frustration-log.json";
const CINEMETA = "https://v3-cinemeta.strem.io";

const MANIFEST = {
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
type LogEntry = any;

let cache: { at: number; entries: LogEntry[] } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

async function loadLog(): Promise<LogEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.entries;
  const r = await fetch(`${LOG_URL}?_=${Date.now()}`, {
    signal: AbortSignal.timeout(15000),
  });
  const entries = r.ok ? await r.json() : [];
  cache = { at: Date.now(), entries };
  return entries;
}

async function posterFor(id: string, type: string): Promise<string | null> {
  try {
    const r = await fetch(`${CINEMETA}/meta/${type}/${id}.json`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.meta?.poster ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const path = new URL(req.url).pathname;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
  };

  if (path === "/manifest.json") {
    return new Response(JSON.stringify(MANIFEST), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const catMatch = path.match(/^\/catalog\/(movie|series)\/latino-(movies|series)\.json$/);
  if (catMatch) {
    const [, type] = catMatch;
    const entries = await loadLog();
    const filtered = entries.filter(
      (e: LogEntry) => e.type === type && e.isFamily && e.latino?.found,
    );

    const metas = await Promise.all(
      filtered.map(async (e: LogEntry) => ({
        id: e.id,
        type: e.type,
        name: e.label || e.name,
        poster: await posterFor(e.id, e.type),
      })),
    );

    return new Response(JSON.stringify({ metas }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response("Not found", { status: 404, headers: cors });
});
