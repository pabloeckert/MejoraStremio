/**
 * proxy.ts — Proxy Sanitizador y Re-sincronizador de Subtítulos.
 */

import { cors, decodeSubtitleText } from "../utils/common.ts";
import { rescaleSrtFramerate, cleanSrt } from "./smartsync.ts";
import { extractSrtFromZip } from "./subdl.ts";
import { verifyProxyUrl, getHmacProxyKeys, signProxyUrl } from "../utils/crypto_security.ts";

export async function handleSubtitleProxy(url: URL): Promise<Response> {
  // Verificación de firma criptográfica y expiración (P8) si la URL incluye sig o exp
  if (url.searchParams.has("sig") || url.searchParams.has("exp")) {
    const { activeKey, previousKey } = getHmacProxyKeys();
    const verification = await verifyProxyUrl(url, activeKey, previousKey);
    if (!verification.valid) {
      if (verification.expired) {
        return new Response("Firma de proxy expirada (anti-replay)", { status: 403, headers: cors });
      }
      return new Response("Firma HMAC de proxy invalida o manipulada", { status: 403, headers: cors });
    }
  }

  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return new Response("Falta el parametro url", { status: 400, headers: cors });
  }

  let host = "";
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    return new Response("URL invalida", { status: 400, headers: cors });
  }

  const allowed = [
    "dl.subdl.com",
    "api.opensubtitles.com",
    "opensubtitles.org",
    "api.subdl.com",
    "strem.fun",
    "stremio-subdivx.xor.ar",
    "subdivx.com",
    "www.subdivx.com",
    "mejorastremio-hub.pabloeckert.deno.net",
  ];
  if (!allowed.some((h) => host === h || host.endsWith("." + h))) {
    return new Response("Host no permitido para proxy de subtitulos", { status: 403, headers: cors });
  }

  try {
    const r = await fetch(targetUrl, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return new Response(`Upstream error ${r.status}`, { status: 502, headers: cors });
    const buf = new Uint8Array(await r.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    let srtText = isZip ? await extractSrtFromZip(buf) : decodeSubtitleText(buf);
    if (!srtText) return new Response("No se pudo decodificar el subtítulo", { status: 502, headers: cors });

    const fps = url.searchParams.get("fps");
    const offsetStr = url.searchParams.get("offset");
    const offsetMs = offsetStr ? parseInt(offsetStr, 10) || 0 : 0;
    const fromFps = url.searchParams.get("fromFps") ? parseFloat(url.searchParams.get("fromFps")!) : null;
    const toFps = url.searchParams.get("toFps") ? parseFloat(url.searchParams.get("toFps")!) : null;

    if (fromFps && toFps) {
      srtText = rescaleSrtFramerate(srtText, fromFps, toFps, offsetMs);
    } else if (fps === "25to23976" || fps === "pal_to_ntsc") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 23.976, offsetMs);
    } else if (fps === "23976to25" || fps === "ntsc_to_pal") {
      srtText = rescaleSrtFramerate(srtText, 23.976, 25.0, offsetMs);
    } else if (fps === "25to24") {
      srtText = rescaleSrtFramerate(srtText, 25.0, 24.0, offsetMs);
    } else if (fps === "24to25") {
      srtText = rescaleSrtFramerate(srtText, 24.0, 25.0, offsetMs);
    } else if (offsetMs !== 0) {
      srtText = rescaleSrtFramerate(srtText, 1.0, 1.0, offsetMs);
    }

    const cleaned = cleanSrt(srtText);
    const format = url.searchParams.get("format");
    const contentType = format === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8";

    return new Response(cleaned, {
      headers: {
        ...cors,
        "Content-Type": contentType,
        "Content-Disposition": 'attachment; filename="sub.srt"',
      },
    });
  } catch (e) {
    return new Response(`Error proxying subtitle: ${(e as Error).message}`, { status: 500, headers: cors });
  }
}

/**
 * Construye una URL firmada de proxy de subtítulos con expiración y HMAC-SHA256.
 */
export async function buildSignedSubtitleProxyUrl(
  baseOrigin: string,
  targetUrl: string,
  extraParams?: Record<string, string>,
  activeKeyOverride?: string,
  ttlSeconds = 3600,
): Promise<string> {
  const { activeKey } = getHmacProxyKeys();
  const keyToUse = activeKeyOverride || activeKey;
  const u = new URL(`${baseOrigin.replace(/\/+$/, "")}/proxy`);
  u.searchParams.set("url", targetUrl);
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      u.searchParams.set(k, v);
    }
  }
  return await signProxyUrl(u, keyToUse, ttlSeconds);
}
