#!/usr/bin/env node
/**
 * Validador de data/preset.json â€” la fuente de verdad de los catÃ¡logos.
 *
 * Red de seguridad: corre esto antes de regenerar AIOMetadata para que un error
 * de ediciÃ³n a mano no llegue a la cuenta. No necesita credenciales ni red.
 *
 * Uso:
 *   node scripts/validate-config.mjs
 *   node scripts/validate-config.mjs --json   # salida machine-readable
 *
 * Exit 0 = vÃ¡lido (puede haber warnings). Exit 1 = hay errores. Exit 2 = no se pudo leer.
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
  console.error(`âœ— No se pudo leer/parsear ${PRESET_PATH}: ${e.message}`);
  process.exit(2);
}

// â”€â”€ Estructura raÃ­z â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (!isObj(preset)) err("La raÃ­z de preset.json no es un objeto");

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

// â”€â”€ Reglas de config crÃ­tica (ver GEMINI.md) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (cfg.hideUnreleasedDigital !== false)
  err(`config.hideUnreleasedDigital debe ser false (es ${JSON.stringify(cfg.hideUnreleasedDigital)}); ` +
      `con true "PrÃ³ximos Estrenos"/"En Cartelera" no devuelven resultados`);

const eng = cfg.search?.engineEnabled || {};
for (const k of ["people_search_movie", "people_search_series"]) {
  if (eng[k] !== true) warn(`search.engineEnabled.${k} no estÃ¡ en true â†’ la bÃºsqueda por actor puede no funcionar`);
}
if (!isObj(cfg.apiKeys)) warn("config.apiKeys no es un objeto");

// â”€â”€ CatÃ¡logos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const VALID_TYPES = new Set(["movie", "series", "all"]);
const seen = new Map(); // "type|id" -> primer Ã­ndice
const DISCOVER_RE = /^tmdb\.discover\./;

standard.forEach((c, i) => {
  const at = `standard[${i}]`;
  if (!isObj(c)) { err(`${at} no es un objeto`); return; }
  if (!isStr(c.id)) err(`${at} sin id vÃ¡lido`);
  if (!VALID_TYPES.has(c.type)) err(`${at} (${c.id}) type invÃ¡lido: ${JSON.stringify(c.type)}`);
  if (!isStr(c.name)) err(`${at} (${c.id}) sin name vÃ¡lido`);
  if (!isBool(c.enabled)) err(`${at} (${c.id}) enabled no es booleano`);
  if (!isBool(c.showInHome)) warn(`${at} (${c.id}) sin showInHome booleano`);
  if (!isStr(c.source)) warn(`${at} (${c.id}) sin source`);

  // CatÃ¡logos discover custom deben traer sus params de TMDB.
  if (isStr(c.id) && DISCOVER_RE.test(c.id)) {
    const params = c.metadata?.discover?.params;
    if (!isObj(params)) err(`${at} (${c.id}) es discover pero le falta metadata.discover.params`);
  }

  // Unicidad type|id (un id duplicado rompe la bÃºsqueda/colecciÃ³n).
  if (isStr(c.id)) {
    const key = `${c.type}|${c.id}`;
    if (seen.has(key)) err(`id duplicado "${key}" en ${at} (tambiÃ©n en standard[${seen.get(key)}])`);
    else seen.set(key, i);
  }
});

// â”€â”€ Salida â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  console.log(`\nValidaciÃ³n de preset.json â€” ${standard.length} catÃ¡logos (${summary.enabled} enabled)`);
  if (warns.length) {
    console.log(`\nâš  ${warns.length} warning(s):`);
    warns.forEach((m) => console.log(`  - ${m}`));
  }
  if (errors.length) {
    console.log(`\nâœ— ${errors.length} error(es):`);
    errors.forEach((m) => console.log(`  - ${m}`));
    console.log("\nâœ— preset.json INVÃLIDO");
  } else {
    console.log("\nâœ… preset.json vÃ¡lido");
  }
}

process.exit(errors.length ? 1 : 0);
