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
  return s === 'spa' || s === 'spl' || s.startsWith('es');
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

export function detectFramerate(name) {
  if (!name) return { fps: 23.976, standard: 'NTSC_WEB', tag: 'WEB-DL (asumido)', confidence: 'low' };
  const s = String(name).toLowerCase();

  // Señales explícitas de 25 fps (PAL / transmisiones de TV europea/británica)
  if (/\b(pal|hdtv|pdtv|dvb|dvb-t|dvb-s|tf1|ard|zdf|orf|bbc|itv|channel4|rte|25fps|25\.000|50fps|50i)\b/i.test(s)) {
    return { fps: 25.0, standard: 'PAL_25', tag: 'PAL/HDTV 25fps', confidence: 'high' };
  }

  // Señales de 23.976 fps (WEB-DL, rips NTSC, BluRay estándar)
  if (/\b(web-?dl|webrip|web\b|amzn|nf|netflix|dsnp|disney|atvp|apple\s?tv|hmax|max\.web|hulu|bluray|blu-ray|bdrip|brrip|23\.976|23\.98|23\.976fps)\b/i.test(s)) {
    return { fps: 23.976, standard: 'NTSC_WEB', tag: 'WEB-DL 23.976fps', confidence: 'high' };
  }

  // Señales de 24.000 fps (Cinema)
  if (/\b(24fps|24\.000|dci)\b/i.test(s)) {
    return { fps: 24.0, standard: 'FILM_24', tag: 'Cinema 24fps', confidence: 'high' };
  }

  // Señales de 29.97 fps (NTSC Broadcast)
  if (/\b(29\.97|29\.970|59\.94|60i)\b/i.test(s)) {
    return { fps: 29.97, standard: 'NTSC_TV', tag: 'NTSC Broadcast 29.97fps', confidence: 'high' };
  }

  return { fps: 23.976, standard: 'NTSC_WEB', tag: 'WEB-DL (estándar)', confidence: 'low' };
}

export function resolveSmartSync(videoName, subName) {
  const v = detectFramerate(videoName);
  const s = detectFramerate(subName);

  // Video WEB-DL (23.976) y subtítulo HDTV/PAL (25.0) -> Time-stretch factor 25 / 23.976 ≈ 1.042709
  if (Math.abs(v.fps - 23.976) < 0.05 && Math.abs(s.fps - 25.0) < 0.05) {
    return {
      needsRescale: true,
      fromFps: 25.0,
      toFps: 23.976,
      ratio: 25.0 / 23.976,
      actionDescription: 'Estiramiento temporal HDTV/PAL (25fps) -> WEB-DL (23.976fps) [+153.75s/h]',
      badge: '⚡ SmartSync (PAL 25->23.976 WEB)',
      fpsParam: '25to23976',
    };
  }

  // Video HDTV/PAL (25.0) y subtítulo WEB-DL (23.976) -> Time-compression factor 23.976 / 25.0 = 0.95904
  if (Math.abs(v.fps - 25.0) < 0.05 && Math.abs(s.fps - 23.976) < 0.05) {
    return {
      needsRescale: true,
      fromFps: 23.976,
      toFps: 25.0,
      ratio: 23.976 / 25.0,
      actionDescription: 'Compresión temporal WEB-DL (23.976fps) -> HDTV/PAL (25fps) [-147.46s/h]',
      badge: '⚡ SmartSync (WEB 23.976->25 PAL)',
      fpsParam: '23976to25',
    };
  }

  // Video Cinema (24.0) y subtítulo PAL (25.0)
  if (Math.abs(v.fps - 24.0) < 0.05 && Math.abs(s.fps - 25.0) < 0.05) {
    return {
      needsRescale: true,
      fromFps: 25.0,
      toFps: 24.0,
      ratio: 25.0 / 24.0,
      actionDescription: 'Estiramiento temporal PAL 25fps -> Cinema 24fps',
      badge: '⚡ SmartSync (PAL 25->24fps)',
      fpsParam: '25to24',
    };
  }

  // Coincidencia de framerate nativo
  return {
    needsRescale: false,
    fromFps: v.fps,
    toFps: v.fps,
    ratio: 1.0,
    actionDescription: `Calce nativo directo (${v.tag})`,
    badge: `✅ Sincro Nativo (${v.tag})`,
    fpsParam: 'none',
  };
}

export function parseSrtToCues(srt) {
  if (!srt) return [];
  const cues = [];
  const normalized = srt
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\[rn]/g, ' ');

  const blocks = normalized.split(/\n\s*\n/);
  const timestampRegex = /(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{1,3})/;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    const timeIdx = lines.findIndex((l) => timestampRegex.test(l));
    if (timeIdx === -1) continue;

    const match = lines[timeIdx].match(timestampRegex);
    if (!match) continue;

    const startMs = srtTimeToMs(match[1]);
    const endMs = srtTimeToMs(match[2]);
    if (endMs <= startMs) continue;

    const textLines = lines.slice(timeIdx + 1).map((l) => l.trim()).filter(Boolean);
    if (textLines.length === 0) continue;

    cues.push({
      id: cues.length + 1,
      startMs,
      endMs,
      text: textLines.join('\n'),
    });
  }

  return cues;
}

