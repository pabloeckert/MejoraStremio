/**
 * deno-hub.ts — Hub único de Deno Deploy que consolida las 3 apps que antes
 * vivían separadas (mejorastremio, mejorastremio-latino) más el enriquecedor
 * de sinopsis que nunca se había deployado. Un solo Deno.serve que despacha
 * por prefijo de ruta a la lógica de cada uno — la lógica de negocio de cada
 * addon es la misma que en su script original (deno-subdl-addon.ts,
 * deno-latino-catalog-addon.ts, deno-synopsis-enricher.ts), solo cambia el
 * envoltorio de routing.
 *
 * Rutas:
 *   /subdl/manifest.json      → SubDL ES (sin SDH), subtítulos
 *   /opensubtitles/manifest.json → OpenSubtitles ES (sin SDH), subtítulos (API moderna,
 *                                catálogo grande, filtro real de hearing_impaired — ver
 *                                CLAUDE.md "Sesión 2026-08-16")
 *   /latino/manifest.json     → Audio Latino (verificado), catálogo
 *   /synopsis/manifest.json   → MejoraStremio Synopsis IA, proxy de meta
 *   /miniseries/manifest.json → Miniseries (1 temporada, ≤10 episodios, finalizada), catálogo
 *   /discover/manifest.json   → Descubrir Maestro (Paso B) — servicio+región+país+idioma+género
 *                                combinables en una sola pantalla, catálogo
 *   /ufc/manifest.json        → MMA / UFC (curado) — catálogo fijo para perfil fan de UFC
 *                                (cuenta stremiojn, ver cuentas/stremiojn/CLAUDE.md), catálogo
 *   /livetv/manifest.json     → TV en Vivo — canales de combate/deportes + noticias AR (cuenta
 *                                stremiojn), fuente iptv-org (streams resueltos en vivo, cache 10
 *                                min — la URL es volátil, no se hardcodea), catálogo+meta+stream
 *   /health                   → estado de las 7 sub-funciones (config presente)
 *
 * Deploy: deno.com/deploy → conectar repo pabloeckert/MejoraStremio →
 *   entry point: scripts/deno-hub.ts
 *   env vars (Secret): SUBDL_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, TMDB_API_KEY_AISEARCH
 *   opcionales: GEMINI_MODEL, OPENROUTER_MODEL
 *
 * Instalar en Stremio (por función):
 *   https://<proyecto>.deno.dev/subdl/manifest.json
 *   https://<proyecto>.deno.dev/latino/manifest.json
 *   https://<proyecto>.deno.dev/synopsis/manifest.json
 *   https://<proyecto>.deno.dev/miniseries/manifest.json
 *
 * Los 3 `manifest.id` se mantienen idénticos a los de los scripts originales
 * (com.mejorastremio.subdl / com.mejorastremio.latino-catalog /
 * com.mejorastremio.synopsis-proxy) — así, al migrar los addons ya instalados,
 * update-addon-url.mjs solo cambia el transportUrl, sin duplicar la entrada.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...cors, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

// ════════════════════════════════════════════════════════════════════════
// ── /subdl — SubDL ES (sin SDH), subtítulos ───────────────────────────────
// Lógica idéntica a deno-subdl-addon.ts.
// ════════════════════════════════════════════════════════════════════════

const SUBDL_KEY = Deno.env.get("SUBDL_KEY") ?? "";
const SUBDL_API = "https://api.subdl.com/api/v1/subtitles";
const SUBDL_DL = "https://dl.subdl.com";

const SUBDL_MANIFEST = {
  id: "com.mejorastremio.subdl",
  version: "1.0.0",
  name: "SubDL ES (sin SDH)",
  description:
    "Subtítulos en español de SubDL. Filtra hearing-impaired (SDH) automáticamente.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

async function extractSrtFromZip(buf: Uint8Array): Promise<string | null> {
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
            return new TextDecoder("utf-8").decode(data);
          }
          const ds = new DecompressionStream("deflate-raw");
          const writer = ds.writable.getWriter();
          await writer.write(new Uint8Array(data));
          await writer.close();
          const chunks: Uint8Array[] = [];
          const reader = ds.readable.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const result = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { result.set(c, off); off += c.length; }
          return new TextDecoder("utf-8").decode(result);
        } catch { /* intentar siguiente entrada */ }
      }
      i = dataStart + (cSize || 1);
    } else {
      i++;
    }
  }
  return null;
}

interface SubdlSub { name: string; subdlPath: string }

