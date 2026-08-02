#!/usr/bin/env node
/**
 * Conecta TorBox (debrid, ver CLAUDE.md → "Plan debrid" / "TorBox (debrid activo)") a Torrentio y
 * Comet, y reordena el bloque de addons de streams para reflejar la nueva jerarquía de fiabilidad
 * ahora que hay debrid: TorBox-backed primero, HTTP scrapers después, P2P puro (Meteor, sin
 * soporte de debrid) al final.
 *
 * No toca la config de Meteor (se deja el minSeeders:1 del perfil CGNAT — Meteor sigue siendo
 * P2P puro y el CGNAT lo sigue afectando igual, TorBox no lo cubre).
 *
 *   1. Torrentio: agrega/actualiza el segmento `torbox=<KEY>` en su transportUrl (formato
 *      pipe-delimited confirmado contra torrentio.strem.fun/configure), preservando el resto de
 *      la config existente (24 providers, sort, qualityfilter).
 *   2. Comet: agrega/actualiza `debridServices: [{service:"torbox", apiKey:<KEY>}]` en su config
 *      (JSON base64 en el path, mismo mecanismo que ya lee apply-cgnat-profile.mjs) y fija
 *      `enableTorrent:false` — TorBox descarga torrents no cacheados en sus propios servidores
 *      (no depende de la conexión del usuario), así que mezclar P2P crudo como fallback
 *      reintroduce el problema de CGNAT sin necesidad. Preserva resolutions/options/etc. tal cual.
 *   3. Reordena el bloque de streams: Torrentio, Comet (TorBox-backed) → NoTorrent, WebStreamrMBG,
 *      Nuvio Streams (HTTP, no dependen de debrid ni P2P entrante) → Meteor (P2P puro, último
 *      recurso).
 *
 * Un solo propósito, no genérico — mismo criterio que scripts/apply-cgnat-profile.mjs. Revertir =
 * restaurar el backup pre-cambio (ver "Backup y restauración de addons" en CLAUDE.md).
 *
 * Requiere: ST_EMAIL, ST_PASS, TORBOX_API_KEY
 *
 * Uso:
 *   ST_EMAIL=... ST_PASS=... TORBOX_API_KEY=... node scripts/apply-torbox-profile.mjs            # dry-run
 *   ST_EMAIL=... ST_PASS=... TORBOX_API_KEY=... node scripts/apply-torbox-profile.mjs --apply    # aplica
 *
 * Node >= 20, sin dependencias.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BACKUPS = join(ROOT, '.backups');

const API = 'https://api.strem.io/api';
const APPLY = process.argv.includes('--apply');

// Orden nuevo del bloque de streams: TorBox-backed primero, HTTP scrapers, P2P puro al final.
const STREAM_ORDER = [
  'com.stremio.torrentio.addon', // Torrentio   TorBox
  'stremio.comet.fast', // Comet       TorBox
  'com.notorrent.addon', // NoTorrent   HTTP
  'webstreamr-mbg', // WebStreamrMBG HTTP
  'org.nuvio.streams', // Nuvio       HTTP
  'community.meteor', // Meteor      P2P puro, sin debrid, último recurso
];

const die = (m, code = 1) => { console.error(`✗ ${m}`); process.exit(code); };
const apiPost = (path, body) =>
  fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  }).then((r) => r.json());

const email = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const pass = process.env.ST_PASS || '';
const torboxKey = process.env.TORBOX_API_KEY || '';
if (!pass) die('Falta ST_PASS');
if (!torboxKey) die('Falta TORBOX_API_KEY');

// ── 1. Login + colección actual ──────────────────────────────────────────────
const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
console.log(`✓ Login OK — ${addons.length} addons leídos`);

// ── 2. Torrentio — insertar/actualizar torbox=<KEY> en el path pipe-delimited ──
const torrentioIdx = addons.findIndex((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
if (torrentioIdx === -1) die('No encontré Torrentio (com.stremio.torrentio.addon) en la colección');

const torrentio = addons[torrentioIdx];
const torrentioMatch = torrentio.transportUrl.match(/^(https:\/\/[^/]+\/)([^/]*)(\/manifest\.json.*)$/);
if (!torrentioMatch) die('No pude parsear el transportUrl de Torrentio: ' + torrentio.transportUrl);
const [, torrentioPrefix, torrentioCfgSegment, torrentioSuffix] = torrentioMatch;

const torrentioPairs = torrentioCfgSegment ? torrentioCfgSegment.split('|') : [];
const torrentioBefore = torrentioCfgSegment;
let torrentioFoundTorbox = false;
const torrentioPairsNew = torrentioPairs.map((p) => {
  if (p.startsWith('torbox=')) { torrentioFoundTorbox = true; return `torbox=${torboxKey}`; }
  return p;
});
if (!torrentioFoundTorbox) torrentioPairsNew.push(`torbox=${torboxKey}`);
const torrentioCfgNew = torrentioPairsNew.join('|');
const newTorrentioUrl = `${torrentioPrefix}${torrentioCfgNew}${torrentioSuffix}`;

console.log('\nTorrentio — diff de config:');
console.log(`  antes: ${torrentioBefore || '(vacío)'}`);
console.log(`  después: ${torrentioCfgNew.replace(torboxKey, '<TORBOX_KEY>')}`);

// ── 3. Comet — debridServices + enableTorrent:false en el JSON base64 ─────────
const cometIdx = addons.findIndex((a) => a.manifest?.id === 'stremio.comet.fast');
if (cometIdx === -1) die('No encontré Comet (stremio.comet.fast) en la colección');

const comet = addons[cometIdx];
const cometMatch = comet.transportUrl.match(/^(https:\/\/[^/]+\/)([^/]+)(\/manifest\.json.*)$/);
if (!cometMatch) die('No pude parsear el transportUrl de Comet: ' + comet.transportUrl);
const [, cometPrefix, cometB64, cometSuffix] = cometMatch;

let cometCfg;
try {
  cometCfg = JSON.parse(Buffer.from(cometB64, 'base64').toString('utf8'));
} catch (e) {
  die('No pude decodificar la config de Comet: ' + e.message);
}

const cometCfgBefore = JSON.parse(JSON.stringify(cometCfg));
const services = Array.isArray(cometCfg.debridServices) ? cometCfg.debridServices.slice() : [];
const torboxSvcIdx = services.findIndex((s) => s?.service === 'torbox');
if (torboxSvcIdx >= 0) services[torboxSvcIdx] = { ...services[torboxSvcIdx], service: 'torbox', apiKey: torboxKey };
else services.push({ service: 'torbox', apiKey: torboxKey });
cometCfg.debridServices = services;
cometCfg.enableTorrent = false;

const newCometB64 = Buffer.from(JSON.stringify(cometCfg)).toString('base64');
const newCometUrl = `${cometPrefix}${newCometB64}${cometSuffix}`;

console.log('\nComet — diff de config:');
console.log(`  debridServices antes: ${JSON.stringify(cometCfgBefore.debridServices || [])}`);
console.log(`  debridServices después: ${JSON.stringify(cometCfg.debridServices).replace(torboxKey, '<TORBOX_KEY>')}`);
console.log(`  enableTorrent: ${cometCfgBefore.enableTorrent} → ${cometCfg.enableTorrent}`);

// ── 4. Aplicar transportUrl nuevos + reordenar el bloque de streams ───────────
const withNewUrls = addons.map((a, i) => {
  if (i === torrentioIdx) return { ...a, transportUrl: newTorrentioUrl };
  if (i === cometIdx) return { ...a, transportUrl: newCometUrl };
  return a;
});

const isStreamAddon = (a) => STREAM_ORDER.includes(a.manifest?.id);
const firstStreamIdx = withNewUrls.findIndex(isStreamAddon);
if (firstStreamIdx === -1) die('No encontré ningún addon del bloque de streams esperado');

const missing = STREAM_ORDER.filter((id) => !withNewUrls.some((a) => a.manifest?.id === id));
if (missing.length) console.warn(`⚠ No se encontraron estos addons (¿se removieron?): ${missing.join(', ')}`);

const sortedStreamAddons = STREAM_ORDER.map((id) => withNewUrls.find((a) => a.manifest?.id === id)).filter(Boolean);
const reordered = [
  ...withNewUrls.slice(0, firstStreamIdx).filter((a) => !isStreamAddon(a)),
  ...sortedStreamAddons,
  ...withNewUrls.slice(firstStreamIdx).filter((a) => !isStreamAddon(a)),
];

if (reordered.length !== addons.length) die(`El reorden perdió addons: antes ${addons.length}, después ${reordered.length}`);

console.log('\nOrden ACTUAL:');
addons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));
console.log('\nOrden NUEVO:');
reordered.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

// ── 5. Guard anti-duplicados ─────────────────────────────────────────────────
const ids = reordered.map((a) => a.manifest?.id).filter(Boolean);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) die('manifest.id duplicado tras el cambio: ' + dup.join(', '));
console.log(`\n✓ Sin ids duplicados tras el cambio (${reordered.length} addons)`);

if (!APPLY) {
  console.log('\n[DRY-RUN] Pasar --apply para escribir los cambios en la cuenta.');
  process.exitCode = 0;
} else {

// ── 6. Guard anti-manifest-congelado ─────────────────────────────────────────
// No vaciamos manifest.catalogs de addons que no tocamos: regenerate-aiometadata.mjs ya prueba
// que addonCollectionSet acepta el payload completo (con los ~132 catálogos de AIOMetadata
// embebidos) sin problema — ver CLAUDE.md → "Bug real: catalogs:[] indiscriminado".
if (!(await assertNoFrozenEmptyCatalogs(reordered, ['com.stremio.torrentio.addon', 'stremio.comet.fast']))) {
  process.exit(1);
}

// ── 7. Backup + aplicar ──────────────────────────────────────────────────────
mkdirSync(BACKUPS, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const accountSlug = email.split('@')[0];
const backupPath = join(BACKUPS, `backup-${accountSlug}-pre-torbox-${ts}.json`);
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\n✓ Backup guardado: ${backupPath}`);

const res = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: reordered });
if (!(res?.result?.success || res?.result)) die('addonCollectionSet falló: ' + JSON.stringify(res));
console.log('✓ Colección actualizada correctamente.');

// ── 8. Verificación post-cambio ────────────────────────────────────────────
const after = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const afterAddons = after?.result?.addons || [];
console.log(`\nVerificando... (${afterAddons.length} addons, antes ${addons.length})`);
afterAddons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

const torrentioAfter = afterAddons.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
const cometAfter = afterAddons.find((a) => a.manifest?.id === 'stremio.comet.fast');
const torrentioOk = !!torrentioAfter?.transportUrl.includes(`torbox=${torboxKey}`);
let cometOk = false;
if (cometAfter) {
  const m = cometAfter.transportUrl.match(/^https:\/\/[^/]+\/([^/]+)\/manifest\.json/);
  if (m) {
    try {
      const cfg = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
      cometOk = Array.isArray(cfg.debridServices) && cfg.debridServices.some((s) => s.service === 'torbox' && s.apiKey === torboxKey) && cfg.enableTorrent === false;
    } catch { /* cometOk queda false */ }
  }
}

