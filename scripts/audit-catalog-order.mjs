#!/usr/bin/env node
// Auditoría de orden de catálogos de AIOMetadata.
//
// Compara el orden ACTUAL de los catálogos visibles en la pantalla de inicio
// (data/preset.json -> aioMetadataConfig.catalogs.standard) contra el orden
// DESEADO por Pablo, y propone un reordenamiento. TIERS actualizado 2026-09-04
// tras la encuesta de gustos (ver docs/encuesta-catalogos.md) — antes de esa
// fecha reflejaba un criterio de 2026-06-19 ya superado (En Cartelera primero,
// Plataformas al fondo); si el criterio vuelve a cambiar, actualizar TIERS acá.
//
// SOLO REPORTA. No modifica preset.json ni la cuenta. Para aplicar el cambio
// hay que reordenar el array y regenerar la instancia de AIOMetadata.
//
// Uso:
//   node scripts/audit-catalog-order.mjs            # reporte legible
//   node scripts/audit-catalog-order.mjs --json     # salida machine-readable
//
// Node >= 20, sin dependencias.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESET_PATH = join(__dirname, "..", "data", "preset.json");

// Orden deseado: cada catálogo cae en un "tier". Menor índice = más arriba.
// Actualizado 2026-09-04 tras la encuesta de gustos + "familiar arriba de
// todo" (ver docs/encuesta-catalogos.md): Familia/apto-todo-público primero,
// después Policial/Crimen/Misterio, Humor Negro, Países, Estrenos. Trending/
// Tendencias/Top Rated/Best-of quedaron FUERA del inicio (showInHome=false,
// Pablo no las quiere ahí) — si aparecen visibles es un desvío real, no un
// tier legítimo, por eso no tienen tier propio y caen en "Otros".
const TIERS = [
  { label: "Familia / apto para todo público" },
  { label: "Policial / Crimen / Misterio / Humor Negro" },
  { label: "Países" },
  { label: "Estrenos (Próximos + En Cartelera)" },
  { label: "Otros (revisar — no debería haber nada visible acá)" },
];
const OTROS = TIERS.length - 1;

function tierOf(cat) {
  const id = String(cat.id || "");
  // Familia / apto para todo público
  if (/family_(movies|shows)\.10751/.test(id) || /animation_(movies|shows)\.16/.test(id) ||
      /(cartoon-network|nickelodeon|comedia-juvenil-actores-reales|family-en|para-ver-en-familia)/.test(id))
    return 0;
  // Policial / Crimen / Misterio / Thriller / Humor Negro
  if (/(crime_(movies|shows)\.80|mystery_(movies|shows)\.9648|thriller_movies\.53|thriller-psicolo|classic-crime|cine-negro-cla|nordic-noir|crime-germany|crime-uk|crimen-france|crimen-espan|crimen-italiano|crimen-no-rdico|humor-negro)/.test(id))
    return 1;
  // Países (incluye Latinoamérica) — ids pabloNNN de 1 y 2 dígitos, o el patrón
  // tmdb.discover.{movie,tv}.<CC>.pabloNNN de los países con código ISO.
  if (/\.(argentina|latam|es|fr|de|it|gb|mx|us)\.pablo0?\d+$/.test(id) ||
      /enc-(cine|series)-(suecia|noruega|dinamarca|islandia)/.test(id))
    return 2;
  // Estrenos
  if (/now_playing/.test(id) || /\.upcoming\./.test(id)) return 3;
  return OTROS;
}

function load() {
  const preset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
  const std = preset?.aioMetadataConfig?.catalogs?.standard;
  if (!Array.isArray(std)) {
    console.error("No encontré aioMetadataConfig.catalogs.standard en preset.json");
    process.exit(2);
  }
  return std;
}

function main() {
  const asJson = process.argv.includes("--json");
  const std = load();

  // Lo que de verdad ve Pablo en el inicio: visible = showInHome && enabled.
  const visible = std
    .map((c, idx) => ({ idx, cat: c, tier: tierOf(c) }))
    .filter((x) => x.cat.showInHome && x.cat.enabled);

  // Orden propuesto: estable por tier (preserva el orden relativo dentro de cada tier).
  const proposed = [...visible].sort((a, b) => a.tier - b.tier || a.idx - b.idx);

  // Desvíos.
  const firstFamilia = visible.findIndex((x) => x.tier === 0);
  const otrosVisibles = visible.filter((x) => x.tier === OTROS);
  const outOfPlace = visible.filter((x, i) => proposed[i].idx !== x.idx).length;

  if (asJson) {
    console.log(JSON.stringify({
      totalCatalogs: std.length,
      visibleInHome: visible.length,
      currentOrder: visible.map((x) => ({ id: x.cat.id, name: x.cat.name, type: x.cat.type, tier: TIERS[x.tier].label })),
      proposedOrder: proposed.map((x) => ({ id: x.cat.id, name: x.cat.name, type: x.cat.type, tier: TIERS[x.tier].label })),
      deviations: {
        familiaPos: firstFamilia < 0 ? null : firstFamilia + 1,
        otrosVisiblesCount: otrosVisibles.length,
        otrosVisiblesNames: otrosVisibles.map((x) => x.cat.name),
        outOfPlace,
      },
    }, null, 2));
    return;
  }

  const line = (n) => "─".repeat(n);
  const fmt = (x, pos) =>
    `${String(pos).padStart(3)}  [${TIERS[x.tier].label}]  ${x.cat.name} (${x.cat.type})`;

  console.log(`\n═══ Auditoría de orden de catálogos — MejoraStremio ═══`);
  console.log(`Fuente: data/preset.json — ${std.length} catálogos, ${visible.length} visibles en el inicio`);
  console.log(`(visible = showInHome && enabled; lo que realmente aparece en tu pantalla)\n`);

  console.log(`▼ ORDEN ACTUAL de tu inicio`);
  console.log(line(60));
  visible.forEach((x, i) => console.log(fmt(x, i + 1)));

  console.log(`\n⚠ DESVÍOS respecto a tu orden deseado`);
  console.log(line(60));
  const totalVisible = visible.length;
  if (firstFamilia !== 0)
    console.log(`  • El bloque Familia no arranca en la posición 1 (arranca en ${firstFamilia + 1}).`);
  if (otrosVisibles.length > 0) {
    console.log(`  • ${otrosVisibles.length} catálogo(s) visible(s) no matchean ningún tier conocido (revisar si son`);
    console.log(`    nuevos sin clasificar en este script, o algo que no debería estar en el inicio):`);
    otrosVisibles.forEach((x) => console.log(`      - ${x.cat.name} (${x.cat.id})`));
  }
  console.log(`  • En total, ${outOfPlace} de ${totalVisible} catálogos visibles cambiarían de lugar.`);

  console.log(`\n▼ ORDEN PROPUESTO (a tu gusto)`);
  console.log(line(60));
  proposed.forEach((x, i) => console.log(fmt(x, i + 1)));

  console.log(`\n${line(60)}`);
  console.log(`Nota: este reporte NO modifica nada. Para aplicar el orden propuesto hay que`);
  console.log(`      reordenar preset.json (ver scripts/reorder-familia-top.mjs como ejemplo`);
  console.log(`      del patrón) y regenerar la instancia de AIOMetadata.`);
  console.log("");
}

main();
