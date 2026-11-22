/**
 * Suite E2E — Perfil stremiojn@gmail.com (UFC, MMA, Boxeo, Combate, Acción y Policial)
 *
 * Verifica:
 * 1. Aislamiento estricto: MEJORASTREMIO_HUB_MANIFEST (stremioeg) intacto con 39 catálogos (15 Home).
 * 2. buildStremioJnManifest(): 42 catálogos (14 Home, 28 Discover), sin filas infantiles y sin '/' en options.
 * 3. handleUnifiedHub(): ruteo diferenciado ?profile=stremiojn (42) vs ?profile=stremioeg (39) y /profile=stremiojn/manifest.json.
 * 4. handleUfcCombatCatalog(): validación en vivo contra TMDB para los 7 catálogos de combate/acción/policial.
 */

import {
  buildStremioJnManifest,
  MEJORASTREMIO_HUB_MANIFEST,
} from "./deno-hub/manifest.ts";
import {
  handleUfcCombatCatalog,
  isUfcCombatCatalogId,
  UFC_COMBAT_CATALOG_IDS,
} from "./deno-hub/catalogs/ufc_combat.ts";
import { handleUnifiedHub } from "./deno-hub/unified-hub.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function assertEquals<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERTION FAILED: ${msg} (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`,
    );
  }
}

interface CatalogExtra {
  name?: string;
  isRequired?: boolean;
  options?: string[];
}

interface CatalogEntry {
  id: string;
  type: string;
  name: string;
  extra?: CatalogExtra[];
}

Deno.test("Manifest aislamiento stremioeg (39 catálogos intactos) vs stremiojn UFC (42 catálogos)", () => {
  // 1. stremioeg sin tocar
  assertEquals(
    MEJORASTREMIO_HUB_MANIFEST.catalogs.length,
    39,
    "MEJORASTREMIO_HUB_MANIFEST debe mantener 39 catálogos exactos para stremioeg",
  );
  const egHome = MEJORASTREMIO_HUB_MANIFEST.catalogs.filter((c: CatalogEntry) => {
    const genreExtra = (c.extra || []).find((e) => e.name === "genre");
    return !genreExtra || genreExtra.isRequired !== true;
  });
  assertEquals(egHome.length, 15, "stremioeg debe mantener 15 filas en Home");

  // 2. stremiojn UFC
  const jn = buildStremioJnManifest();
  assertEquals(jn.id, "com.mejorastremio.hub", "id canónico de hub");
  assertEquals(jn.version, "3.4.0", "version v3.4.0");
  assert(
    jn.name.includes("UFC") && jn.name.includes("Combate"),
    `nombre de manifest debe reflejar UFC & Combate: ${jn.name}`,
  );
  assert(typeof jn.description === "string" && jn.description.length > 20, "description válida");
  assert(Array.isArray(jn.resources) && jn.resources.length >= 4, "resources stremio-core válidos");
  assert(Array.isArray(jn.types) && jn.types.includes("movie") && jn.types.includes("series"), "types válidos");
  assertEquals(jn.catalogs.length, 42, "buildStremioJnManifest debe tener 42 catálogos");

  const homeRows = jn.catalogs.filter((c: CatalogEntry) => {
    const genreExtra = (c.extra || []).find((e) => e.name === "genre");
    return !genreExtra || genreExtra.isRequired !== true;
  });
  const discoverRows = jn.catalogs.filter((c: CatalogEntry) => {
    const genreExtra = (c.extra || []).find((e) => e.name === "genre");
    return Boolean(genreExtra && genreExtra.isRequired === true);
  });

  assertEquals(homeRows.length, 14, "stremiojn Home debe tener 14 filas");
  assertEquals(discoverRows.length, 28, "stremiojn Discover debe tener 28 secciones");

  const forbiddenKidsIds = ["para-ver-en-familia", "dibujos", "familia", "infantil", "ninos", "kids"];
  for (const row of homeRows) {
    assert(
      !forbiddenKidsIds.includes(row.id) && !/infantil|familia|dibujo/i.test(row.name),
      `Home no debe contener filas infantiles/familiares: ${row.id} (${row.name})`,
    );
  }

  for (const cat of jn.catalogs as CatalogEntry[]) {
    for (const ex of cat.extra || []) {
      for (const opt of ex.options || []) {
        assert(
          !opt.includes("/"),
          `extra.options en ${cat.id} contiene '/' prohibido por Stremio HTTP path: ${opt}`,
        );
      }
    }
  }
});

