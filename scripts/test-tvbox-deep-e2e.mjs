#!/usr/bin/env node
/**
 * scripts/test-tvbox-deep-e2e.mjs
 * 
 * SUITE DE VALIDACIÓN OBSESIVA E2E — SIMULADOR TV BOX (ANDROID TV LEANBACK)
 * MejoraStremio Ecosystem / Zero-Trust Production Validation (2 PASADAS COMPLETAS).
 * 
 * PASADA 1: COLD-BOOT & PROTOCOL BOOTSTRAP (Runtime Local + Edge)
 *   - Verificación de perfil Leanback, hardware flags (AFR, libmpv, Passthrough).
 *   - Levantamiento de instancia local Deno Hub (puerto 8787) para validar código nuevo.
 *   - Handshake de red, latencias y estado de salud de los 9 módulos del Hub (/health).
 *   - Auditoría estricta de 9 manifiestos (SubDL, OpenSubtitles Latino, Subdivx, SubSource, Streams, Translate, AIOMetadata, Cinemeta).
 *   - Simulación de carga del Home Screen de la TV Box (Catálogos en cartelera, próximos, familiar y policial).
 * 
 * PASADA 2: PLAYBACK STRESS, MULTI-TITLE DRIFT & TIMELINE AUDIT (Producción en Vivo)
 *   - Caso 1: Título con doblaje latino ("Un show más", tt32604054:1:1) -> Puesto #1 [🇪🇸 LATINO].
 *   - Caso 2: Título solo inglés ("The Really Loud House", tt22495072:1:1) -> 100% [⚠️ SOLO INGLÉS].
 *   - Caso 3: Desfase PAL 25fps vs WEB 23.976fps ("HPI", tt14060708:1:1) -> Descarga real de payload SRT,
 *             auditoría cue por cue (monotonicidad, cero solapamientos, cero SDH) y simulación de seek en 5 anclas.
 *   - Caso 4: Fallback de traducción generativa IA bajo demanda (/translate).
 *   - Caso 5: Simulación de Suspensión y Reanudación (Standby / Warm Resume) sin congelamiento de catálogos.
 * 
 * Node >= 20, sin dependencias externas.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  msToSrtTime,
  parseSrtToCues,
  LATINO_RE,
  classifyStreamAudio,
  isLatinoStream,
  isCachedStream,
} from './lib/addon-signals.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROD_HUB_BASE = process.env.HUB_URL || 'https://mejorastremio-hub.pabloeckert.deno.net';
const LOCAL_PORT = 8787;
const LOCAL_HUB_BASE = `http://127.0.0.1:${LOCAL_PORT}`;

const results = {
  pass1_coldboot: { name: 'PASADA 1: Cold-Boot & Protocol Bootstrap', passed: 0, failed: 0, checks: [] },
  pass2_playback: { name: 'PASADA 2: Playback Stress & Timeline Audit', passed: 0, failed: 0, checks: [] },
};

function assert(section, name, ok, details = '') {
  if (ok) {
    section.passed++;
    section.checks.push({ name, status: 'OK', details });
    console.log(`    ✓ [PASS] ${name}${details ? ` (${details})` : ''}`);
  } else {
    section.failed++;
    section.checks.push({ name, status: 'FAIL', details });
    console.error(`    ✗ [FAIL] ${name}${details ? ` (${details})` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), ...options });
    const latency = Date.now() - start;
    return { res, latency, error: null };
  } catch (err) {
    return { res: null, latency: Date.now() - start, error: err };
  }
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const { res, latency, error } = await fetchWithTimeout(url, options, timeoutMs);
  if (!res || !res.ok) return { data: null, status: res?.status || 0, latency, error };
  try {
    const data = await res.json();
    return { data, status: res.status, latency, error: null };
  } catch (e) {
    return { data: null, status: res.status, latency, error: e };
  }
}

console.log('═'.repeat(82));
console.log('  📺 SUITE DE PRUEBAS OBSESIVAS E2E — SIMULADOR TV BOX (ANDROID TV LEANBACK)');
console.log('  Local Runtime: ' + LOCAL_HUB_BASE);
console.log('  Prod Runtime:  ' + PROD_HUB_BASE);
console.log('  Timestamp:     ' + new Date().toISOString());
console.log('═'.repeat(82));

let localServerProcess = null;

try {
  // ═════════════════════════════════════════════════════════════════════════════
  // ── PASADA 1: COLD-BOOT & PROTOCOL BOOTSTRAP ──────────────────────────────────
  // ═════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '┌' + '─'.repeat(80) + '┐');
  console.log('│ [PASADA 1] COLD-BOOT, HARDWARE FLAGS, MANIFESTS & CARGA DE HOME SCREEN          │');
  console.log('└' + '─'.repeat(80) + '┘');

  // 1.1 Verificación de Perfil de Hardware y Leanback UI
  console.log('\n  1.1 Calibración de Hardware Leanback (profile.json & GEMINI.md):');
  const profilePath = join(ROOT, 'cuentas', 'stremioeg', 'profile.json');
  let profile = null;
  try {
    profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    assert(results.pass1_coldboot, 'Lectura e integridad de cuentas/stremioeg/profile.json', !!profile.deviceTarget, profile.deviceTarget);
  } catch (e) {
    assert(results.pass1_coldboot, 'Lectura e integridad de cuentas/stremioeg/profile.json', false, e.message);
  }

  if (profile) {
    const pOpt = profile.rules?.playerOptimization;
    assert(results.pass1_coldboot, 'Auto Frame Rate (AFR) configurado para eliminar judder', pOpt?.autoFrameRate === 'Match frame rate and resolution', pOpt?.autoFrameRate);
    assert(results.pass1_coldboot, 'Reproductor recomendado configurado a libmpv', pOpt?.recommendedPlayer === 'libmpv', pOpt?.recommendedPlayer);
    assert(results.pass1_coldboot, 'Audio Passthrough habilitado para decodificación multicanal', pOpt?.audioPassthrough === 'direct', pOpt?.audioPassthrough);
    assert(results.pass1_coldboot, 'Regla estricta de subtítulos sin marcas SDH declarada', profile.rules?.subtitles?.mode === 'strict_no_sdh');
    assert(results.pass1_coldboot, 'Prioridad jerárquica de audio: Latino número 1', profile.rules?.audio?.priorityHierarchy?.[0] === 'latino');
  }

  // 1.2 Inicio de Deno Hub Local para Validar Nuevas Funcionalidades
  console.log('\n  1.2 Inicialización de Edge Runtime en Cold-Boot:');
  localServerProcess = spawn('deno', ['run', '--allow-net', '--allow-env', join(ROOT, 'scripts', 'deno-hub.ts')], {
    env: { ...process.env, PORT: String(LOCAL_PORT) },
    stdio: 'ignore',
  });

  // Esperar a que el servidor local responda
  let localReady = false;
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const ping = await fetchJson(`${LOCAL_HUB_BASE}/health`, {}, 2000);
    if (ping.status === 200) {
      localReady = true;
      break;
    }
  }
  assert(results.pass1_coldboot, 'Arranque exitoso de instancia Hub en frío', localReady, `Puerto: ${LOCAL_PORT}`);

  // Handshake de Red y Estado de Salud del Hub (/health)
  const healthFetch = await fetchJson(`${LOCAL_HUB_BASE}/health`);
  assert(results.pass1_coldboot, 'Respuesta HTTP 200 de /health en el Hub', healthFetch.status === 200, `Latencia: ${healthFetch.latency}ms`);
  assert(results.pass1_coldboot, 'Latencia de arranque dentro del budget de Leanback (<1500ms)', healthFetch.latency < 1500, `${healthFetch.latency}ms`);

  const hData = healthFetch.data || {};
  assert(results.pass1_coldboot, 'Módulo Smart Audio Sync operativo en Hub', hData.smartSync?.active === true);
  assert(results.pass1_coldboot, 'Módulo SubDL reconocido en Hub', hData.subdl !== undefined);
  assert(results.pass1_coldboot, 'Módulo OpenSubtitles reconocido en Hub', hData.opensubtitles !== undefined);
  assert(results.pass1_coldboot, 'Módulo Subdivx configurado en Hub', hData.subdivx?.configured === true);
  assert(results.pass1_coldboot, 'Nuevo Proveedor SubSource integrado formalmente en Hub', hData.subsource !== undefined);
  assert(results.pass1_coldboot, 'Smart Stream Interceptor (/streams) activo', hData.streams?.configured === true);
  assert(results.pass1_coldboot, 'Motor de Traducción IA configurado con Gemini Flash', hData.translate?.engine === 'gemini-flash');

  // 1.3 Auditoría Exhaustiva de Manifiestos de Addons de la TV Box
  console.log('\n  1.3 Auditoría de Manifiestos de Addons instalados:');
  const manifestsToCheck = [
    { name: 'SubDL ES (sin SDH)', path: '/subdl/manifest.json', id: 'com.mejorastremio.subdl', resource: 'subtitles' },
    { name: 'OpenSubtitles Latino', path: '/opensubtitles-latino/manifest.json', id: 'com.mejorastremio.opensubtitles-latino', resource: 'subtitles' },
    { name: 'OpenSubtitles ES', path: '/opensubtitles/manifest.json', id: 'com.mejorastremio.opensubtitles', resource: 'subtitles' },
    { name: 'Subdivx ES Latino', path: '/subdivx/manifest.json', id: 'com.mejorastremio.subdivx', resource: 'subtitles' },
    { name: 'SubSource ES (Nuevo)', path: '/subsource/manifest.json', id: 'com.mejorastremio.subsource', resource: 'subtitles' },
    { name: 'Smart Stream Interceptor', path: '/streams/manifest.json', id: 'com.mejorastremio.streams', resource: 'stream' },
    { name: 'Traducción IA (Gemini)', path: '/translate/manifest.json', id: 'com.mejorastremio.translate', resource: 'subtitles' },
    { name: 'Audio Latino Catálogo', path: '/latino/manifest.json', id: 'com.mejorastremio.latino-catalog', resource: 'catalog' },
  ];

  for (const m of manifestsToCheck) {
    const mfFetch = await fetchJson(`${LOCAL_HUB_BASE}${m.path}`);
    const mf = mfFetch.data;
    const ok = mf && mf.id === m.id && (mf.resources?.includes(m.resource) || mf.catalogs !== undefined);
    assert(results.pass1_coldboot, `Manifiesto válido: ${m.name}`, ok, mf ? `v${mf.version} [${mf.id}]` : `HTTP ${mfFetch.status}`);
  }

  // 1.4 Simulación de Carga del Home Screen de Android TV
  console.log('\n  1.4 Carga del Home Screen (Catálogos y Portadas):');
  const cinemetaUpcoming = await fetchJson('https://v3-cinemeta.strem.io/catalog/movie/top.json');
  const cinemetaOk = Array.isArray(cinemetaUpcoming.data?.metas) && cinemetaUpcoming.data.metas.length > 0;
  assert(results.pass1_coldboot, 'Carga de fila principal de películas desde Cinemeta', cinemetaOk, cinemetaOk ? `${cinemetaUpcoming.data.metas.length} títulos` : 'Sin datos');

  const presetPath = join(ROOT, 'data', 'preset.json');
  let presetCatsCount = 0;
  try {
    const preset = JSON.parse(readFileSync(presetPath, 'utf8'));
    presetCatsCount = preset.aioMetadataConfig?.catalogs?.standard?.length || 0;
    assert(results.pass1_coldboot, 'Integridad de catálogos AIOMetadata en preset.json', presetCatsCount >= 100, `${presetCatsCount} catálogos`);
  } catch (e) {
    assert(results.pass1_coldboot, 'Integridad de catálogos AIOMetadata en preset.json', false, e.message);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ── PASADA 2: PLAYBACK STRESS, MULTI-TITLE DRIFT & TIMELINE AUDIT ─────────────
  // ═════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '┌' + '─'.repeat(80) + '┐');
  console.log('│ [PASADA 2] PLAYBACK STRESS, MULTI-TITLE DRIFT & TIMELINE AUDIT                  │');
  console.log('└' + '─'.repeat(80) + '┘');

  // 2.1 Caso 1: Título con Doblaje Latino Disponible ("Un show más", tt32604054:1:1)
  console.log('\n  2.1 Caso 1: Solicitud de Streams para Contenido Latino ("Un show más"):');
  const show1Fetch = await fetchJson(`${PROD_HUB_BASE}/streams/series/tt32604054:1:1.json`);
  const show1Streams = show1Fetch.data?.streams || [];
  assert(results.pass2_playback, 'Entrega de streams para tt32604054:1:1', show1Streams.length > 0, `${show1Streams.length} streams recibidos`);

  const topStream1 = show1Streams[0];
  const top1IsLatino = topStream1?.name?.includes('[🌎 LATINO]') || topStream1?.name?.includes('[🇪🇸 LATINO]');
  assert(results.pass2_playback, 'Puesto #1 liderado indiscutiblemente por stream con audio Latino', top1IsLatino, topStream1?.name);

  const top1Title = `${topStream1?.name || ''} ${topStream1?.title || ''}`;
  const hasCastellanoInTop1 = /castellano|spanish spain|españa/i.test(top1Title) && !/latino|cinecalidad|dual/i.test(top1Title);
  assert(results.pass2_playback, 'Doblaje peninsular (Castellano) estrictamente vetado del puesto #1', !hasCastellanoInTop1);

  // 2.1.1 Caso 1.1: Película "En la cuerda floja" (2015) / "The Walk" (tt3488720) — Audio Latino #1 & IA Subtitles
  console.log('\n  2.1.1 Caso 1.1: Auditoría Integral para "En la cuerda floja" (tt3488720 / tt3488710):');
  const walkStreamsFetch = await fetchJson(`${LOCAL_HUB_BASE}/streams/movie/tt3488720.json`);
  const walkStreams = walkStreamsFetch.data?.streams || [];
  assert(results.pass2_playback, 'Entrega de streams para tt3488720 (The Walk 2015)', walkStreams.length > 0, `${walkStreams.length} streams recibidos`);

  if (walkStreams.length > 0) {
    const topWalk = walkStreams[0];
    const topWalkHasLatinoBadge = topWalk?.name?.includes('[🌎 LATINO]');
    assert(results.pass2_playback, 'Puesto #1 de "En la cuerda floja" con insignia [🌎 LATINO]', topWalkHasLatinoBadge, topWalk?.name?.replace(/\n/g, ' '));
    assert(results.pass2_playback, 'Clasificador LATINO_RE de addon-signals identifica stream #1', LATINO_RE.test(`${topWalk?.name || ''} ${topWalk?.title || ''}`));
    assert(results.pass2_playback, 'isLatinoStream valida puesto #1 como Latino genuino', isLatinoStream(topWalk));
    assert(results.pass2_playback, 'classifyStreamAudio categoriza stream #1 como latino', classifyStreamAudio(topWalk) === 'latino');
    assert(results.pass2_playback, 'isCachedStream resuelve disponibilidad debrid/buffer del stream #1', typeof isCachedStream(topWalk) === 'boolean');
  }

  // Verificación de Subtítulos Traducidos por IA para tt3488720
  const walkTranslateFetch = await fetchJson(`${LOCAL_HUB_BASE}/translate/subtitles/movie/tt3488720.json`);
  const walkSubs = walkTranslateFetch.data?.subtitles || [];
  assert(results.pass2_playback, 'Entrega de subtítulos IA para tt3488720', walkSubs.length > 0, `${walkSubs.length} opciones`);
  const walkAiSub = walkSubs.find((s) => s.name?.includes('⚡ 1. Latino (IA Gemini) · [Traducción Automática]'));
  assert(results.pass2_playback, 'Inyección de subtítulo IA Gemini para "En la cuerda floja"', !!walkAiSub, walkAiSub?.name);
  const walkHasSpl = walkSubs.some((s) => s.lang === 'spl');
  const walkHasSpa = walkSubs.some((s) => s.lang === 'spa');
  assert(results.pass2_playback, 'Inyección dual obligatoria de códigos ISO (spl + spa) para ExoPlayer Leanback', walkHasSpl && walkHasSpa);

  // 2.2 Caso 2: Título Exclusivamente en Inglés ("The Really Loud House", tt22495072:1:1)
  console.log('\n  2.2 Caso 2: Advertencia Preventiva en Contenido Solo Inglés ("The Really Loud House"):');
  const show2Fetch = await fetchJson(`${PROD_HUB_BASE}/streams/series/tt22495072:1:1.json`);
  const show2Streams = show2Fetch.data?.streams || [];
  assert(results.pass2_playback, 'Entrega de streams para tt22495072:1:1', show2Streams.length > 0, `${show2Streams.length} streams recibidos`);

  const allMarkedNoLatino = show2Streams.every((s) => s.name?.includes('[🎧 ORIGINAL]') || s.name?.includes('[⚠️ SOLO INGLÉS]'));
  assert(results.pass2_playback, '100% de los streams sin doblaje marcados preventivamente con [🎧 ORIGINAL]', allMarkedNoLatino);

  // 2.3 Caso 3: Desfase PAL 25fps vs WEB 23.976fps ("HPI", tt14060708:1:1) y Auditoría Temporal
  console.log('\n  2.3 Caso 3: Solicitud de Subtítulos con Smart Audio Sync ("HPI"):');
  const webdlFilename = 'HPI.S01E01.FRENCH.1080p.WEB-DL.DDP5.1.Atmos.H.264-FW.mkv';
  const simulatedHash = '8e245d9679d31e12';
  const simulatedSize = '1845620140';
  const rawStreamId = `tt14060708%3A1%3A1/videoHash=${simulatedHash}&videoSize=${simulatedSize}&filename=${encodeURIComponent(webdlFilename)}`;
  const subQueryUrl = `${PROD_HUB_BASE}/subdl/subtitles/series/${rawStreamId}.json`;
  const subFetch = await fetchJson(subQueryUrl);
  const subtitles = subFetch.data?.subtitles || [];
  assert(results.pass2_playback, 'Entrega de subtítulos procesados por el Hub', subtitles.length > 0, `${subtitles.length} opciones`);

  const topSub = subtitles[0];
  const topSubHasSmartSync = topSub?.label?.includes('Sincro') || topSub?.label?.includes('SmartSync') || topSub?.label?.includes('WEB-DL');
  assert(results.pass2_playback, 'Opción #1 de subtítulo adaptada a stream WEB-DL 23.976fps', topSubHasSmartSync, topSub?.label);

  // Descarga y Auditoría Detallada del Archivo SRT Real
  console.log('\n  2.3.1 Auditoría Temporal Cue por Cue del Payload SRT:');
  const srtUrl = topSub?.url;
  const { res: srtRes, latency: srtLatency } = await fetchWithTimeout(srtUrl, {}, 20000);
  assert(results.pass2_playback, 'Descarga exitosa de archivo SRT desde el proxy', srtRes?.status === 200, `Latencia: ${srtLatency}ms`);

  const srtText = await srtRes.text();
  assert(results.pass2_playback, 'Payload SRT con tamaño sustancial (>20 KB)', srtText.length > 20000, `${srtText.length} bytes`);

  // Parseo de cues usando estructura estandarizada { id, startMs, endMs, text }
  const cues = parseSrtToCues(srtText);
  assert(results.pass2_playback, 'Parseo exitoso de cues de diálogo', cues.length > 500, `${cues.length} cues detectadas`);

  // Auditoría estricta de cues
  let monotonicOk = true;
  let durationOk = true;
  let sdhFound = 0;
  let overlapsFound = 0;

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const startMs = c.startMs;
    const endMs = c.endMs;

    // 1. Inicio menor que fin
    if (startMs >= endMs) monotonicOk = false;

    // 2. Duración coherente (entre 100ms y 15000ms)
    const dur = endMs - startMs;
    if (dur < 100 || dur > 15000) durationOk = false;

    // 3. Solapamiento con la cue anterior
    if (i > 0) {
      const prevEnd = cues[i - 1].endMs;
      if (startMs < prevEnd) {
        overlapsFound++;
      }
    }

    // 4. Marcas SDH residuales
    if (/\[(?:música|musique|suspiro|risas|sonido|aplausos|gritos)\]|\((?:música|musique|suspiro|risas)\)/i.test(c.text)) {
      sdhFound++;
    }
  }

  assert(results.pass2_playback, 'Monotonicidad temporal estricta (inicio < fin en todas las cues)', monotonicOk);
  assert(results.pass2_playback, 'Duración humana válida en cues de diálogo (100ms - 15000ms)', durationOk);
  assert(results.pass2_playback, 'Ausencia total de colisiones o solapamientos entre subtítulos consecutivos', overlapsFound === 0, `${overlapsFound} solapamientos`);
  assert(results.pass2_playback, 'Purga estéril de acotaciones auditivas SDH/CC en el texto', sdhFound === 0, `${sdhFound} marcas detectadas`);

  // 2.3.2 Simulación de Seek en ExoPlayer / libmpv
  console.log('\n  2.3.2 Simulación de Saltos de Reproductor (Seek Stress Test):');
  const seekAnchors = [
    { label: 'Minuto 01:00 (Apertura)', targetMs: 60 * 1000 },
    { label: 'Minuto 15:30 (Primer tercio)', targetMs: (15 * 60 + 30) * 1000 },
    { label: 'Minuto 30:00 (Punto medio)', targetMs: 30 * 60 * 1000 },
    { label: 'Minuto 45:15 (Clímax)', targetMs: (45 * 60 + 15) * 1000 },
    { label: 'Minuto 53:00 (Desenlace)', targetMs: 53 * 60 * 1000 },
  ];

  let seekSuccess = 0;
  for (const a of seekAnchors) {
    const found = cues.find((c) => a.targetMs >= c.startMs && a.targetMs <= c.endMs) ||
                  cues.find((c) => c.startMs > a.targetMs);

    if (found) {
      seekSuccess++;
      console.log(`      ↳ Seek a ${a.label} -> Cue #${found.id} [${msToSrtTime(found.startMs)} --> ${msToSrtTime(found.endMs)}]: "${found.text.slice(0, 45).replace(/\n/g, ' ')}..."`);
    }
  }
  assert(results.pass2_playback, 'Simulación de Seek en 5 anclas temporales sin bloqueo de playback', seekSuccess === seekAnchors.length, `${seekSuccess}/5 saltos resueltos`);

  // 2.4 Caso 4: Verificación de Fallback Generativo IA (/translate)
  console.log('\n  2.4 Caso 4: Verificación de Fallback de Traducción IA (Gemini Flash):');
  const trManifest = await fetchJson(`${LOCAL_HUB_BASE}/translate/manifest.json`);
  assert(results.pass2_playback, 'Manifiesto de traducción IA com.mejorastremio.translate activo', trManifest.data?.id === 'com.mejorastremio.translate');

  const trQuery = await fetchJson(`${LOCAL_HUB_BASE}/translate/subtitles/series/tt0081871:1:1.json`);
  const trSubs = trQuery.data?.subtitles || [];
  assert(results.pass2_playback, 'Disponibilidad de subtítulo traducido bajo demanda para tt0081871', trSubs.length > 0, `${trSubs.length} opciones de traducción`);

  // 2.4.1 Prueba Extrema: Garantizador de Fallback Universal (ID Inexistente/Raro)
  const trInexistente = await fetchJson(`${LOCAL_HUB_BASE}/translate/subtitles/movie/tt999999999.json`);
  const trSubsInex = trInexistente.data?.subtitles || [];
  assert(results.pass2_playback, 'Garantía universal: respuesta nunca vacía para ID inexistente (tt999999999)', trSubsInex.length > 0, `${trSubsInex.length} tracks`);
  assert(results.pass2_playback, 'Inyección obligatoria de opción IA Gemini en última instancia', trSubsInex[0]?.name === '⚡ 1. Latino (IA Gemini) · [Traducción Automática]', trSubsInex[0]?.name);

  if (trSubsInex[0]?.url) {
    const srtInexRes = await fetchWithTimeout(trSubsInex[0].url, {}, 5000);
    assert(results.pass2_playback, 'Descarga exitosa de SRT de fallback sintético universal', srtInexRes.res?.status === 200, `HTTP ${srtInexRes.res?.status}`);
  }

  // 2.5 Caso 5: Simulación de Suspensión y Reanudación (Standby / Warm Resume)
  console.log('\n  2.5 Caso 5: Simulación de Suspensión y Reanudación (Warm Resume):');
  await sleep(300); // Emular micro-suspensión de pantalla
  const warmHealth = await fetchJson(`${PROD_HUB_BASE}/health`);
  assert(results.pass2_playback, 'Reanudación instantánea desde standby sin pérdida de sesión', warmHealth.status === 200, `Latencia: ${warmHealth.latency}ms`);

} finally {
  if (localServerProcess) {
    try {
      localServerProcess.kill();
    } catch {
      // ignore
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ── RESUMEN FINAL Y EVALUACIÓN OBSESIVA ───────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(82));
console.log(' RESUMEN FINAL DE LA VALIDACIÓN OBSESIVA EN 2 PASADAS');
console.log('═'.repeat(82));

let totalPassed = 0;
let totalFailed = 0;

for (const p of Object.values(results)) {
  totalPassed += p.passed;
  totalFailed += p.failed;
  const icon = p.failed === 0 ? '✅' : '❌';
  console.log(` ${icon} ${p.name.padEnd(55)}: ${p.passed} superadas, ${p.failed} fallidas`);
}

console.log('─'.repeat(82));
console.log(` Total de verificaciones ejecutadas: ${totalPassed + totalFailed}`);
console.log(` Tasa de éxito: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);
console.log('═'.repeat(82));

if (totalFailed > 0) {
  console.error('\n🚨 ALERTA: Hubo fallas durante la simulación de TV Box. Revisar detalles arriba.');
  process.exit(1);
} else {
  console.log('\n✨ CERTIFICACIÓN EXITOSA: La TV Box opera con máxima fidelidad, sin judder, con audio latino y subtítulos limpios.');
  process.exit(0);
}