export function enforceMonotonicClamping(cues) {
  if (!cues || cues.length === 0) return [];
  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  for (let i = 0; i < cues.length - 1; i++) {
    const nextStart = cues[i + 1].startMs;
    if (cues[i].endMs >= nextStart) {
      cues[i].endMs = Math.max(cues[i].startMs + 50, nextStart - 5);
    }
    if (cues[i + 1].startMs <= cues[i].startMs) {
      cues[i + 1].startMs = cues[i].startMs + 5;
      if (cues[i + 1].endMs <= cues[i + 1].startMs) {
        cues[i + 1].endMs = cues[i + 1].startMs + 50;
      }
    }
    if (cues[i].endMs <= cues[i].startMs) {
      cues[i].endMs = cues[i].startMs + 50;
    }
  }

  cues.forEach((c, idx) => {
    c.id = idx + 1;
  });

  return cues;
}

export function serializeCuesToSrt(cues) {
  if (!cues || !cues.length) return '';
  return cues
    .map((c, idx) => `${idx + 1}\n${msToSrtTime(c.startMs)} --> ${msToSrtTime(c.endMs)}\n${c.text}`)
    .join('\n\n') + '\n';
}

export function rescaleSrtFramerate(srtText, fromFps, toFps, offsetMs = 0) {
  if (!srtText) return '';
  const cues = parseSrtToCues(srtText);
  if (!cues.length) return srtText;

  const factor = (fromFps && toFps && fromFps !== toFps) ? (fromFps / toFps) : 1.0;

  for (const c of cues) {
    if (factor !== 1.0 || offsetMs !== 0) {
      c.startMs = Math.max(0, Math.round(c.startMs * factor + offsetMs));
      c.endMs = Math.max(c.startMs + 50, Math.round(c.endMs * factor + offsetMs));
    }
  }

  const clamped = enforceMonotonicClamping(cues);
  return serializeCuesToSrt(clamped);
}

export function cleanSrt(text) {
  if (!text) return '';
  const cues = parseSrtToCues(text);
  if (!cues.length) return '';

  const urlPattern = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9_-]+\.(?:com|org|net|io|me|tv|es|lat)\b/i;
  const sitePattern = /\b(?:subdivx|opensubtitles|tusubtitulo|subdl|addic7ed|argenteam|yify|yts|cuevana|gnula|cinetorrent|invision)\b/i;
  const creditPattern = /^(?:subt[ií]tulos?(?:\s+(?:por|de))?|traducci[oó]n(?:\s+(?:por|de))?|sincronizaci[oó]n(?:\s+(?:por|de))?|sincro|corregido\s+por|revisi[oó]n|supervisi[oó]n(?:\s+creativa)?|descargado\s+de|subt[ií]tulo\s+ofrecido\s+por|ajustes?\s+de\s+subt[ií]tulos?|adaptaci[oó]n|resync|ripped\s+by|encoded\s+by|synced\s+by|translated\s+by)\b(?:\s*[:\-–—]|\s+[A-ZÁÉÍÓÚÑa-záéíóúñ])/i;
  const soundCuesRegex = /^(?:m[uú]sica|musique|sonido|son|audio|disparos?|tirs?|gritos?|cris?|aplausos?|applaudissements|risas?|rires?|suspiros?|soupirs?|suspira|soupire|llanto|pleurs?|silbidos?|sifflements?|pasos|pas|jadeos?|halètements?|canción|chanson|tose|tousse|canta|chante|viento|vent|trueno|tonnerre|motor|moteur|timbre|sonnerie|teléfono|téléphone|golpes?|coups?|quejidos?|gémissements?|sollozos?|sanglots?|murmullos?|murmures?|ininteligible|inintelligible|chatarra|alarma|alarme|resopla|souffle|explosión|silencio|silence|jadea|bosteza|bâille)\b/i;

  const filteredCues = [];

  for (const c of cues) {
    const rawLines = c.text.split('\n');
    const isCreditOrWatermarkCue = rawLines.some((l) => {
      const cleanLine = l.replace(/^[•\s\-_=~*|]+|[•\s\-_=~*|]+$/g, '').trim();
      return urlPattern.test(cleanLine) || sitePattern.test(cleanLine) || creditPattern.test(cleanLine);
    });
    if (isCreditOrWatermarkCue) continue;

    const cleanedLines = rawLines
      .map((line) => {
        let s = line
          .replace(/\[[^\]]*\]/g, '')
          .replace(/\([^)]*\)/g, '')
          .replace(/^[A-ZÁÉÍÓÚÑÀÂÇÉÈÊËÎÏÔÙÛÜŸ0-9\s._-]{2,30}:(?:\s*)/, '')
          .replace(/[♪♫#*]+/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/^[•\s\-_=~*|]+|[•\s\-_=~*|]+$/g, '')
          .replace(/[ \t]{2,}/g, ' ')
          .trim();

        if (soundCuesRegex.test(s)) {
          s = '';
        }
        return s;
      })
      .filter((l) => l.length > 0);

    if (cleanedLines.length > 0) {
      filteredCues.push({
        ...c,
        text: cleanedLines.join('\n'),
      });
    }
  }

  const clamped = enforceMonotonicClamping(filteredCues);
  return serializeCuesToSrt(clamped);
}

export function sanitizeSubtitleText(text) {
  return cleanSrt(text);
}

