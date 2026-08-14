#!/usr/bin/env node
/**
 * Regenera la instancia de AIOMetadata PROPIA de la cuenta solotveg (perfil
 * juvenil/adolescente) desde data/preset.json, aplicando las diferencias de
 * ese perfil respecto a la instancia compartida de stremioeg/stremiojn (ver
 * cuentas/solotveg/CLAUDE.md):
 *
 *   1. ageRating="PG-13" (cap nativo del addon, mapea a TV-14 en series).
 *   2. Sin tokens trakt/simkl de Pablo (esta cuenta no tiene Trakt conectado).
 *   3. Reorden de catalogs.standard: Estrenos/Cartelera → Plataforma/Canal →
 *      Tipo de contenido (animación / acción real) → resto de géneros →
 *      al final y ocultos de Inicio: Trending/Latest/Top Rated/Best of 2020s
 *      y los catálogos por país/región (a este perfil no le interesan).
 *   4. Se agregan 2 catálogos nuevos ("Acción Real" movie/series, con
 *      without_genres=16) que no existen en el preset compartido — son
 *      SOLO de esta instancia, no se escriben en data/preset.json.
 *   5. Se quita vote_average.gte y se baja vote_count.gte en los catálogos
 *      de género/plataforma — este perfil prioriza cantidad de contenido por
 *      sobre validación por rating (a diferencia de stremioeg). Se conserva
 *      el piso de with_runtime.gte (evita basura real, no filtra por gusto).
 *
 * No toca data/preset.json ni la instancia compartida. El UUID resultante se
 * guarda en cuentas/solotveg/aiometadata-instance.json.
 *
 * Requiere: AIO_PASSWORD, ST_EMAIL_TEEN, ST_PASS_TEEN
 * Uso:
 *   AIO_PASSWORD=... ST_EMAIL_TEEN=... ST_PASS_TEEN=... node scripts/regenerate-aiometadata-solotveg.mjs [--apply]
 *
 * Node >= 20, sin dependencias.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const AIO_BASE = "https://aiometadata.elfhosted.com";
const API = "https://api.strem.io/api";
const PRESET_PATH = "data/preset.json";
const INSTANCE_PATH = "cuentas/solotveg/aiometadata-instance.json";
const APPLY = process.argv.includes("--apply");

const die = (m, code = 1) => { console.error(`✗ ${m}`); process.exit(code); };
const aioPass = process.env.AIO_PASSWORD;
const email = process.env.ST_EMAIL_TEEN;
const pass = process.env.ST_PASS_TEEN;
if (!aioPass) die("Falta AIO_PASSWORD");
if (!email || !pass) die("Faltan ST_EMAIL_TEEN / ST_PASS_TEEN");

// ── Clasificación de catálogos ───────────────────────────────────────────────
const isDate = (c) => /upcoming|now_playing/.test(c.id);
const isPlatform = (c) => c.id.startsWith("flixpatrol.") || /cartoon-network|nickelodeon|warner-bros|youtube-premium/.test(c.id);
const isAnimation = (c) => /animation_movies|animation_shows/.test(c.id);
const COUNTRY_RE = /\.(ar|es|fr|de|it|gb|pt|mx|co|cl|br|pe|us|ca|au|nz|jp|kr|cn|tw|in|latam)\.pablo/;
const isCountryOrRegion = (c) => COUNTRY_RE.test(c.id);
const isRatingBased = (c) => c.id === "tmdb.trending" || /latest_movies|latest_shows|top_rated|best_of_2020s|best_tv_shows_of_the_2020s/.test(c.id);

function relaxQuantityFilters(catalog) {
  const params = catalog?.metadata?.discover?.params;
  if (!params) return catalog;
  const c = JSON.parse(JSON.stringify(catalog));
  const p = c.metadata.discover.params;
  delete p["vote_average.gte"];
  if (typeof p["vote_count.gte"] === "number" && p["vote_count.gte"] > 10) p["vote_count.gte"] = 10;
  if (c.metadata.discover.formState) {
    c.metadata.discover.formState.voteAverageRange = [0, 10];
    c.metadata.discover.formState.voteCountMin = p["vote_count.gte"] ?? 0;
  }
  return c;
}

function buildLiveActionCatalog(type) {
  const isMovie = type === "movie";
  return {
    id: `tmdb.discover.${isMovie ? "movie" : "tv"}.live_action.pablo9${isMovie ? "00" : "01"}`,
    type: isMovie ? "movie" : "series",
    name: isMovie ? "Acción Real (Películas)" : "Acción Real (Series)",
    enabled: true,
    showInHome: true,
    source: "tmdb",
    cacheTTL: 86400,
    metadata: {
      description: `TMDB Discover (${isMovie ? "movie" : "tv"})`,
      discover: {
        version: 2,
        source: "tmdb",
        mediaType: isMovie ? "movie" : "tv",
        params: {
          sort_by: isMovie ? "primary_release_date.desc" : "first_air_date.desc",
          include_adult: false,
          without_genres: "16",
          watch_region: "US",
          "vote_count.gte": 50, // piso mínimo: sin esto, ordenar por fecha saca puro indie sin
                                 // certificación cargada en TMDB, y el cap de edad los descarta a
                                 // todos por "no verificado" (probado empíricamente, ver commit)
          ...(isMovie ? { with_release_type: "4|5|6", "with_runtime.gte": 60 } : { with_type: "2", "with_runtime.gte": 10 }),
          with_origin_country: "US|GB|CA|AU|IE|FR|DE|IT|ES|PT|NL|BE|SE|NO|DK|FI|AT|CH|AR|MX|BR|CO|CL|PE|JP|KR",
        },
        formState: {
          catalogName: isMovie ? "Acción Real (Películas)" : "Acción Real (Series)",
          discoverSource: "tmdb",
          sortBy: isMovie ? "primary_release_date.desc" : "first_air_date.desc",
          cacheTTL: 86400,
          catalogType: isMovie ? "movie" : "series",
          includeGenres: [],
          excludeGenres: [{ id: 16, label: "Animation" }],
          genreJoinMode: "or",
          originalLanguage: "",
          originCountry: "US|GB|CA|AU|IE|FR|DE|IT|ES|PT|NL|BE|SE|NO|DK|FI|AT|CH|AR|MX|BR|CO|CL|PE|JP|KR",
          certificationCountry: "",
          certificationValue: "",
          includeAdult: false,
          releasedOnly: true,
          watchRegion: "US",
          voteAverageRange: [0, 10],
          voteCountMin: 50,
          runtimeRange: isMovie ? [60, 400] : [10, 180],
        },
      },
    },
  };
}
const preset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
const enabled = preset.aioMetadataConfig.catalogs.standard.filter((c) => c.enabled !== false);

const dateCats = enabled.filter(isDate);
const platformCats = enabled.filter((c) => !isDate(c) && isPlatform(c));
const animationCats = enabled.filter((c) => !isDate(c) && !isPlatform(c) && isAnimation(c));
const liveActionCats = [buildLiveActionCatalog("movie"), buildLiveActionCatalog("series")];
const deprioritized = enabled.filter((c) => !isDate(c) && !isPlatform(c) && !isAnimation(c) && (isCountryOrRegion(c) || isRatingBased(c)));
const rest = enabled.filter((c) => ![...dateCats, ...platformCats, ...animationCats, ...deprioritized].includes(c));

console.log(`Estrenos/Cartelera: ${dateCats.length} | Plataforma/Canal: ${platformCats.length} | Animación: ${animationCats.length} (+2 Acción Real nuevas) | Resto géneros: ${rest.length} | Deprioritizados (país/región/rating): ${deprioritized.length}`);

const finalOrder = [
  ...dateCats,
  ...platformCats.map(relaxQuantityFilters),
  ...animationCats.map(relaxQuantityFilters),
  ...liveActionCats,
  ...rest.map(relaxQuantityFilters).map((c) => ({ ...c, showInHome: true })),
  ...deprioritized.map((c) => ({ ...c, showInHome: false })),
];

const config = JSON.parse(JSON.stringify(preset.aioMetadataConfig.config));
config.catalogs = finalOrder;
config.ageRating = "PG-13";
config.displayAgeRating = true;
delete config.trakt;
delete config.simkl;
if (config.apiKeys) { delete config.apiKeys.trakt; delete config.apiKeys.simkl; }

console.log(`\nTotal catálogos en la config nueva: ${finalOrder.length}`);
console.log(`Orden: ${finalOrder.slice(0, 8).map((c) => c.name).join(" → ")} → ...`);

const save = await fetch(`${AIO_BASE}/api/config/save`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ config, password: aioPass }),
  signal: AbortSignal.timeout(30000),
}).then((r) => r.json());
if (!save?.success || !save?.installUrl) die("Save falló: " + JSON.stringify(save));
const installUrl = save.installUrl;
const newUuid = (installUrl.match(/\/([0-9a-f-]{36})\//) || [])[1];
console.log(`\n✓ Instancia nueva: ${newUuid}`);

const newMan = await fetch(installUrl).then((r) => r.json());
console.log(`Manifest: ${(newMan.catalogs || []).length} catálogos, primero: ${newMan.catalogs?.[0]?.name}`);
if (!newMan.catalogs?.length) die("Manifest nuevo sin catálogos — algo salió mal, no se instala");

mkdirSync("cuentas/solotveg", { recursive: true });
writeFileSync(INSTANCE_PATH, JSON.stringify({ instanceId: newUuid, note: "AIOMetadata separado con ageRating=PG-13 (cap TV-14 en series), reorden Estrenos→Plataforma→Contenido→resto, sin país/región/rating en Home. Solo para esta cuenta.", regeneratedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`✓ ${INSTANCE_PATH} actualizado`);

if (!APPLY) {
  console.log("\nModo reporte (sin --apply): instancia creada pero NO instalada en la cuenta.");
  process.exit(0);
}

const apiPost = (path, body) => fetch(`${API}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) }).then((r) => r.json());
const login = await apiPost("login", { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die("Login fallido: " + JSON.stringify(login?.error || login));
const col = await apiPost("addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
const addons = col?.result?.addons || [];
const idx = addons.findIndex((a) => a.manifest?.id === "aio-metadata");
if (idx < 0) die("No se encontró AIOMetadata en la cuenta");

mkdirSync(".backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`.backups/backup-solotveg-pre-aio-regen-${stamp}.json`, JSON.stringify(col, null, 2));

addons[idx] = { ...addons[idx], transportUrl: installUrl, manifest: newMan };
const set = await apiPost("addonCollectionSet", { type: "AddonCollectionSet", authKey, addons });
if (!(set?.result || set?.success)) die("addonCollectionSet falló: " + JSON.stringify(set));

let okSwap = false;
for (let i = 0; i < 4 && !okSwap; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 2000));
  const after = await apiPost("addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
  const aioAfter = (after?.result?.addons || []).find((a) => a.manifest?.id === "aio-metadata");
  okSwap = (aioAfter?.transportUrl || "").includes(newUuid);
}
console.log(`\n${okSwap ? "✅" : "✗"} Swap ${okSwap ? "OK" : "NO confirmado"} — AIOMetadata solotveg → ${newUuid}`);
process.exit(okSwap ? 0 : 1);
