#!/usr/bin/env node
/**
 * repair-frozen-catalogs.mjs — Restaura manifest.catalogs para addons con catalogs=[] congelados
 * en el storage de Stremio pese a que su manifest EN VIVO tiene catálogos reales.
 *
 * Causa raíz (ver CLAUDE.md → "Bug real: catalogs:[] indiscriminado"): varios scripts de escritura
 * vaciaban `manifest.catalogs = []` para TODOS los addons del payload antes de addonCollectionSet,
 * no solo el que modificaban, por una premisa falsa sobre límites de tamaño del descriptor. Esto
 * dejó congelados en 0 los catálogos guardados de Cinemeta, AIOMetadata, MyTrakt Sync, NoTorrent,
 * Mubi Catalog, Streaming Catalogs, Trakt Integration y Audio Latino (verificado) — rompiendo
 * búsqueda/catálogos/sugerencias de Home. Los scripts de escritura ya se corrigieron para no volver
 * a hacer esto; este script es la reparación puntual del daño ya hecho en el storage.
 *
 * No cambia transportUrl, orden ni ninguna config — solo reemplaza manifest por un fetch fresco
 * del mismo transportUrl para los addons detectados como congelados.
 *
 * Por defecto SOLO REPORTA. Con --apply hace el swap real (con backup previo).
 *
 * Requiere: ST_EMAIL, ST_PASS
 *
 * Uso:
 *   ST_EMAIL=... ST_PASS=... node scripts/repair-frozen-catalogs.mjs
 *   ST_EMAIL=... ST_PASS=... node scripts/repair-frozen-catalogs.mjs --apply
 *
 * Node >= 20, sin dependencias.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const getJson = (url, t = 15000) =>
  fetch(url, { signal: AbortSignal.timeout(t) }).then((r) => r.json()).catch(() => null);

const hasResource = (manifest, res) =>
  (manifest?.resources || []).some((r) => r === res || r?.name === res);
const manifestUrlOf = (transportUrl) =>
  /manifest\.json$/.test(transportUrl) ? transportUrl : transportUrl.replace(/\/?$/, '/') + 'manifest.json';

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

// ── 2. Detectar addons con catalogs=[] congelado (storage) vs manifest EN VIVO ──
const candidates = addons.filter((a) => hasResource(a.manifest, 'catalog') && (a.manifest?.catalogs?.length ?? 0) === 0);
console.log(`\n${candidates.length} addon(s) declaran soporte de catálogos con catalogs=[] en storage — verificando contra el manifest en vivo...`);

const toRepair = [];
for (const a of candidates) {
  const live = await getJson(manifestUrlOf(a.transportUrl));
  const liveCatalogs = live?.catalogs?.length ?? 0;
  if (liveCatalogs > 0) {
    toRepair.push({ addon: a, liveManifest: live, liveCatalogs });
    console.log(`  ✗ "${a.manifest?.name}" (${a.manifest?.id}): storage=0, en vivo=${liveCatalogs} → A REPARAR`);
  } else {
    console.log(`  ✓ "${a.manifest?.name}" (${a.manifest?.id}): storage=0, en vivo=0 — normal para este addon, no se toca`);
  }
}

if (!toRepair.length) {
  console.log('\n✓ Nada para reparar — ningún addon tiene catálogos congelados en 0.');
  process.exit(0);
}

console.log(`\n${toRepair.length} addon(s) a reparar: ${toRepair.map((r) => r.addon.manifest?.name).join(', ')}`);

if (!APPLY) {
  console.log('\n[DRY-RUN] Pasar --apply para escribir los cambios en la cuenta.');
  process.exitCode = 0;
} else {

// ── 3. Backup + aplicar ───────────────────────────────────────────────────────
mkdirSync(BACKUPS, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = join(BACKUPS, `backup-stremioeg-pre-repair-frozen-catalogs-${ts}.json`);
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\n✓ Backup guardado: ${backupPath}`);

const repairMap = new Map(toRepair.map((r) => [r.addon.manifest?.id, r.liveManifest]));
const repaired = addons.map((a) => {
  const liveManifest = repairMap.get(a.manifest?.id);
  if (!liveManifest) return a;
  // Preservar el name que ya tenía la cuenta (algunos addons traen un name levemente distinto
  // en su manifest en vivo vs el guardado, ej. espacios extra en "AIOMetadata  | ElfHosted").
  return { ...a, manifest: { ...liveManifest, name: a.manifest?.name || liveManifest.name } };
});

// Guard anti-duplicados de manifest.id.
const ids = repaired.map((a) => a.manifest?.id).filter(Boolean);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) die('manifest.id duplicado tras la reparación: ' + dup.join(', '));

const res = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: repaired });
if (!(res?.result?.success || res?.result)) die('addonCollectionSet falló: ' + JSON.stringify(res));
console.log('✓ Colección actualizada correctamente.');

// ── 4. Verificación post-cambio ────────────────────────────────────────────────
const after = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const afterAddons = after?.result?.addons || [];
console.log(`\nVerificando... (${afterAddons.length} addons, antes ${addons.length})`);

let allOk = afterAddons.length === addons.length;
for (const { addon } of toRepair) {
  const a2 = afterAddons.find((x) => x.manifest?.id === addon.manifest?.id);
  const n = a2?.manifest?.catalogs?.length ?? 0;
  const ok = n > 0;
  allOk = allOk && ok;
  console.log(`  ${ok ? '✓' : '✗'} ${addon.manifest?.name}: catalogs.length = ${n}`);
}

console.log(`\n${allOk ? '✅' : '✗'} Reparación ${allOk ? 'aplicada y verificada' : 'NO confirmada del todo'}`);
console.log(`   Backup: ${backupPath}`);
process.exitCode = allOk ? 0 : 1;
}
