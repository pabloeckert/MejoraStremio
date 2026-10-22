/**
 * unified-hub.ts — Addon Unificado y Generador de Manifest/Configuración de MejoraStremio.
 *
 * Provee:
 * 1. Manifest raíz (/manifest.json) y parametrizado (/:config/manifest.json) para Stremio.
 * 2. Interfaz web interactiva Leanback (/configure y /:config/configure).
 * 3. Enrutamiento transparente hacia Streams (Torrentio + TorBox + Latino Priority) y
 *    Subtítulos (SubDL + OpenSubtitles Latino + Traducción IA Gemini Flash + SmartSync).
 */

import { cors, jsonResponse, safeGetKv } from "./utils/common.ts";
import { handleStreams } from "./streams/streams.ts";
import { handleSubdl } from "./subtitles/subdl.ts";
import { handleTranslate } from "./translate/translate.ts";
import { pushDualSubtitles, type SubtitleTrackPayload } from "./subtitles/smartsync.ts";
import { handleDiscover } from "./catalogs/tmdb.ts";
import { MEJORASTREMIO_HUB_MANIFEST } from "./manifest.ts";
import { buildParaVosCatalog } from "./catalogs/paravos.ts";
import { isCanaryActiveForProfile } from "./utils/canary_governance.ts";
import { resolveStreamSession } from "./streams/stream_security.ts";
import { fetchMovieHash, computeMovieHashFromBuffers } from "./subtitles/hasher.ts";

export { MEJORASTREMIO_HUB_MANIFEST, fetchMovieHash, computeMovieHashFromBuffers };

export async function computeSha256Etag(payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createManifestResponse(manifest: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(manifest);
  const etag = await computeSha256Etag(body);
  return new Response(body, {
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "ETag": `"${etag}"`,
    },
  });
}


