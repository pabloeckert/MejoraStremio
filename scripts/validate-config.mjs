#!/usr/bin/env node
/**
 * Validador de data/preset.json — la fuente de verdad de los catálogos.
 *
 * Red de seguridad: corre esto antes de regenerar AIOMetadata para que un error
 * de edición a mano no llegue a la cuenta. No necesita credenciales ni red.
 *
 * Uso:
 *   node scripts/validate-config.mjs
 *   node scripts/validate-config.mjs --json   # salida machine-readable
 *
 * Exit 0 = válido (puede haber warnings). Exit 1 = hay errores. Exit 2 = no se pudo leer.
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESET_PATH = join(__dirname, "..", "data", "preset.json");

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const isStr = (v) => typeof v === "string" && v.length > 0;
const isBool = (v) => typeof v === "boolean";
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

let preset;
try {
  preset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
} catch (e) {
  console.error(`✗ No se pudo leer/parsear ${PRESET_PATH}: ${e.message}`);
  process.exit(2);
}

// ── Estructura raíz ──────────────────────────────────────────────────────────
if (!isObj(preset)) err("La raíz de preset.json no es un objeto");

const aio = preset?.aioMetadataConfig;
if (!isObj(aio)) {
  err("Falta aioMetadataConfig (objeto)");
} else {
  if (!isObj(aio.config)) err("Falta aioMetadataConfig.config (objeto)");
  if (!isObj(aio.catalogs)) err("Falta aioMetadataConfig.catalogs (objeto)");
  if (!Array.isArray(aio.catalogs?.standard)) err("Falta aioMetadataConfig.catalogs.standard (array)");
}

const cfg = aio?.config || {};
const standard = Array.isArray(aio?.catalogs?.standard) ? aio.catalogs.standard : [];

// ── Reglas de config crítica (ver CLAUDE.md) ────────────────────────────────
if (cfg.hideUnreleasedDigital !== false)
  err(`config.hideUnreleasedDigital debe ser false (es ${JSON.stringify(cfg.hideUnreleasedDigital)}); ` +
      `con true "Próximos Estrenos"/"En Cartelera" no devuelven resultados`);

const eng = cfg.search?.engineEnabled || {};
for (const k of ["people_search_movie", "people_search_series"]) {
  if (eng[k] !== true) warn(`search.engineEnabled.${k} no está en true → la búsqueda por actor puede no funcionar`);
}
if (!isObj(cfg.apiKeys)) warn("config.apiKeys no es un objeto");

// ── Catálogos ────────────────────────────────────────────────────────────────
const VALID_TYPES = new Set(["movie", "series", "all"]);
const seen = new Map(); // "type|id" -> primer índice
const DISCOVER_RE = /^tmdb\.discover\./;

standard.forEach((c, i) => {
  const at = `standard[${i}]`;
  if (!isObj(c)) { err(`${at} no es un objeto`); return; }
  if (!isStr(c.id)) err(`${at} sin id válido`);
  if (!VALID_TYPES.has(c.type)) err(`${at} (${c.id}) type inválido: ${JSON.stringify(c.type)}`);
  if (!isStr(c.name)) err(`${at} (${c.id}) sin name válido`);
  if (!isBool(c.enabled)) err(`${at} (${c.id}) enabled no es booleano`);
  if (!isBool(c.showInHome)) warn(`${at} (${c.id}) sin showInHome booleano`);
  if (!isStr(c.source)) warn(`${at} (${c.id}) sin source`);

  // Catálogos discover custom deben traer sus params de TMDB.
  if (isStr(c.id) && DISCOVER_RE.test(c.id)) {
    const params = c.metadata?.discover?.params;
    if (!isObj(params)) err(`${at} (${c.id}) es discover pero le falta metadata.discover.params`);
  }

  // Unicidad type|id (un id duplicado rompe la búsqueda/colección).
  if (isStr(c.id)) {
    const key = `${c.type}|${c.id}`;
    if (seen.has(key)) err(`id duplicado "${key}" en ${at} (también en standard[${seen.get(key)}])`);
    else seen.set(key, i);
  }
});

// ── Salida ───────────────────────────────────────────────────────────────────
const summary = {
  ok: errors.length === 0,
  catalogs: standard.length,
  enabled: standard.filter((c) => c?.enabled).length,
  errors,
  warnings: warns,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`\nValidación de preset.json — ${standard.length} catálogos (${summary.enabled} enabled)`);
  if (warns.length) {
    console.log(`\n⚠ ${warns.length} warning(s):`);
    warns.forEach((m) => console.log(`  - ${m}`));
  }
  if (errors.length) {
    console.log(`\n✗ ${errors.length} error(es):`);
    errors.forEach((m) => console.log(`  - ${m}`));
    console.log("\n✗ preset.json INVÁLIDO");
  } else {
    console.log("\n✅ preset.json válido");
  }
}

process.exit(errors.length ? 1 : 0);
