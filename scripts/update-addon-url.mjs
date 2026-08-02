/**
 * update-addon-url.mjs — Cambia el transportUrl de un addon ya instalado (mismo
 * manifest.id), refrescando su manifest desde la URL nueva. Útil cuando un addon
 * migra de infraestructura del lado del proveedor (ej. NoTorrent: Render → Workers,
 * 2026-07-13) y hay que apuntar la cuenta a la URL nueva sin duplicar la entrada.
 *
 * Uso:
 *   ST_EMAIL=... ST_PASS=... node scripts/update-addon-url.mjs <manifest.id> <nuevaTransportUrl>
 *   ST_EMAIL=... ST_PASS=... node scripts/update-addon-url.mjs <manifest.id> <nuevaTransportUrl> --apply
 *
 * Guarda backup antes de aplicar. Aborta si el manifest.id de la URL nueva no
 * coincide con el addon que se está reemplazando (evita instalar otra cosa por error).
 * Sin --apply solo reporta (dry-run).
 */

const API = 'https://api.strem.io/api';
const EMAIL = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const PASS  = process.env.ST_PASS  || '';

const targetId = process.argv[2];
const newUrl   = process.argv[3];
const apply    = process.argv.includes('--apply');

if (!targetId || !newUrl) {
  console.error('Uso: ST_PASS=... node scripts/update-addon-url.mjs <manifest.id> <nuevaTransportUrl> [--apply]');
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

const idx = addons.findIndex((a) => a.manifest?.id === targetId);
if (idx === -1) {
  console.error(`✗ No se encontró addon con manifest.id="${targetId}"`);
  process.exit(1);
}
const current = addons[idx];
console.log(`\nAddon actual (índice ${idx}):`);
console.log(`  transportUrl: ${current.transportUrl}`);
console.log(`  manifest.name: ${current.manifest?.name}`);
console.log(`  manifest.version: ${current.manifest?.version}`);

// Fetch fresco del manifest nuevo
const newManifest = await fetch(newUrl, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
if (newManifest?.id !== targetId) {
  console.error(`✗ El manifest.id de la URL nueva ("${newManifest?.id}") no coincide con "${targetId}" — abortado para no instalar otra cosa por error.`);
  process.exit(1);
}

console.log(`\nManifest NUEVO (${newUrl}):`);
console.log(`  manifest.name: ${newManifest.name}`);
console.log(`  manifest.version: ${newManifest.version}`);
console.log(`  catalogs: ${newManifest.catalogs?.length ?? 0}`);

if (!apply) {
  console.log('\n[DRY-RUN] Pasar --apply para ejecutar el cambio.');
  process.exit(0);
}

// Guard anti-manifest-congelado: este script SÍ modifica el manifest del addon
// objetivo intencionalmente (con datos frescos), así que se excluye del chequeo;
// el resto de la colección no se toca. Ver scripts/lib/collection-guard.mjs y
// CLAUDE.md → "Bug real: catalogs:[] indiscriminado".
const updated = addons.map((a, i) => (i === idx ? { ...a, transportUrl: newUrl, manifest: newManifest } : a));
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';
if (!(await assertNoFrozenEmptyCatalogs(updated, [targetId]))) {
  process.exit(1);
}

// Backup
import { writeFileSync } from 'fs';
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const accountSlug = EMAIL.split('@')[0];
const backupPath = `.backups/backup-${accountSlug}-pre-update-url-${ts}.json`;
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\n✓ Backup guardado: ${backupPath}`);

// Aplicar
const res = await apiPost('addonCollectionSet', {
  type: 'AddonCollectionSet',
  authKey,
  addons: updated,
});

if (res?.result?.success) {
  console.log('✓ Colección actualizada correctamente.');
  console.log('\nVerificando...');
  const check = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const after = (check?.result?.addons || []).find((a) => a.manifest?.id === targetId);
  console.log(`  ${after?.manifest?.id}: transportUrl=${after?.transportUrl} | name=${after?.manifest?.name} | version=${after?.manifest?.version}`);
  console.log('✓ Listo.');
} else {
  console.error('✗ Error al aplicar:', JSON.stringify(res));
  process.exit(1);
}