async function fetchSubdlSubs(
  imdbId: string,
  season: number | null,
  episode: number | null,
): Promise<SubdlSub[]> {
  let url =
    `${SUBDL_API}?api_key=${SUBDL_KEY}&imdb_id=${imdbId}&languages=ES&subs_per_page=20`;
  if (season != null) url += `&season=${season}`;
  if (episode != null) url += `&episode=${episode}`;

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

// subPath: la ruta sin el prefijo /subdl (ej "/manifest.json", "/srt/xxx").
// mountBase: origin + "/subdl" — para que los links generados (srt) vuelvan a
// pasar por el router del hub.
async function handleSubdl(subPath: string, mountBase: string): Promise<Response> {
  if (!SUBDL_KEY) {
    return new Response(
      "SUBDL_KEY no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(SUBDL_MANIFEST);
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, type, rawId] = subMatch;
    const parts = rawId.split(":");
    const imdbId = parts[0];
    const season = type === "series" && parts[1] ? parseInt(parts[1], 10) : null;
    const episode = type === "series" && parts[2] ? parseInt(parts[2], 10) : null;

    try {
      const subs = await fetchSubdlSubs(imdbId, season, episode);
      const subtitles = subs.map((s, idx) => ({
        id: `subdl-${idx}-${imdbId}`,
        url: `${mountBase}/srt/${encodeURIComponent(s.subdlPath)}`,
        lang: "spa",
        name: `[SubDL] ${s.name.replace(/\.(zip|srt)$/i, "")}`,
      }));
      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const srtMatch = subPath.match(/^\/srt\/(.+)$/);
  if (srtMatch) {
    const subdlPath = decodeURIComponent(srtMatch[1]);
    const dlUrl = subdlPath.startsWith("http") ? subdlPath : `${SUBDL_DL}${subdlPath}`;

    // Guard anti-SSRF: dlUrl viene de un path que el cliente controla (encodeURIComponent en el
    // manifest de subtitles, arriba). Sin este chequeo, cualquiera puede pedir
    // /subdl/srt/http://cualquier-host y este endpoint actúa de proxy HTTP abierto no
    // autenticado hacia esa URL. Los subtítulos reales siempre vienen de dl.subdl.com — cualquier
    // otro host se rechaza.
    let dlHost: string;
    try {
      dlHost = new URL(dlUrl).hostname;
    } catch {
      return new Response("URL inválida", { status: 400, headers: cors });
    }
    if (dlHost !== "dl.subdl.com") {
      return new Response("Host no permitido", { status: 400, headers: cors });
    }

    try {
      const r = await fetch(dlUrl, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) {
        return new Response("SubDL error: " + r.status, { status: 502, headers: cors });
      }
      const buf = new Uint8Array(await r.arrayBuffer());
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      const srtText = isZip ? await extractSrtFromZip(buf) : new TextDecoder().decode(buf);

      if (!srtText) {
        return new Response("No se encontró SRT en el ZIP", { status: 502, headers: cors });
      }
      return new Response(srtText, {
        headers: {
          ...cors,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="sub.srt"',
        },
      });
    } catch (e) {
      return new Response("Error descargando: " + (e as Error).message, { status: 502, headers: cors });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ════════════════════════════════════════════════════════════════════════
// ── /opensubtitles — OpenSubtitles ES (sin SDH), subtítulos ───────────────
// A diferencia de SubDL (catálogo chico pero 100% confiable), esta es la
// base de datos grande de OpenSubtitles vía su API REST moderna
// (api.opensubtitles.com, NO la vieja XML-RPC que usan SubSense/OpenSubtitles
// v3/SubMaker) — esa API sí trae un campo estructurado `hearing_impaired`
// por archivo (confirmado contra la API real, no documentación), a
// diferencia de la base vieja que no tiene ningún dato SDH filtrable (ver
// CLAUDE.md, "Sesión 2026-08-16"). Se busca con `hearing_impaired=exclude`
// server-side, antes de que Stremio vea la lista — igual de infalible que
// SubDL, pero con mucha más cobertura (62 subs ES para Matrix vs 3 de SubDL).
//
// Cupo de la API key: 100 descargas/día (no de búsquedas), se resetea a las
// 23:59:59 UTC. Por eso la descarga es perezosa (solo al abrir el subtítulo
// elegido, no al listar) Y cacheada en KV — sin cache, cada apertura repetida
// del mismo subtítulo gastaría cupo de nuevo.
// ════════════════════════════════════════════════════════════════════════

const OPENSUBTITLES_API_KEY = Deno.env.get("OPENSUBTITLES_API_KEY") ?? "";
const OPENSUBTITLES_API = "https://api.opensubtitles.com/api/v1";
const OPENSUBTITLES_UA = "MejoraStremio v1";
const OPENSUBTITLES_SRT_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días — un srt ya subido no cambia

const OPENSUBTITLES_MANIFEST = {
  id: "com.mejorastremio.opensubtitles",
  version: "1.0.0",
  name: "OpenSubtitles ES (sin SDH)",
  description:
    "Subtítulos en español de OpenSubtitles (API moderna). Filtra hearing-impaired " +
    "(SDH) server-side con el campo real de la API, no por nombre de archivo.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

interface OpenSubtitlesSub { name: string; fileId: number }

async function fetchOpenSubtitlesSubs(
  imdbId: string,
  season: number | null,
  episode: number | null,
): Promise<OpenSubtitlesSub[]> {
  const params = new URLSearchParams({ languages: "es", hearing_impaired: "exclude" });
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

async function handleOpenSubtitles(subPath: string, mountBase: string): Promise<Response> {
  if (!OPENSUBTITLES_API_KEY) {
    return new Response(
      "OPENSUBTITLES_API_KEY no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(OPENSUBTITLES_MANIFEST);
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, , rawId] = subMatch;
    const parts = rawId.split(":");
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1], 10) : null;
    const episode = parts[2] ? parseInt(parts[2], 10) : null;

    try {
      const subs = await fetchOpenSubtitlesSubs(imdbId, season, episode);
      const subtitles = subs.map((s, idx) => ({
        id: `opensubtitles-${idx}-${imdbId}`,
        url: `${mountBase}/srt/${s.fileId}`,
        lang: "spa",
        name: `[OpenSubtitles] ${s.name}`,
      }));
      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message }, { status: 500 });
    }
  }

  const srtMatch = subPath.match(/^\/srt\/(\d+)$/);
  if (srtMatch) {
    const fileId = parseInt(srtMatch[1], 10);
    const cacheKey = ["opensubtitles-srt", fileId];

    let kv: Deno.Kv | null = null;
    try {
      kv = await getKv();
      const cached = await kv.get<string>(cacheKey);
      if (cached.value) {
        return new Response(cached.value, {
          headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
        });
      }
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

      if (!dl?.link) {
        return new Response("OpenSubtitles: sin link de descarga — " + JSON.stringify(dl), { status: 502, headers: cors });
      }
      const r = await fetch(dl.link, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return new Response("OpenSubtitles error: " + r.status, { status: 502, headers: cors });
      const srtText = await r.text();

      if (kv) {
        try { await kv.set(cacheKey, srtText, { expireIn: OPENSUBTITLES_SRT_CACHE_TTL_MS }); } catch { /* sin cache, no crítico */ }
      }
      return new Response(srtText, {
        headers: {
          ...cors,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="sub.srt"',
        },
      });
    } catch (e) {
      return new Response("Error descargando: " + (e as Error).message, { status: 502, headers: cors });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ════════════════════════════════════════════════════════════════════════
// ── /latino — Audio Latino (verificado), catálogo ─────────────────────────
// Lógica idéntica a deno-latino-catalog-addon.ts.
// ════════════════════════════════════════════════════════════════════════

const LATINO_LOG_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/anti-frustration-log.json";
const CINEMETA = "https://v3-cinemeta.strem.io";

const LATINO_MANIFEST = {
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

let latinoCache: { at: number; entries: LogEntry[] } | null = null;
const LATINO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

async function loadLatinoLog(): Promise<LogEntry[]> {
  if (latinoCache && Date.now() - latinoCache.at < LATINO_CACHE_TTL_MS) return latinoCache.entries;
  const r = await fetch(`${LATINO_LOG_URL}?_=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
  const entries = r.ok ? await r.json() : [];
  latinoCache = { at: Date.now(), entries };
  return entries;
}

async function posterFor(id: string, type: string): Promise<string | null> {
  try {
    const r = await fetch(`${CINEMETA}/meta/${type}/${id}.json`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.meta?.poster ?? null;
  } catch {
    return null;
  }
}

async function handleLatino(subPath: string): Promise<Response> {
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

// ════════════════════════════════════════════════════════════════════════
// ── /ufc — MMA / UFC (curado), catálogo ────────────────────────────────
// Lista fija (no depende de ningún archivo de datos) — perfil fan de UFC/MMA:
// realities de captación de talento UFC, drama de gimnasio de MMA y wrestling.
// IDs de IMDb verificados vía TMDB/búsqueda real, no adivinados (ver
// cuentas/stremiojn/CLAUDE.md para el detalle de la curación).
// ════════════════════════════════════════════════════════════════════════

const UFC_MANIFEST = {
  id: "com.mejorastremio.ufc-catalog",
  version: "1.0.0",
  name: "MMA / UFC (curado)",
  description:
    "Catálogo curado para perfil fan de UFC: realities de captación de talento MMA " +
    "(Dana White's Contender Series, The Ultimate Fighter), drama de gimnasio de MMA " +
    "(Kingdom, Cobra Kai), reality de aptitud física (Physical: 100) y wrestling (WWE Raw/SmackDown).",
  resources: ["catalog"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [{ type: "series", id: "ufc-series", name: "MMA / UFC (curado)" }],
};

const UFC_TITLES: { id: string; name: string }[] = [
  { id: "tt10845410", name: "Dana White's Contender Series" },
  { id: "tt0445912", name: "The Ultimate Fighter" },
  { id: "tt3673794", name: "Kingdom" },
  { id: "tt7221388", name: "Cobra Kai" },
  { id: "tt25274446", name: "Physical: 100" },
  { id: "tt0185103", name: "WWE Raw" },
  { id: "tt0227972", name: "WWE SmackDown" },
];

async function handleUfc(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(UFC_MANIFEST);
  }

  if (subPath === "/catalog/series/ufc-series.json") {
    const metas = await Promise.all(
      UFC_TITLES.map(async (t) => ({
        id: t.id,
        type: "series",
        name: t.name,
        poster: await posterFor(t.id, "series"),
      })),
    );
    return jsonResponse({ metas });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ════════════════════════════════════════════════════════════════════════
// ── /livetv — TV en Vivo (curado), catálogo + meta + stream ───────────────
// Fuente: iptv-org (github.com/iptv-org/iptv), datos públicos de canales de
// aire/cable legítimos con streams m3u8. Lista de canales ALLOWLIST fija
// (11 ids, verificados con fetch real antes de sumarlos — descartados los
// que dieron 403/404/timeout o vienen marcados "Geo-blocked"/"Not 24/7" en
// la propia data de iptv-org), pero la URL de stream se resuelve EN VIVO
// contra la API pública (cache 10 min) en cada consulta — a diferencia de
// /ufc, acá la URL es volátil (es un endpoint de streaming real, no un id
// estable de IMDb) y hardcodearla se pudriría rápido.
// ════════════════════════════════════════════════════════════════════════

const IPTV_STREAMS_URL = "https://iptv-org.github.io/api/streams.json";
const IPTV_LOGOS_URL = "https://iptv-org.github.io/api/logos.json";

const LIVETV_MANIFEST = {
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

type LivetvCatalogId = "livetv-combate";

const LIVETV_CHANNELS: { id: string; catalog: LivetvCatalogId; name: string }[] = [
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
type IptvStream = any;

let livetvCache: { at: number; streams: Map<string, IptvStream>; logos: Map<string, string> } | null = null;
const LIVETV_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

async function loadLivetvData() {
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

async function handleLivetv(subPath: string): Promise<Response> {
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

// ════════════════════════════════════════════════════════════════════════
// ── /synopsis — MejoraStremio Synopsis IA, proxy de meta ──────────────────
// Lógica idéntica a deno-synopsis-enricher.ts.
// ════════════════════════════════════════════════════════════════════════

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-lite-latest";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const AIOMETADATA_BASE = "https://aiometadata.elfhosted.com";
const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
const PRESET_URL =
  "https://raw.githubusercontent.com/pabloeckert/MejoraStremio/main/data/preset.json";

const AI_BUDGET_MS = 4000;
const SYNOPSIS_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

const SYNOPSIS_MANIFEST = {
  id: "com.mejorastremio.synopsis-proxy",
  version: "1.0.0",
  name: "MejoraStremio Synopsis IA",
  description:
    "Proxy de metadata: pasa AIOMetadata intacto y solo reescribe la sinopsis " +
    "cuando está corta o en inglés (Gemini, fallback OpenRouter). Cae a " +
    "Cinemeta si AIOMetadata no responde.",
  resources: ["meta"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

let cachedInstanceId: string | null = null;
let cachedInstanceIdAt = 0;
const INSTANCE_ID_TTL_MS = 10 * 60 * 1000;

async function getInstanceId(): Promise<string> {
  const now = Date.now();
  if (cachedInstanceId && now - cachedInstanceIdAt < INSTANCE_ID_TTL_MS) {
    return cachedInstanceId;
  }
  const r = await fetch(PRESET_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`No se pudo leer preset.json: ${r.status}`);
  const preset = await r.json();
  const id = preset?.aioMetadataConfig?.instanceId;
  if (!id) throw new Error("preset.json sin aioMetadataConfig.instanceId");
  cachedInstanceId = id;
  cachedInstanceIdAt = now;
  return id;
}

// deno-lint-ignore no-explicit-any
async function fetchAioMeta(type: string, rawId: string): Promise<any> {
  const instanceId = await getInstanceId();
  const url = `${AIOMETADATA_BASE}/stremio/${instanceId}/meta/${type}/${rawId}.json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`AIOMetadata respondió ${r.status}`);
  const d = await r.json();
  if (!d?.meta) throw new Error("AIOMetadata: respuesta sin meta");
  return d.meta;
}

// deno-lint-ignore no-explicit-any
async function fetchCinemetaMeta(type: string, rawId: string): Promise<any | null> {
  try {
    const url = `${CINEMETA_BASE}/meta/${type}/${rawId}.json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.meta ?? null;
  } catch {
    return null;
  }
}

const ENGLISH_HINTS = [
  " the ", " and ", " with ", " from ", " this ", " that ", " their ",
  " were ", " when ", " which ", " who ", " has ", " will ", " story follows",
];
const SPANISH_HINTS = [
  " el ", " la ", " los ", " las ", " de ", " con ", " para ", " una ",
  " uno ", " que ", " su ", " sus ", " es ", " son ", " esta ", " este ",
];

function looksEnglish(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  const en = ENGLISH_HINTS.filter((h) => t.includes(h)).length;
  const es = SPANISH_HINTS.filter((h) => t.includes(h)).length;
  return en >= 2 && en > es;
}

function needsEnrichment(description: string | undefined): boolean {
  if (!description) return false;
  if (description.length < 300) return true;
  return looksEnglish(description);
}

let kvPromise: Promise<Deno.Kv> | null = null;
function getKv(): Promise<Deno.Kv> {
  if (!kvPromise) kvPromise = Deno.openKv();
  return kvPromise;
}

// deno-lint-ignore no-explicit-any
function buildPrompt(meta: any, description: string): string {
  const title = meta.name ?? meta.title ?? "";
  const year = meta.year ?? meta.releaseInfo ?? "";
  const genres = Array.isArray(meta.genres) ? meta.genres.join(", ") : "";
  return (
    "Reescribí esta sinopsis en español latino, más rica y detallada que el " +
    "original. No inventes giros de trama ni eventos específicos que no estén " +
    "ya insinuados en el texto original — solo expandí tono, ambientación, " +
    "contexto y premisa. Devolvé solo la sinopsis reescrita, sin comentarios " +
    "ni encabezados.\n\n" +
    `Título: ${title}${year ? ` (${year})` : ""}\n` +
    `Género: ${genres || "desconocido"}\n` +
    `Sinopsis actual: ${description}`
  );
}

async function callGemini(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal,
  });
  if (!r.ok) throw new Error(`Gemini respondió ${r.status}`);
  const d = await r.json();
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: sin texto en la respuesta");
  return String(text).trim();
}

async function callOpenRouter(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: "user", content: prompt }] }),
    signal,
  });
  if (!r.ok) throw new Error(`OpenRouter respondió ${r.status}`);
  const d = await r.json();
  const text = d?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter: sin texto en la respuesta");
  return String(text).trim();
}

async function enrichSynopsis(
  imdbId: string,
  type: string,
  // deno-lint-ignore no-explicit-any
  meta: any,
  description: string,
): Promise<string | null> {
  const key = ["synopsis", imdbId, type];
  // KV es solo cache (90 días) — si no está disponible (ej. no hay database
  // asignada a la app), el enriquecimiento debe seguir funcionando igual,
  // solo sin cachear entre requests.
  let kv: Deno.Kv | null = null;
  try {
    kv = await getKv();
    const cached = await kv.get<string>(key);
    if (cached.value) return cached.value;
  } catch {
    kv = null;
  }

  const deadline = Date.now() + AI_BUDGET_MS;
  const prompt = buildPrompt(meta, description);

  let text: string | null = null;

  if (GEMINI_API_KEY) {
    const remaining = deadline - Date.now();
    if (remaining > 500) {
      try {
        text = await callGemini(prompt, GEMINI_API_KEY, AbortSignal.timeout(remaining));
      } catch {
        // sigue al fallback de OpenRouter
      }
    }
  }

  if (!text && OPENROUTER_API_KEY) {
    const remaining = deadline - Date.now();
    if (remaining > 500) {
      try {
        text = await callOpenRouter(prompt, OPENROUTER_API_KEY, AbortSignal.timeout(remaining));
      } catch {
        // ambos fallaron: se devuelve la sinopsis original sin tocar
      }
    }
  }

  if (text && kv) {
    try {
      await kv.set(key, text, { expireIn: SYNOPSIS_CACHE_TTL_MS });
    } catch {
      // sin cache, no es crítico
    }
  }
  return text;
}

async function handleSynopsis(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(SYNOPSIS_MANIFEST);
  }

  const metaMatch = subPath.match(/^\/meta\/(movie|series)\/(.+)\.json$/);
  if (metaMatch) {
    const [, type, rawId] = metaMatch;
    const imdbId = rawId.split(":")[0];

    // deno-lint-ignore no-explicit-any
    let meta: any;
    try {
      meta = await fetchAioMeta(type, rawId);
    } catch (e) {
      const fallback = await fetchCinemetaMeta(type, rawId);
      if (fallback) {
        return jsonResponse({ meta: fallback });
      }
      return jsonResponse({ meta: null, error: (e as Error).message }, { status: 502 });
    }

    if (needsEnrichment(meta.description)) {
      try {
        const enriched = await enrichSynopsis(imdbId, type, meta, meta.description);
        if (enriched) meta.description = enriched;
      } catch {
        // se devuelve la sinopsis original de AIOMetadata sin tocar
      }
    }

    return jsonResponse({ meta });
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ════════════════════════════════════════════════════════════════════════
// ── /miniseries — 1 temporada, ≤10 episodios, finalizada (catálogo) ───────
// TMDB Discover TV no soporta filtrar por temporadas/episodios (confirmado
// contra su doc oficial) — pero SÍ soporta `with_type=2` (Miniseries, según
// la clasificación propia de TMDB), sumado el 2026-08-28 tras confirmar el
// parámetro contra la doc oficial de Discover TV — antes el candidate pool
// era "cualquier show Ended por popularidad", con muy poco acierto real al
// filtrar después por temporadas/episodios (de ahí la cobertura floja ya
// documentada, ~2 títulos). Con with_type=2 el pool ya viene pre-filtrado
// por la propia clasificación de TMDB, así que la tasa de acierto del
// filtro de detalle debería subir mucho — se mantiene igual como red de
// seguridad, porque "Miniseries" en TMDB no garantiza ≤10 episodios exactos.
// Se arma en dos pasos: Discover trae candidatos por tipo+popularidad+
// status=Ended, y un fetch de detalle por título filtra por
// number_of_seasons/number_of_episodes. Requiere bastantes llamadas a TMDB
// por refresh, por eso se cachea agresivo (12h) y se acota el trabajo por
// request con un presupuesto de tiempo (deja lo que ya juntó si se pasa).
// ════════════════════════════════════════════════════════════════════════

const TMDB_KEY = Deno.env.get("TMDB_API_KEY_AISEARCH") ?? "";
const TMDB_API = "https://api.themoviedb.org/3";

const MINISERIES_MANIFEST = {
  id: "com.mejorastremio.miniseries",
  version: "1.0.0",
  name: "Miniseries",
  description:
    "Series de 1 sola temporada, 10 episodios o menos, finalizadas — armado " +
    "vía TMDB Discover (with_type=Miniseries) + filtro de detalle por " +
    "temporadas/episodios, que Discover no soporta de forma directa.",
  resources: ["catalog"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [{
    type: "series",
    id: "miniseries",
    name: "Miniseries",
    extra: [
      {
        name: "genre",
        // Nombres tal cual los devuelve TMDB (genre/tv/list?language=es-ES) — mezcla
        // inglés/español real de TMDB, no una traducción nuestra (mismo mix que ya
        // se ve en los catálogos de AIOMetadata, ver CLAUDE.md "Metadata en español").
        // Deben calzar exacto con detail.genres[].name para que el filtro matchee.
        options: [
          "None",
          "Action & Adventure",
          "Animación",
          "Comedia",
          "Crimen",
          "Documental",
          "Drama",
          "Familia",
          "Kids",
          "Misterio",
          "News",
          "Reality",
          "Sci-Fi & Fantasy",
          "Soap",
          "Talk",
          "War & Politics",
          "Western",
        ],
        isRequired: false,
      },
      { name: "skip" },
    ],
  }],
};

interface MiniseriesMeta {
  id: string;
  type: "series";
  name: string;
  poster: string | null;
  description: string;
  genres: string[];
}

let miniseriesCache: { at: number; metas: MiniseriesMeta[]; partial: boolean } | null = null;
const MINISERIES_FULL_TTL_MS = 12 * 60 * 60 * 1000; // 12h si el barrido terminó completo
const MINISERIES_PARTIAL_TTL_MS = 60 * 60 * 1000; // 1h si se cortó por presupuesto
const MINISERIES_BUDGET_MS = 20000;
const MINISERIES_DISCOVER_PAGES = 2;

// deno-lint-ignore no-explicit-any
async function tmdbGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params });
  const r = await fetch(`${TMDB_API}${path}?${qs}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`TMDB ${path} respondió ${r.status}`);
  return await r.json();
}

async function buildMiniseriesCatalog(): Promise<{ metas: MiniseriesMeta[]; partial: boolean }> {
  const deadline = Date.now() + MINISERIES_BUDGET_MS;
  const candidates: number[] = [];

  for (let page = 1; page <= MINISERIES_DISCOVER_PAGES; page++) {
    if (Date.now() > deadline) return { metas: [], partial: true };
    try {
      const d = await tmdbGet("/discover/tv", {
        sort_by: "popularity.desc",
        with_status: "3",
        with_type: "2", // Miniseries (clasificación propia de TMDB) — ver comentario arriba
        "vote_count.gte": "20",
        language: "es-ES",
        page: String(page),
      });
      // deno-lint-ignore no-explicit-any
      for (const s of (d?.results ?? []) as any[]) candidates.push(s.id);
    } catch {
      break; // se sigue con lo que ya se juntó
    }
  }

  const metas: MiniseriesMeta[] = [];
  let partial = false;

  for (const tmdbId of candidates) {
    if (Date.now() > deadline) { partial = true; break; }
    try {
      const detail = await tmdbGet(`/tv/${tmdbId}`, {
        language: "es-ES",
        append_to_response: "external_ids",
      });
      const imdbId = detail?.external_ids?.imdb_id;
      if (
        imdbId &&
        detail.number_of_seasons === 1 &&
        detail.number_of_episodes > 0 &&
        detail.number_of_episodes <= 10
      ) {
        metas.push({
          id: imdbId,
          type: "series",
          name: detail.name,
          poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null,
          description: detail.overview ?? "",
          // deno-lint-ignore no-explicit-any
          genres: ((detail.genres ?? []) as any[]).map((g) => g.name),
        });
      }
    } catch {
      // se salta este candidato, sigue con el resto
    }
  }

  return { metas, partial };
}

async function getMiniseriesCatalog(): Promise<MiniseriesMeta[]> {
  const ttl = miniseriesCache?.partial ? MINISERIES_PARTIAL_TTL_MS : MINISERIES_FULL_TTL_MS;
  if (miniseriesCache && Date.now() - miniseriesCache.at < ttl) return miniseriesCache.metas;

  const stale = miniseriesCache?.metas ?? [];
  try {
    const { metas, partial } = await buildMiniseriesCatalog();
    // si el barrido no encontró nada útil, mejor devolver lo viejo que una lista vacía
    if (metas.length === 0 && stale.length > 0) return stale;
    miniseriesCache = { at: Date.now(), metas, partial };
    return metas;
  } catch {
    return stale;
  }
}

async function handleMiniseries(subPath: string): Promise<Response> {
  if (!TMDB_KEY) {
    return new Response(
      "TMDB_API_KEY_AISEARCH no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(MINISERIES_MANIFEST);
  }

  const catalogMatch = subPath.match(/^\/catalog\/series\/miniseries(?:\/([^/]+))?\.json$/);
  if (catalogMatch) {
    try {
      let metas = await getMiniseriesCatalog();
      const extraStr = catalogMatch[1];
      if (extraStr) {
        const extra = new URLSearchParams(extraStr);
        const genre = extra.get("genre");
        if (genre && genre !== "None") metas = metas.filter((m) => m.genres.includes(genre));
        const skip = parseInt(extra.get("skip") ?? "0", 10);
        if (skip > 0) metas = metas.slice(skip);
      }
      return jsonResponse({ metas });
    } catch (e) {
      return jsonResponse({ metas: [], error: (e as Error).message }, { status: 500 });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ════════════════════════════════════════════════════════════════════════
// ── /discover — Descubrir Maestro (Paso B): servicio+región+país+idioma+
// género combinables como filtros simultáneos de un solo catálogo. TMDB
// Discover soporta los 4 ejes en una sola query (with_watch_providers+
// watch_region, with_origin_country, with_original_language, with_genres);
// el protocolo de Stremio no permite esto en un catálogo nativo de
// AIOMetadata (cada catálogo ahí es un preset fijo) — acá cada eje es un
// "extra" del manifest con sus opciones, así que el cliente de Stremio
// dibuja un dropdown por eje y los combina en la request al catálogo.
// ════════════════════════════════════════════════════════════════════════

// provider_id reales de TMDB (verificados contra /watch/providers/movie en
// vivo, no adivinados — algunos ids cambian con el tiempo si el servicio se
// relanza, ej. HBO Max → Max en 2023 mantuvo el id 1899).
const SERVICE_IDS: Record<string, number> = {
  "Netflix": 8,
  "Disney+": 337,
  "Prime Video": 9,
  "HBO Max": 1899,
  "Paramount+": 2303,
  "Hulu": 15,
  "Peacock": 386,
  "Apple TV+": 350,
  "Starz": 43,
  "Mubi": 11,
  "Criterion Channel": 258,
  "Shudder": 99,
  "Acorn TV": 87,
  "BritBox": 151,
  "Crunchyroll": 283,
};
const DISCOVER_WATCH_REGION = "AR"; // disponibilidad real para Pablo, no "world"/US genérico

const COUNTRY_IDS: Record<string, string> = {
  "Argentina": "AR", "España": "ES", "Francia": "FR", "Alemania": "DE",
  "Italia": "IT", "Reino Unido": "GB", "Portugal": "PT", "México": "MX",
  "Colombia": "CO", "Chile": "CL", "Brasil": "BR", "Perú": "PE",
  "Estados Unidos": "US", "Canadá": "CA", "Australia": "AU", "Nueva Zelanda": "NZ",
  "Japón": "JP", "Corea": "KR", "China": "CN", "Taiwán": "TW",
  "Tailandia": "TH", "Hong Kong": "HK", "India": "IN",
};
// Uniones OR (pipe-delimited, TMDB con with_origin_country) — un pseudo-país
// "regional" que no existe como código ISO propio.
const REGION_IDS: Record<string, string> = {
  "Latinoamérica": "AR|MX|CO|CL|BR|PE",
  "Europa": "ES|FR|DE|IT|GB|PT",
  "Norteamérica": "US|CA",
  "Asia": "JP|KR|CN|TW|TH|HK|IN",
  "Oceanía": "AU|NZ",
};

const LANGUAGE_IDS: Record<string, string> = {
  "Español": "es", "Inglés": "en", "Francés": "fr", "Alemán": "de",
  "Italiano": "it", "Portugués": "pt", "Japonés": "ja", "Coreano": "ko",
  "Chino": "zh", "Hindi": "hi", "Tailandés": "th",
};

const GENRE_IDS_MOVIE: Record<string, number> = {
  "Acción": 28, "Aventura": 12, "Animación": 16, "Comedia": 35, "Crimen": 80,
  "Documental": 99, "Drama": 18, "Familia": 10751, "Fantasía": 14,
  "Historia": 36, "Terror": 27, "Música": 10402, "Misterio": 9648,
  "Romance": 10749, "Ciencia Ficción": 878, "Thriller": 53, "Bélica": 10752,
  "Western": 37,
};
const GENRE_IDS_SERIES: Record<string, number> = {
  "Acción y Aventura": 10759, "Animación": 16, "Comedia": 35, "Crimen": 80,
  "Documental": 99, "Drama": 18, "Familia": 10751, "Infantil": 10762,
  "Misterio": 9648, "Noticias": 10763, "Reality": 10764,
  "Ciencia Ficción y Fantasía": 10765, "Telenovela": 10766, "Talk Show": 10767,
  "Bélica y Política": 10768, "Western": 37,
};

function discoverExtra(genreMap: Record<string, number>) {
  return [
    { name: "service", options: ["None", ...Object.keys(SERVICE_IDS)], isRequired: false },
    { name: "region", options: ["None", ...Object.keys(REGION_IDS)], isRequired: false },
    { name: "country", options: ["None", ...Object.keys(COUNTRY_IDS)], isRequired: false },
    { name: "language", options: ["None", ...Object.keys(LANGUAGE_IDS)], isRequired: false },
    { name: "genre", options: ["None", ...Object.keys(genreMap)], isRequired: false },
    { name: "skip" },
  ];
}

const DISCOVER_MANIFEST = {
  id: "com.mejorastremio.discover-master",
  version: "1.0.0",
  name: "Descubrir Maestro",
  description:
    "Catálogo único con servicio de streaming, región, país, idioma y género " +
    "combinables como filtros simultáneos (TMDB Discover) — a diferencia de " +
    "AIOMetadata, donde cada eje es un catálogo fijo separado.",
  resources: ["catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    { type: "movie", id: "discover-master", name: "Descubrir Maestro", extra: discoverExtra(GENRE_IDS_MOVIE) },
    { type: "series", id: "discover-master", name: "Descubrir Maestro", extra: discoverExtra(GENRE_IDS_SERIES) },
  ],
};

// tmdbId -> imdbId. En memoria (vive mientras el isolate esté caliente) —
// evita repetir el fetch de external_ids en refreshes sucesivos del mismo
// título; no es crítico si se pierde en un cold start, se repuebla solo.
const imdbIdCache = new Map<number, string | null>();

async function resolveImdbId(tmdbId: number): Promise<string | null> {
  if (imdbIdCache.has(tmdbId)) return imdbIdCache.get(tmdbId)!;
  try {
    const d = await tmdbGet(`/movie/${tmdbId}/external_ids`, {});
    const id = d?.imdb_id ?? null;
    imdbIdCache.set(tmdbId, id);
    return id;
  } catch {
    return null;
  }
}
async function resolveImdbIdTv(tmdbId: number): Promise<string | null> {
  if (imdbIdCache.has(tmdbId)) return imdbIdCache.get(tmdbId)!;
  try {
    const d = await tmdbGet(`/tv/${tmdbId}/external_ids`, {});
    const id = d?.imdb_id ?? null;
    imdbIdCache.set(tmdbId, id);
    return id;
  } catch {
    return null;
  }
}

async function handleDiscover(subPath: string): Promise<Response> {
  if (!TMDB_KEY) {
    return new Response(
      "TMDB_API_KEY_AISEARCH no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(DISCOVER_MANIFEST);
  }

  const catalogMatch = subPath.match(/^\/catalog\/(movie|series)\/discover-master(?:\/([^/]+))?\.json$/);
  if (!catalogMatch) {
    return new Response("Not found", { status: 404, headers: cors });
  }
  const [, type, extraStr] = catalogMatch;
  const genreMap = type === "movie" ? GENRE_IDS_MOVIE : GENRE_IDS_SERIES;

  const extra = new URLSearchParams(extraStr ?? "");
  const service = extra.get("service");
  const region = extra.get("region");
  const country = extra.get("country");
  const language = extra.get("language");
  const genre = extra.get("genre");
  const skip = parseInt(extra.get("skip") ?? "0", 10);
  const page = Math.floor(skip / 20) + 1;

  const params: Record<string, string> = {
    sort_by: "popularity.desc",
    language: "es-ES",
    page: String(page),
    "vote_count.gte": "20",
  };
  if (service && service !== "None" && SERVICE_IDS[service]) {
    params.with_watch_providers = String(SERVICE_IDS[service]);
    params.watch_region = DISCOVER_WATCH_REGION;
  }
  // país puntual gana sobre región si ambos vienen seteados (evita una
  // combinación contradictoria silenciosa).
  if (country && country !== "None" && COUNTRY_IDS[country]) {
    params.with_origin_country = COUNTRY_IDS[country];
  } else if (region && region !== "None" && REGION_IDS[region]) {
    params.with_origin_country = REGION_IDS[region];
  }
  if (language && language !== "None" && LANGUAGE_IDS[language]) {
    params.with_original_language = LANGUAGE_IDS[language];
  }
  if (genre && genre !== "None" && genreMap[genre]) {
    params.with_genres = String(genreMap[genre]);
  }

  try {
    const path = type === "movie" ? "/discover/movie" : "/discover/tv";
    const d = await tmdbGet(path, params);
    // deno-lint-ignore no-explicit-any
    const results = (d?.results ?? []) as any[];

    const resolved = await Promise.all(results.map(async (r) => {
      const imdbId = type === "movie"
        ? await resolveImdbId(r.id)
        : await resolveImdbIdTv(r.id);
      if (!imdbId) return null;
      return {
        id: imdbId,
        type,
        name: r.title ?? r.name,
        poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
        description: r.overview ?? "",
      };
    }));

    return jsonResponse({ metas: resolved.filter((m) => m !== null) });
  } catch (e) {
    return jsonResponse({ metas: [], error: (e as Error).message }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════
// ── /health — estado de config de las 5 sub-funciones ─────────────────────
// ════════════════════════════════════════════════════════════════════════

function handleHealth(): Response {
  return jsonResponse({
    hub: "mejorastremio-hub",
    timestamp: new Date().toISOString(),
    subdl: { configured: !!SUBDL_KEY },
    opensubtitles: { configured: !!OPENSUBTITLES_API_KEY },
    latino: { configured: true },
    synopsis: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      geminiConfigured: !!GEMINI_API_KEY,
      openrouterConfigured: !!OPENROUTER_API_KEY,
    },
    miniseries: { configured: !!TMDB_KEY },
    discover: { configured: !!TMDB_KEY },
    ufc: { configured: true },
    livetv: { configured: true },
  });
}

// ════════════════════════════════════════════════════════════════════════
// ── Router ──────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname;
  const started = Date.now();
  let route = "unknown";
  let res: Response;

  try {
    if (path === "/" || path === "") {
      route = "root";
      res = jsonResponse({
        hub: "mejorastremio-hub",
        routes: [
          "/subdl/manifest.json",
          "/opensubtitles/manifest.json",
          "/latino/manifest.json",
          "/synopsis/manifest.json",
          "/miniseries/manifest.json",
          "/discover/manifest.json",
          "/ufc/manifest.json",
          "/livetv/manifest.json",
          "/health",
        ],
      });
    } else if (path === "/health") {
      route = "health";
      res = handleHealth();
    } else if (path.startsWith("/subdl")) {
      route = "subdl";
      const subPath = path.slice("/subdl".length) || "/";
      res = await handleSubdl(subPath, `${url.origin}/subdl`);
    } else if (path.startsWith("/opensubtitles")) {
      route = "opensubtitles";
      const subPath = path.slice("/opensubtitles".length) || "/";
      res = await handleOpenSubtitles(subPath, `${url.origin}/opensubtitles`);
    } else if (path.startsWith("/latino")) {
      route = "latino";
      const subPath = path.slice("/latino".length) || "/";
      res = await handleLatino(subPath);
    } else if (path.startsWith("/synopsis")) {
      route = "synopsis";
      const subPath = path.slice("/synopsis".length) || "/";
      res = await handleSynopsis(subPath);
    } else if (path.startsWith("/miniseries")) {
      route = "miniseries";
      const subPath = path.slice("/miniseries".length) || "/";
      res = await handleMiniseries(subPath);
    } else if (path.startsWith("/discover")) {
      route = "discover";
      const subPath = path.slice("/discover".length) || "/";
      res = await handleDiscover(subPath);
    } else if (path.startsWith("/ufc")) {
      route = "ufc";
      const subPath = path.slice("/ufc".length) || "/";
      res = await handleUfc(subPath);
    } else if (path.startsWith("/livetv")) {
      route = "livetv";
      const subPath = path.slice("/livetv".length) || "/";
      res = await handleLivetv(subPath);
    } else {
      res = new Response("Not found", { status: 404, headers: cors });
    }
  } catch (e) {
    res = jsonResponse({ error: (e as Error).message }, { status: 500 });
  }

  // Logging centralizado por ruta.
  console.log(`[hub] ${route} ${req.method} ${path} -> ${res.status} (${Date.now() - started}ms)`);
  return res;
});
