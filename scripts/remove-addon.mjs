#!/usr/bin/env node
/**
 * remove-addon.mjs — Saca un addon de la colección por su manifest.id.
 *
 * Uso:
 *   ST_EMAIL=... ST_PASS=... node scripts/remove-addon.mjs <manifest.id>            # dry-run
 *   ST_EMAIL=... ST_PASS=... node scripts/remove-addon.mjs <manifest.id> --apply
 *
 * Backup en .backups/ antes de aplicar. Corre assertNoFrozenEmptyCatalogs (guard
 * compartido) antes de cualquier addonCollectionSet.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUPS = join(__dirname, '..', '.backups');
const API = 'https://api.strem.io/api';

const targetId = process.argv[2];
const apply = process.argv.includes('--apply');
const email = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const pass = process.env.ST_PASS || '';

if (!targetId) { console.error('Uso: ST_PASS=... node scripts/remove-addon.mjs <manifest.id> [--apply]'); process.exit(1); }
if (!pass) { console.error('Falta ST_PASS'); process.exit(1); }

const post = (p, b) => fetch(`${API}/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(25000) }).then((r) => r.json());
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

const login = await post('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await post('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const idx = addons.findIndex((a) => a.manifest?.id === targetId);
if (idx < 0) die(`No está instalado: ${targetId}`);
console.log(`Encontrado en índice ${idx}: ${addons[idx].manifest?.name}`);

const next = addons.filter((_, i) => i !== idx);
console.log(`\nColección: ${addons.length} → ${next.length} addons`);

if (!apply) { console.log('\n[DRY-RUN] Pasar --apply para ejecutar.'); process.exit(0); }

await assertNoFrozenEmptyCatalogs(next, []);
mkdirSync(BACKUPS, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(join(BACKUPS, `backup-stremioeg-pre-remove-${targetId.replace(/[^a-z0-9]/gi, '_')}-${stamp}.json`), JSON.stringify(col, null, 2));

const set = await post('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: next });
if (!(set?.result || set?.success)) die('addonCollectionSet falló: ' + JSON.stringify(set));

const check = await post('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const stillThere = (check?.result?.addons || []).some((a) => a.manifest?.id === targetId);
console.log(stillThere ? '⚠ todavía aparece — revisar' : `✓ Removido. Total: ${check.result.addons.length} addons.`);
