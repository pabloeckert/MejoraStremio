#!/usr/bin/env node
/**
 * verify-live-account.mjs — Diagnóstico de verificación cruda contra la cuenta real: confirma
 * (o desmiente) que lo que creemos aplicado (instanceId de AIOMetadata en preset.json, catálogos
 * nuevos por id, posición de cada addon) coincide EXACTO con lo que Stremio tiene guardado y con
 * lo que el manifest en vivo de AIOMetadata expone. No escribe nada, solo lee y compara.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/verify-live-account.mjs
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const API = 'https://api.strem.io/api';

const die = (m, code = 1) => { console.error(`✗ ${m}`); process.exit(code); };
const apiPost = (path, body) =>
  fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  }).then((r) => r.json());
const getJson = (url, t = 20000) =>
  fetch(url, { signal: AbortSignal.timeout(t) })
    .then((r) => (r.ok ? r.json() : null))
    .catch((e) => ({ __error: String(e) }));

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

console.log('═'.repeat(70));
console.log(' MejoraStremio — Verificación cruda contra la cuenta real');
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(70));

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));
console.log(`\n✓ Login OK como ${email}`);

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
if (!addons.length) die('addonCollectionGet no devolvió addons — colección vacía o error.');

console.log(`\n[1] Colección guardada en Stremio ahora mismo: ${addons.length} addons`);
addons.forEach((a, i) => {
  console.log(`  ${String(i).padStart(2)}. ${a.manifest?.name || '?'} (${a.manifest?.id || '?'}) — v${a.manifest?.version || '?'} — ${(a.manifest?.catalogs || []).length} catálogo(s) en el manifest guardado`);
});

const aio = addons.find((a) => a.manifest?.id === 'aio-metadata');
if (!aio) {
  console.log('\n✗ AIOMetadata NO está en la colección guardada — esto sería gravísimo, no está instalado.');
  process.exit(1);
}
console.log(`\n[2] AIOMetadata guardado: transportUrl = ${aio.transportUrl}`);
const savedInstanceId = aio.transportUrl.match(/\/([0-9a-f-]{36})\//)?.[1] || '(no se pudo extraer)';
console.log(`    instanceId guardado (en Stremio): ${savedInstanceId}`);

let presetInstanceId = '(no se pudo leer preset.json)';
try {
  const preset = JSON.parse(readFileSync(join(ROOT, 'data', 'preset.json'), 'utf8'));
  presetInstanceId = preset?.aioMetadataConfig?.instanceId || '(preset.json sin instanceId)';
} catch (e) {
  presetInstanceId = `(error leyendo preset.json: ${e.message})`;
}
console.log(`    instanceId en preset.json (repo):  ${presetInstanceId}`);
console.log(`    ${savedInstanceId === presetInstanceId ? '✓ COINCIDEN' : '✗ NO COINCIDEN — el repo y la cuenta están desincronizados'}`);

console.log(`\n[3] Catálogos guardados EN STREMIO ahora mismo para AIOMetadata: ${(aio.manifest?.catalogs || []).length}`);
const savedCatalogIds = new Set((aio.manifest?.catalogs || []).map((c) => c.id));

const base = aio.transportUrl.replace(/manifest\.json$/, '');
console.log(`\n[4] Fetch EN VIVO al manifest real: ${base}manifest.json`);
const liveManifest = await getJson(`${base}manifest.json`, 20000);
if (!liveManifest || liveManifest.__error) {
  console.log(`  ✗ No se pudo obtener el manifest en vivo: ${liveManifest?.__error || 'respuesta vacía'}`);
} else {
  const liveCatalogIds = new Set((liveManifest.catalogs || []).map((c) => c.id));
  console.log(`  ✓ Manifest en vivo responde: ${liveCatalogIds.size} catálogos`);
  console.log(`    ${liveCatalogIds.size === savedCatalogIds.size ? '✓ mismo número que lo guardado en Stremio' : `✗ DIFERENTE del guardado en Stremio (guardado=${savedCatalogIds.size}, vivo=${liveCatalogIds.size})`}`);

  const checkIds = {
    'Policial Clásico': 'pablo056',
    'Europe Noir (Cine)': 'pablo063',
    'Europe Noir (Series)': 'pablo064',
    '30 Minutos o Menos (Cine)': 'pablo065',
    'Crimen Alemán (Cine)': 'pablo066',
    'Crimen Alemán (Series)': 'pablo067',
    'Crimen Reino Unido (Cine)': 'pablo068',
    'Crimen Reino Unido (Series)': 'pablo069',
  };
  console.log('\n[5] Catálogos puntuales de las últimas sesiones — ¿están en Stremio guardado Y en vivo?');
  for (const [name, idFrag] of Object.entries(checkIds)) {
    const inSaved = [...savedCatalogIds].some((id) => id.includes(idFrag));
    const inLive = [...liveCatalogIds].some((id) => id.includes(idFrag));
    const flag = inSaved && inLive ? '✓' : '✗';
    console.log(`  ${flag} ${name} (${idFrag}) — guardado en Stremio: ${inSaved ? 'SÍ' : 'NO'} | manifest en vivo: ${inLive ? 'SÍ' : 'NO'}`);
    const raw = (liveManifest.catalogs || []).find((c) => c.id.includes(idFrag));
    if (raw) {
      console.log(`      raw: type="${raw.type}" name="${raw.name}" extra=${JSON.stringify(raw.extra || raw.extraSupported || [])}`);
    }
  }
  const refId = 'pablo001';
  const ref = (liveManifest.catalogs || []).find((c) => c.id.includes(refId));
  if (ref) {
    console.log(`\n  Referencia — catálogo YA conocido que sí se ve bien (Argentina, ${refId}):`);
    console.log(`      raw: type="${ref.type}" name="${ref.name}" extra=${JSON.stringify(ref.extra || ref.extraSupported || [])}`);
  }
  const movieCatalogs = (liveManifest.catalogs || []).filter((c) => c.type === 'movie');
  const seriesCatalogs = (liveManifest.catalogs || []).filter((c) => c.type === 'series');
  console.log(`\n  Total en el selector de Descubrir si elegís "Películas": ${movieCatalogs.length} catálogos de este addon`);
  console.log(`  Total en el selector de Descubrir si elegís "Series": ${seriesCatalogs.length} catálogos de este addon`);
  const idxOf = (idFrag) => movieCatalogs.findIndex((c) => c.id.includes(idFrag));
  const idxOfSeries = (idFrag) => seriesCatalogs.findIndex((c) => c.id.includes(idFrag));
  console.log(`\n  Posición de "Policial Clásico" en la lista de Películas: ${idxOf('pablo056') + 1} de ${movieCatalogs.length}`);
  console.log(`  Posición de "Europe Noir (Cine)" en la lista de Películas: ${idxOf('pablo063') + 1} de ${movieCatalogs.length}`);
  console.log(`  Posición de "Crimen Alemán (Series)" en la lista de Series: ${idxOfSeries('pablo067') + 1} de ${seriesCatalogs.length}`);

  console.log('\n[6] showInHome de esos mismos catálogos (según preset.json — determina si aparecen en el Inicio o solo en Descubrir)');
  try {
    const preset = JSON.parse(readFileSync(join(ROOT, 'data', 'preset.json'), 'utf8'));
    const std = preset?.aioMetadataConfig?.catalogs?.standard || [];
    for (const [name, idFrag] of Object.entries(checkIds)) {
      const entry = std.find((c) => (c.id || '').includes(idFrag));
      if (!entry) { console.log(`  ? ${name} — no encontrado en preset.json`); continue; }
      console.log(`  ${entry.showInHome ? '🏠 Inicio' : '🔍 Solo Descubrir'} | enabled=${entry.enabled} — ${name}`);
    }
  } catch (e) {
    console.log(`  ✗ Error leyendo preset.json: ${e.message}`);
  }
}

console.log('\n[7] Catálogos activos en Home (showInHome=true) — cuántos hay en total y primeros 15, según preset.json');
try {
  const preset = JSON.parse(readFileSync(join(ROOT, 'data', 'preset.json'), 'utf8'));
  const std = preset?.aioMetadataConfig?.catalogs?.standard || [];
  const home = std.filter((c) => c.showInHome && c.enabled);
  console.log(`  Total en Home: ${home.length}`);
  home.slice(0, 15).forEach((c, i) => console.log(`    ${i + 1}. ${c.name || c.id}`));
} catch (e) {
  console.log(`  ✗ Error leyendo preset.json: ${e.message}`);
}

console.log('\n' + '═'.repeat(70));
process.exit(0);