Deno.test("handleUnifiedHub rutea manifest stremiojn (42) vs stremioeg (39)", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const jnUrl1 = new URL("https://hub.local/manifest.json?profile=stremiojn");
    const resJn1 = await handleUnifiedHub("/manifest.json", "https://hub.local", jnUrl1, kv);
    assert(resJn1 !== null && resJn1.status === 200, "GET /manifest.json?profile=stremiojn HTTP 200");
    const manifestJn1 = await resJn1.json();
    assertEquals(manifestJn1.catalogs.length, 42, "query ?profile=stremiojn devuelve 42 catálogos");

    const jnUrl2 = new URL("https://hub.local/profile=stremiojn/manifest.json");
    const resJn2 = await handleUnifiedHub("/profile=stremiojn/manifest.json", "https://hub.local", jnUrl2, kv);
    assert(resJn2 !== null && resJn2.status === 200, "GET /profile=stremiojn/manifest.json HTTP 200");
    const manifestJn2 = await resJn2.json();
    assertEquals(manifestJn2.catalogs.length, 42, "path /profile=stremiojn/manifest.json devuelve 42 catálogos");

    const egUrl = new URL("https://hub.local/manifest.json?profile=stremioeg");
    const resEg = await handleUnifiedHub("/manifest.json", "https://hub.local", egUrl, kv);
    assert(resEg !== null && resEg.status === 200, "GET /manifest.json?profile=stremioeg HTTP 200");
    const manifestEg = await resEg.json();
    assertEquals(manifestEg.catalogs.length, 39, "query ?profile=stremioeg devuelve 39 catálogos");
  } finally {
    kv.close();
  }
});

Deno.test("UFC Combat Catalogs IDs registrados y consultas en vivo contra TMDB", async () => {
  const expectedIds: Array<{ type: "movie" | "series"; id: string }> = [
    { type: "movie", id: "ufc-eventos" },
    { type: "series", id: "ufc-series-hub" },
    { type: "movie", id: "cine-ufc-mma" },
    { type: "movie", id: "accion-adrenalina" },
    { type: "movie", id: "thriller-policial" },
    { type: "movie", id: "combat-boxeo" },
    { type: "movie", id: "combat-motor-deportes" },
  ];

  assertEquals(UFC_COMBAT_CATALOG_IDS.size, 7, "7 catálogos de combate esperados");
  for (const item of expectedIds) {
    assert(isUfcCombatCatalogId(item.id), `isUfcCombatCatalogId debe reconocer ${item.id}`);
    const url = new URL(`https://hub.local/profile=stremiojn/catalog/${item.type}/${item.id}.json`);
    const res = await handleUfcCombatCatalog(item.type, item.id, "", url);
    assertEquals(res.status, 200, `${item.type}/${item.id} debe responder HTTP 200`);
    const data = await res.json();
    const metas = data.metas || [];
    assert(
      Array.isArray(metas) && metas.length > 0,
      `${item.type}/${item.id} debe devolver metas no vacíos (got ${metas.length})`,
    );

    for (const m of metas) {
      assert(typeof m.id === "string" && m.id.startsWith("tt"), `${item.id} meta id inválido: ${m.id}`);
      assert(typeof m.poster === "string" && m.poster.startsWith("http"), `${item.id} poster inválido para ${m.id}`);
    }

    if (item.id === "ufc-eventos") {
      const hasUfc = metas.some((m: { name?: string }) => /\bufc\b/i.test(m.name || ""));
      assert(hasUfc, "ufc-eventos debe contener eventos UFC reales");
      // Verificar orden descendente por año en los primeros ítems cuando tengan releaseInfo
      const years = metas
        .slice(0, 8)
        .map((m: { releaseInfo?: string }) => Number.parseInt(String(m.releaseInfo || "").slice(0, 4), 10))
        .filter((y: number) => Number.isFinite(y));
      assert(years.length >= 2 && years[0] >= years[years.length - 1], `ufc-eventos orden descendente por año (${years.join(",")})`);
    }

    if (item.id === "ufc-series-hub") {
      const joined = metas.map((m: { name?: string }) => m.name || "").join(" | ");
      assert(
        /ultimate fighter|contender|kingdom|warrior|baki|kengan|fight|ufc/i.test(joined),
        `ufc-series-hub debe incluir series emblemáticas de combate (got: ${joined.slice(0, 200)})`,
      );
    }

    if (item.id === "cine-ufc-mma") {
      for (const m of metas) {
        const lower = (m.name || "").toLowerCase();
        assert(
          !/peppa|paw patrol|frozen|minions/i.test(lower),
          `cine-ufc-mma no debe contener títulos infantiles: ${m.name}`,
        );
      }
    }
  }
});
