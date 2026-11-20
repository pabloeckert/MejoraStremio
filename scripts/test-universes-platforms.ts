/**
 * test-universes-platforms.ts — Suite integral para MejoraStremio Hub v3.4.0:
 * - Manifiesto Leanback (15 filas Home, 24 secciones Discover-only con isRequired: true, 0 slashes '/')
 * - Parser seguro de '+' (parseStremioExtra y parseCompositeFilter)
 * - Plataformas (Netflix, HBO Max, Prime Video ID 119, Movistar+, BBC, Europa) en Movie & Series
 * - Sagas / Universos (Marvel, DC Comics, Harry Potter, X-Men, Independientes + Rollup)
 * - Calificaciones Tabla Argentina (ATP, +13, +16, +18) homologada multi-región
 * - Identificación de origen en streams ([NF], [HBO], [Prime], [Movistar+], [BBC], [EU]) sin falsos positivos
 */

import { MEJORASTREMIO_HUB_MANIFEST } from "./deno-hub/manifest.ts";
import { handleDiscover } from "./deno-hub/catalogs/tmdb.ts";
import {
  parseCompositeFilter,
  parseStremioExtra,
} from "./deno-hub/catalogs/universes_and_platforms.ts";
import {
  extractFormatBadges,
  rankAndBadgeStreams,
} from "./deno-hub/streams/streams.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function queryCatalog(
  type: "movie" | "series",
  catalogId: string,
  extraSegment = "",
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  const subPath = extraSegment
    ? `/catalog/${type}/${catalogId}/${extraSegment}.json`
    : `/catalog/${type}/${catalogId}.json`;
  const url = new URL(`http://127.0.0.1:8787/discover${subPath}`);
  const res = await handleDiscover(subPath, url);
  assert(res.status === 200, `${subPath} respondió HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.metas) ? data.metas : [];
}

Deno.test("1. Manifiesto v3.4.0 — Reglas Leanback, 15 Home, 24 Discover-only y cero '/' en options", () => {
  assert(MEJORASTREMIO_HUB_MANIFEST.version === "3.4.0", `Versión esperada 3.4.0, actual ${MEJORASTREMIO_HUB_MANIFEST.version}`);

  const catalogs = MEJORASTREMIO_HUB_MANIFEST.catalogs;
  const homeCatalogs = catalogs.filter(
    (c) => !(c.extra || []).some((e: { isRequired?: boolean }) => e.isRequired === true),
  );
  const discoverOnlyCatalogs = catalogs.filter(
    (c) => (c.extra || []).some((e: { name: string; isRequired?: boolean }) => e.name === "genre" && e.isRequired === true),
  );

  assert(
    homeCatalogs.length === 15 && homeCatalogs.length <= 16,
    `Home debe tener 15 catálogos (<=16), actual: ${homeCatalogs.length}`,
  );
  assert(
    discoverOnlyCatalogs.length === 24,
    `Discover-only debe tener 24 catálogos (12 stream + 10 saga + 2 discover-master), actual: ${discoverOnlyCatalogs.length}`,
  );

  for (const cat of catalogs) {
    for (const ex of (cat.extra || []) as Array<{ name: string; options?: string[] }>) {
      for (const opt of ex.options || []) {
        assert(
          !opt.includes("/"),
          `Opción inválida con '/' detectada en ${cat.id}.${ex.name}: "${opt}"`,
        );
      }
    }
  }
});

Deno.test("2. Parser seguro de '+' y filtros compuestos (género + calificación AR + plataforma/universo)", () => {
  const parsedExtra = parseStremioExtra("genre=Acci%C3%B3n%20%C2%B7%20%2B16%20y%20%2B18&service=Movistar+");
  assert(parsedExtra.genre === "Acción · +16 y +18", `genre corrupto: "${parsedExtra.genre}"`);
  assert(parsedExtra.service === "Movistar+", `service corrupto: "${parsedExtra.service}"`);

  const literalPlus = parseStremioExtra("genre=Movistar+ · +13&rating=+18");
  assert(literalPlus.genre === "Movistar+ · +13", `plus literal corrupto: "${literalPlus.genre}"`);
  assert(literalPlus.rating === "+18", `rating plus corrupto: "${literalPlus.rating}"`);

  const c1 = parseCompositeFilter("Acción · ATP y +13", "movie");
  assert(c1.genreId === 28 && c1.rating === "ATP_13", `c1 falló: ${JSON.stringify(c1)}`);

  const c2 = parseCompositeFilter("Crimen · +16 y +18", "series");
  assert(c2.genreId === 80 && c2.rating === "16_18", `c2 falló: ${JSON.stringify(c2)}`);

  const c3 = parseCompositeFilter("Marvel · ATP y +13", "movie");
  assert(c3.universe === "marvel" && c3.rating === "ATP_13", `c3 falló: ${JSON.stringify(c3)}`);

  const c4 = parseCompositeFilter("Movistar+ · +16 y +18", "series");
  assert(c4.platform === "movistar" && c4.rating === "16_18", `c4 falló: ${JSON.stringify(c4)}`);

  const c5 = parseCompositeFilter("Europa · ATP y +13", "movie");
  assert(c5.platform === "europa" && c5.rating === "ATP_13", `c5 falló: ${JSON.stringify(c5)}`);

  const c6 = parseCompositeFilter("Acción", "series", "+13", "Prime Video");
  assert(c6.genreId === 10759 && c6.rating === "+13" && c6.platform === "prime", `c6 falló: ${JSON.stringify(c6)}`);

  // Filtros de 3 niveles simultáneos (Universo/Plataforma · Categoría de Género · Calificación AR)
  const l3a = parseCompositeFilter("Marvel · Acción · +13", "movie");
  assert(l3a.universe === "marvel" && l3a.genreId === 28 && l3a.rating === "+13", `l3a falló: ${JSON.stringify(l3a)}`);

  const l3b = parseCompositeFilter("HBO Max · Drama · +16 y +18", "series");
  assert(l3b.platform === "hbo" && l3b.genreId === 18 && l3b.rating === "16_18", `l3b falló: ${JSON.stringify(l3b)}`);

  const l3c = parseCompositeFilter("Movistar+ · Crimen · +16 y +18", "series");
  assert(l3c.platform === "movistar" && l3c.genreId === 80 && l3c.rating === "16_18", `l3c falló: ${JSON.stringify(l3c)}`);

  const l3d = parseCompositeFilter("BBC · Misterio · +13", "series");
  assert(l3d.platform === "bbc" && l3d.genreId === 9648 && l3d.rating === "+13", `l3d falló: ${JSON.stringify(l3d)}`);

  const l3e = parseCompositeFilter("Europa · Thriller · +16 y +18", "movie");
  assert(l3e.platform === "europa" && l3e.genreId === 53 && l3e.rating === "16_18", `l3e falló: ${JSON.stringify(l3e)}`);

  const l3f = parseCompositeFilter("Drama · +16", "movie", undefined, undefined, "DC Comics");
  assert(l3f.universe === "dc" && l3f.genreId === 18 && l3f.rating === "+16", `l3f falló: ${JSON.stringify(l3f)}`);
});

Deno.test("3. Colecciones Curadas: Harry Potter (ATP vs +13) y X-Men (sin falsos positivos y +16)", async () => {
  const hpAtp = await queryCatalog("movie", "saga-harry-potter", `genre=${encodeURIComponent("ATP · Todo Público")}`);
  assert(hpAtp.length >= 3, `HP ATP devolvió pocos resultados: ${hpAtp.length}`);
  const hpAtpNames = hpAtp.map((m) => String(m.name).toLowerCase()).join(" | ");
  assert(hpAtpNames.includes("piedra") || hpAtpNames.includes("philosopher"), `HP 1 falta en ATP: ${hpAtpNames}`);
  assert(!hpAtpNames.includes("reliquias"), `HP 7 no debería estar en ATP: ${hpAtpNames}`);

  const hp13 = await queryCatalog("movie", "saga-harry-potter", `genre=${encodeURIComponent("+13 · Mayores de 13")}`);
  assert(hp13.length >= 6, `HP +13 devolvió pocos resultados: ${hp13.length}`);
  const hp13Names = hp13.map((m) => String(m.name).toLowerCase()).join(" | ");
  assert(hp13Names.includes("reliquias") || hp13Names.includes("animales"), `HP 7 / Animales falta en +13: ${hp13Names}`);

  const xmSeries = await queryCatalog("series", "saga-xmen");
  assert(xmSeries.length >= 4, `X-Men Series devolvió pocos resultados: ${xmSeries.length}`);
  const xmSeriesNames = xmSeries.map((m) => String(m.name).toLowerCase()).join(" | ");
  assert(!xmSeriesNames.includes("tortugas") && !xmSeriesNames.includes("fallout"), `Falso positivo en X-Men series: ${xmSeriesNames}`);
  assert(xmSeriesNames.includes("x-men") || xmSeriesNames.includes("legion"), `Falta X-Men '97 / Legion en X-Men series: ${xmSeriesNames}`);

  const xm16 = await queryCatalog("movie", "saga-xmen", `genre=${encodeURIComponent("+16 · Mayores de 16")}`);
  assert(xm16.length >= 3, `X-Men +16 devolvió pocos resultados: ${xm16.length}`);
  const xm16Names = xm16.map((m) => String(m.name).toLowerCase()).join(" | ");
  assert(xm16Names.includes("logan") || xm16Names.includes("deadpool"), `Falta Logan/Deadpool en X-Men +16: ${xm16Names}`);
});

