#!/usr/bin/env node
/**
 * test-stremioeg-tvbox.mjs — Triple testeo exhaustivo de punta a punta
 * para la configuración del perfil de la TV Box (cuenta stremioeg).
 *
 * Ejecuta:
 *   Test 1: Validación de Estructura (archivos de perfil, preset.json, fechas, workflows).
 *   Test 2: Simulación de Filtros (descarte estricto de SDH/CC y priorización de audio).
 *   Test 3: Verificación de Integración (conectividad a endpoints en vivo y salud de la colección).
 *
 * Node >= 20, sin dependencias externas.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { filterAndRankSubtitles, rankAudioStreams, isSdhOrCcSubtitle } from './apply-stremioeg-profile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const report = {
  test1_structure: { name: 'Validación de Estructura', passed: 0, failed: 0, items: [] },
  test2_filters: { name: 'Simulación de Filtros Audio / Subtítulos', passed: 0, failed: 0, items: [] },
  test3_integration: { name: 'Verificación de Integración y Endpoints', passed: 0, failed: 0, items: [] },
};

function record(section, name, ok, details = '') {
  if (ok) {
    section.passed++;
    section.items.push({ name, status: 'OK', details });
    console.log(`  ✓ ${name}${details ? ` — ${details}` : ''}`);
  } else {
    section.failed++;
    section.items.push({ name, status: 'FAIL', details });
    console.error(`  ✗ FALLÓ: ${name}${details ? ` — ${details}` : ''}`);
  }
}

// ── TEST 1: VALIDACIÓN DE ESTRUCTURA ─────────────────────────────────────────
console.log('═'.repeat(70));
console.log(' [TEST 1/3] Validación de Estructura de Configuración y Perfil');
console.log('═'.repeat(70));

const profileJsonPath = join(ROOT, 'cuentas', 'stremioeg', 'profile.json');
const profileClaudePath = join(ROOT, 'cuentas', 'stremioeg', 'CLAUDE.md');
const presetPath = join(ROOT, 'data', 'preset.json');
const workflowPath = join(ROOT, '.github', 'workflows', 'daily-catalog-refresh.yml');

// 1.1 Existencia y parseo de profile.json
let profile = null;
try {
  profile = JSON.parse(readFileSync(profileJsonPath, 'utf8'));
  record(report.test1_structure, 'cuentas/stremioeg/profile.json parseable y válido', true, `Target: ${profile.deviceTarget}`);
} catch (e) {
  record(report.test1_structure, 'cuentas/stremioeg/profile.json parseable y válido', false, e.message);
}

// 1.2 Reglas obligatorias en profile.json
if (profile) {
  const hasSub = profile.rules?.subtitles?.mode === 'strict_no_sdh';
  const hasAudio = profile.rules?.audio?.priorityHierarchy?.[0] === 'latino';
  const hasCatalogs = profile.rules?.catalogs?.dailySync === true;
  record(report.test1_structure, 'Reglas de subtítulos estrictos sin SDH declaradas', hasSub);
  record(report.test1_structure, 'Reglas de audio latino/original prioritario declaradas', hasAudio);
  record(report.test1_structure, 'Regla de sincronización diaria de catálogos declarada', hasCatalogs);
}

// 1.3 Documentación en cuentas/stremioeg/CLAUDE.md
const hasClaudeDoc = existsSync(profileClaudePath);
record(report.test1_structure, 'Documentación cuentas/stremioeg/CLAUDE.md presente', hasClaudeDoc);

// 1.4 Integridad de data/preset.json
let preset = null;
try {
  preset = JSON.parse(readFileSync(presetPath, 'utf8'));
  const catCount = preset?.aioMetadataConfig?.catalogs?.standard?.length || 0;
  record(report.test1_structure, 'Integridad de data/preset.json', catCount > 50, `${catCount} catálogos estándar`);
} catch (e) {
  record(report.test1_structure, 'Integridad de data/preset.json', false, e.message);
}

// 1.5 Fechas de estrenos al día
if (preset) {
  const std = preset.aioMetadataConfig?.catalogs?.standard || [];
  const enCartelera = std.find((c) => /now_playing/.test(String(c.id || '')));
  const proximos = std.find((c) => /upcoming/.test(String(c.id || '')));
  const todayStr = new Date().toISOString().slice(0, 10);
  const carteleraTo = enCartelera?.metadata?.discover?.params?.['primary_release_date.lte'];
  const proximosFrom = proximos?.metadata?.discover?.params?.['primary_release_date.gte'];
  const datesFresh = carteleraTo === todayStr && proximosFrom === todayStr;
  record(report.test1_structure, 'Fechas de "En Cartelera" y "Próximos Estrenos" sincronizadas a hoy', datesFresh, `Fecha: ${todayStr}`);
}

// 1.6 Workflow de refresco diario
if (existsSync(workflowPath)) {
  const wfContent = readFileSync(workflowPath, 'utf8');
  const hasCron = wfContent.includes('schedule:') && wfContent.includes('cron:');
  const runsRefresh = wfContent.includes('refresh-dates.mjs');
  record(report.test1_structure, 'Workflow daily-catalog-refresh.yml configurado con cron diario', hasCron && runsRefresh);
} else {
  record(report.test1_structure, 'Workflow daily-catalog-refresh.yml configurado con cron diario', false, 'Archivo no existe');
}

// ── TEST 2: SIMULACIÓN DE FILTROS DE AUDIO Y SUBTÍTULOS ──────────────────────
console.log('\n' + '═'.repeat(70));
console.log(' [TEST 2/3] Simulación Exhaustiva de Filtros (Audio y Subtítulos)');
console.log('═'.repeat(70));

// 2.1 Matriz de prueba de subtítulos
const testSubtitleDataset = [
  { id: 'sub-1', lang: 'es', label: 'Español Latino [SDH]', hi: true },
  { id: 'sub-2', lang: 'ea', label: 'Spanish (Latin America) [CC]', hi: false },
  { id: 'sub-3', lang: 'spa', label: 'Español - Para Sordos e Hipoacúsicos', hi: false },
  { id: 'sub-4', lang: 'es', label: 'Español (Hearing Impaired)', hi: false },
  { id: 'sub-5', lang: 'ea', label: 'Español Latinoamericano (SubDL)', hi: false },
  { id: 'sub-6', lang: 'es', label: 'Español Neutro (OpenSubtitles sin SDH)', hi: false },
  { id: 'sub-7', lang: 'sp', label: 'Castellano (España)', hi: false },
  { id: 'sub-8', lang: 'es', label: 'Español de España / Peninsular', hi: false },
];

const sdhFlagsDetected = testSubtitleDataset.filter(isSdhOrCcSubtitle).length;
record(report.test2_filters, 'Detección exhaustiva de marcas SDH / CC / Sordos', sdhFlagsDetected === 4, `Detectó ${sdhFlagsDetected}/4 con marcas`);

const filteredSubtitles = filterAndRankSubtitles(testSubtitleDataset);
const containsAnySdh = filteredSubtitles.some(isSdhOrCcSubtitle);
record(report.test2_filters, 'Descarte total de subtítulos SDH o CC de la lista final', !containsAnySdh, `${filteredSubtitles.length} subtítulos limpios conservados`);

const topSub = filteredSubtitles[0];
record(report.test2_filters, 'Primer subtítulo recomendado es Español Latino', topSub?.label?.includes('Latinoamericano') || topSub?.lang === 'ea', `Top: "${topSub?.label}"`);

const lastSub = filteredSubtitles[filteredSubtitles.length - 1];
record(report.test2_filters, 'Subtítulo Castellano queda estrictamente como último recurso', lastSub?.label?.includes('Castellano') || lastSub?.label?.includes('España'), `Último recurso: "${lastSub?.label}"`);

// 2.2 Matriz de prueba de streams de audio
const testStreamDataset = [
  { id: 'st-1', name: 'Torrentio', title: 'Gladiator (2000) 1080p BluRay x264 [Castellano] AC3' },
  { id: 'st-2', name: 'Torrentio', title: 'Gladiator (2000) 1080p BluRay x264 [Latino] DD5.1' },
  { id: 'st-3', name: 'Comet', title: 'Gladiator (2000) 1080p Remux [Original English] TrueHD 7.1' },
  { id: 'st-4', name: 'Torrentio [TB+]', title: 'Gladiator (2000) 4K UHD [TB+] Dual [Latino - English]' },
  { id: 'st-5', name: 'WebStreamr', title: 'Gladiator (2000) 720p Multi Audio' },
  { id: 'st-6', name: 'Torrentio', title: 'Gladiator (2000) 1080p [Spanish Spain] DDP5.1' },
];

const rankedStreams = rankAudioStreams(testStreamDataset);
const topStream = rankedStreams[0];
record(report.test2_filters, 'Stream TorBox + Dual Latino/English lidera el ranking', topStream?.title?.includes('[TB+]') && topStream?.title?.includes('Latino'), `Top stream: "${topStream?.title}"`);

const bottomStream = rankedStreams[rankedStreams.length - 1];
record(report.test2_filters, 'Streams exclusivos con Castellano quedan al fondo del ranking', bottomStream?.title?.includes('Castellano') || bottomStream?.title?.includes('Spanish Spain'), `Fondo: "${bottomStream?.title}"`);

const latinoRank = rankedStreams.findIndex((s) => s.title.includes('[Latino]'));
const castellanoRank = rankedStreams.findIndex((s) => s.title.includes('[Castellano]'));
record(report.test2_filters, 'Latino supera holgadamente a Castellano en posición relativa', latinoRank < castellanoRank, `Posiciones: Latino #${latinoRank + 1} vs Castellano #${castellanoRank + 1}`);

// ── TEST 3: VERIFICACIÓN DE INTEGRACIÓN Y ENDPOINTS EN VIVO ──────────────────
console.log('\n' + '═'.repeat(70));
console.log(' [TEST 3/3] Verificación de Integración de Cuenta y Endpoints');
console.log('═'.repeat(70));

const getJson = (url, timeoutMs = 8000) =>
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

// 3.1 Endpoints del Deno Hub en vivo
const hubEndpoints = [
  { name: 'Hub: SubDL ES (sin SDH)', url: 'https://mejorastremio-hub.pabloeckert.deno.net/subdl/manifest.json' },
  { name: 'Hub: OpenSubtitles Latino (sin SDH)', url: 'https://mejorastremio-hub.pabloeckert.deno.net/opensubtitles-latino/manifest.json' },
  { name: 'Hub: OpenSubtitles ES (sin SDH)', url: 'https://mejorastremio-hub.pabloeckert.deno.net/opensubtitles/manifest.json' },
  { name: 'Hub: Audio Latino Verificado (Catálogo)', url: 'https://mejorastremio-hub.pabloeckert.deno.net/latino/manifest.json' },
];

for (const ep of hubEndpoints) {
  const mf = await getJson(ep.url);
  const ok = mf && Boolean(mf.id && mf.name);
  record(report.test3_integration, `Endpoint en vivo: ${ep.name}`, ok, mf ? `v${mf.version} [${mf.id}]` : 'Sin respuesta');
}

// 3.2 Add-ons esenciales de streaming
const streamEndpoints = [
  { name: 'Torrentio Stremio Addon', url: 'https://torrentio.strem.fun/manifest.json' },
  { name: 'Cinemeta Oficial', url: 'https://v3-cinemeta.strem.io/manifest.json' },
];

for (const ep of streamEndpoints) {
  const mf = await getJson(ep.url);
  const ok = mf && Boolean(mf.id);
  record(report.test3_integration, `Endpoint en vivo: ${ep.name}`, ok, mf ? `v${mf.version}` : 'Sin respuesta');
}

// 3.3 Verificación de flags de compatibilidad TV Box
const leanbackSafe = profile?.deviceTarget?.toLowerCase().includes('tv');
record(report.test3_integration, 'Perfil certificado para experiencia Leanback / TV Box', leanbackSafe, profile?.deviceTarget);

// ── RESUMEN FINAL ────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log(' RESUMEN FINAL DEL TRIPLE TESTEO');
console.log('═'.repeat(70));

let totalP = 0;
let totalF = 0;
for (const [key, sec] of Object.entries(report)) {
  totalP += sec.passed;
  totalF += sec.failed;
  const statusIcon = sec.failed === 0 ? '✅' : '❌';
  console.log(` ${statusIcon} ${sec.name.padEnd(50)}: ${sec.passed} aprobados, ${sec.failed} fallidos`);
}

console.log('─'.repeat(70));
console.log(` Total general: ${totalP} pruebas superadas exitosamente de ${totalP + totalF}`);
console.log('═'.repeat(70));

if (totalF > 0) {
  console.error('\n✗ ALERTA: Algunas validaciones fallaron. Revisar el detalle arriba.');
  process.exit(1);
} else {
  console.log('\n✨ TODAS LAS VALIDACIONES COMPLETADAS CON ÉXITO.');
  console.log('   La TV Box está lista para operar con subtítulos sin SDH, prioridad latino y estrenos al día.');
  process.exit(0);
}
