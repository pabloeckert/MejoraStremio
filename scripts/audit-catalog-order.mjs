#!/usr/bin/env node
// Auditoría de orden de catálogos de AIOMetadata (T2).
//
// Compara el orden ACTUAL de los catálogos visibles en la pantalla de inicio
// (data/preset.json -> aioMetadataConfig.catalogs.standard) contra el orden
// DESEADO por Pablo, y propone un reordenamiento.
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
// Aprobado por Pablo: En Cartelera > Estrenos > Tendencias > Géneros >
// Países > Décadas/colecciones > Plataformas y Top 10 al fondo.
const TIERS = [
  { label: "En Cartelera" },
  { label: "Próximos Estrenos" },
  { label: "Tendencias y novedades" },
  { label: "Géneros" },
  { label: "Países (a tu gusto)" },
  { label: "Décadas y colecciones" },
  { label: "Plataformas y Top 10 (al fondo)" },
  { label: "Otros" },
];
const OTROS = TIERS.length - 1;

function tierOf(cat) {
  const id = String(cat.id || "");
  if (/now_playing/.test(id)) return 0;
  if (/\.upcoming\./.test(id)) return 1;
  if (/\.trending/.test(id) || /latest_(movies|shows)/.test(id) ||
      /top_rated/.test(id) || /best_(of_2020s|tv_shows_of_the_2020s)/.test(id))
    return 2;
  if (/\.\d+$/.test(id)) return 3; // géneros TMDB: terminan en id numérico
  if (/\.(argentina|latam)\./.test(id) || /pablo00[1-4]$/.test(id)) return 4;
  if (/best_(movies_of|tv_shows_of_the)_/.test(id)) return 5;
  if (/^streaming\./.test(id) || /^flixpatrol\./.test(id)) return 6;
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
  const firstEnCartelera = visible.findIndex((x) => x.tier === 0);
  const firstEstrenos = visible.findIndex((x) => x.tier === 1);
  const platformsAboveDestacados = visible.filter((x, i) => {
    if (x.tier !== 6) return false;
    // ¿hay En Cartelera o Estrenos por debajo de esta plataforma?
    return visible.slice(i + 1).some((y) => y.tier <= 1);
  }).length;
  const outOfPlace = visible.filter((x, i) => proposed[i].idx !== x.idx).length;

  if (asJson) {
    console.log(JSON.stringify({
      totalCatalogs: std.length,
      visibleInHome: visible.length,
      currentOrder: visible.map((x) => ({ id: x.cat.id, name: x.cat.name, type: x.cat.type, tier: TIERS[x.tier].label })),
      proposedOrder: proposed.map((x) => ({ id: x.cat.id, name: x.cat.name, type: x.cat.type, tier: TIERS[x.tier].label })),
      deviations: {
        enCarteleraPos: firstEnCartelera < 0 ? null : firstEnCartelera + 1,
        estrenosPos: firstEstrenos < 0 ? null : firstEstrenos + 1,
        platformsAboveDestacados,
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
  if (firstEnCartelera >= 0)
    console.log(`  • "En Cartelera" está en la posición ${firstEnCartelera + 1} de ${totalVisible}; debería ser la 1ª.`);
  if (firstEstrenos >= 0)
    console.log(`  • "Próximos Estrenos" está en la posición ${firstEstrenos + 1}; debería estar entre las primeras.`);
  if (platformsAboveDestacados > 0)
    console.log(`  • ${platformsAboveDestacados} catálogos de plataformas (Netflix, Disney+, etc.) están por encima de En Cartelera/Estrenos.`);
  console.log(`  • En total, ${outOfPlace} de ${totalVisible} catálogos visibles cambiarían de lugar.`);

  console.log(`\n▼ ORDEN PROPUESTO (a tu gusto)`);
  console.log(line(60));
  proposed.forEach((x, i) => console.log(fmt(x, i + 1)));

  console.log(`\n${line(60)}`);
  console.log(`Nota 1: "New on MUBI" NO está en AIOMetadata (no aparece en preset.json).`);
  console.log(`        Sale de OTRO addon de la cuenta; bajarlo requiere reordenar la`);
  console.log(`        colección de addons, no este preset. Se audita aparte.`);
  console.log(`Nota 2: este reporte NO modifica nada. Para aplicar el orden propuesto hay`);
  console.log(`        que reordenar preset.json y regenerar la instancia de AIOMetadata.`);
  console.log("");
}

main();
