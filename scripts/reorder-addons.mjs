/**
 * reorder-addons.mjs — Mueve un addon al índice 0 de la colección.
 *
 * Uso:
 *   ST_PASS=... node scripts/reorder-addons.mjs <manifest.id>
 *   ST_PASS=... node scripts/reorder-addons.mjs com.linvo.cinemeta
 *
 * Guarda backup antes de aplicar. Imprime la nueva lista y confirma.
 * Sin --apply solo reporta (dry-run).
 */

const API = 'https://api.strem.io/api';
const EMAIL = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const PASS  = process.env.ST_PASS  || '';

const targetId = process.argv[2];
const apply    = process.argv.includes('--apply');

if (!targetId) {
  console.error('Uso: ST_PASS=... node scripts/reorder-addons.mjs <manifest.id> [--apply]');
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
if (idx === 0) {
  console.log(`✓ "${targetId}" ya está en índice 0 — nada que hacer.`);
  process.exit(0);
}

console.log(`\nOrden ACTUAL:`);
addons.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

// Nuevo orden: el objetivo al frente, resto igual
const reordered = [addons[idx], ...addons.filter((_, i) => i !== idx)];

console.log(`\nOrden NUEVO (${targetId} → índice 0):`);
reordered.forEach((a, i) => console.log(`  ${i} ${a.manifest?.id} | ${a.manifest?.name}`));

if (!apply) {
  console.log('\n[DRY-RUN] Pasar --apply para ejecutar el cambio.');
  process.exit(0);
}

// Backup
import { writeFileSync } from 'fs';
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = `.backups/backup-stremioeg-pre-reorder-${ts}.json`;
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\n✓ Backup guardado: ${backupPath}`);

// Aplicar
// Nota: addonCollectionSet requiere manifest.catalogs = [] para no exceder max descriptor size
const slim = reordered.map((a) => ({
  ...a,
  manifest: { ...a.manifest, catalogs: [] },
}));

const res = await apiPost('addonCollectionSet', {
  type: 'AddonCollectionSet',
  authKey,
  addons: slim,
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