Deno.test("4. Plataformas Streaming + Producción Europea (Movie & Series + Calificaciones AR + Subfiltros)", async () => {
  const platformIds = [
    "stream-netflix",
    "stream-hbo",
    "stream-prime",
    "stream-movistar",
    "stream-bbc",
    "stream-europa",
  ];

  for (const pid of platformIds) {
    const [movies, series] = await Promise.all([
      queryCatalog("movie", pid),
      queryCatalog("series", pid),
    ]);
    assert(movies.length > 0, `${pid} movie devolvió 0 resultados`);
    assert(series.length > 0, `${pid} series devolvió 0 resultados`);
  }

  // Calificaciones AR en Plataformas + Subfiltros de Género
  const cases: Array<["movie" | "series", string, string]> = [
    ["movie", "stream-prime", `genre=${encodeURIComponent("ATP · Todo Público")}`],
    ["movie", "stream-hbo", `genre=${encodeURIComponent("Acción · +16 y +18")}`],
    ["movie", "stream-netflix", `genre=${encodeURIComponent("Acción · ATP y +13")}`],
    ["series", "stream-movistar", `genre=${encodeURIComponent("Drama · +16 y +18")}`],
    ["series", "stream-bbc", `genre=${encodeURIComponent("+13 · Mayores de 13")}`],
    ["movie", "stream-europa", `genre=${encodeURIComponent("+16 · Mayores de 16")}`],
    ["movie", "estrenos-streaming", `genre=${encodeURIComponent("Prime Video")}`],
    ["series", "estrenos-streaming", `genre=${encodeURIComponent("HBO Max · +16 y +18")}`],
  ];

  for (const [type, cid, extra] of cases) {
    const metas = await queryCatalog(type, cid, extra);
    assert(metas.length > 0, `${type}/${cid}/${extra} devolvió 0 resultados`);
  }
});

