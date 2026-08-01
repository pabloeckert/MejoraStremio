/**
 * addon-signals.mjs — Heurísticas compartidas para interpretar streams/subtítulos crudos de los
 * addons instalados. Antes vivían duplicadas dentro de anti-frustration.mjs; se extrajeron acá para
 * que premiere-radar.mjs (y cualquier script futuro) las reuse en vez de reimplementarlas.
 */

// MyTrakt Sync devuelve "streams" que en realidad son botones de acción (Mark Watched / Add to
// Watchlist / etc, un mp4 de 27KB) para el scrobbling, no contenido real.
export function isUtilityStream(s) {
  return /^mytrakt-/.test(s.behaviorHints?.bingeGroup || '') || /\[MyTrakt\]/.test(s.name || '');
}

export function seedCount(text) {
  const m = String(text || '').match(/👤\s*([\d,.]+)/);
  return m ? parseInt(m[1].replace(/[,.]/g, ''), 10) : null;
}

// [TB+] (Torrentio) / [TB⚡] (Comet) = ya cacheado en TorBox: se sirve directo desde su servidor,
// no depende del swarm P2P vivo — un torrent con 👤 0 hoy igual reproduce si ya está cacheado.
// [TB download] / [TB⬇️] = TorBox todavía no lo tiene, necesita bajarlo del swarm primero.
export function isCachedStream(s) {
  return /\[TB\+\]|\[TB⚡\]/.test(s.name || '');
}

export function isRealStream(s) {
  if (isCachedStream(s)) return true;
  const text = `${s.title || ''}\n${s.name || ''}`;
  const seeds = seedCount(text);
  return seeds === null || seeds > 0; // null = addon HTTP sin contador de seeds
}

// Los 5 addons de subtítulos ya instalados devuelven el idioma como "es"/"spa" para un subtítulo
// real. Excluye a propósito etiquetas no estándar como la de SubMaker "Make Spanish (Latin
// America)" — esa es una traducción automática bajo demanda (ver CLAUDE.md), no un subtítulo ya
// hecho; no cuenta como cobertura real hasta que alguien la pida y se genere.
export function isSpanishLang(lang) {
  const s = String(lang || '').toLowerCase();
  return s === 'spa' || s.startsWith('es');
}
