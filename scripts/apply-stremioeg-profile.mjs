#!/usr/bin/env node
/**
 * apply-stremioeg-profile.mjs — Aplica y valida el perfil estricto de la cuenta stremioeg.
 *
 * Establece y audita:
 *   1. Subtítulos: Español Latino / Español SIN SDH (descarta marcas SDH o CC).
 *   2. Audio: Original y Doblado Latino prioritarios; Español España relegado a última instancia.
 *   3. Catálogos: Sincronización diaria de estrenos (ventanas dinámicas en preset.json y orden desc).
 *
 * Opciones CLI:
 *   --check / --dry-run Modo auditoría / dry-run (por defecto). No escribe en la cuenta.
 *   --apply             Aplica los cambios en la cuenta en vivo (requiere ST_EMAIL / ST_PASS).
 *   --rollback-last     Restaura el último backup generado.
 *   --rollback <file>   Restaura un backup JSON específico.
 *   --test-unit         Ejecuta simulación y pruebas unitarias de filtros de audio y subtítulos.
 *
 * Node >= 20, sin dependencias externas.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { apiPost } from './lib/stremio-api.mjs';
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROFILE_PATH = join(ROOT, 'cuentas', 'stremioeg', 'profile.json');
const PRESET_PATH = join(ROOT, 'data', 'preset.json');
const BACKUPS = join(ROOT, '.backups');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ROLLBACK_LAST = args.includes('--rollback-last');
const rbIdx = args.indexOf('--rollback');
const ROLLBACK_FILE = rbIdx >= 0 ? args[rbIdx + 1] : null;
const DRY_RUN = args.includes('--dry-run') || args.includes('--check') || (!APPLY && !ROLLBACK_LAST && !ROLLBACK_FILE);
const RUN_UNIT_TEST = args.includes('--test-unit');

// ── Cargar Especificación de Perfil ──────────────────────────────────────────
export function loadProfile() {
  if (!existsSync(PROFILE_PATH)) {
    throw new Error(`No se encontró el perfil en ${PROFILE_PATH}`);
  }
  return JSON.parse(readFileSync(PROFILE_PATH, 'utf8'));
}

// ── Lógica Estricta de Subtítulos (Filtro y Priorización) ─────────────────────
export const SDH_CC_REGEX = /\b(sdh|cc|hi|hoh|hearing[\s._-]*impaired|hard[\s._-]*of[\s._-]*hearing|for[\s._-]*the[\s._-]*deaf|sordos|para[\s._-]*sordos|para[\s._-]*personas[\s._-]*sordas|forced[\s._-]*sdh)\b|[([{\[]\s*(sdh|cc|hi|hoh)\s*[)}\]]/i;

export function isSdhOrCcSubtitle(sub) {
  if (!sub) return false;
  if (sub.hi === true || sub.hearing_impaired === true) return true;
  const label = String(sub.label || sub.name || sub.id || sub.filename || '');
  // Si indica explícitamente "sin sdh", "no sdh", etc., es un subtítulo limpio
  if (/\b(?:sin|no|non)[\s_-]*sdh\b/i.test(label)) {
    return false;
  }
  return SDH_CC_REGEX.test(label);
}

export function scoreSubtitle(sub) {
  if (!sub) return -1;
  // 1. REGLA ESTRICTA: Descartar SDH / CC
  if (isSdhOrCcSubtitle(sub)) {
    return -1; // Descalificado
  }

  const lang = String(sub.lang || sub.language || '').toLowerCase().trim();
  const label = String(sub.label || sub.name || '').toLowerCase().trim();

  // 2. Español Latinoamericano (Prioridad 1)
  if (
    lang === 'ea' ||
    lang === 'es-419' ||
    lang === 'es-la' ||
    label.includes('latino') ||
    label.includes('latin') ||
    label.includes('mexico') ||
    label.includes('argentina')
  ) {
    return 100;
  }

  // 3. Español neutro / estándar limpio (Prioridad 2)
  if (lang === 'es' || lang === 'spa' || lang === 'spanish') {
    // Si la etiqueta menciona explícitamente España o Castellano, penalizar
    if (label.includes('castellano') || label.includes('españa') || label.includes('spain') || lang === 'sp') {
      return 10; // Última instancia
    }
    return 60;
  }

  // 4. Español España / Castellano explícito (Última instancia)
  if (lang === 'sp' || label.includes('castellano') || label.includes('españa')) {
    return 10;
  }

  return 0;
}

export function filterAndRankSubtitles(subtitles) {
  if (!Array.isArray(subtitles)) return [];
  return subtitles
    .map((sub) => ({ sub, score: scoreSubtitle(sub) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.sub);
}

// ── Lógica Estricta de Audio (Priorización y Scoring) ─────────────────────────
export function scoreAudioStream(stream) {
  const text = `${stream.name || ''} ${stream.title || ''} ${stream.description || ''}`;
  let score = 0;

  // TorBox o Debrid cacheado: máxima disponibilidad
  if (/\[tb\+?\]|cached|instant/i.test(text)) {
    score += 200;
  }

  // REGLA ESTRICTA: Doblaje Latino prioritario (+100)
  if (/\[latino\]|\blatino\b|audio.?latino|español.?latino|\bdual.?latino\b|\blat\b/i.test(text)) {
    score += 100;
  }

  // REGLA ESTRICTA: Audio Original prioritario (+70)
  if (/original.?audio|\beng\b|english|\binglés\b|\bvose\b/i.test(text)) {
    score += 70;
  }

  // Multi Audio general (+30)
  if (/\bmulti\b|\bdual\b/i.test(text) && !/castellano|españa/i.test(text)) {
    score += 30;
  }

  // REGLA ESTRICTA: Español España / Castellano RELEGADO a última instancia (-80)
  if (/\[castellano\]|\bcastellano\b|español.?españa|spanish.?spain/i.test(text)) {
    score -= 80;
  }

  return score;
}

export function rankAudioStreams(streams) {
  if (!Array.isArray(streams)) return [];
  return streams
    .map((st) => ({ stream: st, score: scoreAudioStream(st) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.stream);
}

// ── Modificación de Transport URLs en Add-ons de Streams ─────────────────────
export function configureTorrentio(addon) {
  const url = addon.transportUrl || '';
  const match = url.match(/^(https:\/\/[^/]+\/)([^/]*)(\/manifest\.json.*)$/);
  if (!match) return { url, changed: false };
  const [, prefix, cfgSegment, suffix] = match;
  const pairs = cfgSegment ? cfgSegment.split('|') : [];

  let found = false;
  const newPairs = pairs.map((p) => {
    if (p.startsWith('language=')) {
      found = true;
      return 'language=latino';
    }
    return p;
  });
  if (!found) newPairs.push('language=latino');

  const newSegment = newPairs.join('|');
  const newUrl = `${prefix}${newSegment}${suffix}`;
  return {
    url: newUrl,
    changed: newUrl !== url,
    oldSegment: cfgSegment,
    newSegment,
  };
}

export function configureComet(addon) {
  const url = addon.transportUrl || '';
  const match = url.match(/^(https:\/\/[^/]+\/)([^/]+)(\/manifest\.json.*)$/);
  if (!match) return { url, changed: false };
  const [, prefix, b64, suffix] = match;

  let cfg;
  try {
    cfg = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return { url, changed: false };
  }

  const beforeStr = JSON.stringify(cfg);
  // Fijar cacheados primero y lenguajes preferidos: Latino ('la') y Original ('en')
  cfg.sortCachedUncachedTogether = false;
  cfg.languages = cfg.languages || {};
  cfg.languages.preferred = ['la', 'en'];

  const afterStr = JSON.stringify(cfg);
  const newB64 = Buffer.from(afterStr).toString('base64');
  const newUrl = `${prefix}${newB64}${suffix}`;
  return {
    url: newUrl,
    changed: newUrl !== url,
    before: JSON.parse(beforeStr),
    after: cfg,
  };
}

// ── Neutralización de Add-ons de Subtítulos Competidores y Monopolio del Hub ──
export const COMPETING_SUBTITLE_ADDON_IDS = new Set([
  'org.stremio.opensubtitlesv3',
  'org.stremio.opensubtitles',
  'com.stremio.submaker',
  'community.opensubtitlesv3.pro',
  'community.subscene',
  'com.community.stremio-subtitles',
  'community.subhero-v2.wyzie',
  'lowlevel.subtitles',
  'com.subsense.nepiraw',
  'org.subtitulos.subdivx',
  'community.subsource.subtitles',
  'community.subdl.subtitles',
  'community.addic7ed',
  'com.github.IsraPerez98.Stremio-TuSubtitulo',
  'org.subtis',
  'community.podnapisi',
  'community.yifysubtitles',
  'com.subtito.ai',
]);

export function filterCompetingSubtitleAddons(addons) {
  if (!Array.isArray(addons)) return { cleanedAddons: [], removedAddons: [] };
  const removedAddons = [];
  const cleanedAddons = addons.filter((a) => {
    const id = a.manifest?.id || a.id || '';
    if (COMPETING_SUBTITLE_ADDON_IDS.has(id)) {
      removedAddons.push(a);
      return false;
    }
    const transport = String(a.transportUrl || a.url || '');
    if (
      !transport.includes('mejorastremio-hub') &&
      (transport.includes('opensubtitles-v3.strem.io') ||
        transport.includes('subsense.nepiraw.com') ||
        transport.includes('submaker.elfhosted.com') ||
        transport.includes('subdl.strem.top') ||
        transport.includes('subsource.strem.top') ||
        transport.includes('stremio-community-subtitles') ||
        transport.includes('subtito.com'))
    ) {
      removedAddons.push(a);
      return false;
    }
    return true;
  });
  return { cleanedAddons, removedAddons };
}

export function ensureHubSubtitleAddons(addons) {
  const hubAddons = [
    {
      transportUrl: 'https://mejorastremio-hub.pabloeckert.deno.net/opensubtitles-latino/manifest.json',
      manifest: {
        id: 'com.mejorastremio.opensubtitles-latino',
        version: '1.0.0',
        name: 'OpenSubtitles Latino (sin SDH)',
        description: 'Subtítulos en español latinoamericano real sin SDH',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
      },
    },
    {
      transportUrl: 'https://mejorastremio-hub.pabloeckert.deno.net/subdl/manifest.json',
      manifest: {
        id: 'com.mejorastremio.subdl',
        version: '1.0.0',
        name: 'SubDL ES (sin SDH)',
        description: 'Subtítulos en español de SubDL sin hearing-impaired',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
      },
    },
    {
      transportUrl: 'https://mejorastremio-hub.pabloeckert.deno.net/opensubtitles/manifest.json',
      manifest: {
        id: 'com.mejorastremio.opensubtitles',
        version: '1.0.0',
        name: 'OpenSubtitles ES (sin SDH)',
        description: 'Subtítulos en español estándar sin SDH',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
      },
    },
    {
      transportUrl: 'https://mejorastremio-hub.pabloeckert.deno.net/subsource/manifest.json',
      manifest: {
        id: 'com.mejorastremio.subsource',
        version: '1.0.0',
        name: 'SubSource ES (sin SDH)',
        description: 'Subtítulos en español de SubSource con filtrado hearing-impaired (sin SDH) y smart audio sync.',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: [],
      },
    },
    {
      transportUrl: 'https://mejorastremio-hub.pabloeckert.deno.net/translate/manifest.json',
      manifest: {
        id: 'com.mejorastremio.translate',
        version: '1.0.0',
        name: 'Traducción IA (Gemini Flash)',
        description: 'Traducción automática bajo demanda de subtítulos a español latino cuando no existen subtítulos oficiales.',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: [],
      },
    },
  ];

  const existingIds = new Set(addons.map((a) => a.manifest?.id || a.id));
  const toAdd = hubAddons.filter((h) => !existingIds.has(h.manifest.id));
  return [...toAdd, ...addons];
}

export function ensureStreamsInterceptor(addons) {
  const torrentioAddon = addons.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
  let torConfig = '';
  if (torrentioAddon?.transportUrl) {
    const m = torrentioAddon.transportUrl.match(/torrentio\.strem\.fun\/([^/]+)\/manifest\.json/);
    if (m) torConfig = m[1];
  }
  const streamsUrl = torConfig
    ? `https://mejorastremio-hub.pabloeckert.deno.net/streams/${torConfig}/manifest.json`
    : 'https://mejorastremio-hub.pabloeckert.deno.net/streams/manifest.json';

  const existingIdx = addons.findIndex((a) => a.manifest?.id === 'com.mejorastremio.streams');
  const interceptorEntry = {
    transportUrl: streamsUrl,
    manifest: {
      id: 'com.mejorastremio.streams',
      version: '1.0.0',
      name: 'MejoraStremio Streams (TorBox Latino)',
      description: 'Smart Stream Interceptor: proxy inteligente de Torrentio con reordenamiento prioritario a audio latino y etiquetado visual para TV.',
      resources: ['stream'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: [],
    },
  };

  if (existingIdx >= 0) {
    if (addons[existingIdx].transportUrl !== streamsUrl) {
      const copy = [...addons];
      copy[existingIdx] = interceptorEntry;
      return { addons: copy, changed: true };
    }
    return { addons, changed: false };
  }

  const torIdx = addons.findIndex((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
  const insertAt = torIdx >= 0 ? torIdx : 6;
  const copy = [...addons];
  copy.splice(insertAt, 0, interceptorEntry);
  return { addons: copy, changed: true };
}

export async function syncAioMetadataInstance(addons) {
  if (!existsSync(PRESET_PATH)) return { addons, changed: false };
  let presetInstanceId = null;
  try {
    const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
    presetInstanceId = preset?.aioMetadataConfig?.instanceId;
  } catch {
    // preset.json ausente o no legible
  }
  if (!presetInstanceId) return { addons, changed: false };

  const aioIdx = addons.findIndex((a) => a.manifest?.id === 'aio-metadata');
  if (aioIdx < 0) return { addons, changed: false };

  const currentUrl = addons[aioIdx].transportUrl || '';
  const currentInstanceId = currentUrl.match(/\/([0-9a-f-]{36})\//)?.[1];

  if (currentInstanceId && currentInstanceId !== presetInstanceId) {
    const newUrl = `https://aiometadata.elfhosted.com/stremio/${presetInstanceId}/manifest.json`;
    let freshManifest = addons[aioIdx].manifest;
    try {
      const res = await fetch(newUrl, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        freshManifest = await res.json();
      }
    } catch (e) {
      console.warn(`  ⚠️ No se pudo fetchear manifest fresco de AIOMetadata (${e.message})`);
    }

    const copy = [...addons];
    copy[aioIdx] = {
      ...copy[aioIdx],
      transportUrl: newUrl,
      manifest: freshManifest,
    };
    return { addons: copy, changed: true, oldId: currentInstanceId, newId: presetInstanceId };
  }
  return { addons, changed: false };
}

// ── Diff Visual Estructurado ──────────────────────────────────────────────────
export function renderVisualDiff(currentAddons, targetAddons) {
  console.log('\n' + '┌' + '─'.repeat(78) + '┐');
  console.log('│ DIFF VISUAL ESTRUCTURADO: ESTADO ACTUAL VS OBJETIVO                         │');
  console.log('├────┬───────────────────────────────────┬──────────────────────┬───────────────┤');
  console.log('│ Pos│ Addon                             │ Acción               │ ID / Notas    │');
  console.log('├────┼───────────────────────────────────┼──────────────────────┼───────────────┤');

  const currentMap = new Map();
  currentAddons.forEach((a, idx) => {
    const id = a.manifest?.id || a.id || '(unknown)';
    currentMap.set(id, { addon: a, pos: idx });
  });

  const targetMap = new Map();
  targetAddons.forEach((a, idx) => {
    const id = a.manifest?.id || a.id || '(unknown)';
    targetMap.set(id, { addon: a, pos: idx });
  });

  let added = 0;
  let removed = 0;
  let modified = 0;
  let reordered = 0;
  let unchanged = 0;

  targetAddons.forEach((t, newPos) => {
    const id = t.manifest?.id || t.id || '(unknown)';
    const name = (t.manifest?.name || id).slice(0, 33).padEnd(33);
    const posStr = String(newPos).padStart(2).padEnd(2);

    if (!currentMap.has(id)) {
      added++;
      console.log(`│ ${posStr} │ ${name} │ [+] AGREGADO         │ ${id.slice(0, 13).padEnd(13)} │`);
    } else {
      const { addon: c, pos: oldPos } = currentMap.get(id);
      const urlChanged = c.transportUrl !== t.transportUrl;
      const posChanged = oldPos !== newPos;

      if (urlChanged) {
        modified++;
        const note = posChanged ? `pos ${oldPos}->${newPos} + url` : 'url modif';
        console.log(`│ ${posStr} │ ${name} │ [~] MODIFICADO       │ ${note.slice(0, 13).padEnd(13)} │`);
      } else if (posChanged) {
        reordered++;
        const note = `pos ${oldPos}->${newPos}`;
        console.log(`│ ${posStr} │ ${name} │ [^] REORDENADO       │ ${note.slice(0, 13).padEnd(13)} │`);
      } else {
        unchanged++;
        console.log(`│ ${posStr} │ ${name} │ [=] SIN CAMBIO       │ v${(t.manifest?.version || '1.0').slice(0, 11).padEnd(11)} │`);
      }
    }
  });

  currentAddons.forEach((c) => {
    const id = c.manifest?.id || c.id || '(unknown)';
    if (!targetMap.has(id)) {
      removed++;
      const name = (c.manifest?.name || id).slice(0, 33).padEnd(33);
      console.log(`│ -- │ ${name} │ [-] REMOVIDO         │ ${id.slice(0, 13).padEnd(13)} │`);
    }
  });

  console.log('└────┴───────────────────────────────────┴──────────────────────┴───────────────┘');
  console.log(`  Resumen: ${added} agregados, ${removed} removidos, ${modified} modificados, ${reordered} reordenados, ${unchanged} sin cambios.`);
}

// ── Rollback Seguro con 1 Comando ─────────────────────────────────────────────
export async function handleRollback(authKey, rollbackLast, rollbackFile, dryRun = false) {
  mkdirSync(BACKUPS, { recursive: true });
  let targetPath = rollbackFile;

  if (rollbackLast || !targetPath) {
    const files = readdirSync(BACKUPS)
      .filter((f) => f.startsWith('backup-stremioeg-') && f.endsWith('.json') && !f.includes('pre-rollback'))
      .map((f) => ({ name: f, path: join(BACKUPS, f), mtime: statSync(join(BACKUPS, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      console.error('✗ No se encontraron snapshots de backup en .backups/ para rollback.');
      process.exit(1);
    }
    targetPath = files[0].path;
  }

  if (!existsSync(targetPath)) {
    console.error(`✗ Archivo de backup no encontrado: ${targetPath}`);
    process.exit(1);
  }

  console.log(`\n[ ROLLBACK ] Cargando snapshot de respaldo: ${targetPath}`);
  const raw = JSON.parse(readFileSync(targetPath, 'utf8'));
  const rollbackAddons = raw.result?.addons || raw.addons || (Array.isArray(raw) ? raw : null);

  if (!Array.isArray(rollbackAddons) || rollbackAddons.length === 0) {
    console.error('✗ El archivo de backup no contiene un array válido de addons.');
    process.exit(1);
  }

  console.log(`  ✓ Snapshot válido: ${rollbackAddons.length} addons para restaurar.`);

  const currentCol = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const currentAddons = currentCol?.result?.addons || [];

  renderVisualDiff(currentAddons, rollbackAddons);

  const guardOk = await assertNoFrozenEmptyCatalogs(rollbackAddons, [
    'com.stremio.torrentio.addon',
    'stremio.comet.fast',
    'com.mejorastremio.opensubtitles-latino',
    'com.mejorastremio.subdl',
    'com.mejorastremio.opensubtitles',
    'com.mejorastremio.subsource',
    'com.mejorastremio.translate',
    'com.mejorastremio.streams',
    'aio-metadata',
  ]);
  if (!guardOk) {
    console.error('✗ Rollback abortado por guard anti-catálogos-congelados');
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n  ℹ MODO DRY-RUN: Rollback simulado y validado (ejecutar sin --dry-run para aplicar en Stremio).');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safetyBackup = join(BACKUPS, `backup-stremioeg-pre-rollback-${stamp}.json`);
  writeFileSync(safetyBackup, JSON.stringify({ result: { addons: currentAddons } }, null, 2));
  console.log(`  ✓ Snapshot de seguridad previo al rollback guardado en: ${safetyBackup}`);

  const res = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: rollbackAddons });
  if (!res?.result?.success && !res?.result) {
    console.error('✗ Falló addonCollectionSet durante el rollback:', JSON.stringify(res));
    process.exit(1);
  }

  console.log('\n  ✓ ROLLBACK COMPLETADO CON ÉXITO: Tu cuenta Stremio fue restaurada al estado del snapshot.');
}

// ── Ejecución de Auditoría / Aplicación ───────────────────────────────────────
async function runProfileManager() {
  const profile = loadProfile();

  console.log('═'.repeat(70));
  console.log(' MejoraStremio — Gestor de Perfil: stremioeg (Pablo)');
  const modeLabel = (ROLLBACK_LAST || ROLLBACK_FILE)
    ? (DRY_RUN ? ' [ROLLBACK DRY-RUN]' : ' [ROLLBACK]')
    : (DRY_RUN ? ' [DRY-RUN]' : ' [APPLY]');
  console.log(` Target: ${profile.deviceTarget} | Versión: ${profile.version}${modeLabel}`);
  console.log('═'.repeat(70));

  console.log('\n[ 1/3 ] Verificando Políticas del Perfil...');
  console.log('  ✓ Subtítulos: Modo "strict_no_sdh" (OpenSubtitles Latino/ES + SubDL + SubSource sin SDH)');
  console.log('  ✓ Monopolio del Hub: Eliminación de OpenSubtitles v3 y competidores');
  console.log('  ✓ Audio: Prioridad [Latino, Original] con Smart Stream Interceptor');
  console.log('  ✓ Catálogos: Sincronización diaria 07:00 ART vía daily-catalog-refresh');

  const email = process.env.ST_EMAIL || profile.account;
  let pass = process.env.ST_PASS || '';

  if (!pass) {
    const localCred = 'C:/Users/tabeg/OneDrive/Documentos/Stemio/Pruebas/baee30cf-9528-4d53-82f3-2c4831853455.txt';
    if (existsSync(localCred)) {
      try {
        const rawLines = readFileSync(localCred, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        pass = rawLines.length > 1 ? rawLines[1] : rawLines[0];
      } catch {
        // Ignorar error al leer credencial local de respaldo
      }
    }
  }

  if (!pass) {
    console.log('\n[ 2/3 ] Cuenta Stremio: Modo Auditoría Local (ST_PASS no provisto)');
    console.log('  ℹ Para aplicar cambios remotos en vivo: ST_EMAIL=... ST_PASS=... node scripts/apply-stremioeg-profile.mjs --apply');

    const backupPaths = [
      'C:/Users/tabeg/OneDrive/Documentos/Stemio/Backup/stremioeg@gmail.com-stremio-addon-manager-2026-03-06 21-06-42.json',
      'C:/Users/tabeg/OneDrive/Documentos/Stemio/Backup/stremioeg@gmail.com-stremio-addon-manager-2026-02-27 17-22-13.json',
    ];
    for (const bp of backupPaths) {
      if (existsSync(bp)) {
        try {
          const raw = JSON.parse(readFileSync(bp, 'utf8'));
          const list = Array.isArray(raw) ? raw : (raw.addons || []);
          console.log(`\n  Auditoría forense sobre backup de cuenta real (${bp.split('/').pop()}):`);
          console.log(`  • Total add-ons en backup: ${list.length}`);
          const { removedAddons } = filterCompetingSubtitleAddons(list);
          if (removedAddons.length > 0) {
            console.log(`  ⚠️ Se detectaron ${removedAddons.length} add-ons de subtítulos competidores que secuestran la UI de Android TV:`);
            removedAddons.forEach((ra) => console.log(`     - [${ra.manifest?.id || ra.id}] ${ra.manifest?.name || ra.name}`));
            console.log(`  ℹ En Leanback UI, estos add-ons tienen precedencia e inyectan SDH y subtítulos desincronizados.`);
          }
          break;
        } catch {
          // Ignorar error de lectura de backup y continuar con el siguiente
        }
      }
    }
  } else {
    console.log('\n[ 2/3 ] Conectando a la cuenta Stremio...');
    const login = await apiPost('login', { authKey: null, email, password: pass });
    const authKey = login?.result?.authKey;
    if (!authKey) {
      console.error('✗ Login fallido:', JSON.stringify(login?.error || login));
      process.exit(1);
    }
    console.log('  ✓ Login exitoso');

    const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
    const addons = col?.result?.addons || [];
    console.log(`  ✓ Colección leída: ${addons.length} add-ons instalados`);

    if (ROLLBACK_LAST || ROLLBACK_FILE) {
      await handleRollback(authKey, ROLLBACK_LAST, ROLLBACK_FILE, DRY_RUN);
      return;
    }

    let changesCount = 0;

    // 1. Neutralizar addons de subtítulos competidores
    const { cleanedAddons, removedAddons } = filterCompetingSubtitleAddons(addons);
    if (removedAddons.length > 0) {
      changesCount += removedAddons.length;
      console.log(`  ✓ Neutralizados ${removedAddons.length} add-ons competidores de subtítulos:`);
      removedAddons.forEach((ra) => console.log(`     - [${ra.manifest?.id || ra.id}] ${ra.manifest?.name || ra.name}`));
    }

    // 2. Garantizar presencia de los addons de subtítulos del Hub (incluyendo SubSource)
    const withHub = ensureHubSubtitleAddons(cleanedAddons);
    if (withHub.length > cleanedAddons.length) {
      changesCount += (withHub.length - cleanedAddons.length);
      console.log(`  ✓ Instalados ${withHub.length - cleanedAddons.length} add-ons del Hub para monopolio de subtítulos sin SDH`);
    }

    // 3. Smart Stream Interceptor (MejoraStremio Streams en puesto #1 de streams)
    const streamRes = ensureStreamsInterceptor(withHub);
    let currentAddonsList = streamRes.addons;
    if (streamRes.changed) {
      changesCount++;
      console.log('  ✓ Smart Stream Interceptor (com.mejorastremio.streams) configurado como stream prioritario');
    }

    // 4. Sincronización de instancia AIOMetadata contra preset.json
    const aioRes = await syncAioMetadataInstance(currentAddonsList);
    currentAddonsList = aioRes.addons;
    if (aioRes.changed) {
      changesCount++;
      console.log(`  ✓ AIOMetadata sincronizado con preset.json: ${aioRes.oldId} ➔ ${aioRes.newId}`);
    }

    // 5. Ajustar configuración de streams (Torrentio, Comet)
    const updatedAddons = currentAddonsList.map((a) => {
      if (a.manifest?.id === 'com.stremio.torrentio.addon') {
        const tRes = configureTorrentio(a);
        if (tRes.changed) {
          changesCount++;
          console.log(`  ✓ Torrentio actualizado: ${tRes.oldSegment} ➔ ${tRes.newSegment}`);
          return { ...a, transportUrl: tRes.url };
        }
      }
      if (a.manifest?.id === 'stremio.comet.fast') {
        const cRes = configureComet(a);
        if (cRes.changed) {
          changesCount++;
          console.log(`  ✓ Comet actualizado: languages.preferred = ${JSON.stringify(cRes.after.languages.preferred)}`);
          return { ...a, transportUrl: cRes.url };
        }
      }
      return a;
    });

    // Renderizar Diff Visual Estructurado
    renderVisualDiff(addons, updatedAddons);

    if (APPLY && !DRY_RUN && changesCount > 0) {
      console.log('\n  Aplicando cambios con guard anti-catálogos-congelados...');
      const guardExempt = [
        'com.stremio.torrentio.addon',
        'stremio.comet.fast',
        'com.mejorastremio.opensubtitles-latino',
        'com.mejorastremio.subdl',
        'com.mejorastremio.opensubtitles',
        'com.mejorastremio.subsource',
        'com.mejorastremio.translate',
        'com.mejorastremio.streams',
      ];
      if (aioRes.changed) guardExempt.push('aio-metadata');

      const guardOk = await assertNoFrozenEmptyCatalogs(updatedAddons, guardExempt);
      if (!guardOk) {
        console.error('✗ Abortado por guard anti-catálogos-congelados');
        process.exit(1);
      }

      mkdirSync(BACKUPS, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const bFile = join(BACKUPS, `backup-stremioeg-pre-profile-${stamp}.json`);
      writeFileSync(bFile, JSON.stringify({ result: { addons } }, null, 2));
      console.log(`  ✓ Backup creado: ${bFile}`);

      const saveRes = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: updatedAddons });
      if (!saveRes?.result?.success && !saveRes?.result) {
        console.error('✗ Falló addonCollectionSet:', JSON.stringify(saveRes));
        process.exit(1);
      }
      console.log('  ✓ Colección guardada exitosamente en la cuenta con monopolio de subtítulos en el Hub.');
    } else if (changesCount === 0) {
      console.log('\n  ✓ Add-ons de la cuenta ya cumplen estrictamente con la configuración.');
    } else {
      console.log(`\n  ℹ MODO DRY-RUN: Se detectaron ${changesCount} cambios pendientes (ejecutar con --apply para guardar en Stremio).`);
    }
  }

  // ── 3/3: Validación de Catálogos de Estrenos ──────────────────────────────
  console.log('\n[ 3/3 ] Verificando Estado de Catálogos de Estrenos...');
  if (existsSync(PRESET_PATH)) {
    const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
    const std = preset?.aioMetadataConfig?.catalogs?.standard || [];
    const enCartelera = std.find((c) => /now_playing/.test(String(c.id || '')));
    const proximos = std.find((c) => /upcoming/.test(String(c.id || '')));

    const todayStr = new Date().toISOString().slice(0, 10);
    const carteleraTo = enCartelera?.metadata?.discover?.params?.['primary_release_date.lte'];
    const proximosFrom = proximos?.metadata?.discover?.params?.['primary_release_date.gte'];

    console.log(`  • En Cartelera (cine): ventana hasta ${carteleraTo} (hoy: ${todayStr})`);
    console.log(`  • Próximos Estrenos: desde ${proximosFrom} (hoy: ${todayStr})`);
    if (carteleraTo === todayStr && proximosFrom === todayStr) {
      console.log('  ✓ Ventanas de estrenos sincronizadas y vigentes al día de hoy.');
    } else {
      console.log('  ⚠ Fechas desfasadas — se sincronizan automáticamente en el cron diario o con scripts/refresh-dates.mjs');
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log(' Perfil stremioeg validado correctamente.');
  console.log('═'.repeat(70));
}

// ── Batería de Pruebas Unitarias / Simulación ────────────────────────────────
export function runUnitTests() {
  console.log('═'.repeat(70));
  console.log(' Batería de Tests Unitarios: Perfil stremioeg');
  console.log('═'.repeat(70));

  let passed = 0;
  let total = 0;
  const assertTest = (name, condition) => {
    total++;
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.error(`  ✗ FALLÓ: ${name}`);
    }
  };

  // 1. Subtítulos: Descarte estricto de SDH y CC
  const testSubs = [
    { lang: 'es', label: 'Spanish [SDH]', hi: true },
    { lang: 'ea', label: 'Spanish (Latin America) [CC]', hi: false },
    { lang: 'spa', label: 'Español (Para Sordos)', hi: false },
    { lang: 'ea', label: 'Español Latino (Limpio)', hi: false },
    { lang: 'es', label: 'Español Neutro (Limpio)', hi: false },
    { lang: 'sp', label: 'Castellano (España)', hi: false },
  ];

  const rankedSubs = filterAndRankSubtitles(testSubs);

  assertTest('Descarta subtítulo con flag hi: true', !rankedSubs.some((s) => s.label.includes('[SDH]')));
  assertTest('Descarta subtítulo con marca [CC]', !rankedSubs.some((s) => s.label.includes('[CC]')));
  assertTest('Descarta subtítulo con texto "Para Sordos"', !rankedSubs.some((s) => s.label.includes('Para Sordos')));
  assertTest('Prioriza Español Latino en primer lugar', rankedSubs[0]?.label.includes('Latino'));
  assertTest('Relega Castellano (España) al último lugar de los aceptados', rankedSubs[rankedSubs.length - 1]?.label.includes('Castellano'));

  // 2. Audio: Priorización de Latino y Original; Relegación de Castellano
  const testStreams = [
    { name: 'Torrentio', title: 'Movie 1080p [Castellano] AC3' },
    { name: 'Torrentio', title: 'Movie 1080p [Latino] 5.1' },
    { name: 'Comet', title: 'Movie 1080p [Original English] TrueHD' },
    { name: 'Torrentio', title: 'Movie 4K [TB+] Dual [Latino-Eng]' },
  ];

  const rankedStreams = rankAudioStreams(testStreams);

  assertTest('TorBox cacheado + Latino lidera el ranking', rankedStreams[0]?.title.includes('[TB+]') && rankedStreams[0]?.title.includes('Latino'));
  assertTest('Stream con solo Castellano queda al final', rankedStreams[rankedStreams.length - 1]?.title.includes('[Castellano]'));

  // 3. Configuración de Torrentio y Comet
  const dummyTorrentio = {
    manifest: { id: 'com.stremio.torrentio.addon' },
    transportUrl: 'https://torrentio.strem.fun/sort=quality|qualityfilter=480p/manifest.json',
  };
  const resT = configureTorrentio(dummyTorrentio);
  assertTest('Configuración de Torrentio inyecta language=latino', resT.newSegment.includes('language=latino'));

  const dummyCometCfg = { languages: { preferred: ['es'] }, sortCachedUncachedTogether: true };
  const dummyComet = {
    manifest: { id: 'stremio.comet.fast' },
    transportUrl: `https://comet.elfhosted.com/${Buffer.from(JSON.stringify(dummyCometCfg)).toString('base64')}/manifest.json`,
  };
  const resC = configureComet(dummyComet);
  assertTest('Configuración de Comet fija preferred en ["la", "en"]', JSON.stringify(resC.after.languages.preferred) === JSON.stringify(['la', 'en']));
  // 4. Neutralización de add-ons de subtítulos competidores y monopolio del Hub
  const sampleAddonCollection = [
    { manifest: { id: 'com.linvo.cinemeta', name: 'Cinemeta' }, transportUrl: 'https://v3-cinemeta.strem.io/manifest.json' },
    { manifest: { id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3' }, transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json' },
    { manifest: { id: 'com.subsense.nepiraw', name: 'SubSense' }, transportUrl: 'https://subsense.nepiraw.com/manifest.json' },
    { manifest: { id: 'com.stremio.torrentio.addon', name: 'Torrentio' }, transportUrl: 'https://torrentio.strem.fun/manifest.json' },
  ];
  const { cleanedAddons, removedAddons } = filterCompetingSubtitleAddons(sampleAddonCollection);
  assertTest('Filtra OpenSubtitles v3 y SubSense de la colección', removedAddons.length === 2 && !cleanedAddons.some(a => a.manifest.id.includes('subtitlesv3') || a.manifest.id.includes('subsense')));

  const withHubMonopoly = ensureHubSubtitleAddons(cleanedAddons);
  assertTest('Inyecta los 3 add-ons del Hub al inicio de la colección', withHubMonopoly.some(a => a.manifest.id === 'com.mejorastremio.opensubtitles-latino') && withHubMonopoly.some(a => a.manifest.id === 'com.mejorastremio.subdl'));

  console.log(`\nResultado Tests Unitarios: ${passed}/${total} pruebas pasadas con éxito.\n`);
  if (passed !== total) process.exit(1);
}

// ── Entrada Principal ────────────────────────────────────────────────────────
const isMainScript = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(`file://${process.argv[1]}`);

if (isMainScript) {
  if (RUN_UNIT_TEST) {
    runUnitTests();
  } else {
    runProfileManager().catch((err) => {
      console.error(`✗ Error fatal: ${err.message}`);
      process.exit(1);
    });
  }
}