Deno.test("5. Sagas y Universos Discover (Marvel, DC, Independientes + Rollup) con filtros AR", async () => {
  const universeCases: Array<["movie" | "series", string, string]> = [
    ["movie", "saga-marvel", ""],
    ["series", "saga-marvel", ""],
    ["movie", "saga-marvel", `genre=${encodeURIComponent("Acción · ATP y +13")}`],
    ["movie", "saga-dc", ""],
    ["series", "saga-dc", ""],
    ["movie", "saga-dc", `genre=${encodeURIComponent("+16 · Mayores de 16")}`],
    ["movie", "saga-independientes", ""],
    ["series", "saga-independientes", ""],
    ["movie", "saga-independientes", `genre=${encodeURIComponent("Drama · +16 y +18")}`],
    ["movie", "sagas-universos", ""],
    ["series", "sagas-universos", ""],
  ];

  for (const [type, cid, extra] of universeCases) {
    const metas = await queryCatalog(type, cid, extra);
    assert(metas.length > 0, `${type}/${cid}/${extra} devolvió 0 resultados`);
  }

  // Consultas reales de 3 niveles simultáneos en TMDB
  const level3Marvel = await queryCatalog(
    "movie",
    "sagas-universos",
    `genre=${encodeURIComponent("Marvel · Acción · +13")}`,
  );
  assert(level3Marvel.length > 0, "Consulta 3 niveles 'Marvel · Acción · +13' devolvió 0 resultados");

  const level3Hbo = await queryCatalog(
    "series",
    "estrenos-streaming",
    `genre=${encodeURIComponent("HBO Max · Drama · +16 y +18")}`,
  );
  assert(level3Hbo.length > 0, "Consulta 3 niveles 'HBO Max · Drama · +16 y +18' devolvió 0 resultados");
});

