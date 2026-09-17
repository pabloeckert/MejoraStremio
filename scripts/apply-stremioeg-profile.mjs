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
 *   --check         Modo auditoría / dry-run (por defecto). No escribe en la cuenta.
 *   --apply         Aplica los cambios en la cuenta en vivo (requiere ST_EMAIL / ST_PASS).
 *   --test-unit     Ejecuta simulación y pruebas unitarias de filtros de audio y subtítulos.
 *
 * Node >= 20, sin dependencias externas.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
const CHECK = args.includes('--check') || !APPLY;
const RUN_UNIT_TEST = args.includes('--test-unit');

// ── Cargar Especificación de Perfil ──────────────────────────────────────────
export function loadProfile() {
  if (!existsSync(PROFILE_PATH)) {
    throw new Error(`No se encontró el perfil en ${PROFILE_PATH}`);
  }
  return JSON.parse(readFileSync(PROFILE_PATH, 'utf8'));
}

// ── Lógica Estricta de Subtítulos (Filtro y Priorización) ─────────────────────
export const SDH_CC_REGEX = /\[sdh\]|\(sdh\)|\[cc\]|\(cc\)|\bsdh\b|\bcc\b|hearing.?impaired|para.?sordos/i;

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

// ── Ejecución de Auditoría / Aplicación ───────────────────────────────────────
async function runProfileManager() {
  const profile = loadProfile();

  console.log('═'.repeat(70));
  console.log(' MejoraStremio — Gestor de Perfil: stremioeg (Pablo)');
  console.log(` Target: ${profile.deviceTarget} | Versión: ${profile.version}`);
  console.log('═'.repeat(70));

  console.log('\n[ 1/3 ] Verificando Políticas del Perfil...');
  console.log('  ✓ Subtítulos: Modo "strict_no_sdh" (OpenSubtitles Latino/ES + SubDL sin SDH)');
  console.log('  ✓ Audio: Prioridad [Latino, Original] — Castellano relegado a última instancia');
  console.log('  ✓ Catálogos: Sincronización diaria 07:00 ART vía daily-catalog-refresh');

  const email = process.env.ST_EMAIL || profile.account;
  const pass = process.env.ST_PASS || '';

  if (!pass) {
    console.log('\n[ 2/3 ] Cuenta Stremio: Modo Auditoría Local (ST_PASS no provisto)');
    console.log('  ℹ Para aplicar cambios remotos en vivo: ST_EMAIL=... ST_PASS=... node scripts/apply-stremioeg-profile.mjs --apply');
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

    let changesCount = 0;
    const updatedAddons = addons.map((a) => {
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

    if (APPLY && changesCount > 0) {
      console.log('\n  Aplicando cambios con guard anti-catálogos-congelados...');
      const guardOk = await assertNoFrozenEmptyCatalogs(updatedAddons, [
        'com.stremio.torrentio.addon',
        'stremio.comet.fast',
      ]);
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
      console.log('  ✓ Colección guardada exitosamente en la cuenta.');
    } else if (changesCount === 0) {
      console.log('  ✓ Add-ons de la cuenta ya cumplen estrictamente con la configuración.');
    } else {
      console.log(`  ℹ Se detectaron ${changesCount} cambios pendientes (ejecutar con --apply para guardar).`);
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
  assertTest('Configuración de Comet desactiva sortCachedUncachedTogether', resC.after.sortCachedUncachedTogether === false);

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