export function renderConfigureHtml(configSegment: string, origin: string): string {
  const currentConfig = configSegment || "providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,nekobt,rutor,rutracker,comando,bludv,micoleaodublado,torrent9,ilcorsaronero,mejortorrent,wolfmax4k,cinecalidad,besttorrents|sort=seeders|qualityfilter=brremux,hdrall,dolbyvision,dolbyvisionwithhdr,threed,cam,scr,unknown,4k,480p|torbox=9fe5c202-15ec-4aeb-b4e7-8613728cf044|language=latino";

  const manifestHttpsUrl = `${origin}/${currentConfig}/manifest.json`;
  const manifestStremioUrl = manifestHttpsUrl.replace(/^https?:\/\//, "stremio://");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MejoraStremio Hub — Configuración del Addon</title>
  <style>
    :root {
      --bg: #0f111a;
      --card: #181b2a;
      --accent: #6c5ce7;
      --accent-hover: #5844e3;
      --text: #f1f2f6;
      --text-muted: #a4b0be;
      --border: #2f3542;
      --success: #2ed573;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      max-width: 680px;
      width: 100%;
      padding: 36px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    }
    .badge {
      display: inline-block;
      background: rgba(108, 92, 231, 0.2);
      color: var(--accent);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    p.desc {
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .features {
      list-style: none;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 28px;
    }
    .features li {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    input[type="text"] {
      width: 100%;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #0d0f17;
      color: var(--text);
      font-size: 14px;
      font-family: monospace;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }
    .btn {
      flex: 1;
      padding: 14px 20px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      border: none;
      transition: background 0.2s, transform 0.1s;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
    }
    .btn-primary:hover {
      background: var(--accent-hover);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    .guide {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }
    .guide h3 {
      font-size: 16px;
      margin-bottom: 12px;
    }
    .guide ol {
      padding-left: 20px;
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.6;
    }
    .guide code {
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      color: var(--text);
    }
  </style>
</head>
<body>
  <div class="container">
    <span class="badge">MejoraStremio v3.0 (Enterprise)</span>
    <h1>Hub Unificado de MejoraStremio</h1>
    <p class="desc">
      Smart Stream Interceptor (TorBox + Audio Latino) y suite completa de subtítulos limpios sin SDH, SmartSync (PAL 25 ➔ 23.976fps) y traducción IA Gemini Flash en un solo addon.
    </p>

    <ul class="features">
      <li>🌎 Prioridad Doblaje Latino (#1)</li>
      <li>⚡ TorBox Debrid Instantáneo</li>
      <li>🎧 Francés/Inglés Original Identificado</li>
      <li>🤖 Subtítulos IA Gemini Flash</li>
      <li>🧹 Cero marcas SDH / CC</li>
      <li>⏱️ SmartSync (0% judder / drift)</li>
    </ul>

    <div class="form-group">
      <label>URL Canónica del Manifest (Copiar / Pegar en Stremio)</label>
      <input type="text" id="manifestUrl" value="${manifestHttpsUrl}" readonly onclick="this.select()">
    </div>

    <div class="actions">
      <a href="${manifestStremioUrl}" class="btn btn-primary" id="installBtn">Instalar en Stremio</a>
      <button class="btn btn-secondary" onclick="copyUrl()">Copiar Enlace</button>
    </div>

    <div class="guide">
      <h3>Sincronización en Android TV / TV Box</h3>
      <ol>
        <li>Hacé click en <strong>"Instalar en Stremio"</strong> en tu computadora o celular con la sesión de <code>stremioeg@gmail.com</code> abierta.</li>
        <li>O copiá la URL de arriba y pegala en el buscador de Addons de Stremio.</li>
        <li>En la TV Box, abrí <strong>Ajustes ➔ Aplicaciones ➔ Stremio ➔ Forzar detención</strong> (o reiniciá la TV Box) para refrescar la colección remota.</li>
      </ol>
    </div>
  </div>

  <script>
    function copyUrl() {
      const input = document.getElementById('manifestUrl');
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        alert('¡Enlace del manifest copiado al portapapeles!');
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Agregador de Subtítulos para el Addon Unificado (/subtitles/:type/:id.json).
 * Consulta SubDL, SubSource y Translate en paralelo para ofrecer la mejor combinación.
 */
export async function handleUnifiedSubtitles(
  subPath: string,
  _mountBase: string,
  reqUrl: URL,
): Promise<Response> {
  const subtitles: SubtitleTrackPayload[] = [];
  const origin = reqUrl.origin;

  // Ejecución paralela resiliente
  const [subdlRes, transRes] = await Promise.allSettled([
    handleSubdl(subPath, `${origin}/subdl`, reqUrl).then((r) => r.ok ? r.json() : null),
    handleTranslate(subPath, `${origin}/translate`, reqUrl).then((r) => r.ok ? r.json() : null),
  ]);

  // 1. Agregar subtítulos comunitarios limpios (SubDL)
  if (subdlRes.status === "fulfilled" && subdlRes.value?.subtitles) {
    const list = subdlRes.value.subtitles as SubtitleTrackPayload[];
    for (const sub of list) {
      if (!subtitles.some((s) => s.id === sub.id)) {
        subtitles.push(sub);
      }
    }
  }

  // 2. Agregar traducción IA Gemini Flash como fallback garantizado
  if (transRes.status === "fulfilled" && transRes.value?.subtitles) {
    const list = transRes.value.subtitles as SubtitleTrackPayload[];
    for (const sub of list) {
      if (!subtitles.some((s) => s.id === sub.id)) {
        subtitles.push(sub);
      }
    }
  }

  // Si ambos fallaron o quedaron vacíos, garantizar subtítulo IA de última instancia
  if (subtitles.length === 0) {
    pushDualSubtitles(subtitles, {
      id: "ia-unified-fallback",
      url: `${origin}/translate/gen/fallback.srt`,
      label: "⚡ 1. Latino (IA Gemini) · [Traducción IA]",
      name: "⚡ 1. Latino (IA Gemini) · [Traducción IA]",
    }, true);
  }

  return jsonResponse({ subtitles });
}

/**
 * Dispatcher del Hub Unificado: procesa peticiones en raíz o con prefijo de configuración.
 */
export function extractProfileFromConfig(configSegment?: string | null): string {
  if (!configSegment) return "default";
  for (const part of configSegment.split("|")) {
    if (part.startsWith("profile=")) {
      return part.slice("profile=".length).trim();
    }
  }
  const clean = configSegment.toLowerCase().trim();
  if (["stremiojn", "stremioeg", "solotveg"].includes(clean)) {
    return clean;
  }
  return "default";
}

export function getManifestWithVersion(reqUrl?: URL) {
  const versionParam = reqUrl?.searchParams?.get("v");
  if (versionParam === "1.4.1") {
    return {
      ...MEJORASTREMIO_HUB_MANIFEST,
      version: "1.4.1",
      description: "[ROLLBACK BASELINE v1.4.1] " + MEJORASTREMIO_HUB_MANIFEST.description,
    };
  }
  return MEJORASTREMIO_HUB_MANIFEST;
}

export async function getCanaryManifest(
  reqUrl?: URL,
  configSegment?: string,
  customKv?: Deno.Kv | null,
): Promise<Record<string, unknown>> {
  const versionParam = reqUrl?.searchParams?.get("v");
  if (versionParam === "1.4.1") {
    return getManifestWithVersion(reqUrl) as unknown as Record<string, unknown>;
  }

  const profile = reqUrl?.searchParams?.get("profile") || extractProfileFromConfig(configSegment);
  const kv = customKv ?? (await safeGetKv());
  const canaryStatus = await isCanaryActiveForProfile(profile, kv);

  if (canaryStatus.active) {
    return {
      ...MEJORASTREMIO_HUB_MANIFEST,
      version: "1.5.0-rc",
      description: "[CANARY v1.5.0-RC · stremiojn] " + MEJORASTREMIO_HUB_MANIFEST.description,
      catalogs: [
        {
          type: "movie",
          id: "paravos",
          name: "Para vos (Recomendado)",
          extra: [{ name: "skip" }],
        },
        {
          type: "series",
          id: "paravos",
          name: "Para vos (Series)",
          extra: [{ name: "skip" }],
        },
        ...MEJORASTREMIO_HUB_MANIFEST.catalogs,
      ],
    };
  }

  return MEJORASTREMIO_HUB_MANIFEST as unknown as Record<string, unknown>;
}

export async function handleUnifiedHub(
  path: string,
  origin: string,
  reqUrl: URL,
  customKv?: Deno.Kv | null,
): Promise<Response | null> {
  // 1. Manifest raíz: /manifest.json (soporta ?v=1.4.1 para rollback rápido / cache-busting inverso)
  if (path === "/manifest.json") {
    const manifest = await getCanaryManifest(reqUrl, undefined, customKv);
    return await createManifestResponse(manifest);
  }

  // Stream session redirection: /stream_session/:id
  const streamSessionMatch = path.match(/^\/stream_session\/([^/]+)$/);
  if (streamSessionMatch) {
    const sessionIdOrHex = streamSessionMatch[1];
    const realUrl = await resolveStreamSession(sessionIdOrHex, customKv);
    if (realUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          ...cors,
          "Location": realUrl,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }
    return new Response("Stream session expired or not found", { status: 404, headers: cors });
  }

  // Moviehash probe endpoint: /subtitles/hash?streamUrl=...
  if (path === "/subtitles/hash") {
    const targetUrl = reqUrl.searchParams.get("streamUrl") || reqUrl.searchParams.get("url");
    if (targetUrl) {
      const hashInfo = await fetchMovieHash(targetUrl);
      return jsonResponse(hashInfo || { error: "Failed to calculate moviehash" });
    }
    return jsonResponse({ error: "Parámetro 'streamUrl' requerido" }, { status: 400 });
  }

  // 2. Página de configuración raíz: /configure
  if (path === "/configure") {
    const html = renderConfigureHtml("", origin);
    return new Response(html, {
      headers: {
        ...cors,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  const RESERVED_PREFIXES = new Set([
    "subdl", "opensubtitles", "opensubtitles-latino", "subdivx",
    "subsource", "latino", "synopsis", "miniseries", "short-series",
    "discover", "ufc", "livetv", "iptv", "mediathek", "translate",
    "streams", "stream", "stream_session", "subtitles", "catalog", "health", "configure", "manifest.json",
  ]);

  // 3. Manifest parametrizado: /:config/manifest.json (soporta ?v=1.4.1 y canario)
  const configManifestMatch = path.match(/^\/([^/]+)\/manifest\.json$/);
  if (configManifestMatch) {
    const config = configManifestMatch[1];
    if (!RESERVED_PREFIXES.has(config)) {
      const manifest = await getCanaryManifest(reqUrl, config, customKv);
      return await createManifestResponse(manifest);
    }
  }

  // 4. Página de configuración parametrizada: /:config/configure
  const configConfigureMatch = path.match(/^\/([^/]+)\/configure$/);
  if (configConfigureMatch) {
    const config = configConfigureMatch[1];
    if (!RESERVED_PREFIXES.has(config)) {
      const html = renderConfigureHtml(config, origin);
      return new Response(html, {
        headers: {
          ...cors,
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }
  }

  // 5. Streams parametrizados: /:config/stream/:type/:id.json
  const configStreamMatch = path.match(/^\/([^/]+)\/(?:stream|streams)\/(movie|series)\/(.+)\.json$/);
  if (configStreamMatch) {
    const configSegment = configStreamMatch[1];
    if (!RESERVED_PREFIXES.has(configSegment)) {
      const type = configStreamMatch[2];
      const rawId = configStreamMatch[3];
      const subPath = `/${configSegment}/stream/${type}/${rawId}.json`;
      return await handleStreams(subPath, reqUrl);
    }
  }

  // 6. Streams directos en raíz: /stream/:type/:id.json
  const directStreamMatch = path.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
  if (directStreamMatch) {
    return await handleStreams(path, reqUrl);
  }

  // 7. Subtítulos parametrizados: /:config/subtitles/:type/:id.json
  const configSubsMatch = path.match(/^\/([^/]+)\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (configSubsMatch) {
    const configSegment = configSubsMatch[1];
    if (!RESERVED_PREFIXES.has(configSegment)) {
      const type = configSubsMatch[2];
      const rawId = configSubsMatch[3];
      const subPath = `/subtitles/${type}/${rawId}.json`;
      return await handleUnifiedSubtitles(subPath, `${origin}/subtitles`, reqUrl);
    }
  }

  // 8. Subtítulos directos en raíz: /subtitles/:type/:id.json
  const directSubsMatch = path.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (directSubsMatch) {
    return await handleUnifiedSubtitles(path, `${origin}/subtitles`, reqUrl);
  }

  // 9. Catálogos parametrizados: /:config/catalog/:type/:id.json
  const configCatMatch = path.match(/^\/([^/]+)\/catalog\/(movie|series)\/([^/]+)(?:\/([^/]+))?\.json$/);
  if (configCatMatch) {
    const configSegment = configCatMatch[1];
    if (!RESERVED_PREFIXES.has(configSegment)) {
      const type = configCatMatch[2] as "movie" | "series";
      const catId = configCatMatch[3];
      if (catId === "paravos") {
        const kv = customKv ?? (await safeGetKv());
        if (kv) {
          const profile = reqUrl.searchParams.get("profile") || extractProfileFromConfig(configSegment);
          const data = await buildParaVosCatalog(kv, profile, type);
          return jsonResponse(data);
        }
        return jsonResponse({ metas: [] });
      }
      const extra = configCatMatch[4] ? `/${configCatMatch[4]}` : "";
      const subPath = `/catalog/${type}/${catId}${extra}.json`;
      return await handleDiscover(subPath, reqUrl);
    }
  }

  // 10. Catálogos directos en raíz: /catalog/:type/:id.json
  const directCatMatch = path.match(/^\/catalog\/(movie|series)\/([^/]+)(?:\/([^/]+))?\.json$/);
  if (directCatMatch) {
    const type = directCatMatch[1] as "movie" | "series";
    const catId = directCatMatch[2];
    if (catId === "paravos") {
      const kv = customKv ?? (await safeGetKv());
      if (kv) {
        const profile = reqUrl.searchParams.get("profile") || "default";
        const data = await buildParaVosCatalog(kv, profile, type);
        return jsonResponse(data);
      }
      return jsonResponse({ metas: [] });
    }
    return await handleDiscover(path, reqUrl);
  }

  return null;
}
