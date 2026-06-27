/**
 * subdl-addon.mjs — Addon local de Stremio para subtítulos SubDL en español sin SDH.
 *
 * Qué hace:
 *   - Expone un addon Stremio en http://localhost:11337
 *   - Consulta SubDL API con hi=false (excluye subtítulos "para sordos")
 *   - Descarga los ZIPs de SubDL, extrae el SRT en memoria y lo sirve a Stremio
 *   - Funciona para películas (type=movie) y series (type=series)
 *
 * Uso:
 *   SUBDL_KEY=... node scripts/subdl-addon.mjs
 *
 * Instalar en Stremio:
 *   http://localhost:11337/manifest.json
 *
 * Requisitos: Node >= 20, env SUBDL_KEY.
 */

import http from 'node:http';
import { inflateRawSync } from 'node:zlib';

const KEY  = process.env.SUBDL_KEY || '';
const PORT = 11337;
const SUBDL_API  = 'https://api.subdl.com/api/v1/subtitles';
const SUBDL_DL   = 'https://dl.subdl.com';

if (!KEY) {
  console.error('Falta SUBDL_KEY. Uso: SUBDL_KEY=... node scripts/subdl-addon.mjs');
  process.exit(1);
}

// ── Manifest ─────────────────────────────────────────────────────────────────
const MANIFEST = {
  id: 'com.mejorastremio.subdl',
  version: '1.0.0',
  name: 'SubDL ES (sin SDH)',
  description: 'Subtítulos en español de SubDL. Filtra hearing-impaired (SDH) automáticamente.',
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
};

// ── ZIP extractor (pure Node.js, sin npm) ────────────────────────────────────
// Busca el primer archivo .srt dentro del ZIP y lo extrae.
function extractSrtFromZip(buf) {
  let i = 0;
  while (i < buf.length - 30) {
    // Local file header signature: PK 03 04
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method   = buf.readUInt16LE(i + 8);
      const cSize    = buf.readUInt32LE(i + 18);
      const fnLen    = buf.readUInt16LE(i + 26);
      const exLen    = buf.readUInt16LE(i + 28);
      const fn       = buf.slice(i + 30, i + 30 + fnLen).toString('utf8');
      const dataStart = i + 30 + fnLen + exLen;

      if (fn.toLowerCase().endsWith('.srt') && cSize > 0 && dataStart + cSize <= buf.length) {
        const data = buf.slice(dataStart, dataStart + cSize);
        try {
          return method === 0
            ? data.toString('utf8')              // sin compresión
            : inflateRawSync(data).toString('utf8'); // DEFLATE
        } catch {
          // intentar siguiente entrada
        }
      }
      i = dataStart + cSize;
    } else {
      i++;
    }
  }
  return null;
}

// ── SubDL API ─────────────────────────────────────────────────────────────────
async function fetchSubdlSubs(imdbId, season, episode) {
  let url = `${SUBDL_API}?api_key=${KEY}&imdb_id=${imdbId}&languages=ES&subs_per_page=20`;
  if (season  != null) url += `&season=${season}`;
  if (episode != null) url += `&episode=${episode}`;

  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) return [];
  const d = await r.json();

  return (d?.subtitles || [])
    .filter((s) => (s.language || '').toUpperCase() === 'ES' && s.hi === false)
    .map((s) => ({
      name: s.name || s.release_name || 'SubDL ES',
      subdlPath: s.url, // relative path, ej: /subtitle/xxx.zip?api_key=...
    }));
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS para Stremio
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // ── GET /manifest.json ───────────────────────────────────────────────────
  if (path === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(MANIFEST));
  }

  // ── GET /subtitles/{type}/{id}.json ─────────────────────────────────────
  // Ejemplos:
  //   /subtitles/movie/tt0133093.json
  //   /subtitles/series/tt0903747:1:1.json
  const subMatch = path.match(/^\/subtitles\/(movie|series)\/(.+)\.json$/);
  if (subMatch) {
    const [, type, rawId] = subMatch;
    const parts   = rawId.split(':');
    const imdbId  = parts[0];
    const season  = type === 'series' && parts[1] ? parseInt(parts[1], 10) : null;
    const episode = type === 'series' && parts[2] ? parseInt(parts[2], 10) : null;

    try {
      const subs = await fetchSubdlSubs(imdbId, season, episode);
      const subtitles = subs.map((s, idx) => ({
        id:   `subdl-${idx}-${imdbId}`,
        url:  `http://localhost:${PORT}/srt/${encodeURIComponent(s.subdlPath)}`,
        lang: 'spa',
        name: `[SubDL] ${s.name.replace(/\.(zip|srt)$/i, '')}`,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ subtitles }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ subtitles: [], error: e.message }));
    }
  }

  // ── GET /srt/{encodedSubdlPath} — proxy + unzip ─────────────────────────
  const srtMatch = path.match(/^\/srt\/(.+)$/);
  if (srtMatch) {
    const subdlPath = decodeURIComponent(srtMatch[1]);
    // subdlPath ya tiene ?api_key=... porque SubDL lo incluye en la URL
    const dlUrl = subdlPath.startsWith('http') ? subdlPath : `${SUBDL_DL}${subdlPath}`;

    try {
      const r = await fetch(dlUrl, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) { res.writeHead(502); return res.end('SubDL error: ' + r.status); }
      const buf = Buffer.from(await r.arrayBuffer());

      // Si es ZIP, extraer el SRT
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      const srtText = isZip ? extractSrtFromZip(buf) : buf.toString('utf8');

      if (!srtText) { res.writeHead(502); return res.end('No se encontró SRT en el ZIP'); }

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sub.srt"',
      });
      return res.end(srtText);
    } catch (e) {
      res.writeHead(502);
      return res.end('Error descargando: ' + e.message);
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SubDL ES addon corriendo en http://localhost:${PORT}`);
  console.log(`Instalar en Stremio: http://localhost:${PORT}/manifest.json`);
  console.log('Filtra hi=true (SDH) automáticamente. Ctrl+C para detener.\n');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Puerto ${PORT} en uso. ¿Ya está corriendo el addon?`);
  } else {
    console.error('Error del servidor:', e.message);
  }
  process.exit(1);
});
