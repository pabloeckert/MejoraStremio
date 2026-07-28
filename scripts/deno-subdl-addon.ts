/**
 * deno-subdl-addon.ts — Addon Stremio para subtítulos SubDL en español sin SDH.
 * Versión Deno Deploy de scripts/subdl-addon.mjs (Node.js local → nube gratuita).
 *
 * Deploy: deno.com/deploy → conectar repo pabloeckert/MejoraStremio →
 *   entry point: scripts/deno-subdl-addon.ts
 *   env var: SUBDL_KEY=<tu key>
 *
 * Una vez deployado, instalar en Stremio:
 *   https://<proyecto>.deno.dev/manifest.json
 *
 * Requiere: Deno Deploy (gratis, sin tarjeta). No requiere node ni npm.
 */

const KEY = Deno.env.get("SUBDL_KEY") ?? "";
const SUBDL_API = "https://api.subdl.com/api/v1/subtitles";
const SUBDL_DL = "https://dl.subdl.com";

const MANIFEST = {
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

// ── ZIP extractor (puro Web API, sin dependencias) ───────────────────────────
async function extractSrtFromZip(buf: Uint8Array): Promise<string | null> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 0;
  while (i < buf.length - 30) {
    // Local file header: PK\x03\x04
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
          // DEFLATE raw (method=8 en ZIP)
          const ds = new DecompressionStream("deflate-raw");
          const writer = ds.writable.getWriter();
          await writer.write(data);
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

// ── SubDL API ─────────────────────────────────────────────────────────────────
interface SubdlSub { name: string; subdlPath: string }

async function fetchSubdlSubs(
  imdbId: string,
  season: number | null,
  episode: number | null,
): Promise<SubdlSub[]> {
  let url =
    `${SUBDL_API}?api_key=${KEY}&imdb_id=${imdbId}&languages=ES&subs_per_page=20`;
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

// ── Servidor (Deno Deploy usa Deno.serve, no escucha en puerto fijo) ──────────
Deno.serve(async (req: Request): Promise<Response> => {
  const reqUrl = new URL(req.url);
  const path = reqUrl.pathname;
  // baseUrl se deriva del request → funciona igual en local y en Deno Deploy
  const baseUrl = reqUrl.origin;

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
  };

  if (!KEY) {
    return new Response(
      "SUBDL_KEY no configurada. Setear en el dashboard de Deno Deploy.",
      { status: 503, headers: cors },
    );
  }

  // ── /manifest.json ─────────────────────────────────────────────────────────
  if (path === "/manifest.json") {
    return new Response(JSON.stringify(MANIFEST), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // ── /subtitles/{type}/{id}.json ────────────────────────────────────────────
  const subMatch = path.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, type, rawId] = subMatch;
    const parts = rawId.split(":");
    const imdbId = parts[0];
    const season = type === "series" && parts[1] ? parseInt(parts[1], 10) : null;
    const episode = type === "series" && parts[2]
      ? parseInt(parts[2], 10)
      : null;

    try {
      const subs = await fetchSubdlSubs(imdbId, season, episode);
      const subtitles = subs.map((s, idx) => ({
        id: `subdl-${idx}-${imdbId}`,
        url: `${baseUrl}/srt/${encodeURIComponent(s.subdlPath)}`,
        lang: "spa",
        name: `[SubDL] ${s.name.replace(/\.(zip|srt)$/i, "")}`,
      }));
      return new Response(JSON.stringify({ subtitles }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ subtitles: [], error: (e as Error).message }),
        { status: 500, headers: cors },
      );
    }
  }

  // ── /srt/{encodedPath} — proxy + unzip ────────────────────────────────────
  const srtMatch = path.match(/^\/srt\/(.+)$/);
  if (srtMatch) {
    const subdlPath = decodeURIComponent(srtMatch[1]);
    const dlUrl = subdlPath.startsWith("http")
      ? subdlPath
      : `${SUBDL_DL}${subdlPath}`;

    // Guard anti-SSRF: sin este chequeo, cualquiera puede pedir /srt/http://cualquier-host y
    // este endpoint actúa de proxy HTTP abierto no autenticado. Los subtítulos reales siempre
    // vienen de dl.subdl.com — cualquier otro host se rechaza.
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
        return new Response("SubDL error: " + r.status, {
          status: 502,
          headers: cors,
        });
      }
      const buf = new Uint8Array(await r.arrayBuffer());
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      const srtText = isZip
        ? await extractSrtFromZip(buf)
        : new TextDecoder().decode(buf);

      if (!srtText) {
        return new Response("No se encontró SRT en el ZIP", {
          status: 502,
          headers: cors,
        });
      }
      return new Response(srtText, {
        headers: {
          ...cors,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="sub.srt"',
        },
      });
    } catch (e) {
      return new Response("Error descargando: " + (e as Error).message, {
        status: 502,
        headers: cors,
      });
    }
  }

  return new Response("Not found", { status: 404, headers: cors });
});