// Fetch de los manifests nuevos para confirmar que responden y no quedaron rotos.
let torrentioManifestOk = false, cometManifestOk = false;
try {
  const m = await fetch(newTorrentioUrl.replace(/\/manifest\.json.*/, '/manifest.json'), { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
  torrentioManifestOk = m?.id === 'com.stremio.torrentio.addon';
} catch (e) { console.warn(`⚠ No pude fetchear el manifest nuevo de Torrentio: ${e.message}`); }
try {
  const m = await fetch(newCometUrl, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
  cometManifestOk = m?.id === 'stremio.comet.fast' || m?.id === comet.manifest?.id;
} catch (e) { console.warn(`⚠ No pude fetchear el manifest nuevo de Comet: ${e.message}`); }

const lengthOk = afterAddons.length === addons.length;
const ok = lengthOk && torrentioOk && cometOk && torrentioManifestOk && cometManifestOk;
console.log(`\n${ok ? '✅' : '✗'} Perfil TorBox ${ok ? 'aplicado y verificado' : 'NO confirmado del todo'}`);
console.log(`   Total addons: ${afterAddons.length} (antes: ${addons.length})`);
console.log(`   Torrentio config OK: ${torrentioOk} | manifest responde: ${torrentioManifestOk}`);
console.log(`   Comet config OK: ${cometOk} | manifest responde: ${cometManifestOk}`);
console.log(`   Backup: ${backupPath}`);

process.exitCode = ok ? 0 : 1;
}
