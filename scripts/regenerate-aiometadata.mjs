#!/usr/bin/env node
/**
 * Regenera la instancia de AIOMetadata desde data/preset.json y (opcional) la
 * instala en la cuenta. Encapsula el flujo save → verificar → diff anti-pérdida
 * → swap que antes se hacía a mano.
 *
 * Por defecto SOLO REPORTA: crea el config nuevo en ElfHosted, verifica el
 * manifest y lo compara contra la instancia EN VIVO, sin tocar la cuenta.
 * Con --apply hace el swap en la colección (con backup previo).
 *
 * Requiere:
 *   ST_EMAIL, ST_PASS    credenciales de la cuenta Stremio (para leer la colección
 *                        y, con --apply, para el swap)
 *   AIO_PASSWORD         password del config de AIOMetadata (lo exige /config/save)
 *
 * Uso:
 *   AIO_PASSWORD=... ST_EMAIL=... ST_PASS=... node scripts/regenerate-aiometadata.mjs
 *   ... node scripts/regenerate-aiometadata.mjs --apply        # además hace el swap
 *   ... node scripts/regenerate-aiometadata.mjs --apply --force # swap aun con pérdidas
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PRESET_PATH = join(ROOT, "data", "preset.json");
const BACKUPS = join(ROOT, ".backups");

const AIO_BASE = "https://aiometadata.elfhosted.com";
const API = "https://api.strem.io/api";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

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
const uuidOf = (url) => (String(url).match(/\/([0-9a-f-]{36})\//) || [])[1];
const manUrl = (uuid) => `${AIO_BASE}/stremio/${uuid}/manifest.json`;

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
const aioPass = process.env.AIO_PASSWORD;
if (!email || !pass) die("Faltan ST_EMAIL / ST_PASS");
if (!aioPass) die("Falta AIO_PASSWORD (el save lo exige no vacío)");

mkdirSync(BACKUPS, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

// ── 1. Login + colección actual ──────────────────────────────────────────────
const login = await apiPost("login", { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die("Login fallido: " + JSON.stringify(login?.error || login));

const col = await apiPost("addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
const addons = col?.result?.addons || [];
const aioIdx = addons.findIndex((a) => a.manifest?.id === "aio-metadata" || /aiometadata/i.test(a.transportUrl || ""));
if (aioIdx < 0) die("No encontré AIOMetadata en la colección");
const currentUuid = uuidOf(addons[aioIdx].transportUrl);
console.log(`✓ Login OK — AIOMetadata actual: ${currentUuid} (índice ${aioIdx} de ${addons.length})`);

// ── 2. Construir el config nuevo desde el preset ─────────────────────────────
const preset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
const config = JSON.parse(JSON.stringify(preset.aioMetadataConfig.config));
config.catalogs = preset.aioMetadataConfig.catalogs.standard;

// Inyectar trakt/simkl del config en vivo (tokens server-side; ver CLAUDE.md).
const liveCfg = await getJson(`${AIO_BASE}/api/config?id=${currentUuid}`).catch(() => ({}));
if (liveCfg.trakt) { config.trakt = liveCfg.trakt; config.apiKeys.trakt = liveCfg.trakt; }
if (liveCfg.simkl) { config.simkl = liveCfg.simkl; config.apiKeys.simkl = liveCfg.simkl; }
console.log(`✓ Config armado: ${config.catalogs.length} catálogos | trakt=${!!config.trakt} simkl=${!!config.simkl} | hideUnreleasedDigital=${config.hideUnreleasedDigital}`);

// ── 3. Save (crea instancia nueva; NO toca la cuenta) ────────────────────────
const save = await fetch(`${AIO_BASE}/api/config/save`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ config, password: aioPass }),
  signal: AbortSignal.timeout(30000),
}).then((r) => r.json()).catch((e) => ({ _err: String(e) }));
if (!save?.success || !save?.installUrl) die("Save no devolvió installUrl: " + JSON.stringify(save));
const installUrl = save.installUrl;
const newUuid = uuidOf(installUrl);
console.log(`✓ Instancia nueva creada: ${newUuid}`);

// ── 4. Verificar + diff anti-pérdida contra la instancia EN VIVO ─────────────
const [newMan, liveMan] = await Promise.all([getJson(installUrl), getJson(manUrl(currentUuid))]);
const namesOf = (m) => new Set((m.catalogs || []).map((c) => c.name));
const newNames = namesOf(newMan), liveNames = namesOf(liveMan);
const lost = [...liveNames].filter((n) => !newNames.has(n));
const gained = [...newNames].filter((n) => !liveNames.has(n));

console.log(`\n— Verificación —`);
console.log(`manifest nuevo: ${(newMan.catalogs || []).length} catálogos | en vivo: ${(liveMan.catalogs || []).length}`);
console.log(`primero: ${newMan.catalogs?.[0]?.name}`);
console.log(`PERDIDOS (por nombre): ${lost.length}${lost.length ? " → " + lost.join(", ") : ""}`);
console.log(`GANADOS (por nombre):  ${gained.length}${gained.length ? " → " + gained.join(", ") : ""}`);

const base = installUrl.replace(/manifest\.json$/, "");
const nowPlaying = (newMan.catalogs || []).find((c) => /now_playing/.test(c.id));
if (nowPlaying) {
  const cat = await getJson(`${base}catalog/${nowPlaying.type}/${nowPlaying.id}.json`).catch(() => null);
  console.log(`"${nowPlaying.name}" devuelve ${cat?.metas?.length || 0} títulos`);
}
const newCfg = await getJson(`${AIO_BASE}/api/config?id=${newUuid}`).catch(() => ({}));
console.log(`config nuevo conserva trakt=${!!newCfg.trakt} simkl=${!!newCfg.simkl}`);

writeFileSync(join(BACKUPS, "aio-new-install.json"),
  JSON.stringify({ installUrl, newUuid, fromUuid: currentUuid, when: stamp, catalogs: newMan.catalogs?.length }, null, 2));

// ── 5. Swap (solo con --apply) ───────────────────────────────────────────────
if (!APPLY) {
  console.log(`\nℹ Modo reporte (sin --apply): NO se tocó la cuenta. Instancia nueva lista en .backups/aio-new-install.json`);
  console.log(`  Para instalar: volvé a correr con --apply`);
  process.exit(0);
}
if (lost.length && !FORCE) {
  die(`Se perderían ${lost.length} catálogos (${lost.join(", ")}). Abortado. Usá --force para forzar, o arreglá data/preset.json.`);
}

writeFileSync(join(BACKUPS, `backup-stremioeg-preregen-${stamp}.json`), JSON.stringify(col, null, 2));
const newManifest = await getJson(installUrl);
newManifest.name = addons[aioIdx].manifest?.name || "AIOMetadata";
addons[aioIdx] = { ...addons[aioIdx], transportUrl: installUrl, manifest: newManifest };

// Guard anti-duplicados de manifest.id.
const ids = addons.map((a) => a.manifest?.id).filter(Boolean);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) die("manifest.id duplicado tras el swap: " + dup.join(", "));

const set = await apiPost("addonCollectionSet", { type: "AddonCollectionSet", authKey, addons });
if (!(set?.result || set?.success)) die("addonCollectionSet falló: " + JSON.stringify(set));

// La API a veces tarda un instante en propagar el Set antes de que un Get inmediato lo refleje
// (encontrado el 2026-08-02: un swap real dio "NO confirmado" acá pero ya estaba aplicado al
// reconsultar segundos después) — reintenta unas veces con backoff corto antes de declarar falla.
let okSwap = false;
for (let attempt = 0; attempt < 4 && !okSwap; attempt++) {
  if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
  const after = await apiPost("addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
  const aioAfter = (after?.result?.addons || []).find((a) => a.manifest?.id === "aio-metadata");
  okSwap = (aioAfter?.transportUrl || "").includes(newUuid);
}
console.log(`\n${okSwap ? "✅" : "✗"} Swap ${okSwap ? "OK" : "NO confirmado"} — AIOMetadata → ${newUuid}`);
console.log(`   Backup: .backups/backup-stremioeg-preregen-${stamp}.json`);

if (okSwap) {
  const presetRaw = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
  presetRaw.aioMetadataConfig.instanceId = newUuid;
  writeFileSync(PRESET_PATH, JSON.stringify(presetRaw, null, 2) + "\n");
  console.log(`✓ preset.json actualizado con instanceId=${newUuid}`);
}

process.exit(okSwap ? 0 : 1);
