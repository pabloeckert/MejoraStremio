#!/usr/bin/env node
/**
 * Perfil TEMPORAL de mitigaciÃ³n de CGNAT (ver GEMINI.md â†’ "Perfil CGNAT temporal (sin debrid)").
 *
 * Sin acceso al router (CGNAT confirmado en la conexiÃ³n de Claro Argentina), los addons P2P
 * sufren swarms inestables (streams que conectan, cargan un poco y caen a 0 en loop). Mientras se
 * suma un debrid de pago (TorBox, ~agosto 2026), este script:
 *
 *   1. Reordena el bloque de addons de streams para que los HTTP (no dependen de conexiÃ³n P2P
 *      entrante) vayan antes que los P2P: NoTorrent â†’ WebStreamrMBG â†’ Nuvio Streams â†’ Torrentio â†’
 *      Comet â†’ Meteor. El resto de la colecciÃ³n mantiene su posiciÃ³n y orden relativo.
 *   2. Reescribe SOLO la config de Meteor (base64 en su transportUrl): minSeeders 0 â†’ 1 (filtra
 *      torrents con 0 seeds confirmados, el patrÃ³n "carga y nunca arranca") y sortOrder para que
 *      "seeders" pese mÃ¡s que resoluciÃ³n/calidad.
 *   3. Imprime (sin tocar) la config de Torrentio y Comet con la razÃ³n por la que no se modifican:
 *      Torrentio ya usa sort=seeders y su qualityfilter no excluye 4K liso; Comet no tiene ningÃºn
 *      campo de sort, sÃ³lo exclusiÃ³n binaria de resoluciones (ya conservador).
 *
 * Un solo propÃ³sito, no genÃ©rico â€” mismo criterio que scripts/swap-aiolists-mytrakt.mjs (no se
 * espera reusarlo salvo para otro ajuste puntual de este mismo perfil). Revertir = restaurar el
 * backup pre-cambio (ver "Backup y restauraciÃ³n de addons" en GEMINI.md).
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
import { apiPost } from './lib/stremio-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BACKUPS = join(ROOT, '.backups');

const APPLY = process.argv.includes('--apply');

// Orden nuevo del bloque de addons de streams (HTTP antes que P2P; Meteor Ãºltimo).
const STREAM_ORDER = [
  'com.notorrent.addon', // NoTorrent            HTTP
  'webstreamr-mbg', // WebStreamrMBG        HTTP
  'org.nuvio.streams', // Nuvio Streams        HTTP
  'com.stremio.torrentio.addon', // Torrentio            P2P
  'stremio.comet.fast', // Comet                P2P
  'community.meteor', // Meteor               P2P
];

const die = (m, code = 1) => { console.error(`âœ— ${m}`); process.exit(code); };

const email = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const pass = process.env.ST_PASS || '';
if (!pass) die('Faltan ST_EMAIL / ST_PASS');

// â”€â”€ 1. Login + colecciÃ³n actual â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
console.log(`âœ“ Login OK â€” ${addons.length} addons leÃ­dos`);

// â”€â”€ 2. Reordenar el bloque de streams (por manifest.id, no por Ã­ndice) â”€â”€â”€â”€â”€â”€
const isStreamAddon = (a) => STREAM_ORDER.includes(a.manifest?.id);
const firstStreamIdx = addons.findIndex(isStreamAddon);
if (firstStreamIdx === -1) die('No encontrÃ© ningÃºn addon del bloque de streams esperado');

const missing = STREAM_ORDER.filter((id) => !addons.some((a) => a.manifest?.id === id));
if (missing.length) {
  console.warn(`âš  No se encontraron estos addons (Â¿se removieron?): ${missing.join(', ')}`);
}
const sortedStreamAddons = STREAM_ORDER.map((id) => addons.find((a) => a.manifest?.id === id)).filter(Boolean);

const before = addons.filter((a) => !isStreamAddon(a));
const reordered = [
  ...addons.slice(0, firstStreamIdx).filter((a) => !isStreamAddon(a)),
  ...sortedStreamAddons,
  ...addons.slice(firstStreamIdx).filter((a) => !isStreamAddon(a)),
];

if (reordered.length !== addons.length) {
  die(`El reorden perdiÃ³ addons: antes ${addons.length}, despuÃ©s ${reordered.length}`);
}

console.log('\nOrden ACTUAL:');
addons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));
console.log('\nOrden NUEVO:');
reordered.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

// â”€â”€ 3. Reescribir SOLO Meteor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const meteorIdx = reordered.findIndex((a) => a.manifest?.id === 'community.meteor');
if (meteorIdx === -1) die('Meteor no encontrado â€” no se puede aplicar el perfil');

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

console.log('\nMeteor â€” diff de config:');
console.log(`  minSeeders: ${meteorCfgBefore.minSeeders} â†’ ${meteorCfg.minSeeders}`);
console.log(`  sortOrder:  [${meteorCfgBefore.sortOrder.join(', ')}]`);
console.log(`           â†’  [${meteorCfg.sortOrder.join(', ')}]`);

reordered[meteorIdx] = { ...meteor, transportUrl: newMeteorUrl };

// â”€â”€ 4. Visibilidad de Torrentio/Comet (sin tocar) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const torrentio = reordered.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
if (torrentio) {
  const decoded = decodeURIComponent(torrentio.transportUrl);
  const sortMatch = decoded.match(/sort=([^|/]+)/);
  const qfMatch = decoded.match(/qualityfilter=([^/]+)/);
  console.log('\nTorrentio â€” config actual (sin cambios):');
  console.log(`  sort: ${sortMatch?.[1] || '(no seteado)'}`);
  console.log(`  qualityfilter: ${qfMatch?.[1] || '(no seteado)'}`);
  console.log('  â†’ ya usa sort=seeders y el qualityfilter no excluye 4K liso; no hace falta tocarlo.');
}

const comet = reordered.find((a) => a.manifest?.id === 'stremio.comet.fast');
if (comet) {
  const cometMatch = comet.transportUrl.match(/^https:\/\/[^/]+\/([^/]+)\/manifest\.json/);
  if (cometMatch) {
    try {
      const cometCfg = JSON.parse(Buffer.from(cometMatch[1], 'base64').toString('utf8'));
      console.log('\nComet â€” config actual (sin cambios):');
      console.log(`  resolutions: ${JSON.stringify(cometCfg.resolutions)}`);
      console.log(`  options.remove_ranks_under: ${cometCfg.options?.remove_ranks_under}`);
      console.log('  â†’ no tiene campo de sort; ya excluye 2160p/240p/360p/unknown (conservador). No hace falta tocarlo.');
    } catch {
      console.log('\nComet â€” no pude decodificar su config (informativo, no bloquea el resto).');
    }
  }
}

// â”€â”€ 5. Guard anti-duplicados â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ids = reordered.map((a) => a.manifest?.id).filter(Boolean);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) die('manifest.id duplicado tras el reorden: ' + dup.join(', '));
console.log(`\nâœ“ Sin ids duplicados tras el reorden (${reordered.length} addons)`);

if (!APPLY) {
  console.log('\n[DRY-RUN] Pasar --apply para escribir los cambios en la cuenta.');
  // No process.exit() aquÃ­: en Node 24 en Windows, salir justo despuÃ©s de un fetch()
  // dispara un crash de libuv en el cleanup (assertion en async.c) aunque el script ya
  // terminÃ³ su trabajo. Dejar que el proceso termine solo evita el crash.
  process.exitCode = 0;
} else {

// â”€â”€ 6. Guard anti-manifest-congelado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// No vaciamos manifest.catalogs de addons que no tocamos: regenerate-aiometadata.mjs ya prueba
// que addonCollectionSet acepta el payload completo (con los ~132 catÃ¡logos de AIOMetadata
// embebidos) sin problema â€” ver GEMINI.md â†’ "Bug real: catalogs:[] indiscriminado".
if (!(await assertNoFrozenEmptyCatalogs(reordered, ['community.meteor']))) {
  process.exit(1);
}

// â”€â”€ 7. Backup + aplicar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
mkdirSync(BACKUPS, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = join(BACKUPS, `backup-stremioeg-pre-cgnat-profile-${ts}.json`);
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\nâœ“ Backup guardado: ${backupPath}`);

const res = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: reordered });

if (!(res?.result?.success || res?.result)) {
  die('addonCollectionSet fallÃ³: ' + JSON.stringify(res));
}
console.log('âœ“ ColecciÃ³n actualizada correctamente.');

// â”€â”€ 8. VerificaciÃ³n post-cambio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
console.log(`\n${ok ? 'âœ…' : 'âœ—'} Perfil CGNAT ${ok ? 'aplicado y verificado' : 'NO confirmado del todo'}`);
console.log(`   Total addons: ${afterAddons.length} (antes: ${addons.length})`);
console.log(`   Meteor config OK: ${meteorOk}`);
console.log(`   Backup: ${backupPath}`);

// No process.exit() aquÃ­: en Node 24 en Windows, salir justo despuÃ©s de un fetch()
// dispara un crash de libuv en el cleanup (assertion en async.c) aunque el trabajo ya
// terminÃ³. Dejar que el proceso termine solo evita el crash.
process.exitCode = ok ? 0 : 1;
}
