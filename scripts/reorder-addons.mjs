/**
 * reorder-addons.mjs â€” Mueve un addon al Ã­ndice 0 de la colecciÃ³n, o justo
 * despuÃ©s de otro addon con --after.
 *
 * Uso:
 *   ST_PASS=... node scripts/reorder-addons.mjs <manifest.id>
 *   ST_PASS=... node scripts/reorder-addons.mjs com.linvo.cinemeta
 *   ST_PASS=... node scripts/reorder-addons.mjs <manifest.id> --after <otro.manifest.id>
 *
 * Guarda backup antes de aplicar. Imprime la nueva lista y confirma.
 * Sin --apply solo reporta (dry-run).
 */
import { apiPost as _apiPost } from './lib/stremio-api.mjs';

const EMAIL = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const PASS  = process.env.ST_PASS  || '';

const targetId = process.argv[2];
const apply    = process.argv.includes('--apply');
const afterFlagIdx = process.argv.indexOf('--after');
const afterId = afterFlagIdx >= 0 ? process.argv[afterFlagIdx + 1] : null;

if (!targetId) {
  console.error('Uso: ST_PASS=... node scripts/reorder-addons.mjs <manifest.id> [--after <otro.manifest.id>] [--apply]');
  process.exit(1);
}
if (afterFlagIdx >= 0 && !afterId) {
  console.error('--after requiere un manifest.id');
  process.exit(1);
}
if (!PASS) {
  console.error('ST_PASS requerido');
  process.exit(1);
}

const apiPost = (path, body) => _apiPost(path, body, { timeout: 15000 });

// Login
const login = await apiPost('login', { authKey: null, email: EMAIL, password: PASS });
const authKey = login?.result?.authKey;
if (!authKey) { console.error('Login fallido:', login?.error); process.exit(1); }
console.log('âœ“ Login OK');

// Leer colecciÃ³n actual
const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
console.log(`âœ“ ${addons.length} addons leÃ­dos`);

// Buscar el addon objetivo
const idx = addons.findIndex((a) => a.manifest?.id === targetId);
if (idx === -1) {
  console.error(`âœ— No se encontrÃ³ addon con manifest.id="${targetId}"`);
  console.log('IDs disponibles:', addons.map((a) => a.manifest?.id).join(', '));
  process.exit(1);
}
console.log(`\nOrden ACTUAL:`);
addons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

let reordered;
if (afterId) {
  const afterIdx = addons.findIndex((a) => a.manifest?.id === afterId);
  if (afterIdx === -1) {
    console.error(`âœ— No se encontrÃ³ addon con manifest.id="${afterId}" (--after)`);
    process.exit(1);
  }
  if (afterIdx === idx - 1) {
    console.log(`âœ“ "${targetId}" ya estÃ¡ justo despuÃ©s de "${afterId}" â€” nada que hacer.`);
    process.exit(0);
  }
  const withoutTarget = addons.filter((_, i) => i !== idx);
  const newAfterIdx = withoutTarget.findIndex((a) => a.manifest?.id === afterId);
  reordered = [
    ...withoutTarget.slice(0, newAfterIdx + 1),
    addons[idx],
    ...withoutTarget.slice(newAfterIdx + 1),
  ];
  console.log(`\nOrden NUEVO (${targetId} â†’ justo despuÃ©s de ${afterId}):`);
} else {
  if (idx === 0) {
    console.log(`âœ“ "${targetId}" ya estÃ¡ en Ã­ndice 0 â€” nada que hacer.`);
    process.exit(0);
  }
  // Nuevo orden: el objetivo al frente, resto igual
  reordered = [addons[idx], ...addons.filter((_, i) => i !== idx)];
  console.log(`\nOrden NUEVO (${targetId} â†’ Ã­ndice 0):`);
}
reordered.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

if (!apply) {
  console.log('\n[DRY-RUN] Pasar --apply para ejecutar el cambio.');
  process.exit(0);
}

// Guard anti-manifest-congelado: un simple reorden no modifica el manifest de ningÃºn addon, asÃ­
// que ninguno deberÃ­a perder catalogs â€” ver scripts/lib/collection-guard.mjs y GEMINI.md â†’ "Bug
// real: catalogs:[] indiscriminado". regenerate-aiometadata.mjs ya prueba que addonCollectionSet
// acepta el payload completo (con catÃ¡logos embebidos) sin problema; no hace falta vaciarlo.
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';
if (!(await assertNoFrozenEmptyCatalogs(reordered, []))) {
  process.exit(1);
}

// Backup
import { writeFileSync } from 'fs';
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const accountSlug = EMAIL.split('@')[0];
const backupPath = `.backups/backup-${accountSlug}-pre-reorder-${ts}.json`;
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\nâœ“ Backup guardado: ${backupPath}`);

// Aplicar
const res = await apiPost('addonCollectionSet', {
  type: 'AddonCollectionSet',
  authKey,
  addons: reordered,
});

if (res?.result?.success) {
  console.log('âœ“ ColecciÃ³n actualizada correctamente.');
  console.log('\nVerificando...');
  const check = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const newAddons = check?.result?.addons || [];
  console.log(`  Ãndice 0: ${newAddons[0]?.manifest?.id} | ${newAddons[0]?.manifest?.name}`);
  console.log('âœ“ Listo.');
} else {
  console.error('âœ— Error al aplicar:', JSON.stringify(res));
  process.exit(1);
}
