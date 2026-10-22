#!/usr/bin/env node
/**
 * Validador de Arquitectura, Esquemas y Gobernanza Leanback UX
 * MejoraStremio — Config & Profile Validator v2.1
 *
 * Valida:
 *   1. data/preset.json: Fuente de verdad de los catálogos de metadatos.
 *   2. cuentas/[perfil]/profile.json: Perfiles y gobernanza Leanback UX (TV Box).
 *
 * Uso:
 *   node scripts/validate-config.mjs                                  # Valida preset.json y todos los perfiles
 *   node scripts/validate-config.mjs cuentas/stremiojn/profile.json    # Valida perfil individual
 *   node scripts/validate-config.mjs data/preset.json                 # Valida solo preset.json
 *   node scripts/validate-config.mjs --json                           # Salida machine-readable
 *
 * Exit 0 = válido (0 errores). Exit 1 = hay errores. Exit 2 = no se pudo leer.
 *
 * Node >= 20, sin dependencias externas.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PRESET_PATH = join(ROOT, "data", "preset.json");
const CUENTAS_DIR = join(ROOT, "cuentas");

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const isStr = (v) => typeof v === "string" && v.length > 0;
const isBool = (v) => typeof v === "boolean";
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// ── Validador de data/preset.json ─────────────────────────────────────────────
export function validatePreset(filePath, preset, errFn = err, warnFn = warn) {
  if (!isObj(preset)) {
    errFn(`[${filePath}] La raíz de preset.json no es un objeto`);
    return;
  }

  const aio = preset?.aioMetadataConfig;
  if (!isObj(aio)) {
    errFn(`[${filePath}] Falta aioMetadataConfig (objeto)`);
    return;
  } else {
    if (!isObj(aio.config)) errFn(`[${filePath}] Falta aioMetadataConfig.config (objeto)`);
    if (!isObj(aio.catalogs)) errFn(`[${filePath}] Falta aioMetadataConfig.catalogs (objeto)`);
    if (!Array.isArray(aio.catalogs?.standard)) errFn(`[${filePath}] Falta aioMetadataConfig.catalogs.standard (array)`);
  }

  const cfg = aio?.config || {};
  const standard = Array.isArray(aio?.catalogs?.standard) ? aio.catalogs.standard : [];

  // Reglas de config crítica
  if (cfg.hideUnreleasedDigital !== false) {
    errFn(`[${filePath}] config.hideUnreleasedDigital debe ser false (es ${JSON.stringify(cfg.hideUnreleasedDigital)}); ` +
        `con true "Próximos Estrenos"/"En Cartelera" no devuelven resultados`);
  }

  const eng = cfg.search?.engineEnabled || {};
  for (const k of ["people_search_movie", "people_search_series"]) {
    if (eng[k] !== true) warnFn(`[${filePath}] search.engineEnabled.${k} no está en true → la búsqueda por actor puede no funcionar`);
  }
  if (!isObj(cfg.apiKeys)) warnFn(`[${filePath}] config.apiKeys no es un objeto`);

  // Catálogos standard
  const VALID_TYPES = new Set(["movie", "series", "all"]);
  const seen = new Map();
  const DISCOVER_RE = /^tmdb\.discover\./;

  standard.forEach((c, i) => {
    const at = `standard[${i}]`;
    if (!isObj(c)) { errFn(`[${filePath}] ${at} no es un objeto`); return; }
    if (!isStr(c.id)) errFn(`[${filePath}] ${at} sin id válido`);
    if (!VALID_TYPES.has(c.type)) errFn(`[${filePath}] ${at} (${c.id}) type inválido: ${JSON.stringify(c.type)}`);
    if (!isStr(c.name)) errFn(`[${filePath}] ${at} (${c.id}) sin name válido`);
    if (!isBool(c.enabled)) errFn(`[${filePath}] ${at} (${c.id}) enabled no es booleano`);
    if (!isBool(c.showInHome)) warnFn(`[${filePath}] ${at} (${c.id}) sin showInHome booleano`);
    if (!isStr(c.source)) warnFn(`[${filePath}] ${at} (${c.id}) sin source`);

    if (isStr(c.id) && DISCOVER_RE.test(c.id)) {
      const params = c.metadata?.discover?.params;
      if (!isObj(params)) errFn(`[${filePath}] ${at} (${c.id}) es discover pero le falta metadata.discover.params`);
    }

    if (isStr(c.id)) {
      const key = `${c.type}|${c.id}`;
      if (seen.has(key)) errFn(`[${filePath}] id duplicado "${key}" en ${at} (también en standard[${seen.get(key)}])`);
      else seen.set(key, i);
    }
  });

  // Gobernanza Leanback UX (TV Box)
  const homeCatalogs = standard.filter((c) => c.showInHome !== false && c.enabled !== false);
  if (homeCatalogs.length > 20) {
    errFn(`[${filePath}] Gobernanza Leanback: ${homeCatalogs.length} catálogos en Inicio exceden el límite máximo de 20 filas`);
  }

  homeCatalogs.forEach((c) => {
    const isUpcoming = /upcoming/.test(String(c.id || ''));
    const params = c.metadata?.discover?.params;
    if (params) {
      if (!isUpcoming) {
        const v = Number(params['vote_count.gte']);
        if (isNaN(v) || v < 3) {
          errFn(`[${filePath}] Catálogo de inicio "${c.name}" (${c.id}) carece de vote_count.gte >= 3 (tiene: ${params['vote_count.gte']})`);
        }
      }
      const sb = String(params.sort_by || '');
      if (/^popularity\./i.test(sb)) {
        errFn(`[${filePath}] Catálogo de inicio "${c.name}" (${c.id}) usa sort_by de popularidad estática: ${sb}`);
      }
    }
  });
}

// ── Validador de cuentas/[perfil]/profile.json ────────────────────────────────
export function validateProfile(filePath, profile, errFn = err, warnFn = warn) {
  const label = basename(dirname(filePath)) + "/profile.json";

  if (!isObj(profile)) {
    errFn(`[${label}] La raíz de profile.json no es un objeto`);
    return;
  }

  if (!isStr(profile.account) || !/.+@.+\..+/.test(profile.account)) {
    errFn(`[${label}] Falta account válido con formato de email (tiene: ${JSON.stringify(profile.account)})`);
  }
  if (!isStr(profile.alias)) errFn(`[${label}] Falta alias (string)`);
  if (!isStr(profile.deviceTarget)) errFn(`[${label}] Falta deviceTarget (string)`);
  if (!isStr(profile.version)) errFn(`[${label}] Falta version (string)`);

  const rules = profile.rules;
  if (!isObj(rules)) {
    errFn(`[${label}] Falta rules (objeto)`);
    return;
  }

  // 1. Gobernanza Leanback UX
  const cat = rules.catalogs;
  if (!isObj(cat)) {
    errFn(`[${label}] Falta rules.catalogs (objeto)`);
  } else {
    if (typeof cat.maxHomeRows !== "number" || cat.maxHomeRows > 20 || cat.maxHomeRows <= 0) {
      errFn(`[${label}] Gobernanza Leanback: rules.catalogs.maxHomeRows (${cat.maxHomeRows}) debe ser un número entre 1 y 20`);
    }
    if (typeof cat.minVoteCountHome !== "number" || cat.minVoteCountHome < 3) {
      errFn(`[${label}] Gobernanza Leanback: rules.catalogs.minVoteCountHome (${cat.minVoteCountHome}) debe ser >= 3 para blindar contra portadas vacías`);
    }
    if (cat.orderLaw && cat.orderLaw !== "release_date_desc") {
      errFn(`[${label}] Gobernanza Leanback: rules.catalogs.orderLaw debe ser "release_date_desc" (es: ${cat.orderLaw})`);
    }
  }

  // 2. Topología Canónica (Monopolio de exactamente 2 addons)
  if (rules.topology?.installedAddons) {
    const addons = rules.topology.installedAddons;
    if (!Array.isArray(addons) || addons.length !== 2) {
      errFn(`[${label}] Topología Canónica: deben configurarse exactamente 2 addons instalados (tiene: ${addons?.length})`);
    } else {
      if (addons[0]?.id !== "com.mejorastremio.hub") {
        errFn(`[${label}] Topología Canónica: posición #0 debe ser com.mejorastremio.hub (es: ${addons[0]?.id})`);
      }
      if (addons[1]?.id !== "com.linvo.cinemeta") {
        errFn(`[${label}] Topología Canónica: posición #1 debe ser com.linvo.cinemeta (es: ${addons[1]?.id})`);
      }
    }
  }

  // Unified Hub en Subtítulos
  const hub = rules.subtitles?.unifiedHub;
  if (!isObj(hub)) {
    errFn(`[${label}] Falta rules.subtitles.unifiedHub`);
  } else {
    if (hub.id !== "com.mejorastremio.hub") {
      errFn(`[${label}] rules.subtitles.unifiedHub.id debe ser "com.mejorastremio.hub" (es: ${hub.id})`);
    }
    if (hub.position !== 0) {
      errFn(`[${label}] rules.subtitles.unifiedHub.position debe ser 0 (es: ${hub.position})`);
    }
  }

  // 3. Audio Latino Puesto #1 Innegociable
  const audio = rules.audio;
  if (!isObj(audio)) {
    errFn(`[${label}] Falta rules.audio`);
  } else {
    if (!Array.isArray(audio.priorityHierarchy) || audio.priorityHierarchy[0] !== "latino") {
      errFn(`[${label}] Audio: priorityHierarchy[0] debe ser "latino" para asegurar Puesto #1 ([⚡ INSTANTÁNEO] [🌎 LATINO])`);
    }
    if (audio.torrentio?.language && audio.torrentio.language !== "latino") {
      errFn(`[${label}] Audio: rules.audio.torrentio.language debe ser "latino"`);
    }
    if (Array.isArray(audio.streamAddonOrder) && audio.streamAddonOrder[0] !== "com.mejorastremio.hub") {
      errFn(`[${label}] Audio: streamAddonOrder[0] debe ser "com.mejorastremio.hub"`);
    }
  }

  // 4. Subtítulos sin SDH
  const subs = rules.subtitles;
  if (subs?.mode !== "strict_no_sdh") {
    errFn(`[${label}] rules.subtitles.mode debe ser "strict_no_sdh"`);
  }

  // 5. Curaduría de Nicho para stremiojn
  if (profile.account === "stremiojn@gmail.com") {
    const focus = String(rules.focus || "");
    const genres = (rules.curation?.priorityGenres || []).join(" ");
    const hasCombat = /ufc|mma|boxeo|combate/i.test(focus + " " + genres);
    const hasAction = /acci[oó]n|thriller|policial/i.test(focus + " " + genres);
    if (!hasCombat || !hasAction) {
      errFn(`[${label}] Curaduría stremiojn: Debe priorizar Deportes de Combate (UFC, MMA, Boxeo) y Cine de Acción`);
    }

    const exGenres = (rules.curation?.excludedGenres || []).map((g) => g.toLowerCase());
    const exFilters = (rules.curation?.excludeFilters || []).map((f) => f.toLowerCase());
    const exCats = (rules.catalogs?.excludedCatalogs || []).map((c) => c.toLowerCase());
    const allEx = [...exGenres, ...exFilters, ...exCats].join(" ");

    const hasKidsEx = /infantil|kids/i.test(allEx);
    const hasMeloEx = /melodrama|telenovela/i.test(allEx);
    if (!hasKidsEx || !hasMeloEx) {
      errFn(`[${label}] Curaduría stremiojn: Debe excluir formalmente catálogo infantil y melodrama`);
    }
  }
}

// ── Ejecución Principal ───────────────────────────────────────────────────────
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const isJsonOutput = process.argv.includes("--json");

const filesToValidate = [];

if (args.length > 0) {
  for (const rawPath of args) {
    const fullPath = resolve(process.cwd(), rawPath);
    if (!existsSync(fullPath)) {
      console.error(`✗ Archivo no encontrado: ${rawPath}`);
      process.exit(2);
    }
    filesToValidate.push(fullPath);
  }
} else {
  // Sin argumentos: valida preset.json y todos los perfiles en cuentas/
  if (existsSync(PRESET_PATH)) filesToValidate.push(PRESET_PATH);
  if (existsSync(CUENTAS_DIR)) {
    const subdirs = readdirSync(CUENTAS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(CUENTAS_DIR, d.name, "profile.json"))
      .filter((p) => existsSync(p));
    filesToValidate.push(...subdirs);
  }
}

for (const f of filesToValidate) {
  let content;
  try {
    content = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    console.error(`✗ No se pudo parsear ${f}: ${e.message}`);
    process.exit(2);
  }

  if (content?.aioMetadataConfig) {
    validatePreset(f, content);
  } else if (content?.account && content?.rules) {
    validateProfile(f, content);
  } else {
    warn(`[${f}] Formato no reconocido (no es preset.json ni profile.json)`);
  }
}

const summary = {
  ok: errors.length === 0,
  validatedFiles: filesToValidate.length,
  errors,
  warnings: warns,
};

if (isJsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`\nValidación de Configuración y Perfiles Leanback (${filesToValidate.length} archivo(s))`);
  filesToValidate.forEach((f) => console.log(`  • ${f.replace(ROOT, "")}`));

  if (warns.length) {
    console.log(`\n⚠️  ${warns.length} warning(s):`);
    warns.forEach((m) => console.log(`  - ${m}`));
  }
  if (errors.length) {
    console.log(`\n✗ ${errors.length} error(es):`);
    errors.forEach((m) => console.log(`  - ${m}`));
    console.log("\n✗ CONFIGURACIÓN INVÁLIDA");
  } else {
    console.log("\n✅ Configuración y Gobernanza Leanback UX 100% VÁLIDAS (0 errores, 0 warnings)");
  }
}

process.exit(errors.length ? 1 : 0);
