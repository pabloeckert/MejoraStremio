#!/usr/bin/env node
/**
 * Refresca las ventanas de fecha (absolutas) de los catÃ¡logos sensibles al tiempo
 * de AIOMetadata, en data/preset.json:
 *   - "En Cartelera" (now_playing, movie): [hoy - ventana, hoy]
 *   - "PrÃ³ximos Estrenos" (upcoming, movie): primary_release_date.gte = hoy
 *   - "PrÃ³ximos Estrenos" (upcoming, series): first_air_date.gte = hoy
 *
 * TMDB Discover no soporta fechas relativas, por eso hay que regenerar la
 * instancia con la fecha actual cada tanto (ver GEMINI.md). Este script SOLO
 * edita el preset; para que llegue a la cuenta, correr despuÃ©s:
 *   node scripts/regenerate-aiometadata.mjs --apply
 *
 * Uso:
 *   node scripts/refresh-dates.mjs           # actualiza preset.json
 *   node scripts/refresh-dates.mjs --check    # no escribe; exit 1 si estÃ¡ desactualizado
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
  return Number.isFinite(d) && d > 0 ? d : 75; // ventana por defecto: 75 dÃ­as
};

const preset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
const std = preset.aioMetadataConfig.catalogs.standard;
const find = (re) => std.find((c) => re.test(String(c.id || "")));

const changes = [];
const setParam = (c, key, val, fsKey) => {
  const params = c.metadata.discover.params;
  const fs = c.metadata.discover.formState;
  if (params[key] !== val) changes.push(`${c.name}: ${key} ${params[key] ?? "â€”"} â†’ ${val}`);
  params[key] = val;
  if (fsKey) fs[fsKey] = val;
};

// En Cartelera (movie): ventana deslizante [hoy - span, hoy].
const enCarteleraMovie = find(/\.movie\.now_playing\./) || find(/now_playing/);
if (enCarteleraMovie) {
  const p = enCarteleraMovie.metadata.discover.params;
  const span = spanDays(p["primary_release_date.gte"], p["primary_release_date.lte"]);
  setParam(enCarteleraMovie, "primary_release_date.gte", minusDays(span), "primaryReleaseFrom");
  setParam(enCarteleraMovie, "primary_release_date.lte", TODAY, "primaryReleaseTo");
}

// En Cartelera (series): ventana deslizante [hoy - span, hoy] usando first_air_date.
const enCarteleraSeries = find(/\.tv\.now_playing\./);
if (enCarteleraSeries) {
  const p = enCarteleraSeries.metadata.discover.params;
  const span = spanDays(p["first_air_date.gte"], p["first_air_date.lte"]);
  setParam(enCarteleraSeries, "first_air_date.gte", minusDays(span), "firstAirFrom");
  setParam(enCarteleraSeries, "first_air_date.lte", TODAY, "firstAirTo");
  // Cero confianza: no bloquear estrenos frescos de la semana exigiendo votos excesivos en TMDB
  if (Number(p["vote_count.gte"]) > 1) {
    setParam(enCarteleraSeries, "vote_count.gte", 1, "voteCountMin");
  }
}

// Próximos Estrenos (movie): desde hoy hacia adelante.
const upMovie = find(/\.movie\.upcoming\./);
if (upMovie) setParam(upMovie, "primary_release_date.gte", TODAY, "primaryReleaseFrom");

// Próximos Estrenos (series): TMDB tv usa first_air_date.
const upSeries = find(/\.tv\.upcoming\./);
if (upSeries) setParam(upSeries, "first_air_date.gte", TODAY, "firstAirFrom");

if (!changes.length) {
  console.log(`âœ“ Fechas ya al dÃ­a (${TODAY}) â€” nada que cambiar.`);
  process.exit(0);
}

console.log(`Fecha de hoy: ${TODAY}`);
changes.forEach((c) => console.log("  â€¢ " + c));

if (CHECK) {
  console.log(`\nâš  Desactualizado: ${changes.length} cambio(s) pendientes. Correr sin --check para aplicar.`);
  process.exit(1);
}

writeFileSync(PRESET_PATH, JSON.stringify(preset, null, 2) + "\n");
console.log(`\nâœ“ preset.json actualizado. Ahora: node scripts/regenerate-aiometadata.mjs --apply`);
