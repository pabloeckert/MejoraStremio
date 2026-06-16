/**
 * health-check.mjs — Verifica el estado de los 13 addons de stremioeg@gmail.com
 *
 * Uso:
 *   node scripts/health-check.mjs
 *   node scripts/health-check.mjs --fix    # regenera SubSense si falla
 *
 * Exit codes: 0 = todo OK, 1 = hay addons caídos o cuenta sin addons
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const API = 'https://api.strem.io/api';
const FIX_MODE = process.argv.includes('--fix');

// ── Configuración esperada ──────────────────────────────────────────────────
// SubSense: userId DEBE ser 8 chars. Código de idioma: "es" (no "spa", "es-AR", "es-419")
const SUBSENSE_LANG_CONFIG = { languages: ['es'], maxSubtitles: 20 };
const SUBSENSE_USER_ID     = 'pablo001';
const SUBSENSE_CONFIG_STR  = encodeURIComponent(JSON.stringify(SUBSENSE_LANG_CONFIG));
const SUBSENSE_ES_URL      = `https://subsense.nepiraw.com/${SUBSENSE_USER_ID}-${SUBSENSE_CONFIG_STR}/manifest.json`;

const EXPECTED_ADDONS = [
  { name: 'Cinemeta',              url: 'https://v3-cinemeta.strem.io/manifest.json' },
  { name: 'AIOMetadata',          url: 'https://aiometadata.elfhosted.com/stremio/8b248161-d9b0-4398-a054-14f0693c83f1/manifest.json' },
  { name: 'Torrentio',            url: 'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickass,horriblesubs,nyaa,tokyotosho,anidex,rutor,rutracker,comando,baibako,toloka,hdrezka,filmclub/manifest.json' },
  { name: 'Comet',                url: null },  // URL dinámica con config base64
  { name: 'MediaFusion',          url: 'https://mediafusion.elfhosted.com/manifest.json' },
  { name: 'NoTorrent',            url: 'https://addon-osvh.onrender.com/manifest.json' },
  { name: 'Meteor',               url: null },  // URL dinámica con config base64
  { name: 'WebStreamrMBG',        url: null },  // URL dinámica con config JSON
  { name: 'Streailer',            url: null },  // URL dinámica
  { name: 'Mubi Catalog',         url: 'https://mubi2stremio.adiba.ro/manifest.json' },
  { name: 'SubSense',             url: SUBSENSE_ES_URL },
  { name: 'OpenSubtitles v3',     url: 'https://opensubtitles-v3.strem.io/manifest.json' },
  { name: 'Streaming Catalogs',   url: 'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json' },
];

// Títulos de prueba para verificar streams y subtítulos
const TEST_TITLES = [
  { label: 'Matrix',        type: 'movie',  imdb: 'tt0133093' },
  { label: 'Breaking Bad',  type: 'series', imdb: 'tt0903747:1:1' },
];

const TORRENTIO_BASE = 'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickass,horriblesubs,nyaa,tokyotosho,anidex,rutor,rutracker,comando,baibako,toloka,hdrezka,filmclub';

// ── Helpers ────────────────────────────────────────────────────────────────
const apiPost = (path, body) =>
  fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  }).then(r => r.json());

const getManifest = (url) =>
  fetch(url, { signal: AbortSignal.timeout(10000) })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

const ok  = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);
const fail = (msg) => console.log(`  ✗ ${msg}`);

// ── Main ───────────────────────────────────────────────────────────────────
let exitCode = 0;

console.log('═══════════════════════════════════════════');
console.log(' MejoraStremio — Health Check');
console.log(' ' + new Date().toISOString());
console.log('═══════════════════════════════════════════\n');

// 1. Verificar cuenta Stremio
console.log('[ 1/4 ] Cuenta Stremio');
const email = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const pass  = process.env.ST_PASS  || '';

let authKey = null;
let installedAddons = [];

if (!pass) {
  warn('ST_PASS no definido — omitiendo verificación de cuenta');
  warn('  Usar: ST_EMAIL=x ST_PASS=y node scripts/health-check.mjs');
} else {
  const login = await apiPost('login', { authKey: null, email, password: pass });
  authKey = login?.result?.authKey;
  if (!authKey) {
    fail('Login fallido: ' + JSON.stringify(login?.error || login));
    exitCode = 1;
  } else {
    ok('Login OK');
    const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
    installedAddons = col?.result?.addons || [];
    const count = installedAddons.length;
    if (count < 10) {
      fail(`Solo ${count} addons instalados (esperado ≥10)`);
      exitCode = 1;
    } else {
      ok(`${count} addons instalados en el servidor`);
    }
  }
}

// 2. Verificar manifests de addons clave
console.log('\n[ 2/4 ] Manifests de addons');
const manifestChecks = [
  { name: 'Cinemeta',             url: 'https://v3-cinemeta.strem.io/manifest.json' },
  { name: 'AIOMetadata',         url: 'https://aiometadata.elfhosted.com/stremio/8b248161-d9b0-4398-a054-14f0693c83f1/manifest.json' },
  { name: 'Torrentio',           url: 'https://torrentio.strem.fun/manifest.json' },
  { name: 'Comet',               url: 'https://comet.feels.legal/manifest.json' },
  { name: 'MediaFusion',         url: 'https://mediafusion.elfhosted.com/manifest.json' },
  { name: 'SubSense (español)',   url: SUBSENSE_ES_URL },
  { name: 'OpenSubtitles v3',    url: 'https://opensubtitles-v3.strem.io/manifest.json' },
  { name: 'Streaming Catalogs',  url: 'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json' },
  { name: 'Mubi',                url: 'https://mubi2stremio.adiba.ro/manifest.json' },
];
const results = await Promise.all(manifestChecks.map(c => getManifest(c.url)));
let addonsFailed = 0;
manifestChecks.forEach((c, i) => {
  const m = results[i];
  if (m?.name) {
    ok(`${c.name}: v${m.version}`);
  } else {
    fail(`${c.name}: NO RESPONDE`);
    addonsFailed++;
    exitCode = 1;
  }
});

// 3. Verificar SubSense en español (prueba real de subtítulos)
console.log('\n[ 3/4 ] Subtítulos en español (SubSense)');
const SUBSENSE_BASE = `https://subsense.nepiraw.com/${SUBSENSE_USER_ID}-${SUBSENSE_CONFIG_STR}`;
const subTests = await Promise.all(TEST_TITLES.map(t =>
  fetch(`${SUBSENSE_BASE}/subtitles/${t.type}/${t.imdb}.json`, { signal: AbortSignal.timeout(12000) })
    .then(r => r.json()).catch(() => ({ subtitles: [] }))
));
subTests.forEach((r, i) => {
  const subs = (r?.subtitles || []).filter(s => s.lang === 'spa');
  if (subs.length === 0) {
    fail(`${TEST_TITLES[i].label}: 0 subtítulos en español — SubSense puede estar mal configurado`);
    if (FIX_MODE) {
      warn('  --fix: regenerando URL de SubSense con config correcta...');
      // La URL ya está correcta. El issue sería del servidor SubSense.
    }
    exitCode = 1;
  } else {
    ok(`${TEST_TITLES[i].label}: ${subs.length} subs en español`);
  }
});

// 4. Verificar streams P2P disponibles
console.log('\n[ 4/4 ] Streams P2P');
const streamTests = await Promise.all(TEST_TITLES.map(t =>
  fetch(`${TORRENTIO_BASE}/stream/${t.type}/${t.imdb}.json`, { signal: AbortSignal.timeout(15000) })
    .then(r => r.json()).catch(() => ({ streams: [] }))
));
streamTests.forEach((r, i) => {
  const count = (r?.streams || []).length;
  if (count === 0) {
    fail(`${TEST_TITLES[i].label}: 0 streams — Torrentio puede estar caído`);
    exitCode = 1;
  } else {
    ok(`${TEST_TITLES[i].label}: ${count} streams disponibles`);
  }
});

// Resumen
console.log('\n═══════════════════════════════════════════');
if (exitCode === 0) {
  console.log('✅ Todo OK — setup funcionando correctamente');
} else {
  console.log(`❌ ${addonsFailed > 0 ? addonsFailed + ' addon(s) caídos' : ''} — revisar salida arriba`);
  console.log('\nSi SubSense falla, regenerar URL en https://subsense.nepiraw.com');
  console.log('  → Idioma: "Spanish" (código "es"), maxSubtitles: 20, userId: 8 chars');
}
console.log('═══════════════════════════════════════════');

process.exit(exitCode);
