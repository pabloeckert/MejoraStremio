#!/usr/bin/env node
/**
 * Reemplaza AIOLists (deprecado por ElfHosted, org.stremio.aiolists) por MyTrakt Sync
 * en la colección de addons de la cuenta Stremio, en el mismo índice.
 *
 * Por defecto SOLO REPORTA (busca el índice, trae el manifest nuevo, chequea
 * duplicados). Con --apply hace el swap real (con backup previo de la colección).
 *
 * Requiere:
 *   ST_EMAIL, ST_PASS    credenciales de la cuenta Stremio
 *
 * Uso:
 *   ST_EMAIL=... ST_PASS=... node scripts/swap-aiolists-mytrakt.mjs
 *   ST_EMAIL=... ST_PASS=... node scripts/swap-aiolists-mytrakt.mjs --apply
 *
 * Node >= 20, sin dependencias.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertNoFrozenEmptyCatalogs } from "./lib/collection-guard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BACKUPS = join(ROOT, ".backups");

const API = "https://api.strem.io/api";
const MYTRAKT_UUID = "13e948e9-04c8-4917-a0d5-96af15b63d2f";
const MYTRAKT_URL = `https://mytrakt.elfhosted.com/addon/${MYTRAKT_UUID}/manifest.json`;
const AIOLISTS_ID = "org.stremio.aiolists";

const APPLY = process.argv.includes("--apply");

const die = (m, code = 1) => { console.error(`✗ ${m}`); process.exit(code); };
const apiPost = (path, body) =>
  fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  }).then((r) => r.json());
const getJson = (url, t = 20000) =>
  fetch(url, { signal: AbortSignal.timeout(t) }).then((r) => r.json());

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die("Faltan ST_EMAIL / ST_PASS");

mkdirSync(BACKUPS, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

// ── 1. Login + colección actual ──────────────────────────────────────────────
const login = await apiPost("login", { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die("Login fallido: " + JSON.stringify(login?.error || login));

const col = await apiPost("addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
const addons = col?.result?.addons || [];
const idx = addons.findIndex((a) => a.manifest?.id === AIOLISTS_ID);
if (idx < 0) die(`No encontré ${AIOLISTS_ID} en la colección`);
console.log(`✓ Login OK — AIOLists encontrado en índice ${idx} de ${addons.length} addons`);

// ── 2. Manifest nuevo de MyTrakt ─────────────────────────────────────────────
const mytraktManifest = await getJson(`${MYTRAKT_URL}?cb=${Date.now()}`);
if (!mytraktManifest?.id) die("No pude leer el manifest de MyTrakt: " + JSON.stringify(mytraktManifest));
console.log(`✓ Manifest MyTrakt: ${mytraktManifest.id} — ${mytraktManifest.catalogs?.length || 0} catálogos`);
for (const c of mytraktManifest.catalogs || []) console.log(`   - ${c.type}/${c.id} — ${c.name}`);

// ── 3. Guard anti-duplicados (simulado antes de escribir nada) ──────────────
const nextAddons = addons.slice();
nextAddons[idx] = { ...addons[idx], transportUrl: MYTRAKT_URL, manifest: mytraktManifest };
const ids = nextAddons.map((a) => a.manifest?.id).filter(Boolean);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) die("manifest.id duplicado tras el swap: " + dup.join(", "));
console.log(`✓ Sin ids duplicados tras el swap (${nextAddons.length} addons)`);

if (!APPLY) {
  console.log(`\nℹ Modo reporte (sin --apply): NO se tocó la cuenta.`);
  console.log(`  Para instalar: volvé a correr con --apply`);
  process.exit(0);
}

if (!(await assertNoFrozenEmptyCatalogs(nextAddons, [mytraktManifest.id]))) {
  process.exit(1);
}

// ── 4. Backup + swap real ────────────────────────────────────────────────────
const backupPath = join(BACKUPS, `backup-stremioeg-pre-mytrakt-${stamp}.json`);
writeFileSync(backupPath, JSON.stringify(col, null, 2));
console.log(`✓ Backup escrito: ${backupPath}`);

const set = await apiPost("addonCollectionSet", { type: "AddonCollectionSet", authKey, addons: nextAddons });
if (!(set?.result || set?.success)) die("addonCollectionSet falló: " + JSON.stringify(set));

const after = await apiPost("addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
const afterAddons = after?.result?.addons || [];
const mytraktAfter = afterAddons.find((a) => a.manifest?.id === mytraktManifest.id);
const okSwap = !!mytraktAfter && afterAddons.length === addons.length;
console.log(`\n${okSwap ? "✅" : "✗"} Swap ${okSwap ? "OK" : "NO confirmado"} — AIOLists → MyTrakt Sync (${mytraktManifest.id})`);
console.log(`   Total addons: ${afterAddons.length} (antes: ${addons.length})`);
console.log(`   Backup: ${backupPath}`);

process.exit(okSwap ? 0 : 1);