Deno.test("6. Streams extractFormatBadges — Plataformas [NF]/[HBO]/[Prime]/[Movistar+]/[BBC]/[EU] sin falsos positivos", () => {
  const cases: Array<{ title: string; expected: string[]; forbidden: string[] }> = [
    {
      title: "Stranger.Things.S04E01.1080p.NF.WEB-DL.DDP5.1.Atmos.x265",
      expected: ["[NF]", "[Atmos]"],
      forbidden: ["[HBO]", "[Prime]"],
    },
    {
      title: "The.Last.of.Us.S01E01.2160p.HMAX.WEB-DL.DV.P8.HDR10",
      expected: ["[HBO]", "[DV P8]", "[HDR10]"],
      forbidden: ["[NF]", "[Prime]"],
    },
    {
      title: "House.of.the.Dragon.S02E01.1080p.MAX.WEB-DL.x265",
      expected: ["[HBO]"],
      forbidden: ["[NF]"],
    },
    {
      title: "The.Boys.S04E01.1080p.AMZN.WEB-DL.DDP5.1",
      expected: ["[Prime]", "[5.1]"],
      forbidden: ["[HBO]", "[NF]"],
    },
    {
      title: "Antidisturbios.S01E01.1080p.MPLUS.WEB-DL.x264",
      expected: ["[Movistar+]"],
      forbidden: ["[BBC]", "[NF]"],
    },
    {
      title: "Sherlock.S01E01.1080p.BBC.iPlayer.WEB-DL",
      expected: ["[BBC]"],
      forbidden: ["[Movistar+]", "[HBO]"],
    },
    {
      title: "Balthazar.S01E01.1080p.TF1.WEB-DL.FR",
      expected: ["[EU]"],
      forbidden: ["[HBO]", "[NF]"],
    },
    {
      title: "Dune.2021.IMAX.1080p.BluRay.x264",
      expected: [],
      forbidden: ["[HBO]", "[NF]", "[Prime]", "[Movistar+]", "[BBC]", "[EU]"],
    },
    {
      title: "Pelicula.Latina.2025.wolfmax4k.1080p.WEB-DL",
      expected: [],
      forbidden: ["[HBO]", "[NF]", "[Prime]", "[Movistar+]", "[BBC]", "[EU]"],
    },
  ];

  for (const c of cases) {
    const badges = extractFormatBadges({ title: c.title });
    for (const exp of c.expected) {
      assert(badges.includes(exp), `Falta badge ${exp} en "${c.title}". Obtenido: ${JSON.stringify(badges)}`);
    }
    for (const forb of c.forbidden) {
      assert(!badges.includes(forb), `Falso positivo ${forb} en "${c.title}". Obtenido: ${JSON.stringify(badges)}`);
    }
  }
});

Deno.test("7. HCI / HPI / ACI (tt14060708 / tt13000282) — Prioridad Audio Castellano en Puesto #1 y Búsqueda HCI", async () => {
  const sampleStreams = [
    {
      name: "[TB+] Torrentio\n1080p",
      title: "HPI.S01E01.1080p.DSNP.WEB-DL.DD2.0.H264-STPAULI\n🇫🇷",
      infoHash: "fr001",
    },
    {
      name: "[TB+] Torrentio\n720p",
      title: "ACI Alta Capacidad Intelectual - Temporada 1 [HDTV 720p][Cap.101][AC3 5.1 Castellano][www.AtomixHQ.com]\n⚙️ MejorTorrent\n🇪🇸",
      infoHash: "es001",
    },
    {
      name: "[TB download] Torrentio\n1080p",
      title: "ACI Alta Capacidad Intelectual - Temporada 1 [WEB-DL 1080p][Cap.101][Dual DDP5.1 + Subs][www.atomixHQ.com]\n⚙️ Wolfmax4k\nDual Audio / 🇪🇸",
      infoHash: "es002",
    },
  ];

  const rankedHci = rankAndBadgeStreams(sampleStreams, { preferCastellano: true });
  assert(
    rankedHci.length === 3 && rankedHci[0].name?.includes("[🇪🇸 CASTELLANO]"),
    `Para HCI el Puesto #1 debe ser [🇪🇸 CASTELLANO], obtenido: ${rankedHci[0]?.name}`,
  );
  assert(
    rankedHci[1].name?.includes("[🇪🇸 CASTELLANO]") && rankedHci[2].name?.includes("[🎧 ORIGINAL]"),
    `El orden de HCI debe poner Castellano antes que Francés original`,
  );

  const hciSearchMetas = await queryCatalog("series", "discover-master", "search=HCI");
  const foundHci = hciSearchMetas.find((m) => m.id === "tt14060708");
  assert(Boolean(foundHci), `Búsqueda search=HCI no encontró tt14060708: ${JSON.stringify(hciSearchMetas.slice(0, 3))}`);
  assert(
    foundHci.name === "ACI: Alta Capacidad Intelectual (HCI / HPI)",
    `Nombre inesperado para HCI en búsqueda: "${foundHci.name}"`,
  );
});
