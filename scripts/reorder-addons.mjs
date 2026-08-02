/**
 * reorder-addons.mjs — Mueve un addon al índice 0 de la colección, o justo
 * después de otro addon con --after.
 *
 * Uso:
 *   ST_PASS=... node scripts/reorder-addons.mjs <manifest.id>
 *   ST_PASS=... node scripts/reorder-addons.mjs com.linvo.cinemeta
 *   ST_PASS=... node scripts/reorder-addons.mjs <manifest.id> --after <otro.manifest.id>
 *
 * Guarda backup antes de aplicar. Imprime la nueva lista y confirma.
 * Sin --apply solo reporta (dry-run).
 */

const API = 'https://api.strem.io/api';
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

const apiPost = (path, body) =>
  fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.json());

// Login
const login = await apiPost('login', { authKey: null, email: EMAIL, password: PASS });
const authKey = login?.result?.authKey;
if (!authKey) { console.error('Login fallido:', login?.error); process.exit(1); }
console.log('✓ Login OK');

// Leer colección actual
const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
console.log(`✓ ${addons.length} addons leídos`);

// Buscar el addon objetivo
const idx = addons.findIndex((a) => a.manifest?.id === targetId);
if (idx === -1) {
  console.error(`✗ No se encontró addon con manifest.id="${targetId}"`);
  console.log('IDs disponibles:', addons.map((a) => a.manifest?.id).join(', '));
  process.exit(1);
}
console.log(`\nOrden ACTUAL:`);
addons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

let reordered;
if (afterId) {
  const afterIdx = addons.findIndex((a) => a.manifest?.id === afterId);
  if (afterIdx === -1) {
    console.error(`✗ No se encontró addon con manifest.id="${afterId}" (--after)`);
    process.exit(1);
  }
  if (afterIdx === idx - 1) {
    console.log(`✓ "${targetId}" ya está justo después de "${afterId}" — nada que hacer.`);
    process.exit(0);
  }
  const withoutTarget = addons.filter((_, i) => i !== idx);
  const newAfterIdx = withoutTarget.findIndex((a) => a.manifest?.id === afterId);
  reordered = [
    ...withoutTarget.slice(0, newAfterIdx + 1),
    addons[idx],
    ...withoutTarget.slice(newAfterIdx + 1),
  ];
  console.log(`\nOrden NUEVO (${targetId} → justo después de ${afterId}):`);
} else {
  if (idx === 0) {
    console.log(`✓ "${targetId}" ya está en índice 0 — nada que hacer.`);
    process.exit(0);
  }
  // Nuevo orden: el objetivo al frente, resto igual
  reordered = [addons[idx], ...addons.filter((_, i) => i !== idx)];
  console.log(`\nOrden NUEVO (${targetId} → índice 0):`);
}
reordered.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

if (!apply) {
  console.log('\n[DRY-RUN] Pasar --apply para ejecutar el cambio.');
  process.exit(0);
}

// Guard anti-manifest-congelado: un simple reorden no modifica el manifest de ningún addon, así
// que ninguno debería perder catalogs — ver scripts/lib/collection-guard.mjs y CLAUDE.md → "Bug
// real: catalogs:[] indiscriminado". regenerate-aiometadata.mjs ya prueba que addonCollectionSet
// acepta el payload completo (con catálogos embebidos) sin problema; no hace falta vaciarlo.
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
console.log(`\n✓ Backup guardado: ${backupPath}`);

// Aplicar
const res = await apiPost('addonCollectionSet', {
  type: 'AddonCollectionSet',
  authKey,
  addons: reordered,
});

if (res?.result?.success) {
  console.log('✓ Colección actualizada correctamente.');
  console.log('\nVerificando...');
  const check = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const newAddons = check?.result?.addons || [];
  console.log(`  Índice 0: ${newAddons[0]?.manifest?.id} | ${newAddons[0]?.manifest?.name}`);
  console.log('✓ Listo.');
} else {
  console.error('✗ Error al aplicar:', JSON.stringify(res));
  process.exit(1);
}
