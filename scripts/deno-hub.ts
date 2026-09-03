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
 *   /opensubtitles-latino/manifest.json → OpenSubtitles Latino (sin SDH), subtítulos — mismo
 *                                mecanismo que /opensubtitles pero con languages="ea" (código
 *                                real de "Spanish (LA)" en la API moderna, distinto de "es"/"sp"
 *                                — confirmado 2026-09-02, ver CLAUDE.md)
 *   /latino/manifest.json     → Audio Latino (verificado), catálogo
 *   /synopsis/manifest.json   → MejoraStremio Synopsis IA, proxy de meta
 *   /mediathek/manifest.json  → Mediathek DE (Tatort), streams directos ARD/ZDF/ORF
 *   /translate/manifest.json  → Traducción IA → ES latino, subtítulos generados
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

// "ea" = Spanish (LA), código separado de "es" (genérico) y "sp" (Spanish EU) — confirmado
// contra GET /api/v1/infos/languages de la API real el 2026-09-02 (nunca antes verificado; las
// pruebas viejas con es-419/es-MX/es-AR/lat contra SubSense no aplicaban a esta API). Primera
// fuente de subtítulos del proyecto que puede filtrar la variante latina de verdad, en vez de
// depender de que el uploader la haya mencionado en el nombre del archivo (ver CLAUDE.md,
// "Subtítulos, variante latino vs. España").
const OPENSUBTITLES_LATINO_MANIFEST = {
  id: "com.mejorastremio.opensubtitles-latino",
  version: "1.0.0",
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

interface OpenSubtitlesSub { name: string; fileId: number }

async function fetchOpenSubtitlesSubs(
  imdbId: string,
  season: number | null,
  episode: number | null,
  lang: string = "es",
): Promise<OpenSubtitlesSub[]> {
  const params = new URLSearchParams({ languages: lang, hearing_impaired: "exclude" });
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

async function handleOpenSubtitles(
  subPath: string,
  mountBase: string,
  // deno-lint-ignore no-explicit-any
  manifest: any = OPENSUBTITLES_MANIFEST,
  lang: string = "es",
  idTag: string = "opensubtitles",
  nameTag: string = "OpenSubtitles",
): Promise<Response> {
  if (!OPENSUBTITLES_API_KEY) {
    return new Response(
      "OPENSUBTITLES_API_KEY no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(manifest);
  }

  const subMatch = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, , rawId] = subMatch;
    const parts = rawId.split(":");
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1], 10) : null;
    const episode = parts[2] ? parseInt(parts[2], 10) : null;

    try {
      const subs = await fetchOpenSubtitlesSubs(imdbId, season, episode, lang);
      const subtitles = subs.map((s, idx) => ({
        id: `${idTag}-${idx}-${imdbId}`,
        url: `${mountBase}/srt/${s.fileId}`,
        lang: "spa",
        name: `[${nameTag}] ${s.name}`,
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

const GEMINI_SAFETY_OFF = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

async function callGemini(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // Tatort es contenido policial (violencia, crimen) — sin esto Gemini
      // bloquea lotes con descripciones de escenas y la traducción sale a medias.
      safetySettings: GEMINI_SAFETY_OFF,
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
    }),
    signal,
  });
  if (!r.ok) throw new Error(`Gemini respondió ${r.status}`);
  const d = await r.json();
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: sin texto (" + (d?.candidates?.[0]?.finishReason || JSON.stringify(d).slice(0, 120)) + ")");
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
// ── /short-series — series con episodios de 30 minutos o menos (catálogo) ─
// Mismo problema que Miniseries: TMDB Discover TV no soporta filtrar por
// duración de episodio, así que se arma en dos pasos (candidate pool por
// popularidad + fetch de detalle por título chequeando episode_run_time).
// A diferencia de Miniseries, acá NO se filtra por with_status — el
// formato "episodio corto" incluye tanto sitcoms en emisión como shows ya
// terminados, no tiene sentido excluir contenido activo. Pedido de Pablo,
// sesión 2026-08-28 (noche), junto con el catálogo de películas cortas
// (tmdb.discover.movie.short-form.pablo065, ese sí resuelto directo en
// preset.json porque Discover Movie SÍ soporta with_runtime).
// ════════════════════════════════════════════════════════════════════════

const SHORT_SERIES_MANIFEST = {
  id: "com.mejorastremio.short-series",
  version: "1.1.0",
  name: "Comedias Cortas (30 min o menos)",
  description:
    "Sitcoms y comedias live-action cuyos episodios duran 30 minutos o menos. " +
    "TMDB Discover (comedia, sin animación) + confirmación por episode_run_time.",
  resources: ["catalog"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [{
    type: "series",
    id: "short-series",
    name: "Comedias Cortas (≤30 min)",
    extra: [{ name: "skip" }],
  }],
};

interface ShortSeriesMeta {
  id: string;
  type: "series";
  name: string;
  poster: string | null;
  description: string;
  genres: string[];
  runtime: number;
}

let shortSeriesCache: { at: number; metas: ShortSeriesMeta[]; partial: boolean } | null = null;
const SHORT_SERIES_FULL_TTL_MS = 12 * 60 * 60 * 1000;
const SHORT_SERIES_PARTIAL_TTL_MS = 60 * 60 * 1000;
const SHORT_SERIES_BUDGET_MS = 24000;
const SHORT_SERIES_DISCOVER_PAGES = 5;

async function buildShortSeriesCatalog(): Promise<{ metas: ShortSeriesMeta[]; partial: boolean }> {
  const deadline = Date.now() + SHORT_SERIES_BUDGET_MS;
  const candidates: number[] = [];

  for (let page = 1; page <= SHORT_SERIES_DISCOVER_PAGES; page++) {
    if (Date.now() > deadline) return { metas: [], partial: true };
    try {
      const d = await tmdbGet("/discover/tv", {
        sort_by: "popularity.desc",
        // with_runtime SÍ funciona en /discover/tv (la doc de la sesión
        // 2026-08-28 estaba equivocada) — pre-filtra a formato corto. Es un
        // filtro laxo (incluye shows sin dato de runtime), por eso abajo se
        // confirma con episode_run_time del detalle. vote_count alto para
        // sacar el ruido (soaps regionales, telediarios).
        "with_runtime.lte": "30",
        "vote_count.gte": "150",
        // Comedia + sin animación/kids/noticias/talk: "series ≤30min por
        // popularidad" a secas es 90% anime y dibujos (es lo que domina el
        // formato corto a nivel mundial). Acotarlo a comedia live-action lo
        // vuelve el catálogo útil para la cuenta — sitcoms para "algo cortito".
        with_genres: "35",
        without_genres: "16,10762,10763,10767",
        language: "es-ES",
        page: String(page),
      });
      // deno-lint-ignore no-explicit-any
      for (const s of (d?.results ?? []) as any[]) candidates.push(s.id);
    } catch {
      break;
    }
  }

  const metas: ShortSeriesMeta[] = [];
  const seen = new Set<string>();
  let partial = false;

  // Confirmación de detalle en paralelo (de a 8) — el fetch por título era el
  // cuello de botella y dejaba el catálogo en ~7 resultados.
  for (let i = 0; i < candidates.length; i += 8) {
    if (Date.now() > deadline) { partial = true; break; }
    const batch = candidates.slice(i, i + 8);
    const details = await Promise.all(batch.map((id) =>
      tmdbGet(`/tv/${id}`, { language: "es-ES", append_to_response: "external_ids" }).catch(() => null)
    ));
    for (const detail of details) {
      const imdbId = detail?.external_ids?.imdb_id;
      // deno-lint-ignore no-explicit-any
      const runtimes = (detail?.episode_run_time ?? []) as any[];
      const maxRuntime = runtimes.length ? Math.max(...runtimes) : null;
      if (imdbId && !seen.has(imdbId) && maxRuntime !== null && maxRuntime > 0 && maxRuntime <= 30) {
        seen.add(imdbId);
        metas.push({
          id: imdbId,
          type: "series",
          name: detail.name,
          poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null,
          description: detail.overview ?? "",
          // deno-lint-ignore no-explicit-any
          genres: ((detail.genres ?? []) as any[]).map((g) => g.name),
          runtime: maxRuntime,
        });
      }
    }
  }

  return { metas, partial };
}

async function getShortSeriesCatalog(): Promise<ShortSeriesMeta[]> {
  const ttl = shortSeriesCache?.partial ? SHORT_SERIES_PARTIAL_TTL_MS : SHORT_SERIES_FULL_TTL_MS;
  if (shortSeriesCache && Date.now() - shortSeriesCache.at < ttl) return shortSeriesCache.metas;

  const stale = shortSeriesCache?.metas ?? [];
  try {
    const { metas, partial } = await buildShortSeriesCatalog();
    if (metas.length === 0 && stale.length > 0) return stale;
    shortSeriesCache = { at: Date.now(), metas, partial };
    return metas;
  } catch {
    return stale;
  }
}

async function handleShortSeries(subPath: string): Promise<Response> {
  if (!TMDB_KEY) {
    return new Response(
      "TMDB_API_KEY_AISEARCH no configurada. Setear como Secret en Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  if (subPath === "/manifest.json") {
    return jsonResponse(SHORT_SERIES_MANIFEST);
  }

  const catalogMatch = subPath.match(/^\/catalog\/series\/short-series(?:\/([^/]+))?\.json$/);
  if (catalogMatch) {
    try {
      let metas = await getShortSeriesCatalog();
      const extraStr = catalogMatch[1];
      if (extraStr) {
        const extra = new URLSearchParams(extraStr);
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
  // Series: sacar telediarios y talk shows — se cuelan con with_origin_country
  // por país (ej. "Alemania + Crimen" traía Tagesschau) y nunca son lo buscado.
  if (type === "series") params.without_genres = "10763,10767";
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
// ── /mediathek — streams directos de la Mediathek alemana (Tatort) ────────
// La antología Tatort (tt0806910) casi no tiene cobertura en los indexers de
// torrents (los releases se nombran por Folge/caso, no SxxExx, así que
// Torrentio/Comet no los mapean al esquema season=año de Cinemeta). Pero la
// ARD/SWR/WDR/NDR/… mantienen online cientos de episodios en la Mediathek
// pública, con MP4 progresivo directo + subtítulo alemán oficial (EBU-TT-D).
// Este addon los expone como streams y adjunta, en el propio stream, un
// subtítulo en español latino generado por /translate a partir de esa pista
// alemana (perfectamente sincronizada con el mismo archivo).
//
// Fuente: MediathekViewWeb (mediathekviewweb.de/api/query) — API JSON pública
// que agrega las Filmlisten de todos los canales públicos alemanes + ORF.
// ════════════════════════════════════════════════════════════════════════

const TATORT_IMDB = "tt0806910";
const MVW_API = "https://mediathekviewweb.de/api/query";

const MEDIATHEK_MANIFEST = {
  id: "com.mejorastremio.mediathek",
  version: "1.0.0",
  name: "Mediathek DE (Tatort)",
  description:
    "Streams directos de la Mediathek pública alemana (ARD/SWR/WDR/NDR/…) para Tatort — " +
    "audio alemán en calidad HD, sin torrents ni debrid. Cada stream ya trae adjunto el " +
    "subtítulo alemán oficial y una traducción IA al español latino.",
  resources: ["stream"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

interface MvwFilm {
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

let mvwCache: { at: number; films: MvwFilm[] } | null = null;
const MVW_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function normTitleKey(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bteil\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "Odenthal - 81 - Der Stelzenmann" -> "Der Stelzenmann"
// "Tatort: Das Haus am Ende der Straße" -> "Das Haus am Ende der Straße"
function tatortCaseTitle(episodeName: string): string {
  let n = String(episodeName || "");
  const dash = n.match(/^.*?-\s*\d+\s*-\s*(.+)$/);
  if (dash) n = dash[1];
  n = n.replace(/^Tatort[:\s-]+/i, "").replace(/\(.*?\)/g, "").trim();
  return n;
}

async function loadMvwTatort(): Promise<MvwFilm[]> {
  if (mvwCache && Date.now() - mvwCache.at < MVW_CACHE_TTL_MS) return mvwCache.films;
  const films: MvwFilm[] = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const r = await fetch(MVW_API, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        queries: [{ fields: ["topic"], query: "Tatort" }],
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
      if ((x.duration ?? 0) < 3300) continue; // descarta trailers/clips, deja solo films
      if (/Audiodeskription|H[oö]rfassung|klare Sprache|Geb[aä]rden/i.test(x.title)) continue;
      const hd = String(x.url_video_hd || "");
      const mp4 = String(x.url_video || "");
      // variantes de accesibilidad que se cuelan sin marca en el título
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
        normTitle: normTitleKey(String(x.title).replace(/\(.*?\)/g, "").replace(/^Tatort[:\s-]+/i, "")),
      });
    }
    if (res.length < 100) break;
  }
  mvwCache = { at: Date.now(), films };
  return films;
}

function matchMvwFilms(films: MvwFilm[], caseTitle: string): MvwFilm[] {
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

function dedupeFilms(films: MvwFilm[]): MvwFilm[] {
  const best = new Map<string, MvwFilm>();
  for (const f of films) {
    const k = `${f.channel}|${f.normTitle}|${Math.round(f.duration / 30)}`;
    const cur = best.get(k);
    if (!cur || (!cur.urlHd && f.urlHd) || (!cur.urlSub && f.urlSub)) best.set(k, f);
  }
  return [...best.values()].sort((a, b) => (b.urlSub ? 1 : 0) - (a.urlSub ? 1 : 0) || b.ts - a.ts);
}

const b64u = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};

async function handleMediathek(subPath: string, mountBase: string, translateMount: string): Promise<Response> {
  if (subPath === "/manifest.json") return jsonResponse(MEDIATHEK_MANIFEST);

  const m = subPath.match(/^\/stream\/series\/(.+?)\.json$/);
  if (!m) return new Response("Not found", { status: 404, headers: cors });

  const [imdbId, sRaw, eRaw] = m[1].split(":");
  if (imdbId !== TATORT_IMDB || !sRaw || !eRaw) return jsonResponse({ streams: [] });

  try {
    const meta = await fetchCinemetaMeta("series", imdbId);
    const vid = (meta?.videos ?? []).find(
      // deno-lint-ignore no-explicit-any
      (v: any) => String(v.season) === sRaw && String(v.number) === eRaw,
    );
    const caseTitle = tatortCaseTitle(vid?.name ?? "");
    if (!caseTitle) return jsonResponse({ streams: [] });

    const films = await loadMvwTatort();
    const matched = matchMvwFilms(films, caseTitle);

    const streams = matched.slice(0, 6).map((f) => {
      const video = f.urlHd || f.urlMp4 || f.urlLow;
      const quality = f.urlHd ? "1080p" : f.urlMp4 ? "720p" : "360p";
      const subs: { id: string; url: string; lang: string }[] = [];
      if (f.urlSub) {
        subs.push({ id: "de-oficial", url: f.urlSub, lang: "ger" });
        subs.push({
          id: "es-latino-ia",
          url: `${translateMount}/x/${b64u.enc(f.urlSub)}.srt`,
          lang: "spa",
        });
      }
      return {
        name: `Mediathek DE\n${quality}`,
        title: `${f.channel} · ${caseTitle}\n🇩🇪 audio alemán${f.urlSub ? " · sub DE oficial + IA→ES latino" : ""} · ${Math.round(f.duration / 60)}min`,
        url: video,
        subtitles: subs,
        behaviorHints: { notWebReady: /\.m3u8($|\?)/.test(video), bingeGroup: `mediathek-tatort-${imdbId}` },
      };
    });

    return jsonResponse({ streams });
  } catch (e) {
    return jsonResponse({ streams: [], error: (e as Error).message }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════════════════════
// ── /translate — subtítulo ES latino generado por IA ─────────────────────
// Para contenido alemán (u otro) que NO tiene ningún subtítulo en español
// pre-hecho en ninguna fuente (Tatort: OpenSubtitles.com tiene 1 en toda la
// historia de la serie; SubDL 0). Toma la mejor pista base disponible
// —alemán oficial de la Mediathek si es Tatort, si no alemán/inglés de
// OpenSubtitles.com— y la traduce al español latino con IA (Gemini, fallback
// OpenRouter), en lotes paralelos. Cachea el SRT resultante 90 días en KV.
//
// Se auto-limita: si ya existe algún subtítulo ES real en OpenSubtitles.com
// para ese título, no ofrece nada (no ensucia la lista de contenido que ya
// está bien cubierto). Solo aparece donde de verdad hace falta.
// ════════════════════════════════════════════════════════════════════════

const TRANSLATE_MANIFEST = {
  id: "com.mejorastremio.translate",
  version: "1.0.0",
  name: "Traducción IA → ES latino",
  description:
    "Genera un subtítulo en español latino traduciendo con IA la mejor pista alemana o " +
    "inglesa disponible. Pensado para contenido alemán sin subs ES (Tatort y similares). " +
    "Cachea 90 días — la primera apertura de un episodio tarda ~20-40s, después es instantánea.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
};

const TRANSLATE_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TRANSLATE_BUDGET_MS = 55000;
// Gemini free tier ≈ 15 RPM. Lotes grandes + poca concurrencia mantienen el
// total de requests por episodio en ~5-6 (una tanda), bien por debajo del tope.
const TRANSLATE_BATCH = 220;
const TRANSLATE_PARALLEL = 4;
const NL = "⏎"; // sentinel para saltos de línea internos al mandar a la IA
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Cue { start: string; end: string; text: string }

// Una cue "solo sonido" no se traduce (y de hecho se descarta del SRT final):
// "(spannungsvolle Musik)", "[Tür quietscht]", ".", "♪ ... ♪", líneas todas
// entre paréntesis. Para alguien que mira en alemán con subs ES son ruido.
function isSoundOnly(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || /^[.\-–—#♪*\s]+$/.test(t)) return true;
  const oneLine = t.replace(/\s+/g, " ");
  // toda la cue entre ( ), [ ] o * * (los 3 estilos de acotación sonora de la
  // Mediathek): "(spannungsvolle Musik)", "[Tür quietscht]", "* Musik *"
  if (/^[(\[*][^)\]]*[)\]*]$/.test(oneLine)) return true;
  return t.split("\n").every((l) => l.trim() === "" || /^[(\[*][^)\]]*[)\]*]$/.test(l.trim()));
}

// EBU-TT-D / TTML (Mediathek alemana) -> cues
function parseEbuTt(xml: string): Cue[] {
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

// "00:01:02.240" | "00:01:02:12" (frames) -> "00:01:02,240"
function normTtmlTime(t: string): string {
  const mSec = t.match(/^(\d{2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (mSec) return `${mSec[1]}:${mSec[2]}:${mSec[3]},${mSec[4].padEnd(3, "0")}`;
  const mFr = t.match(/^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (mFr) {
    const ms = Math.round((parseInt(mFr[4], 10) / 25) * 1000);
    return `${mFr[1]}:${mFr[2]}:${mFr[3]},${String(ms).padStart(3, "0")}`;
  }
  return t.replace(".", ",");
}

function parseSrt(srt: string): Cue[] {
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

function serializeSrt(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${c.start} --> ${c.end}\n${c.text}`)
    .join("\n\n") + "\n";
}

const TRANSLATE_SYS =
  "Sos traductor profesional de subtítulos. Traducí del alemán (o inglés) al ESPAÑOL " +
  "LATINOAMERICANO NEUTRO — el registro de doblaje: nada de 'vosotros', nada de 'coger' " +
  "por agarrar, trato 'usted'/'tú' según la formalidad, modismos neutros (ni argentino, " +
  "ni mexicano, ni español de España). Es una serie policial alemana (Tatort). Conservá " +
  "el tono y las malas palabras. Recibís líneas numeradas '<n>▸ <texto>'. Devolvé " +
  "EXACTAMENTE las mismas líneas numeradas '<n>▸ <traducción>', una por línea, mismo n, " +
  `misma cantidad, sin texto extra. El símbolo ${NL} es un salto de línea interno: dejalo donde está.`;

// Parsea la respuesta numerada del modelo. Devuelve map n->texto.
function parseNumbered(raw: string): Map<number, string> {
  const out = new Map<number, string>();
  const re = /(^|\n)\s*(\d+)\s*▸\s*([\s\S]*?)(?=\n\s*\d+\s*▸|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.set(parseInt(m[2], 10), m[3].trim());
  return out;
}

// Traduce un lote. Devuelve el mapa n->texto (con fallback al original en las
// líneas que la IA no devolvió) y `ok` = si la IA cubrió ≥90% del lote (para
// decidir si vale cachearlo). OpenRouter free quedó descartado del camino de
// subtítulos: su router tarda >40s por request. Gemini flash-lite hace 80
// líneas en ~5s y aguanta ráfagas paralelas sin rate-limit.
async function translateBatch(
  items: { n: number; text: string }[],
  signal: AbortSignal,
): Promise<{ map: Map<number, string>; ok: boolean }> {
  const payload = items.map((it) => `${it.n}▸ ${it.text.replace(/\n/g, NL)}`).join("\n");
  const prompt = `${TRANSLATE_SYS}\n\n${payload}`;

  const merged = new Map<number, string>();
  for (let attempt = 0; attempt < 4 && merged.size < items.length; attempt++) {
    // Tras el primer intento, se re-piden SOLO las líneas que faltan — un lote
    // más chico parsea mejor y no re-gasta tiempo en lo ya traducido.
    const todo = attempt === 0 ? items : items.filter((it) => !merged.has(it.n));
    if (!todo.length) break;
    const p = attempt === 0
      ? prompt
      : `${TRANSLATE_SYS}\n\n${todo.map((it) => `${it.n}▸ ${it.text.replace(/\n/g, NL)}`).join("\n")}`;
    try {
      const parsed = parseNumbered(await callGemini(p, GEMINI_API_KEY, signal));
      for (const it of todo) {
        if (!merged.has(it.n) && parsed.has(it.n)) merged.set(it.n, parsed.get(it.n)!);
      }
    } catch (e) {
      const msg = (e as Error).message;
      // 429 (cuota) / 503 (sobrecarga) de Gemini: esperar y reintentar.
      if (/429|503/.test(msg) && attempt < 3) await sleep(3500 + attempt * 3500);
      else if (attempt >= 3) console.log(`[translate] batch n0=${items[0]?.n} agotó reintentos: ${msg}`);
    }
  }

  const map = new Map<number, string>();
  for (const it of items) {
    const t = merged.get(it.n);
    map.set(it.n, t ? t.replace(new RegExp(NL, "g"), "\n") : it.text);
  }
  // ≥80% traducido = se acepta y se cachea (el resto queda en alemán). Un puñado
  // de líneas sueltas sin traducir no justifica que cada apertura rehaga 30s.
  return { map, ok: merged.size >= items.length * 0.8 };
}

// Traduce solo las cues de diálogo, con cache por-lote en KV para que un
// reintento (o el pre-warm) no rehaga lo ya hecho. cacheRef identifica la
// pista base (url ARD o os-<fileId>).
async function translateCues(
  cues: Cue[],
  cacheRef: string,
  kv: Deno.Kv | null,
  deadline: number,
): Promise<{ texts: string[]; done: boolean }> {
  const texts = cues.map((c) => c.text);
  const dialogueIdx = cues.map((c, i) => (isSoundOnly(c.text) ? -1 : i)).filter((i) => i >= 0);

  const batches: number[][] = [];
  for (let i = 0; i < dialogueIdx.length; i += TRANSLATE_BATCH) {
    batches.push(dialogueIdx.slice(i, i + TRANSLATE_BATCH));
  }

  // Estado por lote: pendiente hasta que quede cacheado o traducido ~entero.
  const pending = new Set(batches.map((_, i) => i));

  // Primera pasada: leer de KV lo ya hecho.
  if (kv) {
    await Promise.all([...pending].map(async (bi) => {
      try {
        const hit = await kv.get<Record<string, string>>(["tr-batch", "v8", cacheRef, bi]);
        if (hit.value) {
          for (const idx of batches[bi]) texts[idx] = hit.value[idx] ?? texts[idx];
          pending.delete(bi);
        }
      } catch { /* queda pendiente */ }
    }));
  }

  // Rondas de traducción: cada ronda toma hasta TRANSLATE_PARALLEL lotes
  // pendientes en paralelo y reintenta los que fallaron, hasta agotarlos o
  // quedarse sin presupuesto.
  for (let round = 0; round < 5 && pending.size && Date.now() < deadline - 3000; round++) {
    const wave = [...pending].slice(0, TRANSLATE_PARALLEL);
    const remaining = deadline - Date.now();
    await Promise.all(wave.map(async (bi) => {
      const batchIdxs = batches[bi];
      const items = batchIdxs.map((idx) => ({ n: idx, text: texts[idx] }));
      const { map, ok } = await translateBatch(
        items,
        AbortSignal.timeout(Math.max(6000, Math.min(remaining, 48000))),
      );
      for (const idx of batchIdxs) texts[idx] = map.get(idx) ?? texts[idx];
      if (ok) {
        pending.delete(bi);
        if (kv) {
          const obj: Record<string, string> = {};
          for (const idx of batchIdxs) obj[idx] = texts[idx];
          try { await kv.set(["tr-batch", "v8", cacheRef, bi], obj, { expireIn: TRANSLATE_CACHE_TTL_MS }); } catch { /* sin cache */ }
        }
      }
    }));
  }

  return { texts, done: pending.size === 0 };
}

async function fetchBaseCues(src: { t: string; u?: string; f?: number }): Promise<Cue[]> {
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
    return parseSrt(await r.text());
  }
  throw new Error("base desconocida");
}

async function osHasSpanish(imdbId: string, season: number | null, episode: number | null): Promise<boolean> {
  if (!OPENSUBTITLES_API_KEY) return false;
  // es (genérico) + sp (España) + ea (Latinoamérica) — los 3 códigos de español
  // de la API moderna (ver commit "OpenSubtitles Latino real"). Si ya hay un
  // subtítulo ES real en cualquiera, /translate no ofrece su traducción IA.
  const p = new URLSearchParams({ languages: "es,sp,ea" });
  if (season != null && episode != null) {
    p.set("parent_imdb_id", imdbId.replace(/^tt0*/, ""));
    p.set("season_number", String(season));
    p.set("episode_number", String(episode));
  } else p.set("imdb_id", imdbId.replace(/^tt0*/, ""));
  const r = await fetch(`${OPENSUBTITLES_API}/subtitles?${p}`, {
    headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
    signal: AbortSignal.timeout(10000),
  }).then((x) => x.json()).catch(() => null);
  return (r?.total_count ?? 0) > 0;
}

async function osBaseFileId(imdbId: string, season: number | null, episode: number | null, lang: string): Promise<number | null> {
  if (!OPENSUBTITLES_API_KEY) return null;
  const p = new URLSearchParams({ languages: lang, hearing_impaired: "exclude", order_by: "download_count" });
  if (season != null && episode != null) {
    p.set("parent_imdb_id", imdbId.replace(/^tt0*/, ""));
    p.set("season_number", String(season));
    p.set("episode_number", String(episode));
  } else p.set("imdb_id", imdbId.replace(/^tt0*/, ""));
  const r = await fetch(`${OPENSUBTITLES_API}/subtitles?${p}`, {
    headers: { "Api-Key": OPENSUBTITLES_API_KEY, "User-Agent": OPENSUBTITLES_UA },
    signal: AbortSignal.timeout(10000),
  }).then((x) => x.json()).catch(() => null);
  const fid = r?.data?.[0]?.attributes?.files?.[0]?.file_id;
  return Number.isFinite(fid) ? fid : null;
}

async function handleTranslate(subPath: string, mountBase: string): Promise<Response> {
  if (subPath === "/manifest.json") return jsonResponse(TRANSLATE_MANIFEST);

  // ── listar: /subtitles/:type/:id.json ──────────────────────────────────
  const listM = subPath.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (listM) {
    const [, , rawId] = listM;
    const [imdbId, sRaw, eRaw] = rawId.split(":");
    const season = sRaw ? parseInt(sRaw, 10) : null;
    const episode = eRaw ? parseInt(eRaw, 10) : null;
    try {
      if (await osHasSpanish(imdbId, season, episode)) return jsonResponse({ subtitles: [] });

      const bases: { t: string; u?: string; f?: number; label: string; keyRef: string }[] = [];

      if (imdbId === TATORT_IMDB && season != null && episode != null) {
        const meta = await fetchCinemetaMeta("series", imdbId);
        // deno-lint-ignore no-explicit-any
        const vid = (meta?.videos ?? []).find((v: any) => v.season === season && v.number === episode);
        const ct = tatortCaseTitle(vid?.name ?? "");
        if (ct) {
          const films = matchMvwFilms(await loadMvwTatort(), ct).filter((f) => f.urlSub);
          if (films[0]) bases.push({ t: "ard", u: films[0].urlSub, label: "base DE oficial", keyRef: films[0].urlSub });
        }
      }
      if (!bases.length) {
        const de = await osBaseFileId(imdbId, season, episode, "de");
        if (de) bases.push({ t: "os", f: de, label: "base DE", keyRef: `os-${de}` });
        else {
          const en = await osBaseFileId(imdbId, season, episode, "en");
          if (en) bases.push({ t: "os", f: en, label: "base EN", keyRef: `os-${en}` });
        }
      }

      const subtitles = bases.map((b, i) => ({
        id: `ia-es-${i}`,
        url: `${mountBase}/gen/${b64u.enc(JSON.stringify({ t: b.t, u: b.u, f: b.f, r: b.keyRef }))}.srt`,
        lang: "spa",
        name: `[IA→ES latino] ${b.label}`,
      }));
      return jsonResponse({ subtitles });
    } catch (e) {
      return jsonResponse({ subtitles: [], error: (e as Error).message }, { status: 500 });
    }
  }

  // ── generar: /gen/<token>.srt  y  /x/<b64 url ARD>.srt ─────────────────
  const genM = subPath.match(/^\/gen\/([^/]+?)(?:\.srt)?$/);
  const xM = subPath.match(/^\/x\/([^/]+?)(?:\.srt)?$/);
  if (genM || xM) {
    let src: { t: string; u?: string; f?: number; r: string };
    try {
      if (xM) {
        const u = b64u.dec(xM[1]);
        src = { t: "ard", u, r: u };
      } else {
        src = JSON.parse(b64u.dec(genM![1]));
      }
    } catch {
      return new Response("token inválido", { status: 400, headers: cors });
    }

    const cacheKey = ["translate-srt", "v8", src.r];
    let kv: Deno.Kv | null = null;
    try {
      kv = await getKv();
      const hit = await kv.get<string>(cacheKey);
      if (hit.value) {
        return new Response(hit.value, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
      }
    } catch { kv = null; }

    try {
      const baseCues = await fetchBaseCues(src);
      if (!baseCues.length) return new Response("subtítulo base vacío", { status: 502, headers: cors });

      const { texts, done } = await translateCues(baseCues, src.r, kv, Date.now() + TRANSLATE_BUDGET_MS);
      // El SRT final descarta las cues de puro sonido (ruido para quien mira en alemán).
      const outCues = baseCues
        .map((c, i) => ({ ...c, text: texts[i] }))
        .filter((c) => !isSoundOnly(c.text));
      const srt = serializeSrt(outCues);

      // Completa → cache 90 días. Parcial (algún lote nunca parseó — típico:
      // una escena que la IA se niega a devolver) → igual se cachea el SRT pero
      // 2 días, así las aperturas repetidas son instantáneas mientras el resto
      // ya está traducido; se re-genera solo pasado ese plazo por si mejora.
      if (kv) {
        const ttl = done ? TRANSLATE_CACHE_TTL_MS : 2 * 24 * 60 * 60 * 1000;
        try { await kv.set(cacheKey, srt, { expireIn: ttl }); } catch { /* sin cache */ }
      }
      return new Response(srt, {
        headers: {
          ...cors,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="es-latino.srt"',
          "X-Translate-Complete": String(done),
        },
      });
    } catch (e) {
      return new Response("Error generando traducción: " + (e as Error).message, { status: 502, headers: cors });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
}

// ════════════════════════════════════════════════════════════════════════
// ── /health — estado de config de las sub-funciones ──────────────────────
// ════════════════════════════════════════════════════════════════════════

function handleHealth(): Response {
  return jsonResponse({
    hub: "mejorastremio-hub",
    timestamp: new Date().toISOString(),
    subdl: { configured: !!SUBDL_KEY },
    opensubtitles: { configured: !!OPENSUBTITLES_API_KEY },
    opensubtitlesLatino: { configured: !!OPENSUBTITLES_API_KEY },
    latino: { configured: true },
    synopsis: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      geminiConfigured: !!GEMINI_API_KEY,
      openrouterConfigured: !!OPENROUTER_API_KEY,
    },
    miniseries: { configured: !!TMDB_KEY },
    shortSeries: { configured: !!TMDB_KEY },
    discover: { configured: !!TMDB_KEY },
    ufc: { configured: true },
    livetv: { configured: true },
    mediathek: { configured: true },
    translate: {
      configured: !!(GEMINI_API_KEY || OPENROUTER_API_KEY),
      baseSource: !!OPENSUBTITLES_API_KEY,
    },
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
          "/opensubtitles-latino/manifest.json",
          "/latino/manifest.json",
          "/synopsis/manifest.json",
          "/miniseries/manifest.json",
          "/short-series/manifest.json",
          "/discover/manifest.json",
          "/ufc/manifest.json",
          "/livetv/manifest.json",
          "/mediathek/manifest.json",
          "/translate/manifest.json",
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
    } else if (path.startsWith("/opensubtitles-latino")) {
      // Debe ir ANTES que "/opensubtitles" — ese startsWith también matchea este path.
      route = "opensubtitles-latino";
      const subPath = path.slice("/opensubtitles-latino".length) || "/";
      res = await handleOpenSubtitles(
        subPath,
        `${url.origin}/opensubtitles-latino`,
        OPENSUBTITLES_LATINO_MANIFEST,
        "ea",
        "opensubtitles-latino",
        "OpenSubtitles Latino",
      );
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
    } else if (path.startsWith("/short-series")) {
      route = "short-series";
      const subPath = path.slice("/short-series".length) || "/";
      res = await handleShortSeries(subPath);
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
    } else if (path.startsWith("/mediathek")) {
      route = "mediathek";
      const subPath = path.slice("/mediathek".length) || "/";
      res = await handleMediathek(subPath, `${url.origin}/mediathek`, `${url.origin}/translate`);
    } else if (path.startsWith("/translate")) {
      route = "translate";
      const subPath = path.slice("/translate".length) || "/";
      res = await handleTranslate(subPath, `${url.origin}/translate`);
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
