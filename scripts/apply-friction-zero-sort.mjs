#!/usr/bin/env node
/**
 * Perfil "friction-zero": el usuario no quiere evaluar streams a mano â€” entra, toca play, anda.
 * Ver GEMINI.md â†’ "TorBox (debrid activo)" â†’ "Sort friction-zero".
 *
 * Investigado contra los configuradores pÃºblicos de Torrentio y Comet (2026-07-11) antes de
 * escribir nada:
 *   - Torrentio NO tiene ninguna opciÃ³n de sort por "cacheado en debrid primero" (su dropdown
 *     "Sorting" solo tiene quality/qualitysize/seeders/size, con o sin debrid configurado). SÃ­
 *     tiene "Priority foreign language" con una opciÃ³n `latino` (ðŸ‡²ðŸ‡½) dedicada â€” eso se aplica acÃ¡
 *     para audio latino. El objetivo de "el primero siempre anda" para Torrentio queda cubierto
 *     igual por otra vÃ­a: con debrid configurado, TODOS los resultados de Torrentio se resuelven
 *     vÃ­a TorBox (tageados [TB+] o "[TB download]"), no dependen del swarm P2P del usuario aunque
 *     no estÃ©n cacheados â€” el req real (fiabilidad, no depender del P2P propio) ya estÃ¡ cubierto.
 *   - Comet SÃ tiene la opciÃ³n exacta: `sortCachedUncachedTogether` (tooltip real: "Disable the
 *     default behavior of sorting cached results first, and instead mixes cached and uncached
 *     results together"). El default de la cuenta ya era el correcto (false = cacheados primero)
 *     pero no estaba seteado explÃ­citamente en el config â€” se fija acÃ¡ para que no dependa de un
 *     default implÃ­cito del addon. TambiÃ©n tiene `languages.preferred`, que la cuenta YA tenÃ­a en
 *     `["la","en"]` (latino primero) de una sesiÃ³n anterior â€” no se toca, ya estaba bien.
 *
 * Por defecto SOLO REPORTA (dry-run). Con --apply escribe de verdad (con backup previo).
 *
 * Requiere: ST_EMAIL, ST_PASS
 *
 * Uso:
 *   ST_EMAIL=... ST_PASS=... node scripts/apply-friction-zero-sort.mjs
 *   ST_EMAIL=... ST_PASS=... node scripts/apply-friction-zero-sort.mjs --apply
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

const die = (m, code = 1) => { console.error(`âœ— ${m}`); process.exit(code); };

const email = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const pass = process.env.ST_PASS || '';
if (!pass) die('Falta ST_PASS');

// â”€â”€ 1. Login + colecciÃ³n actual â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
console.log(`âœ“ Login OK â€” ${addons.length} addons leÃ­dos`);

// â”€â”€ 2. Torrentio â€” agregar language=latino (preservando el resto) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const torrentioIdx = addons.findIndex((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
if (torrentioIdx === -1) die('No encontrÃ© Torrentio en la colecciÃ³n');
const torrentio = addons[torrentioIdx];
const torrentioMatch = torrentio.transportUrl.match(/^(https:\/\/[^/]+\/)([^/]*)(\/manifest\.json.*)$/);
if (!torrentioMatch) die('No pude parsear el transportUrl de Torrentio: ' + torrentio.transportUrl);
const [, torrentioPrefix, torrentioCfgSegment, torrentioSuffix] = torrentioMatch;

const torrentioPairs = torrentioCfgSegment ? torrentioCfgSegment.split('|') : [];
let foundLanguage = false;
const torrentioPairsNew = torrentioPairs.map((p) => {
  if (p.startsWith('language=')) { foundLanguage = true; return 'language=latino'; }
  return p;
});
if (!foundLanguage) torrentioPairsNew.push('language=latino');
const torrentioCfgNew = torrentioPairsNew.join('|');
const newTorrentioUrl = `${torrentioPrefix}${torrentioCfgNew}${torrentioSuffix}`;

console.log('\nTorrentio â€” diff:');
console.log(`  antes:   ${torrentioCfgSegment}`);
console.log(`  despuÃ©s: ${torrentioCfgNew}`);

// â”€â”€ 3. Comet â€” fijar sortCachedUncachedTogether:false explÃ­cito â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const cometIdx = addons.findIndex((a) => a.manifest?.id === 'stremio.comet.fast');
if (cometIdx === -1) die('No encontrÃ© Comet en la colecciÃ³n');
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
cometCfg.sortCachedUncachedTogether = false;
// languages.preferred ya tiene ["la","en"] de una sesiÃ³n anterior â€” no se toca si ya estÃ¡ bien.
const preferredHasLatino = (cometCfg.languages?.preferred || []).includes('la');
if (!preferredHasLatino) {
  cometCfg.languages = cometCfg.languages || {};
  cometCfg.languages.preferred = ['la', ...(cometCfg.languages.preferred || [])];
}

const newCometB64 = Buffer.from(JSON.stringify(cometCfg)).toString('base64');
const newCometUrl = `${cometPrefix}${newCometB64}${cometSuffix}`;

console.log('\nComet â€” diff:');
console.log(`  sortCachedUncachedTogether: ${cometCfgBefore.sortCachedUncachedTogether} â†’ ${cometCfg.sortCachedUncachedTogether}`);
console.log(`  languages.preferred: ${JSON.stringify(cometCfgBefore.languages?.preferred)} â†’ ${JSON.stringify(cometCfg.languages.preferred)}`);

if (!APPLY) {
  console.log('\n[DRY-RUN] Pasar --apply para escribir los cambios en la cuenta.');
  process.exitCode = 0;
} else {

const updated = addons.map((a, i) => {
  if (i === torrentioIdx) return { ...a, transportUrl: newTorrentioUrl };
  if (i === cometIdx) return { ...a, transportUrl: newCometUrl };
  return a;
});

// â”€â”€ 4. Guard anti-manifest-congelado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// No vaciamos manifest.catalogs de addons que no tocamos: regenerate-aiometadata.mjs ya prueba
// que addonCollectionSet acepta el payload completo (con los ~132 catÃ¡logos de AIOMetadata
// embebidos) sin problema â€” ver GEMINI.md â†’ "Bug real: catalogs:[] indiscriminado". Este era
// justo el script que dejÃ³ AIOMetadata/MyTrakt con catalogs=0 el 2026-07-11.
if (!(await assertNoFrozenEmptyCatalogs(updated, ['com.stremio.torrentio.addon', 'stremio.comet.fast']))) {
  process.exit(1);
}

// â”€â”€ 5. Backup + aplicar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
mkdirSync(BACKUPS, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const accountSlug = email.split('@')[0];
const backupPath = join(BACKUPS, `backup-${accountSlug}-pre-frictionzero-${ts}.json`);
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\nâœ“ Backup guardado: ${backupPath}`);

const res = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: updated });
if (!(res?.result?.success || res?.result)) die('addonCollectionSet fallÃ³: ' + JSON.stringify(res));
console.log('âœ“ ColecciÃ³n actualizada correctamente.');

const after = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const afterAddons = after?.result?.addons || [];
const torrentioAfter = afterAddons.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
const cometAfter = afterAddons.find((a) => a.manifest?.id === 'stremio.comet.fast');
const torrentioOk = !!torrentioAfter?.transportUrl.includes('language=latino');
let cometOk = false;
if (cometAfter) {
  const m = cometAfter.transportUrl.match(/^https:\/\/[^/]+\/([^/]+)\/manifest\.json/);
  if (m) {
    try {
      const cfg = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
      cometOk = cfg.sortCachedUncachedTogether === false && (cfg.languages?.preferred || []).includes('la');
    } catch { /* cometOk queda false */ }
  }
}
const ok = torrentioOk && cometOk;
console.log(`\n${ok ? 'âœ…' : 'âœ—'} Perfil friction-zero ${ok ? 'aplicado y verificado' : 'NO confirmado del todo'}`);
console.log(`   Torrentio OK: ${torrentioOk} | Comet OK: ${cometOk}`);
console.log(`   Backup: ${backupPath}`);
process.exitCode = ok ? 0 : 1;
}
