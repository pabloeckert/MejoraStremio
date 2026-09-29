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

// ── Blindaje Anti-SDH y Sanitización de Subtítulos ─────────────────────────
export const SDH_CC_REGEX = /\b(sdh|cc|hi|hoh|hearing[\s._-]*impaired|hard[\s._-]*of[\s._-]*hearing|for[\s._-]*the[\s._-]*deaf|sordos|para[\s._-]*sordos|para[\s._-]*personas[\s._-]*sordas|forced[\s._-]*sdh)\b|[([{\[]\s*(sdh|cc|hi|hoh)\s*[)}\]]/i;

export function isSdhSubtitle(sub) {
  if (!sub) return false;
  if (sub.hi === true || sub.hearing_impaired === true) return true;
  const label = String(sub.label || sub.name || sub.id || sub.filename || '');
  if (/\b(?:sin|no|non)[\s._-]*sdh\b/i.test(label)) return false;
  return SDH_CC_REGEX.test(label);
}

export function srtTimeToMs(t) {
  const parts = String(t || '').trim().replace('.', ',').split(':');
  if (parts.length < 3) return 0;
  const [sec, ms] = parts[2].split(',');
  return (
    parseInt(parts[0], 10) * 3600000 +
    parseInt(parts[1], 10) * 60000 +
    parseInt(sec || '0', 10) * 1000 +
    parseInt(ms || '0', 10)
  );
}

export function msToSrtTime(ms) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = Math.floor(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rem).padStart(3, '0')}`;
}

export function rescaleSrtFramerate(srtText, fromFps, toFps) {
  if (!srtText || !fromFps || !toFps || fromFps === toFps) return srtText;
  const factor = fromFps / toFps;
  return srtText.replace(
    /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/g,
    (_m, start, end) => {
      const sMs = Math.round(srtTimeToMs(start) * factor);
      const eMs = Math.round(srtTimeToMs(end) * factor);
      return `${msToSrtTime(sMs)} --> ${msToSrtTime(eMs)}`;
    }
  );
}

export function cleanSrt(text) {
  if (!text) return '';
  const timestampRegex = /^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/;
  const normalized = text.replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').replace(/\\[rn]/g, ' ');
  const blocks = normalized.split(/\n\s*\n/);
  const finalBlocks = [];
  let cueCounter = 1;

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => timestampRegex.test(l));
    if (timeIdx === -1) continue;
    const timeLine = lines[timeIdx];
    const textLines = lines.slice(timeIdx + 1)
      .map((l) => {
        let s = l
          // 1. Eliminar corchetes completos y su contenido
          .replace(/\[[^\]]*\]/g, '')
          // 2. Eliminar paréntesis completos y su contenido
          .replace(/\([^)]*\)/g, '')
          // 3. Eliminar prefijos de hablantes en mayúsculas (incluyendo acentos franceses/españoles)
          .replace(/^[A-ZÁÉÍÓÚÑÀÂÇÉÈÊËÎÏÔÙÛÜŸ0-9\s._-]{2,30}:(?:\s*)/, '')
          // 4. Eliminar notas musicales y caracteres de sonido
          .replace(/[♪♫#*]+/g, '')
          // 5. Eliminar tags html tipo <i>, </i>, <font...>, etc.
          .replace(/<[^>]+>/g, '')
          // 6. Normalizar espacios
          .replace(/[ \t]{2,}/g, ' ')
          .trim();

        // 7. Descartar acotaciones sonoras típicas tanto en español como en francés
        const soundCuesRegex = /^(?:m[uú]sica|musique|sonido|son|audio|disparos?|tirs?|gritos?|cris?|aplausos?|applaudissements|risas?|rires?|suspiros?|soupirs?|suspira|soupire|llanto|pleurs?|silbidos?|sifflements?|pasos|pas|jadeos?|halètements?|canción|chanson|tose|tousse|canta|chante|viento|vent|trueno|tonnerre|motor|moteur|timbre|sonnerie|teléfono|téléphone|golpes?|coups?|quejidos?|gémissements?|sollozos?|sanglots?|murmullos?|murmures?|ininteligible|inintelligible|chatarra|alarma|alarme|resopla|souffle|explosión|silencio|silence|jadea|bosteza|bâille)\b/i;
        if (soundCuesRegex.test(s)) {
          s = '';
        }
        return s;
      })
      .filter((l) => l.length > 0);

    if (textLines.length === 0) continue;

    finalBlocks.push(`${cueCounter++}\n${timeLine}\n${textLines.join('\n')}`);
  }

  return finalBlocks.join('\n\n') + '\n';
}

export function sanitizeSubtitleText(text) {
  return cleanSrt(text);
}

