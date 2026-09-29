/**
 * install-addon.mjs â€” Instala un addon NUEVO (que no estÃ¡ en la colecciÃ³n) por su
 * manifest URL, en una posiciÃ³n dada (Ã­ndice o --after otro manifest.id).
 *
 * A diferencia de reorder-addons.mjs / update-addon-url.mjs (que solo reordenan o
 * actualizan addons YA presentes en la colecciÃ³n, buscados por manifest.id), este
 * script es para el caso que no tenÃ­a precedente en el repo: insertar una entrada
 * con un manifest.id que todavÃ­a no existe en la cuenta.
 *
 * Uso:
 *   ST_PASS=... node scripts/install-addon.mjs <manifestUrl> --at 0
 *   ST_PASS=... node scripts/install-addon.mjs <manifestUrl> --after <otro.manifest.id>
 *   ST_PASS=... node scripts/install-addon.mjs <manifestUrl> --at 0 --apply
 *
 * Guarda backup antes de aplicar. Sin --apply solo reporta (dry-run).
 */
import { apiPost as _apiPost } from './lib/stremio-api.mjs';

const EMAIL = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const PASS  = process.env.ST_PASS  || '';

const manifestUrl = process.argv[2];
const apply = process.argv.includes('--apply');
const atFlagIdx = process.argv.indexOf('--at');
const atIndex = atFlagIdx >= 0 ? parseInt(process.argv[atFlagIdx + 1], 10) : null;
const afterFlagIdx = process.argv.indexOf('--after');
const afterId = afterFlagIdx >= 0 ? process.argv[afterFlagIdx + 1] : null;

if (!manifestUrl || (atIndex == null && !afterId)) {
  console.error(
    'Uso: ST_PASS=... node scripts/install-addon.mjs <manifestUrl> (--at <Ã­ndice> | --after <manifest.id>) [--apply]'
  );
  process.exit(1);
}
if (atIndex != null && afterId) {
  console.error('UsÃ¡ --at o --after, no ambos.');
  process.exit(1);
}
if (!PASS) {
  console.error('ST_PASS requerido');
  process.exit(1);
}

const apiPost = (path, body) => _apiPost(path, body, { timeout: 15000 });

const manifestUrlOf = (url) =>
  /manifest\.json$/.test(url) ? url : url.replace(/\/?$/, '/') + 'manifest.json';

// Login
const login = await apiPost('login', { authKey: null, email: EMAIL, password: PASS });
const authKey = login?.result?.authKey;
if (!authKey) { console.error('Login fallido:', login?.error); process.exit(1); }
console.log('âœ“ Login OK');

// Leer colecciÃ³n actual
const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
console.log(`âœ“ ${addons.length} addons leÃ­dos`);

// Fetch fresco del manifest del addon nuevo
const fullManifestUrl = manifestUrlOf(manifestUrl);
console.log(`\nFetcheando manifest: ${fullManifestUrl}`);
const manifestRes = await fetch(fullManifestUrl, { signal: AbortSignal.timeout(15000) });
if (!manifestRes.ok) {
  console.error(`âœ— El manifest respondiÃ³ ${manifestRes.status}`);
  process.exit(1);
}
const newManifest = await manifestRes.json();
if (!newManifest?.id) {
  console.error('âœ— El manifest no tiene un campo "id" vÃ¡lido:', JSON.stringify(newManifest).slice(0, 300));
  process.exit(1);
}
console.log(`âœ“ Manifest OK: "${newManifest.name}" (${newManifest.id}), ${newManifest.catalogs?.length ?? 0} catÃ¡logos, resources=${JSON.stringify(newManifest.resources)}`);

// Guard: no duplicar manifest.id ya instalado
if (addons.some((a) => a.manifest?.id === newManifest.id)) {
  console.error(`âœ— Ya hay un addon instalado con manifest.id="${newManifest.id}" â€” usar update-addon-url.mjs si es un reemplazo, no este script.`);
  process.exit(1);
}

const newEntry = { transportUrl: fullManifestUrl, manifest: newManifest };

// Calcular posiciÃ³n de inserciÃ³n
console.log(`\nOrden ACTUAL:`);
addons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

let insertAt;
if (afterId) {
  const afterIdx = addons.findIndex((a) => a.manifest?.id === afterId);
  if (afterIdx === -1) {
    console.error(`âœ— No se encontrÃ³ addon con manifest.id="${afterId}" (--after)`);
    console.log('IDs disponibles:', addons.map((a) => a.manifest?.id).join(', '));
    process.exit(1);
  }
  insertAt = afterIdx + 1;
} else {
  insertAt = Math.max(0, Math.min(atIndex, addons.length));
}

const nextAddons = [
  ...addons.slice(0, insertAt),
  newEntry,
  ...addons.slice(insertAt),
];

console.log(`\nOrden NUEVO (${newManifest.id} â†’ Ã­ndice ${insertAt}):`);
nextAddons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

if (!apply) {
  console.log('\n[DRY-RUN] Pasar --apply para ejecutar el cambio.');
  process.exit(0);
}

// Guard anti-manifest-congelado â€” ver scripts/lib/collection-guard.mjs y GEMINI.md â†’ "Bug real:
// catalogs:[] indiscriminado". El addon nuevo queda exento (modifiedIds); nada mÃ¡s se toca.
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';
if (!(await assertNoFrozenEmptyCatalogs(nextAddons, [newManifest.id]))) {
  process.exit(1);
}

// Backup
import { mkdirSync, writeFileSync } from 'fs';
mkdirSync('.backups', { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const accountSlug = EMAIL.split('@')[0];
const backupPath = `.backups/backup-${accountSlug}-pre-install-${newManifest.id.replace(/[^a-z0-9.-]/gi, '_')}-${ts}.json`;
writeFileSync(backupPath, JSON.stringify(col, null, 2));
console.log(`\nâœ“ Backup guardado: ${backupPath}`);

// Aplicar
const res = await apiPost('addonCollectionSet', {
  type: 'AddonCollectionSet',
  authKey,
  addons: nextAddons,
});

if (res?.result?.success ?? res?.result) {
  console.log('âœ“ ColecciÃ³n actualizada correctamente.');
  console.log('\nVerificando...');
  const check = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const checkAddons = check?.result?.addons || [];
  const installedIdx = checkAddons.findIndex((a) => a.manifest?.id === newManifest.id);
  if (installedIdx === -1) {
    console.error('âœ— El addon nuevo no aparece en la colecciÃ³n tras el write â€” revisar a mano.');
    process.exit(1);
  }
  console.log(`  Ãndice ${installedIdx}: ${checkAddons[installedIdx]?.manifest?.id} | ${checkAddons[installedIdx]?.manifest?.name}`);
  console.log(`  Total de addons: ${checkAddons.length} (antes: ${addons.length})`);
  console.log('âœ“ Listo.');
} else {
  console.error('âœ— Error al aplicar:', JSON.stringify(res));
  process.exit(1);
}
