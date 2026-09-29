#!/usr/bin/env node
/**
 * repair-frozen-catalogs.mjs â€” Restaura manifest.catalogs para addons con catalogs=[] congelados
 * en el storage de Stremio pese a que su manifest EN VIVO tiene catÃ¡logos reales.
 *
 * Causa raÃ­z (ver GEMINI.md â†’ "Bug real: catalogs:[] indiscriminado"): varios scripts de escritura
 * vaciaban `manifest.catalogs = []` para TODOS los addons del payload antes de addonCollectionSet,
 * no solo el que modificaban, por una premisa falsa sobre lÃ­mites de tamaÃ±o del descriptor. Esto
 * dejÃ³ congelados en 0 los catÃ¡logos guardados de Cinemeta, AIOMetadata, MyTrakt Sync, NoTorrent,
 * Mubi Catalog, Streaming Catalogs, Trakt Integration y Audio Latino (verificado) â€” rompiendo
 * bÃºsqueda/catÃ¡logos/sugerencias de Home. Los scripts de escritura ya se corrigieron para no volver
 * a hacer esto; este script es la reparaciÃ³n puntual del daÃ±o ya hecho en el storage.
 *
 * No cambia transportUrl, orden ni ninguna config â€” solo reemplaza manifest por un fetch fresco
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
import { apiPost } from './lib/stremio-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BACKUPS = join(ROOT, '.backups');

const APPLY = process.argv.includes('--apply');

const die = (m, code = 1) => { console.error(`âœ— ${m}`); process.exit(code); };
const getJson = (url, t = 15000) =>
  fetch(url, { signal: AbortSignal.timeout(t) }).then((r) => r.json()).catch(() => null);

const hasResource = (manifest, res) =>
  (manifest?.resources || []).some((r) => r === res || r?.name === res);
const manifestUrlOf = (transportUrl) =>
  /manifest\.json$/.test(transportUrl) ? transportUrl : transportUrl.replace(/\/?$/, '/') + 'manifest.json';

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

// â”€â”€ 2. Detectar addons con catalogs=[] congelado (storage) vs manifest EN VIVO â”€â”€
const candidates = addons.filter((a) => hasResource(a.manifest, 'catalog') && (a.manifest?.catalogs?.length ?? 0) === 0);
console.log(`\n${candidates.length} addon(s) declaran soporte de catÃ¡logos con catalogs=[] en storage â€” verificando contra el manifest en vivo...`);

const toRepair = [];
for (const a of candidates) {
  const live = await getJson(manifestUrlOf(a.transportUrl));
  const liveCatalogs = live?.catalogs?.length ?? 0;
  if (liveCatalogs > 0) {
    toRepair.push({ addon: a, liveManifest: live, liveCatalogs });
    console.log(`  âœ— "${a.manifest?.name}" (${a.manifest?.id}): storage=0, en vivo=${liveCatalogs} â†’ A REPARAR`);
  } else {
    console.log(`  âœ“ "${a.manifest?.name}" (${a.manifest?.id}): storage=0, en vivo=0 â€” normal para este addon, no se toca`);
  }
}

if (!toRepair.length) {
  console.log('\nâœ“ Nada para reparar â€” ningÃºn addon tiene catÃ¡logos congelados en 0.');
  process.exit(0);
}

console.log(`\n${toRepair.length} addon(s) a reparar: ${toRepair.map((r) => r.addon.manifest?.name).join(', ')}`);

if (!APPLY) {
  console.log('\n[DRY-RUN] Pasar --apply para escribir los cambios en la cuenta.');
  process.exitCode = 0;
} else {

// â”€â”€ 3. Backup + aplicar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
mkdirSync(BACKUPS, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const accountSlug = email.split('@')[0];
const backupPath = join(BACKUPS, `backup-${accountSlug}-pre-repair-frozen-catalogs-${ts}.json`);
writeFileSync(backupPath, JSON.stringify({ result: { addons } }, null, 2));
console.log(`\nâœ“ Backup guardado: ${backupPath}`);

const repairMap = new Map(toRepair.map((r) => [r.addon.manifest?.id, r.liveManifest]));
const repaired = addons.map((a) => {
  const liveManifest = repairMap.get(a.manifest?.id);
  if (!liveManifest) return a;
  // Preservar el name que ya tenÃ­a la cuenta (algunos addons traen un name levemente distinto
  // en su manifest en vivo vs el guardado, ej. espacios extra en "AIOMetadata  | ElfHosted").
  return { ...a, manifest: { ...liveManifest, name: a.manifest?.name || liveManifest.name } };
});

// Guard anti-duplicados de manifest.id.
const ids = repaired.map((a) => a.manifest?.id).filter(Boolean);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) die('manifest.id duplicado tras la reparaciÃ³n: ' + dup.join(', '));

const res = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: repaired });
if (!(res?.result?.success || res?.result)) die('addonCollectionSet fallÃ³: ' + JSON.stringify(res));
console.log('âœ“ ColecciÃ³n actualizada correctamente.');

// â”€â”€ 4. VerificaciÃ³n post-cambio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const after = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const afterAddons = after?.result?.addons || [];
console.log(`\nVerificando... (${afterAddons.length} addons, antes ${addons.length})`);

let allOk = afterAddons.length === addons.length;
for (const { addon } of toRepair) {
  const a2 = afterAddons.find((x) => x.manifest?.id === addon.manifest?.id);
  const n = a2?.manifest?.catalogs?.length ?? 0;
  const ok = n > 0;
  allOk = allOk && ok;
  console.log(`  ${ok ? 'âœ“' : 'âœ—'} ${addon.manifest?.name}: catalogs.length = ${n}`);
}

console.log(`\n${allOk ? 'âœ…' : 'âœ—'} ReparaciÃ³n ${allOk ? 'aplicada y verificada' : 'NO confirmada del todo'}`);
console.log(`   Backup: ${backupPath}`);
process.exitCode = allOk ? 0 : 1;
}
