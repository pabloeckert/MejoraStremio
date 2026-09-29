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
  const timestampRegex = /^(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/;
  const urlPattern = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9_-]+\.(?:com|org|net|io|me|tv|es|lat)\b/i;
  const sitePattern = /\b(?:subdivx|opensubtitles|tusubtitulo|subdl|addic7ed|argenteam|yify|yts|cuevana|gnula|cinetorrent|invision)\b/i;
  const creditPattern = /^(?:subt[ií]tulos?(?:\s+(?:por|de))?|traducci[oó]n(?:\s+(?:por|de))?|sincronizaci[oó]n(?:\s+(?:por|de))?|sincro|corregido\s+por|revisi[oó]n|supervisi[oó]n(?:\s+creativa)?|descargado\s+de|subt[ií]tulo\s+ofrecido\s+por|ajustes?\s+de\s+subt[ií]tulos?|adaptaci[oó]n|resync|ripped\s+by|encoded\s+by|synced\s+by|translated\s+by)\b(?:\s*[:\-–—]|\s+[A-ZÁÉÍÓÚÑa-záéíóúñ])/i;
  const soundCuesRegex = /^(?:m[uú]sica|musique|sonido|son|audio|disparos?|tirs?|gritos?|cris?|aplausos?|applaudissements|risas?|rires?|suspiros?|soupirs?|suspira|soupire|llanto|pleurs?|silbidos?|sifflements?|pasos|pas|jadeos?|halètements?|canción|chanson|tose|tousse|canta|chante|viento|vent|trueno|tonnerre|motor|moteur|timbre|sonnerie|teléfono|téléphone|golpes?|coups?|quejidos?|gémissements?|sollozos?|sanglots?|murmullos?|murmures?|ininteligible|inintelligible|chatarra|alarma|alarme|resopla|souffle|explosión|silencio|silence|jadea|bosteza|bâille)\b/i;

  const normalized = text.replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').replace(/\\[rn]/g, ' ');
  const blocks = normalized.split(/\n\s*\n/);
  const finalBlocks = [];
  let lastStartMs = -1;
  let cueCounter = 1;

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => timestampRegex.test(l));
    if (timeIdx === -1) continue;
    const timeLine = lines[timeIdx];
    const match = timeLine.match(timestampRegex);
    if (!match) continue;

    const startMs = srtTimeToMs(match[1]);
    const endMs = srtTimeToMs(match[2]);

    // Sanidad temporal: no aceptar duraciones nulas o negativas
    if (endMs <= startMs) continue;

    // Sanidad temporal: si el tiempo retrocede (salto atrás mayor a 2s), es un cue corrupto / watermark desplazado
    if (lastStartMs >= 0 && startMs < lastStartMs - 2000) continue;

    const rawTextLines = lines.slice(timeIdx + 1);

    // Descartar bloque entero si alguna línea es una marca de agua, URL o crédito de uploader
    const isCreditOrWatermarkCue = rawTextLines.some((l) => {
      const cleanLine = l.replace(/^[•\s\-_=~*|]+|[•\s\-_=~*|]+$/g, '').trim();
      return urlPattern.test(cleanLine) || sitePattern.test(cleanLine) || creditPattern.test(cleanLine);
    });
    if (isCreditOrWatermarkCue) continue;

    const textLines = rawTextLines
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
          // 6. Eliminar bullets y símbolos decorativos en bordes
          .replace(/^[•\s\-_=~*|]+|[•\s\-_=~*|]+$/g, '')
          // 7. Normalizar espacios
          .replace(/[ \t]{2,}/g, ' ')
          .trim();

        // 8. Descartar acotaciones sonoras típicas tanto en español como en francés
        if (soundCuesRegex.test(s)) {
          s = '';
        }
        return s;
      })
      .filter((l) => l.length > 0);

    if (textLines.length === 0) continue;

    lastStartMs = startMs;
    finalBlocks.push(`${cueCounter++}\n${timeLine}\n${textLines.join('\n')}`);
  }

  return finalBlocks.join('\n\n') + '\n';
}

export function sanitizeSubtitleText(text) {
  return cleanSrt(text);
}

