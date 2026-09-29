#!/usr/bin/env node
/**
 * Regenera la instancia de AIOMetadata desde data/preset.json y (opcional) la
 * instala en la cuenta. Encapsula el flujo save â†’ verificar â†’ diff anti-pÃ©rdida
 * â†’ swap que antes se hacÃ­a a mano.
 *
 * Por defecto SOLO REPORTA: crea el config nuevo en ElfHosted, verifica el
 * manifest y lo compara contra la instancia EN VIVO, sin tocar la cuenta.
 * Con --apply hace el swap en la colecciÃ³n (con backup previo).
 *
 * Requiere:
 *   ST_EMAIL, ST_PASS    credenciales de la cuenta Stremio (para leer la colecciÃ³n
 *                        y, con --apply, para el swap)
 *   AIO_PASSWORD         password del config de AIOMetadata (lo exige /config/save)
 *
 * Uso:
 *   AIO_PASSWORD=... ST_EMAIL=... ST_PASS=... node scripts/regenerate-aiometadata.mjs
 *   ... node scripts/regenerate-aiometadata.mjs --apply        # ademÃ¡s hace el swap
 *   ... node scripts/regenerate-aiometadata.mjs --apply --force # swap aun con pÃ©rdidas
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { apiPost } from "./lib/stremio-api.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PRESET_PATH = join(ROOT, "data", "preset.json");
const BACKUPS = join(ROOT, ".backups");

const AIO_BASE = "https://aiometadata.elfhosted.com";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

const die = (m, code = 1) => { console.error(`âœ— ${m}`); process.exit(code); };
const getJson = (url, t = 20000) =>
  fetch(url, { signal: AbortSignal.timeout(t) }).then((r) => r.json());
const uuidOf = (url) => (String(url).match(/\/([0-9a-f-]{36})\//) || [])[1];
const manUrl = (uuid) => `${AIO_BASE}/stremio/${uuid}/manifest.json`;

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
const aioPass = process.env.AIO_PASSWORD;
if (!email || !pass) die("Faltan ST_EMAIL / ST_PASS");
if (!aioPass) die("Falta AIO_PASSWORD (el save lo exige no vacÃ­o)");

mkdirSync(BACKUPS, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

// â”€â”€ 1. Login + colecciÃ³n actual â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const login = await apiPost("login", { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die("Login fallido: " + JSON.stringify(login?.error || login));

const col = await apiPost("addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
const addons = col?.result?.addons || [];
const aioIdx = addons.findIndex((a) => a.manifest?.id === "aio-metadata" || /aiometadata/i.test(a.transportUrl || ""));
if (aioIdx < 0) die("No encontrÃ© AIOMetadata en la colecciÃ³n");
const currentUuid = uuidOf(addons[aioIdx].transportUrl);
console.log(`âœ“ Login OK â€” AIOMetadata actual: ${currentUuid} (Ã­ndice ${aioIdx} de ${addons.length})`);

// â”€â”€ 2. Construir el config nuevo desde el preset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const preset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
const config = JSON.parse(JSON.stringify(preset.aioMetadataConfig.config));
config.catalogs = preset.aioMetadataConfig.catalogs.standard;

// Inyectar trakt/simkl del config en vivo (tokens server-side; ver GEMINI.md).
const liveCfg = await getJson(`${AIO_BASE}/api/config?id=${currentUuid}`).catch(() => ({}));
if (liveCfg.trakt) { config.trakt = liveCfg.trakt; config.apiKeys.trakt = liveCfg.trakt; }
if (liveCfg.simkl) { config.simkl = liveCfg.simkl; config.apiKeys.simkl = liveCfg.simkl; }
console.log(`âœ“ Config armado: ${config.catalogs.length} catÃ¡logos | trakt=${!!config.trakt} simkl=${!!config.simkl} | hideUnreleasedDigital=${config.hideUnreleasedDigital}`);

// â”€â”€ 3. Save (crea instancia nueva; NO toca la cuenta) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const save = await fetch(`${AIO_BASE}/api/config/save`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ config, password: aioPass }),
  signal: AbortSignal.timeout(30000),
}).then((r) => r.json()).catch((e) => ({ _err: String(e) }));
if (!save?.success || !save?.installUrl) die("Save no devolviÃ³ installUrl: " + JSON.stringify(save));
const installUrl = save.installUrl;
const newUuid = uuidOf(installUrl);
console.log(`âœ“ Instancia nueva creada: ${newUuid}`);

// â”€â”€ 4. Verificar + diff anti-pÃ©rdida contra la instancia EN VIVO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const [newMan, liveMan] = await Promise.all([getJson(installUrl), getJson(manUrl(currentUuid))]);
const namesOf = (m) => new Set((m.catalogs || []).map((c) => c.name));
const newNames = namesOf(newMan), liveNames = namesOf(liveMan);
const lost = [...liveNames].filter((n) => !newNames.has(n));
const gained = [...newNames].filter((n) => !liveNames.has(n));

console.log(`\nâ€” VerificaciÃ³n â€”`);
console.log(`manifest nuevo: ${(newMan.catalogs || []).length} catÃ¡logos | en vivo: ${(liveMan.catalogs || []).length}`);
console.log(`primero: ${newMan.catalogs?.[0]?.name}`);
console.log(`PERDIDOS (por nombre): ${lost.length}${lost.length ? " â†’ " + lost.join(", ") : ""}`);
console.log(`GANADOS (por nombre):  ${gained.length}${gained.length ? " â†’ " + gained.join(", ") : ""}`);

const base = installUrl.replace(/manifest\.json$/, "");
const nowPlaying = (newMan.catalogs || []).find((c) => /now_playing/.test(c.id));
if (nowPlaying) {
  const cat = await getJson(`${base}catalog/${nowPlaying.type}/${nowPlaying.id}.json`).catch(() => null);
  console.log(`"${nowPlaying.name}" devuelve ${cat?.metas?.length || 0} tÃ­tulos`);
}
const newCfg = await getJson(`${AIO_BASE}/api/config?id=${newUuid}`).catch(() => ({}));
console.log(`config nuevo conserva trakt=${!!newCfg.trakt} simkl=${!!newCfg.simkl}`);

writeFileSync(join(BACKUPS, "aio-new-install.json"),
  JSON.stringify({ installUrl, newUuid, fromUuid: currentUuid, when: stamp, catalogs: newMan.catalogs?.length }, null, 2));

// â”€â”€ 5. Swap (solo con --apply) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (!APPLY) {
  console.log(`\nâ„¹ Modo reporte (sin --apply): NO se tocÃ³ la cuenta. Instancia nueva lista en .backups/aio-new-install.json`);
  console.log(`  Para instalar: volvÃ© a correr con --apply`);
  process.exit(0);
}
if (lost.length && !FORCE) {
  die(`Se perderÃ­an ${lost.length} catÃ¡logos (${lost.join(", ")}). Abortado. UsÃ¡ --force para forzar, o arreglÃ¡ data/preset.json.`);
}

const accountSlug = (email || 'unknown').split('@')[0];
writeFileSync(join(BACKUPS, `backup-${accountSlug}-preregen-${stamp}.json`), JSON.stringify(col, null, 2));
const newManifest = await getJson(installUrl);
newManifest.name = addons[aioIdx].manifest?.name || "AIOMetadata";
addons[aioIdx] = { ...addons[aioIdx], transportUrl: installUrl, manifest: newManifest };

// Guard anti-duplicados de manifest.id.
const ids = addons.map((a) => a.manifest?.id).filter(Boolean);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) die("manifest.id duplicado tras el swap: " + dup.join(", "));

const set = await apiPost("addonCollectionSet", { type: "AddonCollectionSet", authKey, addons });
if (!(set?.result || set?.success)) die("addonCollectionSet fallÃ³: " + JSON.stringify(set));

// La API a veces tarda un instante en propagar el Set antes de que un Get inmediato lo refleje
// (encontrado el 2026-08-02: un swap real dio "NO confirmado" acÃ¡ pero ya estaba aplicado al
// reconsultar segundos despuÃ©s) â€” reintenta unas veces con backoff corto antes de declarar falla.
let okSwap = false;
for (let attempt = 0; attempt < 4 && !okSwap; attempt++) {
  if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
  const after = await apiPost("addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
  const aioAfter = (after?.result?.addons || []).find((a) => a.manifest?.id === "aio-metadata");
  okSwap = (aioAfter?.transportUrl || "").includes(newUuid);
}
console.log(`\n${okSwap ? "âœ…" : "âœ—"} Swap ${okSwap ? "OK" : "NO confirmado"} â€” AIOMetadata â†’ ${newUuid}`);
console.log(`   Backup: .backups/backup-${accountSlug}-preregen-${stamp}.json`);

if (okSwap) {
  const presetRaw = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
  presetRaw.aioMetadataConfig.instanceId = newUuid;
  writeFileSync(PRESET_PATH, JSON.stringify(presetRaw, null, 2) + "\n");
  console.log(`âœ“ preset.json actualizado con instanceId=${newUuid}`);

  // Calentamiento de la instancia nueva antes de salir â€” daily-catalog-refresh.yml corre
  // health-check.mjs segundos despuÃ©s de este script, y una instancia de ElfHosted reciÃ©n creada
  // puede tardar en levantar del todo (cold-start POR CATÃLOGO: la primera fetch a TMDB de cada
  // catÃ¡logo no estÃ¡ cacheada), dando falsos "âœ— catÃ¡logos con error" que no reflejan un problema
  // real (ver GEMINI.md, "PatrÃ³n de falso positivo... 2026-08-01"). Antes se calentaba solo
  // "now_playing" â€” pero el health-check muestrea ~10 catÃ¡logos al azar (2026-09-07: fallÃ³ en
  // "PrÃ³ximos Estrenos"/pablo005). Ahora se calientan TODOS, en paralelo acotado, con 1 reintento
  // para los que queden frÃ­os.
  const allCats = newMan.catalogs || [];
  // "calentado" = respondiÃ³ un JSON con array metas (aunque estÃ© vacÃ­o â€” un catÃ¡logo nicho puede
  // dar 0 resultados legÃ­timamente); lo que importa es que ElfHosta ya hizo la primera fetch a
  // TMDB y la cacheÃ³. Solo cuenta como frÃ­o si tira error / timeout / no devuelve metas.
  const warmOne = (c) =>
    getJson(`${base}catalog/${c.type}/${c.id}.json`, 15000).then((j) => Array.isArray(j?.metas)).catch(() => false);
  const CONC = 20;
  let coldIds = [];
  for (let i = 0; i < allCats.length; i += CONC) {
    const batch = allCats.slice(i, i + CONC);
    const res = await Promise.all(batch.map(warmOne));
    res.forEach((ok, k) => { if (!ok) coldIds.push(batch[k]); });
  }
  if (coldIds.length) {
    await new Promise((r) => setTimeout(r, 4000));
    const retry = await Promise.all(coldIds.map(warmOne));
    coldIds = coldIds.filter((_c, k) => !retry[k]);
  }
  console.log(coldIds.length === 0
    ? `âœ“ Instancia nueva calentada (${allCats.length}/${allCats.length} catÃ¡logos responden)`
    : `âš  ${coldIds.length}/${allCats.length} catÃ¡logos todavÃ­a frÃ­os tras el warm-up (${coldIds.slice(0, 5).map((c) => c.id).join(", ")}â€¦) â€” el health-check podrÃ­a dar un falso âœ— transitorio`);
}

process.exit(okSwap ? 0 : 1);
