#!/usr/bin/env node
/**
 * Perfil "friction-zero": el usuario no quiere evaluar streams a mano — entra, toca play, anda.
 * Ver CLAUDE.md → "TorBox (debrid activo)" → "Sort friction-zero".
 *
 * Investigado contra los configuradores públicos de Torrentio y Comet (2026-07-11) antes de
 * escribir nada:
 *   - Torrentio NO tiene ninguna opción de sort por "cacheado en debrid primero" (su dropdown
 *     "Sorting" solo tiene quality/qualitysize/seeders/size, con o sin debrid configurado). Sí
 *     tiene "Priority foreign language" con una opción `latino` (🇲🇽) dedicada — eso se aplica acá
 *     para audio latino. El objetivo de "el primero siempre anda" para Torrentio queda cubierto
 *     igual por otra vía: con debrid configurado, TODOS los resultados de Torrentio se resuelven
 *     vía TorBox (tageados [TB+] o "[TB download]"), no dependen del swarm P2P del usuario aunque
 *     no estén cacheados — el req real (fiabilidad, no depender del P2P propio) ya está cubierto.
 *   - Comet SÍ tiene la opción exacta: `sortCachedUncachedTogether` (tooltip real: "Disable the
 *     default behavior of sorting cached results first, and instead mixes cached and uncached
 *     results together"). El default de la cuenta ya era el correcto (false = cacheados primero)
 *     pero no estaba seteado explícitamente en el config — se fija acá para que no dependa de un
 *     default implícito del addon. También tiene `languages.preferred`, que la cuenta YA tenía en
 *     `["la","en"]` (latino primero) de una sesión anterior — no se toca, ya estaba bien.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BACKUPS = join(ROOT, '.backups');

const API = 'https://api.strem.io/api';
const APPLY = process.argv.includes('--apply');

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
if (!pass) die('Falta ST_PASS');

// ── 1. Login + colección actual ──────────────────────────────────────────────
const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
console.log(`✓ Login OK — ${addons.length} addons leídos`);

// ── 2. Torrentio — agregar language=latino (preservando el resto) ────────────
const torrentioIdx = addons.findIndex((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
if (torrentioIdx === -1) die('No encontré Torrentio en la colección');
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

console.log('\nTorrentio — diff:');
console.log(`  antes:   ${torrentioCfgSegment}`);
console.log(`  después: ${torrentioCfgNew}`);

// ── 3. Comet — fijar sortCachedUncachedTogether:false explícito ──────────────
const cometIdx = addons.findIndex((a) => a.manifest?.id === 'stremio.comet.fast');
if (cometIdx === -1) die('No encontré Comet en la colección');
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
// languages.preferred ya tiene ["la","en"] de una sesión anterior — no se toca si ya está bien.
const preferredHasLatino = (cometCfg.languages?.preferred || []).includes('la');
if (!preferredHasLatino) {
  cometCfg.languages = cometCfg.languages || {};
  cometCfg.languages.preferred = ['la', ...(cometCfg.languages.preferred || [])];
}

const newCometB64 = Buffer.from(JSON.stringify(cometCfg)).toString('base64');
const newCometUrl = `${cometPrefix}${newCometB64}${cometSuffix}`;

console.log('\nComet — diff:');
console.log(`  sortCachedUncachedTogether: ${cometCfgBefore.sortCachedUncachedTogether} → ${cometCfg.sortCachedUncachedTogether}`);
console.log(`  languages.preferred: ${JSON.stringify(cometCfgBefore.languages?.preferred)} → ${JSON.stringify(cometCfg.languages.preferred)}`);

if (!APPLY) {
  console.log('\n[DRY-RUN] Pasar --apply para escribir los cambios en la cuenta.');
  process.exitCode = 0;
} else {

const updated = addons.map((a, i) => {
  if (i === torrentioIdx) return { ...a, transportUrl: newTorrentioUrl };
  if (i === cometIdx) return { ...a, transportUrl: newCometUrl };
  return a;
});

// ── 4. Guard anti-manifest-congelado ──────────────────────────────────────────
// No vaciamos manifest.catalogs de addons que no tocamos: regenerate-aiometadata.mjs ya prueba
// que addonCollectionSet acepta el payload completo (con los ~132 catálogos de AIOMetadata
// embebidos) sin problema — ver CLAUDE.md → "Bug real: catalogs:[] indiscriminado". Este era
// justo el script que dejó AIOMetadata/MyTrakt con catalogs=0 el 2026-07-11.
if (!(await assertNoFrozenEmptyCatalogs(updated, ['com.stremio.torrentio.addon', 'stremio.comet.fast']))) {
  process.exit(1);
}

// ── 5. Backup + aplicar ──────────────────────────────────────────────────────
mkdirSync(BACKUPS, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = join(BACKUPS, `backup-stremioeg-pre-frictionzero-${ts}.json`);
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\n✓ Backup guardado: ${backupPath}`);

const res = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: updated });
if (!(res?.result?.success || res?.result)) die('addonCollectionSet falló: ' + JSON.stringify(res));
console.log('✓ Colección actualizada correctamente.');

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
console.log(`\n${ok ? '✅' : '✗'} Perfil friction-zero ${ok ? 'aplicado y verificado' : 'NO confirmado del todo'}`);
console.log(`   Torrentio OK: ${torrentioOk} | Comet OK: ${cometOk}`);
console.log(`   Backup: ${backupPath}`);
process.exitCode = ok ? 0 : 1;
}
