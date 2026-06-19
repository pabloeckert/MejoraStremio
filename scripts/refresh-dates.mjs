#!/usr/bin/env node
/**
 * Refresca las ventanas de fecha (absolutas) de los catálogos sensibles al tiempo
 * de AIOMetadata, en data/preset.json:
 *   - "En Cartelera" (now_playing, movie): [hoy - ventana, hoy]
 *   - "Próximos Estrenos" (upcoming, movie): primary_release_date.gte = hoy
 *   - "Próximos Estrenos" (upcoming, series): first_air_date.gte = hoy
 *
 * TMDB Discover no soporta fechas relativas, por eso hay que regenerar la
 * instancia con la fecha actual cada tanto (ver CLAUDE.md). Este script SOLO
 * edita el preset; para que llegue a la cuenta, correr después:
 *   node scripts/regenerate-aiometadata.mjs --apply
 *
 * Uso:
 *   node scripts/refresh-dates.mjs           # actualiza preset.json
 *   node scripts/refresh-dates.mjs --check    # no escribe; exit 1 si está desactualizado
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESET_PATH = join(__dirname, "..", "data", "preset.json");
const CHECK = process.argv.includes("--check");

const fmt = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const TODAY = fmt(today);
const minusDays = (n) => { const x = new Date(today); x.setUTCDate(x.getUTCDate() - n); return fmt(x); };
const spanDays = (gte, lte) => {
  const a = Date.parse(gte), b = Date.parse(lte);
  const d = Math.round((b - a) / 86400000);
  return Number.isFinite(d) && d > 0 ? d : 75; // ventana por defecto: 75 días
};

const preset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
const std = preset.aioMetadataConfig.catalogs.standard;
const find = (re) => std.find((c) => re.test(String(c.id || "")));

const changes = [];
const setParam = (c, key, val, fsKey) => {
  const params = c.metadata.discover.params;
  const fs = c.metadata.discover.formState;
  if (params[key] !== val) changes.push(`${c.name}: ${key} ${params[key] ?? "—"} → ${val}`);
  params[key] = val;
  if (fsKey) fs[fsKey] = val;
};

// En Cartelera (movie): ventana deslizante [hoy - span, hoy].
const enCartelera = find(/now_playing/);
if (enCartelera) {
  const p = enCartelera.metadata.discover.params;
  const span = spanDays(p["primary_release_date.gte"], p["primary_release_date.lte"]);
  setParam(enCartelera, "primary_release_date.gte", minusDays(span), "primaryReleaseFrom");
  setParam(enCartelera, "primary_release_date.lte", TODAY, "primaryReleaseTo");
}

// Próximos Estrenos (movie): desde hoy hacia adelante.
const upMovie = find(/\.movie\.upcoming\./);
if (upMovie) setParam(upMovie, "primary_release_date.gte", TODAY, "primaryReleaseFrom");

// Próximos Estrenos (series): TMDB tv usa first_air_date.
const upSeries = find(/\.tv\.upcoming\./);
if (upSeries) setParam(upSeries, "first_air_date.gte", TODAY, "firstAirFrom");

if (!changes.length) {
  console.log(`✓ Fechas ya al día (${TODAY}) — nada que cambiar.`);
  process.exit(0);
}

console.log(`Fecha de hoy: ${TODAY}`);
changes.forEach((c) => console.log("  • " + c));

if (CHECK) {
  console.log(`\n⚠ Desactualizado: ${changes.length} cambio(s) pendientes. Correr sin --check para aplicar.`);
  process.exit(1);
}

writeFileSync(PRESET_PATH, JSON.stringify(preset, null, 2) + "\n");
console.log(`\n✓ preset.json actualizado. Ahora: node scripts/regenerate-aiometadata.mjs --apply`);
