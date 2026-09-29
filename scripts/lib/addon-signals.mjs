/**
 * addon-signals.mjs â€” HeurÃ­sticas compartidas para interpretar streams/subtÃ­tulos crudos de los
 * addons instalados. Antes vivÃ­an duplicadas dentro de anti-frustration.mjs; se extrajeron acÃ¡ para
 * que premiere-radar.mjs (y cualquier script futuro) las reuse en vez de reimplementarlas.
 */

// MyTrakt Sync devuelve "streams" que en realidad son botones de acciÃ³n (Mark Watched / Add to
// Watchlist / etc, un mp4 de 27KB) para el scrobbling, no contenido real.
export function isUtilityStream(s) {
  return /^mytrakt-/.test(s.behaviorHints?.bingeGroup || '') || /\[MyTrakt\]/.test(s.name || '');
}

export function seedCount(text) {
  const m = String(text || '').match(/ðŸ‘¤\s*([\d,.]+)/);
  return m ? parseInt(m[1].replace(/[,.]/g, ''), 10) : null;
}

// [TB+] (Torrentio) / [TBâš¡] (Comet) = ya cacheado en TorBox: se sirve directo desde su servidor,
// no depende del swarm P2P vivo â€” un torrent con ðŸ‘¤ 0 hoy igual reproduce si ya estÃ¡ cacheado.
// [TB download] / [TBâ¬‡ï¸] = TorBox todavÃ­a no lo tiene, necesita bajarlo del swarm primero.
export function isCachedStream(s) {
  return /\[TB\+\]|\[TBâš¡\]/.test(s.name || '');
}

export function isRealStream(s) {
  if (isCachedStream(s)) return true;
  const text = `${s.title || ''}\n${s.name || ''}`;
  const seeds = seedCount(text);
  return seeds === null || seeds > 0; // null = addon HTTP sin contador de seeds
}

// Los 5 addons de subtÃ­tulos ya instalados devuelven el idioma como "es"/"spa" para un subtÃ­tulo
// real. Excluye a propÃ³sito etiquetas no estÃ¡ndar como la de SubMaker "Make Spanish (Latin
// America)" â€” esa es una traducciÃ³n automÃ¡tica bajo demanda (ver GEMINI.md), no un subtÃ­tulo ya
// hecho; no cuenta como cobertura real hasta que alguien la pida y se genere.
export function isSpanishLang(lang) {
  const s = String(lang || '').toLowerCase();
  return s === 'spa' || s.startsWith('es');
}
