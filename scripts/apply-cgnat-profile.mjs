#!/usr/bin/env node
/**
 * Perfil TEMPORAL de mitigación de CGNAT (ver CLAUDE.md → "Perfil CGNAT temporal (sin debrid)").
 *
 * Sin acceso al router (CGNAT confirmado en la conexión de Claro Argentina), los addons P2P
 * sufren swarms inestables (streams que conectan, cargan un poco y caen a 0 en loop). Mientras se
 * suma un debrid de pago (TorBox, ~agosto 2026), este script:
 *
 *   1. Reordena el bloque de addons de streams para que los HTTP (no dependen de conexión P2P
 *      entrante) vayan antes que los P2P: NoTorrent → WebStreamrMBG → Nuvio Streams → Torrentio →
 *      Comet → Meteor. El resto de la colección mantiene su posición y orden relativo.
 *   2. Reescribe SOLO la config de Meteor (base64 en su transportUrl): minSeeders 0 → 1 (filtra
 *      torrents con 0 seeds confirmados, el patrón "carga y nunca arranca") y sortOrder para que
 *      "seeders" pese más que resolución/calidad.
 *   3. Imprime (sin tocar) la config de Torrentio y Comet con la razón por la que no se modifican:
 *      Torrentio ya usa sort=seeders y su qualityfilter no excluye 4K liso; Comet no tiene ningún
 *      campo de sort, sólo exclusión binaria de resoluciones (ya conservador).
 *
 * Un solo propósito, no genérico — mismo criterio que scripts/swap-aiolists-mytrakt.mjs (no se
 * espera reusarlo salvo para otro ajuste puntual de este mismo perfil). Revertir = restaurar el
 * backup pre-cambio (ver "Backup y restauración de addons" en CLAUDE.md).
 *
 * Requiere: ST_EMAIL, ST_PASS
 *
 * Uso:
 *   ST_EMAIL=... ST_PASS=... node scripts/apply-cgnat-profile.mjs            # dry-run
 *   ST_EMAIL=... ST_PASS=... node scripts/apply-cgnat-profile.mjs --apply    # aplica de verdad
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

// Orden nuevo del bloque de addons de streams (HTTP antes que P2P; Meteor último).
const STREAM_ORDER = [
  'com.notorrent.addon', // NoTorrent            HTTP
  'webstreamr-mbg', // WebStreamrMBG        HTTP
  'org.nuvio.streams', // Nuvio Streams        HTTP
  'com.stremio.torrentio.addon', // Torrentio            P2P
  'stremio.comet.fast', // Comet                P2P
  'community.meteor', // Meteor               P2P
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
if (!pass) die('Faltan ST_EMAIL / ST_PASS');

// ── 1. Login + colección actual ──────────────────────────────────────────────
const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
console.log(`✓ Login OK — ${addons.length} addons leídos`);

// ── 2. Reordenar el bloque de streams (por manifest.id, no por índice) ──────
const isStreamAddon = (a) => STREAM_ORDER.includes(a.manifest?.id);
const firstStreamIdx = addons.findIndex(isStreamAddon);
if (firstStreamIdx === -1) die('No encontré ningún addon del bloque de streams esperado');

const missing = STREAM_ORDER.filter((id) => !addons.some((a) => a.manifest?.id === id));
if (missing.length) {
  console.warn(`⚠ No se encontraron estos addons (¿se removieron?): ${missing.join(', ')}`);
}
const sortedStreamAddons = STREAM_ORDER.map((id) => addons.find((a) => a.manifest?.id === id)).filter(Boolean);

const before = addons.filter((a) => !isStreamAddon(a));
const reordered = [
  ...addons.slice(0, firstStreamIdx).filter((a) => !isStreamAddon(a)),
  ...sortedStreamAddons,
  ...addons.slice(firstStreamIdx).filter((a) => !isStreamAddon(a)),
];

if (reordered.length !== addons.length) {
  die(`El reorden perdió addons: antes ${addons.length}, después ${reordered.length}`);
}

console.log('\nOrden ACTUAL:');
addons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));
console.log('\nOrden NUEVO:');
reordered.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

// ── 3. Reescribir SOLO Meteor ─────────────────────────────────────────────────
const meteorIdx = reordered.findIndex((a) => a.manifest?.id === 'community.meteor');
if (meteorIdx === -1) die('Meteor no encontrado — no se puede aplicar el perfil');

const meteor = reordered[meteorIdx];
const meteorMatch = meteor.transportUrl.match(/^(https:\/\/[^/]+\/)([^/]+)(\/manifest\.json.*)$/);
if (!meteorMatch) die('No pude parsear el transportUrl de Meteor: ' + meteor.transportUrl);
const [, meteorPrefix, meteorB64, meteorSuffix] = meteorMatch;

let meteorCfg;
try {
  meteorCfg = JSON.parse(Buffer.from(meteorB64, 'base64').toString('utf8'));
} catch (e) {
  die('No pude decodificar la config de Meteor: ' + e.message);
}

const meteorCfgBefore = JSON.parse(JSON.stringify(meteorCfg));
meteorCfg.minSeeders = 1;
meteorCfg.sortOrder = ['pack', 'cached', 'seeders', 'seadex', 'resolution', 'size', 'quality', 'language'];

const newMeteorB64 = Buffer.from(JSON.stringify(meteorCfg)).toString('base64');
const newMeteorUrl = `${meteorPrefix}${newMeteorB64}${meteorSuffix}`;

console.log('\nMeteor — diff de config:');
console.log(`  minSeeders: ${meteorCfgBefore.minSeeders} → ${meteorCfg.minSeeders}`);
console.log(`  sortOrder:  [${meteorCfgBefore.sortOrder.join(', ')}]`);
console.log(`           →  [${meteorCfg.sortOrder.join(', ')}]`);

reordered[meteorIdx] = { ...meteor, transportUrl: newMeteorUrl };

// ── 4. Visibilidad de Torrentio/Comet (sin tocar) ───────────────────────────
const torrentio = reordered.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
if (torrentio) {
  const decoded = decodeURIComponent(torrentio.transportUrl);
  const sortMatch = decoded.match(/sort=([^|/]+)/);
  const qfMatch = decoded.match(/qualityfilter=([^/]+)/);
  console.log('\nTorrentio — config actual (sin cambios):');
  console.log(`  sort: ${sortMatch?.[1] || '(no seteado)'}`);
  console.log(`  qualityfilter: ${qfMatch?.[1] || '(no seteado)'}`);
  console.log('  → ya usa sort=seeders y el qualityfilter no excluye 4K liso; no hace falta tocarlo.');
}

const comet = reordered.find((a) => a.manifest?.id === 'stremio.comet.fast');
if (comet) {
  const cometMatch = comet.transportUrl.match(/^https:\/\/[^/]+\/([^/]+)\/manifest\.json/);
  if (cometMatch) {
    try {
      const cometCfg = JSON.parse(Buffer.from(cometMatch[1], 'base64').toString('utf8'));
      console.log('\nComet — config actual (sin cambios):');
      console.log(`  resolutions: ${JSON.stringify(cometCfg.resolutions)}`);
      console.log(`  options.remove_ranks_under: ${cometCfg.options?.remove_ranks_under}`);
      console.log('  → no tiene campo de sort; ya excluye 2160p/240p/360p/unknown (conservador). No hace falta tocarlo.');
    } catch {
      console.log('\nComet — no pude decodificar su config (informativo, no bloquea el resto).');
    }
  }
}

// ── 5. Guard anti-duplicados ─────────────────────────────────────────────────
const ids = reordered.map((a) => a.manifest?.id).filter(Boolean);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) die('manifest.id duplicado tras el reorden: ' + dup.join(', '));
console.log(`\n✓ Sin ids duplicados tras el reorden (${reordered.length} addons)`);

if (!APPLY) {
  console.log('\n[DRY-RUN] Pasar --apply para escribir los cambios en la cuenta.');
  // No process.exit() aquí: en Node 24 en Windows, salir justo después de un fetch()
  // dispara un crash de libuv en el cleanup (assertion en async.c) aunque el script ya
  // terminó su trabajo. Dejar que el proceso termine solo evita el crash.
  process.exitCode = 0;
} else {

// ── 6. Guard anti-manifest-congelado ─────────────────────────────────────────
// No vaciamos manifest.catalogs de addons que no tocamos: regenerate-aiometadata.mjs ya prueba
// que addonCollectionSet acepta el payload completo (con los ~132 catálogos de AIOMetadata
// embebidos) sin problema — ver CLAUDE.md → "Bug real: catalogs:[] indiscriminado".
if (!(await assertNoFrozenEmptyCatalogs(reordered, ['community.meteor']))) {
  process.exit(1);
}

// ── 7. Backup + aplicar ──────────────────────────────────────────────────────
mkdirSync(BACKUPS, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = join(BACKUPS, `backup-stremioeg-pre-cgnat-profile-${ts}.json`);
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\n✓ Backup guardado: ${backupPath}`);

const res = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: reordered });

if (!(res?.result?.success || res?.result)) {
  die('addonCollectionSet falló: ' + JSON.stringify(res));
}
console.log('✓ Colección actualizada correctamente.');

// ── 8. Verificación post-cambio ──────────────────────────────────────────────
const after = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const afterAddons = after?.result?.addons || [];
console.log(`\nVerificando... (${afterAddons.length} addons, antes ${addons.length})`);
afterAddons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

const meteorAfter = afterAddons.find((a) => a.manifest?.id === 'community.meteor');
let meteorOk = false;
if (meteorAfter) {
  const m = meteorAfter.transportUrl.match(/^https:\/\/[^/]+\/([^/]+)\/manifest\.json/);
  if (m) {
    try {
      const cfg = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
      meteorOk = cfg.minSeeders === 1 && JSON.stringify(cfg.sortOrder) === JSON.stringify(meteorCfg.sortOrder);
    } catch { /* meteorOk queda false */ }
  }
}

const lengthOk = afterAddons.length === addons.length;
const ok = lengthOk && meteorOk;
console.log(`\n${ok ? '✅' : '✗'} Perfil CGNAT ${ok ? 'aplicado y verificado' : 'NO confirmado del todo'}`);
console.log(`   Total addons: ${afterAddons.length} (antes: ${addons.length})`);
console.log(`   Meteor config OK: ${meteorOk}`);
console.log(`   Backup: ${backupPath}`);

// No process.exit() aquí: en Node 24 en Windows, salir justo después de un fetch()
// dispara un crash de libuv en el cleanup (assertion en async.c) aunque el trabajo ya
// terminó. Dejar que el proceso termine solo evita el crash.
process.exitCode = ok ? 0 : 1;
}
