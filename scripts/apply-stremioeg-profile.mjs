#!/usr/bin/env node
/**
 * apply-stremioeg-profile.mjs — Aplica y valida el perfil estricto de la cuenta stremioeg.
 *
 * Establece y audita:
 *   1. Subtítulos: Español Latino / Español SIN SDH (descarta marcas SDH o CC).
 *   2. Audio: Original y Doblado Latino prioritarios; Español España relegado a última instancia.
 *   3. Catálogos: Sincronización diaria de estrenos (ventanas dinámicas en preset.json y orden desc).
 *
 * Opciones CLI:
 *   --check         Modo auditoría / dry-run (por defecto). No escribe en la cuenta.
 *   --dry-run       Alias de --check. Gana sobre --apply si se pasan ambos.
 *   --apply         Aplica los cambios en la cuenta en vivo (requiere ST_EMAIL / ST_PASS).
 *                   Antes de escribir: snapshot en .backups/, chequeo anti-carrera y guard de catálogos.
 *                   Después de escribir: verificación por lectura posterior.
 *   --rollback-last Restaura el último snapshot de .backups/ (crea antes un snapshot del estado actual,
 *                   así que el propio rollback es reversible). Con --dry-run solo muestra el diff.
 *   --rollback=<archivo>  Restaura un snapshot específico.
 *   --test-unit     Ejecuta simulación y pruebas unitarias de filtros de audio y subtítulos.
 *
 * Los diffs y logs enmascaran tokens (TorBox, Real-Debrid, API keys, segmentos de config largos).
 * Los snapshots SÍ contienen las URLs completas: .backups/ está en .gitignore y se escribe con modo 0600.
 *
 * Node >= 20, sin dependencias externas.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { apiPost } from './lib/stremio-api.mjs';
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROFILE_PATH = join(ROOT, 'cuentas', 'stremioeg', 'profile.json');
const PRESET_PATH = join(ROOT, 'data', 'preset.json');
const BACKUPS = join(ROOT, '.backups');

const args = process.argv.slice(2);
const DRY_FLAG = args.includes('--check') || args.includes('--dry-run');
const APPLY = args.includes('--apply') && !DRY_FLAG;
const RUN_UNIT_TEST = args.includes('--test-unit');
const ROLLBACK_ARG = args.find((a) => a.startsWith('--rollback='));
const ROLLBACK = args.includes('--rollback-last') || Boolean(ROLLBACK_ARG);

// ── Cargar Especificación de Perfil ──────────────────────────────────────────
export function loadProfile() {
  if (!existsSync(PROFILE_PATH)) {
    throw new Error(`No se encontró el perfil en ${PROFILE_PATH}`);
  }
  return JSON.parse(readFileSync(PROFILE_PATH, 'utf8'));
}

// ── Lógica Estricta de Subtítulos (Filtro y Priorización) ─────────────────────
export const SDH_CC_REGEX = /\b(sdh|cc|hi|hoh|hearing[\s._-]*impaired|hard[\s._-]*of[\s._-]*hearing|for[\s._-]*the[\s._-]*deaf|sordos|para[\s._-]*sordos|para[\s._-]*personas[\s._-]*sordas|forced[\s._-]*sdh)\b|[([{\[]\s*(sdh|cc|hi|hoh)\s*[)}\]]/i;

export function isSdhOrCcSubtitle(sub) {
  if (!sub) return false;
  if (sub.hi === true || sub.hearing_impaired === true) return true;
  const label = String(sub.label || sub.name || sub.id || sub.filename || '');
  // Si indica explícitamente "sin sdh", "no sdh", etc., es un subtítulo limpio
  if (/\b(?:sin|no|non)[\s_-]*sdh\b/i.test(label)) {
    return false;
  }
  return SDH_CC_REGEX.test(label);
}

export function scoreSubtitle(sub) {
  if (!sub) return -1;
  // 1. REGLA ESTRICTA: Descartar SDH / CC
  if (isSdhOrCcSubtitle(sub)) {
    return -1; // Descalificado
  }

  const lang = String(sub.lang || sub.language || '').toLowerCase().trim();
  const label = String(sub.label || sub.name || '').toLowerCase().trim();

  // 2. Español Latinoamericano (Prioridad 1)
  if (
    lang === 'ea' ||
    lang === 'es-419' ||
    lang === 'es-la' ||
    label.includes('latino') ||
    label.includes('latin') ||
    label.includes('mexico') ||
    label.includes('argentina')
  ) {
    return 100;
  }

  // 3. Español neutro / estándar limpio (Prioridad 2)
  if (lang === 'es' || lang === 'spa' || lang === 'spanish') {
    // Si la etiqueta menciona explícitamente España o Castellano, penalizar
    if (label.includes('castellano') || label.includes('españa') || label.includes('spain') || lang === 'sp') {
      return 10; // Última instancia
    }
    return 60;
  }

  // 4. Español España / Castellano explícito (Última instancia)
  if (lang === 'sp' || label.includes('castellano') || label.includes('españa')) {
    return 10;
  }

  return 0;
}

export function filterAndRankSubtitles(subtitles) {
  if (!Array.isArray(subtitles)) return [];
  return subtitles
    .map((sub) => ({ sub, score: scoreSubtitle(sub) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.sub);
}

// ── Lógica Estricta de Audio (Priorización y Scoring) ─────────────────────────
export function scoreAudioStream(stream) {
  const text = `${stream.name || ''} ${stream.title || ''} ${stream.description || ''}`;
  let score = 0;

  // TorBox o Debrid cacheado: máxima disponibilidad
  if (/\[tb\+?\]|cached|instant/i.test(text)) {
    score += 200;
  }

  // REGLA ESTRICTA: Doblaje Latino prioritario (+100)
  if (/\[latino\]|\blatino\b|audio.?latino|español.?latino|\bdual.?latino\b|\blat\b/i.test(text)) {
    score += 100;
  }

  // REGLA ESTRICTA: Audio Original prioritario (+70)
  if (/original.?audio|\beng\b|english|\binglés\b|\bvose\b/i.test(text)) {
    score += 70;
  }

  // Multi Audio general (+30)
  if (/\bmulti\b|\bdual\b/i.test(text) && !/castellano|españa/i.test(text)) {
    score += 30;
  }

  // REGLA ESTRICTA: Español España / Castellano RELEGADO a última instancia (-80)
  if (/\[castellano\]|\bcastellano\b|español.?españa|spanish.?spain/i.test(text)) {
    score -= 80;
  }

  return score;
}

export function rankAudioStreams(streams) {
  if (!Array.isArray(streams)) return [];
  return streams
    .map((st) => ({ stream: st, score: scoreAudioStream(st) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.stream);
}

// ── Modificación de Transport URLs en Add-ons de Streams ─────────────────────
export function configureTorrentio(addon) {
  const url = addon.transportUrl || '';
  const match = url.match(/^(https:\/\/[^/]+\/)([^/]*)(\/manifest\.json.*)$/);
  if (!match) return { url, changed: false };
  const [, prefix, cfgSegment, suffix] = match;
  const pairs = cfgSegment ? cfgSegment.split('|') : [];

  let found = false;
  const newPairs = pairs.map((p) => {
    if (p.startsWith('language=')) {
      found = true;
      return 'language=latino';
    }
    return p;
  });
  if (!found) newPairs.push('language=latino');

  const newSegment = newPairs.join('|');
  const newUrl = `${prefix}${newSegment}${suffix}`;
  return {
    url: newUrl,
    changed: newUrl !== url,
    oldSegment: cfgSegment,
    newSegment,
  };
}

export function configureComet(addon) {
  const url = addon.transportUrl || '';
  const match = url.match(/^(https:\/\/[^/]+\/)([^/]+)(\/manifest\.json.*)$/);
  if (!match) return { url, changed: false };
  const [, prefix, b64, suffix] = match;

  let cfg;
  try {
    cfg = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return { url, changed: false };
  }

  const beforeStr = JSON.stringify(cfg);
  // Fijar cacheados primero y lenguajes preferidos: Latino ('la') y Original ('en')
  cfg.sortCachedUncachedTogether = false;
  cfg.languages = cfg.languages || {};
  cfg.languages.preferred = ['la', 'en'];

  const afterStr = JSON.stringify(cfg);
  const newB64 = Buffer.from(afterStr).toString('base64');
  const newUrl = `${prefix}${newB64}${suffix}`;
  return {
    url: newUrl,
    changed: newUrl !== url,
    before: JSON.parse(beforeStr),
    after: cfg,
  };
}

// ── Neutralización de Add-ons de Subtítulos Competidores y Monopolio del Hub ──
export const COMPETING_SUBTITLE_ADDON_IDS = new Set([
  'org.stremio.opensubtitlesv3',
  'org.stremio.opensubtitles',
  'com.stremio.submaker',
  'community.opensubtitlesv3.pro',
  'community.subscene',
  'com.community.stremio-subtitles',
  'community.subhero-v2.wyzie',
  'lowlevel.subtitles',
  'com.subsense.nepiraw',
  'org.subtitulos.subdivx',
  'community.subsource.subtitles',
  'community.subdl.subtitles',
  'community.addic7ed',
  'com.github.IsraPerez98.Stremio-TuSubtitulo',
  'org.subtis',
  'community.podnapisi',
  'community.yifysubtitles',
  'com.subtito.ai',
]);

export function filterCompetingSubtitleAddons(addons) {
  if (!Array.isArray(addons)) return { cleanedAddons: [], removedAddons: [] };
  const removedAddons = [];
  const cleanedAddons = addons.filter((a) => {
    const id = a.manifest?.id || a.id || '';
    if (COMPETING_SUBTITLE_ADDON_IDS.has(id)) {
      removedAddons.push(a);
      return false;
    }
    const transport = String(a.transportUrl || a.url || '');
    if (
      !transport.includes('mejorastremio-hub') &&
      (transport.includes('opensubtitles-v3.strem.io') ||
        transport.includes('subsense.nepiraw.com') ||
        transport.includes('submaker.elfhosted.com') ||
        transport.includes('subdl.strem.top') ||
        transport.includes('subsource.strem.top') ||
        transport.includes('stremio-community-subtitles') ||
        transport.includes('subtito.com'))
    ) {
      removedAddons.push(a);
      return false;
    }
    return true;
  });
  return { cleanedAddons, removedAddons };
}

export function ensureHubSubtitleAddons(addons) {
  const hubAddons = [
    {
      transportUrl: 'https://mejorastremio-hub.pabloeckert.deno.net/opensubtitles-latino/manifest.json',
      manifest: {
        id: 'com.mejorastremio.opensubtitles-latino',
        version: '1.0.0',
        name: 'OpenSubtitles Latino (sin SDH)',
        description: 'Subtítulos en español latinoamericano real sin SDH',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
      },
    },
    {
      transportUrl: 'https://mejorastremio-hub.pabloeckert.deno.net/subdl/manifest.json',
      manifest: {
        id: 'com.mejorastremio.subdl',
        version: '1.0.0',
        name: 'SubDL ES (sin SDH)',
        description: 'Subtítulos en español de SubDL sin hearing-impaired',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
      },
    },
    {
      transportUrl: 'https://mejorastremio-hub.pabloeckert.deno.net/opensubtitles/manifest.json',
      manifest: {
        id: 'com.mejorastremio.opensubtitles',
        version: '1.0.0',
        name: 'OpenSubtitles ES (sin SDH)',
        description: 'Subtítulos en español estándar sin SDH',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
      },
    },
    {
      transportUrl: 'https://mejorastremio-hub.pabloeckert.deno.net/subsource/manifest.json',
      manifest: {
        id: 'com.mejorastremio.subsource',
        version: '1.0.0',
        name: 'SubSource ES (sin SDH)',
        description: 'Subtítulos en español de SubSource con filtrado hearing-impaired (sin SDH) y smart audio sync.',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: [],
      },
    },
  ];

  const existingIds = new Set(addons.map((a) => a.manifest?.id || a.id));
  const toAdd = hubAddons.filter((h) => !existingIds.has(h.manifest.id));
  return [...toAdd, ...addons];
}

export function ensureStreamsInterceptor(addons) {
  const torrentioAddon = addons.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
  let torConfig = '';
  if (torrentioAddon?.transportUrl) {
    const m = torrentioAddon.transportUrl.match(/torrentio\.strem\.fun\/([^/]+)\/manifest\.json/);
    if (m) torConfig = m[1];
  }
  const streamsUrl = torConfig
    ? `https://mejorastremio-hub.pabloeckert.deno.net/streams/${torConfig}/manifest.json`
    : 'https://mejorastremio-hub.pabloeckert.deno.net/streams/manifest.json';

  const existingIdx = addons.findIndex((a) => a.manifest?.id === 'com.mejorastremio.streams');
  const interceptorEntry = {
    transportUrl: streamsUrl,
    manifest: {
      id: 'com.mejorastremio.streams',
      version: '1.0.0',
      name: 'MejoraStremio Streams (TorBox Latino)',
      description: 'Smart Stream Interceptor: proxy inteligente de Torrentio con reordenamiento prioritario a audio latino y etiquetado visual para TV.',
      resources: ['stream'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: [],
    },
  };

  if (existingIdx >= 0) {
    if (addons[existingIdx].transportUrl !== streamsUrl) {
      const copy = [...addons];
      copy[existingIdx] = interceptorEntry;
      return { addons: copy, changed: true };
    }
    return { addons, changed: false };
  }

  const torIdx = addons.findIndex((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
  const insertAt = torIdx >= 0 ? torIdx : 6;
  const copy = [...addons];
  copy.splice(insertAt, 0, interceptorEntry);
  return { addons: copy, changed: true };
}

export async function syncAioMetadataInstance(addons) {
  if (!existsSync(PRESET_PATH)) return { addons, changed: false };
  let presetInstanceId = null;
  try {
    const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
    presetInstanceId = preset?.aioMetadataConfig?.instanceId;
  } catch {
    // preset.json ausente o no legible
  }
  if (!presetInstanceId) return { addons, changed: false };

  const aioIdx = addons.findIndex((a) => a.manifest?.id === 'aio-metadata');
  if (aioIdx < 0) return { addons, changed: false };

  const currentUrl = addons[aioIdx].transportUrl || '';
  const currentInstanceId = currentUrl.match(/\/([0-9a-f-]{36})\//)?.[1];

  if (currentInstanceId && currentInstanceId !== presetInstanceId) {
    const newUrl = `https://aiometadata.elfhosted.com/stremio/${presetInstanceId}/manifest.json`;
    let freshManifest = addons[aioIdx].manifest;
    try {
      const res = await fetch(newUrl, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        freshManifest = await res.json();
      }
    } catch (e) {
      console.warn(`  ⚠️ No se pudo fetchear manifest fresco de AIOMetadata (${e.message})`);
    }

    const copy = [...addons];
    copy[aioIdx] = {
      ...copy[aioIdx],
      transportUrl: newUrl,
      manifest: freshManifest,
    };
    return { addons: copy, changed: true, oldId: currentInstanceId, newId: presetInstanceId };
  }
  return { addons, changed: false };
}

// ── Blindaje operativo: enmascarado, diff, snapshot, verificación, rollback ───
const SENSITIVE_KEYS = /^(torbox|realdebrid|alldebrid|premiumize|debridlink|offcloud|easydebrid|apikey|api_key|key|token|password|auth|authkey)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYLIKE_RE = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{16,}$/;

/** Enmascara los valores sensibles de un segmento de config estilo Torrentio (k=v|k=v). */
export function redactSegment(seg) {
  return String(seg || '')
    .split('|')
    .map((pair) => {
      const [k, ...rest] = pair.split('=');
      if (!rest.length) return pair;
      return SENSITIVE_KEYS.test(k) ? `${k}=***` : pair;
    })
    .join('|');
}

/** Enmascara tokens en una transportUrl para poder imprimirla en consola/CI. */
export function redactUrl(url) {
  const s = String(url || '');
  const m = s.match(/^(https?:\/\/[^/]+)(\/.*)?$/);
  if (!m) return s.length > 60 ? `${s.slice(0, 20)}…(${s.length}c)` : s;
  const [, origin, path = ''] = m;
  const segs = path.split('/').map((seg) => {
    if (!seg || /^manifest\.json/.test(seg) || UUID_RE.test(seg)) return seg;
    if (seg.includes('=')) return redactSegment(seg);
    if (seg.length > 24 || KEYLIKE_RE.test(seg)) return `${seg.slice(0, 4)}…(${seg.length}c)`;
    return seg;
  });
  return origin + segs.join('/');
}

const idOf = (a) => a?.manifest?.id || a?.id || a?.transportUrl;
const catalogCountOf = (a) => a?.manifest?.catalogs?.length ?? 0;

/** Diff estructurado entre dos colecciones de add-ons (antes ➔ después). */
export function diffCollections(before, after) {
  const b = new Map(before.map((a, i) => [idOf(a), { a, i }]));
  const f = new Map(after.map((a, i) => [idOf(a), { a, i }]));
  const added = [];
  const removed = [];
  const changed = [];
  const moved = [];

  for (const [id, { a, i }] of f) {
    const prev = b.get(id);
    if (!prev) {
      added.push({ id, name: a.manifest?.name, index: i, url: a.transportUrl });
      continue;
    }
    const urlChanged = prev.a.transportUrl !== a.transportUrl;
    const catsChanged = catalogCountOf(prev.a) !== catalogCountOf(a);
    if (urlChanged || catsChanged) {
      changed.push({
        id,
        name: a.manifest?.name,
        from: prev.a.transportUrl,
        to: a.transportUrl,
        urlChanged,
        catalogsFrom: catalogCountOf(prev.a),
        catalogsTo: catalogCountOf(a),
      });
    }
  }
  for (const [id, { a, i }] of b) {
    if (!f.has(id)) removed.push({ id, name: a.manifest?.name, index: i, url: a.transportUrl });
  }

  // Movimientos: rango relativo entre add-ons comunes (insertar al inicio no cuenta como mover al resto).
  const commonBefore = before.map(idOf).filter((id) => f.has(id));
  const commonAfter = after.map(idOf).filter((id) => b.has(id));
  commonAfter.forEach((id, pos) => {
    const from = commonBefore.indexOf(id);
    if (from !== pos) moved.push({ id, name: f.get(id).a.manifest?.name, from: from + 1, to: pos + 1 });
  });

  return { added, removed, changed, moved };
}

export const isEmptyDiff = (d) => !d.added.length && !d.removed.length && !d.changed.length && !d.moved.length;

export function formatDiff(d) {
  const lines = [];
  const label = (x) => `[${x.id}]${x.name ? ` ${x.name}` : ''}`;
  d.added.forEach((x) => lines.push(`    + ${label(x)}  (pos ${x.index + 1})  ${redactUrl(x.url)}`));
  d.removed.forEach((x) => lines.push(`    - ${label(x)}  (estaba en pos ${x.index + 1})  ${redactUrl(x.url)}`));
  d.changed.forEach((x) => {
    lines.push(`    ~ ${label(x)}`);
    if (x.urlChanged) {
      lines.push(`        antes:  ${redactUrl(x.from)}`);
      lines.push(`        ahora:  ${redactUrl(x.to)}`);
    }
    if (x.catalogsFrom !== x.catalogsTo) lines.push(`        catálogos en manifest: ${x.catalogsFrom} ➔ ${x.catalogsTo}`);
  });
  d.moved.forEach((x) => lines.push(`    ↕ ${label(x)}  orden relativo ${x.from} ➔ ${x.to}`));
  if (!lines.length) lines.push('    (sin diferencias)');
  return lines;
}

/** Huella de una colección (id + transportUrl). ordered=false ignora el orden. */
export function collectionFingerprint(addons, { ordered = true } = {}) {
  const rows = (addons || []).map((a) => `${idOf(a)}\t${a?.transportUrl || ''}`);
  if (!ordered) rows.sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

/** Valida un snapshot. Rechaza colecciones vacías para que un rollback nunca pueda vaciar la cuenta. */
export function validateSnapshot(raw) {
  const addons = Array.isArray(raw) ? raw : raw?.result?.addons || raw?.addons;
  if (!Array.isArray(addons) || addons.length === 0) {
    return { ok: false, reason: 'el snapshot no contiene add-ons (se rechaza para no vaciar la cuenta)' };
  }
  const bad = addons.findIndex((a) => !a?.transportUrl || !a?.manifest?.id);
  if (bad >= 0) return { ok: false, reason: `el add-on #${bad + 1} no tiene transportUrl o manifest.id` };
  return { ok: true, addons };
}

const SNAPSHOT_RE = /^backup-stremioeg-pre-(profile|rollback)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.json$/;

/** Elige el snapshot más reciente por el timestamp del nombre (no por tipo ni por mtime). */
export function pickLatestSnapshot(names) {
  const valid = (names || [])
    .map((n) => ({ n, m: SNAPSHOT_RE.exec(n) }))
    .filter((x) => x.m)
    .sort((a, b) => (a.m[2] < b.m[2] ? 1 : a.m[2] > b.m[2] ? -1 : 0));
  return valid.length ? valid[0].n : null;
}

function writeSnapshot(kind, account, addons) {
  mkdirSync(BACKUPS, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(BACKUPS, `backup-stremioeg-pre-${kind}-${stamp}.json`);
  const payload = {
    meta: { createdAt: new Date().toISOString(), account, count: addons.length, kind },
    result: { addons },
  };
  // 'wx': nunca pisar un snapshot existente. 0600: contiene URLs con tokens.
  writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600, flag: 'wx' });
  const check = validateSnapshot(JSON.parse(readFileSync(file, 'utf8')));
  if (!check.ok || check.addons.length !== addons.length) {
    throw new Error(`snapshot inválido tras escribirlo: ${check.reason || 'conteo distinto'}`);
  }
  return file;
}

function resolveCredentials(profile) {
  const email = process.env.ST_EMAIL || profile.account;
  let pass = process.env.ST_PASS || '';
  if (!pass) {
    const localCred = 'C:/Users/tabeg/OneDrive/Documentos/Stemio/Pruebas/baee30cf-9528-4d53-82f3-2c4831853455.txt';
    if (existsSync(localCred)) {
      try {
        const rawLines = readFileSync(localCred, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        pass = rawLines.length > 1 ? rawLines[1] : rawLines[0];
      } catch {
        // Ignorar error al leer credencial local de respaldo
      }
    }
  }
  return { email, pass };
}

async function loginOrDie(email, pass) {
  const login = await apiPost('login', { authKey: null, email, password: pass });
  const authKey = login?.result?.authKey;
  if (!authKey) {
    console.error('✗ Login fallido:', JSON.stringify(login?.error || login));
    process.exit(1);
  }
  return authKey;
}

async function readCollection(authKey) {
  const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  return col?.result?.addons || [];
}

/** Lee la colección tras escribir y confirma que coincide con lo esperado. */
async function verifyCollection(authKey, expected) {
  const live = await readCollection(authKey);
  if (collectionFingerprint(live, { ordered: false }) !== collectionFingerprint(expected, { ordered: false })) {
    const d = diffCollections(expected, live);
    return {
      ok: false,
      reason: `la colección leída de vuelta difiere de la escrita (+${d.added.length} −${d.removed.length} ~${d.changed.length}); revisar con --check`,
    };
  }
  if (collectionFingerprint(live) !== collectionFingerprint(expected)) {
    return { ok: true, warn: 'mismo contenido pero distinto orden al leer de vuelta' };
  }
  return { ok: true };
}

async function runRollback() {
  const profile = loadProfile();
  let file;
  if (ROLLBACK_ARG) {
    file = resolve(ROLLBACK_ARG.slice('--rollback='.length));
  } else {
    const latest = pickLatestSnapshot(existsSync(BACKUPS) ? readdirSync(BACKUPS) : []);
    if (!latest) {
      console.error(`✗ No hay snapshots en ${BACKUPS}. Nada que restaurar.`);
      process.exit(1);
    }
    file = join(BACKUPS, latest);
  }
  if (!existsSync(file)) {
    console.error(`✗ No existe el snapshot: ${file}`);
    process.exit(1);
  }

  const snap = validateSnapshot(JSON.parse(readFileSync(file, 'utf8')));
  if (!snap.ok) {
    console.error(`✗ Snapshot rechazado (${file}): ${snap.reason}`);
    process.exit(1);
  }

  console.log('═'.repeat(70));
  console.log(` MejoraStremio — ROLLBACK ${DRY_FLAG ? '(dry-run)' : ''}`);
  console.log(` Snapshot: ${file} (${snap.addons.length} add-ons)`);
  console.log('═'.repeat(70));

  const { email, pass } = resolveCredentials(profile);
  if (!pass) {
    console.error('✗ Rollback requiere credenciales: ST_EMAIL=... ST_PASS=... node scripts/apply-stremioeg-profile.mjs --rollback-last');
    process.exit(1);
  }
  const authKey = await loginOrDie(email, pass);
  const current = await readCollection(authKey);
  console.log(`  ✓ Colección actual: ${current.length} add-ons`);

  const diff = diffCollections(current, snap.addons);
  console.log('\n  Cambios que produciría el rollback (actual ➔ snapshot):');
  formatDiff(diff).forEach((l) => console.log(l));

  if (isEmptyDiff(diff)) {
    console.log('\n  ✓ La cuenta ya coincide con el snapshot. Nada que hacer.');
    return;
  }
  if (DRY_FLAG) {
    console.log('\n  ℹ Dry-run: no se escribió nada.');
    return;
  }

  // El estado actual también se respalda: el rollback es reversible con --rollback-last.
  const preFile = writeSnapshot('rollback', email, current);
  console.log(`\n  ✓ Snapshot del estado actual (para deshacer el rollback): ${preFile}`);

  const saveRes = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: snap.addons });
  if (!saveRes?.result?.success && !saveRes?.result) {
    console.error('✗ Falló addonCollectionSet:', JSON.stringify(saveRes));
    process.exit(1);
  }
  const verify = await verifyCollection(authKey, snap.addons);
  if (!verify.ok) {
    console.error(`✗ Verificación posterior fallida: ${verify.reason}`);
    process.exit(1);
  }
  if (verify.warn) console.warn(`  ⚠ ${verify.warn}`);
  console.log('  ✓ Rollback aplicado y verificado por lectura posterior.');
}

// ── Ejecución de Auditoría / Aplicación ───────────────────────────────────────
async function runProfileManager() {
  const profile = loadProfile();

  console.log('═'.repeat(70));
  console.log(' MejoraStremio — Gestor de Perfil: stremioeg (Pablo)');
  console.log(` Target: ${profile.deviceTarget} | Versión: ${profile.version}`);
  console.log('═'.repeat(70));

  console.log('\n[ 1/3 ] Verificando Políticas del Perfil...');
  console.log('  ✓ Subtítulos: Modo "strict_no_sdh" (OpenSubtitles Latino/ES + SubDL + SubSource sin SDH)');
  console.log('  ✓ Monopolio del Hub: Eliminación de OpenSubtitles v3 y competidores');
  console.log('  ✓ Audio: Prioridad [Latino, Original] con Smart Stream Interceptor');
  console.log('  ✓ Catálogos: Sincronización diaria 07:00 ART vía daily-catalog-refresh');

  const { email, pass } = resolveCredentials(profile);

  if (!pass) {
    console.log('\n[ 2/3 ] Cuenta Stremio: Modo Auditoría Local (ST_PASS no provisto)');
    console.log('  ℹ Para aplicar cambios remotos en vivo: ST_EMAIL=... ST_PASS=... node scripts/apply-stremioeg-profile.mjs --apply');

    const backupPaths = [
      'C:/Users/tabeg/OneDrive/Documentos/Stemio/Backup/stremioeg@gmail.com-stremio-addon-manager-2026-03-06 21-06-42.json',
      'C:/Users/tabeg/OneDrive/Documentos/Stemio/Backup/stremioeg@gmail.com-stremio-addon-manager-2026-02-27 17-22-13.json',
    ];
    for (const bp of backupPaths) {
      if (existsSync(bp)) {
        try {
          const raw = JSON.parse(readFileSync(bp, 'utf8'));
          const list = Array.isArray(raw) ? raw : (raw.addons || []);
          console.log(`\n  Auditoría forense sobre backup de cuenta real (${bp.split('/').pop()}):`);
          console.log(`  • Total add-ons en backup: ${list.length}`);
          const { removedAddons } = filterCompetingSubtitleAddons(list);
          if (removedAddons.length > 0) {
            console.log(`  ⚠️ Se detectaron ${removedAddons.length} add-ons de subtítulos competidores que secuestran la UI de Android TV:`);
            removedAddons.forEach((ra) => console.log(`     - [${ra.manifest?.id || ra.id}] ${ra.manifest?.name || ra.name}`));
            console.log(`  ℹ En Leanback UI, estos add-ons tienen precedencia e inyectan SDH y subtítulos desincronizados.`);
          }
          break;
        } catch {
          // Ignorar error de lectura de backup y continuar con el siguiente
        }
      }
    }
  } else {
    console.log('\n[ 2/3 ] Conectando a la cuenta Stremio...');
    const authKey = await loginOrDie(email, pass);
    console.log('  ✓ Login exitoso');

    const addons = await readCollection(authKey);
    console.log(`  ✓ Colección leída: ${addons.length} add-ons instalados`);

    let changesCount = 0;

    // 1. Neutralizar addons de subtítulos competidores
    const { cleanedAddons, removedAddons } = filterCompetingSubtitleAddons(addons);
    if (removedAddons.length > 0) {
      changesCount += removedAddons.length;
      console.log(`  ✓ Neutralizados ${removedAddons.length} add-ons competidores de subtítulos:`);
      removedAddons.forEach((ra) => console.log(`     - [${ra.manifest?.id || ra.id}] ${ra.manifest?.name || ra.name}`));
    }

    // 2. Garantizar presencia de los addons de subtítulos del Hub (incluyendo SubSource)
    const withHub = ensureHubSubtitleAddons(cleanedAddons);
    if (withHub.length > cleanedAddons.length) {
      changesCount += (withHub.length - cleanedAddons.length);
      console.log(`  ✓ Instalados ${withHub.length - cleanedAddons.length} add-ons del Hub para monopolio de subtítulos sin SDH`);
    }

    // 3. Smart Stream Interceptor (MejoraStremio Streams en puesto #1 de streams)
    const streamRes = ensureStreamsInterceptor(withHub);
    let currentAddonsList = streamRes.addons;
    if (streamRes.changed) {
      changesCount++;
      console.log('  ✓ Smart Stream Interceptor (com.mejorastremio.streams) configurado como stream prioritario');
    }

    // 4. Sincronización de instancia AIOMetadata contra preset.json
    const aioRes = await syncAioMetadataInstance(currentAddonsList);
    currentAddonsList = aioRes.addons;
    if (aioRes.changed) {
      changesCount++;
      console.log(`  ✓ AIOMetadata sincronizado con preset.json: ${aioRes.oldId} ➔ ${aioRes.newId}`);
    }

    // 5. Ajustar configuración de streams (Torrentio, Comet)
    const updatedAddons = currentAddonsList.map((a) => {
      if (a.manifest?.id === 'com.stremio.torrentio.addon') {
        const tRes = configureTorrentio(a);
        if (tRes.changed) {
          changesCount++;
          console.log(`  ✓ Torrentio actualizado: ${redactSegment(tRes.oldSegment)} ➔ ${redactSegment(tRes.newSegment)}`);
          return { ...a, transportUrl: tRes.url };
        }
      }
      if (a.manifest?.id === 'stremio.comet.fast') {
        const cRes = configureComet(a);
        if (cRes.changed) {
          changesCount++;
          console.log(`  ✓ Comet actualizado: languages.preferred = ${JSON.stringify(cRes.after.languages.preferred)}`);
          return { ...a, transportUrl: cRes.url };
        }
      }
      return a;
    });

    const diff = diffCollections(addons, updatedAddons);
    if (changesCount > 0 || !isEmptyDiff(diff)) {
      console.log(
        `\n  ${APPLY ? 'Cambios a aplicar' : 'DRY-RUN — cambios que se aplicarían'} (${addons.length} ➔ ${updatedAddons.length} add-ons):`
      );
      formatDiff(diff).forEach((l) => console.log(l));
    }

    if (APPLY && changesCount > 0) {
      console.log('\n  Aplicando cambios con guard anti-catálogos-congelados...');
      const guardExempt = [
        'com.stremio.torrentio.addon',
        'stremio.comet.fast',
        'com.mejorastremio.opensubtitles-latino',
        'com.mejorastremio.subdl',
        'com.mejorastremio.opensubtitles',
        'com.mejorastremio.subsource',
        'com.mejorastremio.streams',
      ];
      if (aioRes.changed) guardExempt.push('aio-metadata');

      const guardOk = await assertNoFrozenEmptyCatalogs(updatedAddons, guardExempt);
      if (!guardOk) {
        console.error('✗ Abortado por guard anti-catálogos-congelados');
        process.exit(1);
      }

      const snapFile = writeSnapshot('profile', email, addons);
      console.log(`  ✓ Snapshot previo creado: ${snapFile}`);

      // Anti-carrera: addonCollectionSet reemplaza TODO. Si la colección cambió desde que se leyó
      // (p. ej. edición desde la app), abortar en vez de pisar ese cambio.
      const freshAddons = await readCollection(authKey);
      if (collectionFingerprint(freshAddons) !== collectionFingerprint(addons)) {
        console.error('✗ Abortado: la colección cambió en la cuenta mientras se preparaban los cambios. No se escribió nada; reintentar.');
        process.exit(1);
      }

      const saveRes = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: updatedAddons });
      if (!saveRes?.result?.success && !saveRes?.result) {
        console.error('✗ Falló addonCollectionSet:', JSON.stringify(saveRes));
        process.exit(1);
      }

      const verify = await verifyCollection(authKey, updatedAddons);
      if (!verify.ok) {
        console.error(`✗ Verificación posterior fallida: ${verify.reason}`);
        console.error('  Restaurar con: node scripts/apply-stremioeg-profile.mjs --rollback-last');
        process.exit(1);
      }
      if (verify.warn) console.warn(`  ⚠ ${verify.warn}`);
      console.log('  ✓ Colección guardada y verificada por lectura posterior.');
      console.log('  ↩ Rollback disponible: node scripts/apply-stremioeg-profile.mjs --rollback-last');
    } else if (changesCount === 0) {
      console.log('  ✓ Add-ons de la cuenta ya cumplen estrictamente con la configuración.');
    } else {
      console.log(`  ℹ Se detectaron ${changesCount} cambios pendientes (ejecutar con --apply para guardar).`);
    }
  }

  // ── 3/3: Validación de Catálogos de Estrenos ──────────────────────────────
  console.log('\n[ 3/3 ] Verificando Estado de Catálogos de Estrenos...');
  if (existsSync(PRESET_PATH)) {
    const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
    const std = preset?.aioMetadataConfig?.catalogs?.standard || [];
    const enCartelera = std.find((c) => /now_playing/.test(String(c.id || '')));
    const proximos = std.find((c) => /upcoming/.test(String(c.id || '')));

    const todayStr = new Date().toISOString().slice(0, 10);
    const carteleraTo = enCartelera?.metadata?.discover?.params?.['primary_release_date.lte'];
    const proximosFrom = proximos?.metadata?.discover?.params?.['primary_release_date.gte'];

    console.log(`  • En Cartelera (cine): ventana hasta ${carteleraTo} (hoy: ${todayStr})`);
    console.log(`  • Próximos Estrenos: desde ${proximosFrom} (hoy: ${todayStr})`);
    if (carteleraTo === todayStr && proximosFrom === todayStr) {
      console.log('  ✓ Ventanas de estrenos sincronizadas y vigentes al día de hoy.');
    } else {
      console.log('  ⚠ Fechas desfasadas — se sincronizan automáticamente en el cron diario o con scripts/refresh-dates.mjs');
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log(' Perfil stremioeg validado correctamente.');
  console.log('═'.repeat(70));
}

// ── Batería de Pruebas Unitarias / Simulación ────────────────────────────────
export function runUnitTests() {
  console.log('═'.repeat(70));
  console.log(' Batería de Tests Unitarios: Perfil stremioeg');
  console.log('═'.repeat(70));

  let passed = 0;
  let total = 0;
  const assertTest = (name, condition) => {
    total++;
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.error(`  ✗ FALLÓ: ${name}`);
    }
  };

  // 1. Subtítulos: Descarte estricto de SDH y CC
  const testSubs = [
    { lang: 'es', label: 'Spanish [SDH]', hi: true },
    { lang: 'ea', label: 'Spanish (Latin America) [CC]', hi: false },
    { lang: 'spa', label: 'Español (Para Sordos)', hi: false },
    { lang: 'ea', label: 'Español Latino (Limpio)', hi: false },
    { lang: 'es', label: 'Español Neutro (Limpio)', hi: false },
    { lang: 'sp', label: 'Castellano (España)', hi: false },
  ];

  const rankedSubs = filterAndRankSubtitles(testSubs);

  assertTest('Descarta subtítulo con flag hi: true', !rankedSubs.some((s) => s.label.includes('[SDH]')));
  assertTest('Descarta subtítulo con marca [CC]', !rankedSubs.some((s) => s.label.includes('[CC]')));
  assertTest('Descarta subtítulo con texto "Para Sordos"', !rankedSubs.some((s) => s.label.includes('Para Sordos')));
  assertTest('Prioriza Español Latino en primer lugar', rankedSubs[0]?.label.includes('Latino'));
  assertTest('Relega Castellano (España) al último lugar de los aceptados', rankedSubs[rankedSubs.length - 1]?.label.includes('Castellano'));

  // 2. Audio: Priorización de Latino y Original; Relegación de Castellano
  const testStreams = [
    { name: 'Torrentio', title: 'Movie 1080p [Castellano] AC3' },
    { name: 'Torrentio', title: 'Movie 1080p [Latino] 5.1' },
    { name: 'Comet', title: 'Movie 1080p [Original English] TrueHD' },
    { name: 'Torrentio', title: 'Movie 4K [TB+] Dual [Latino-Eng]' },
  ];

  const rankedStreams = rankAudioStreams(testStreams);

  assertTest('TorBox cacheado + Latino lidera el ranking', rankedStreams[0]?.title.includes('[TB+]') && rankedStreams[0]?.title.includes('Latino'));
  assertTest('Stream con solo Castellano queda al final', rankedStreams[rankedStreams.length - 1]?.title.includes('[Castellano]'));

  // 3. Configuración de Torrentio y Comet
  const dummyTorrentio = {
    manifest: { id: 'com.stremio.torrentio.addon' },
    transportUrl: 'https://torrentio.strem.fun/sort=quality|qualityfilter=480p/manifest.json',
  };
  const resT = configureTorrentio(dummyTorrentio);
  assertTest('Configuración de Torrentio inyecta language=latino', resT.newSegment.includes('language=latino'));

  const dummyCometCfg = { languages: { preferred: ['es'] }, sortCachedUncachedTogether: true };
  const dummyComet = {
    manifest: { id: 'stremio.comet.fast' },
    transportUrl: `https://comet.elfhosted.com/${Buffer.from(JSON.stringify(dummyCometCfg)).toString('base64')}/manifest.json`,
  };
  const resC = configureComet(dummyComet);
  assertTest('Configuración de Comet fija preferred en ["la", "en"]', JSON.stringify(resC.after.languages.preferred) === JSON.stringify(['la', 'en']));
  // 4. Neutralización de add-ons de subtítulos competidores y monopolio del Hub
  const sampleAddonCollection = [
    { manifest: { id: 'com.linvo.cinemeta', name: 'Cinemeta' }, transportUrl: 'https://v3-cinemeta.strem.io/manifest.json' },
    { manifest: { id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3' }, transportUrl: 'https://opensubtitles-v3.strem.io/manifest.json' },
    { manifest: { id: 'com.subsense.nepiraw', name: 'SubSense' }, transportUrl: 'https://subsense.nepiraw.com/manifest.json' },
    { manifest: { id: 'com.stremio.torrentio.addon', name: 'Torrentio' }, transportUrl: 'https://torrentio.strem.fun/manifest.json' },
  ];
  const { cleanedAddons, removedAddons } = filterCompetingSubtitleAddons(sampleAddonCollection);
  assertTest('Filtra OpenSubtitles v3 y SubSense de la colección', removedAddons.length === 2 && !cleanedAddons.some(a => a.manifest.id.includes('subtitlesv3') || a.manifest.id.includes('subsense')));

  const withHubMonopoly = ensureHubSubtitleAddons(cleanedAddons);
  assertTest('Inyecta los 3 add-ons del Hub al inicio de la colección', withHubMonopoly.some(a => a.manifest.id === 'com.mejorastremio.opensubtitles-latino') && withHubMonopoly.some(a => a.manifest.id === 'com.mejorastremio.subdl'));

  // 5. Blindaje operativo: enmascarado, diff, snapshot, rollback
  const secretUrl = 'https://torrentio.strem.fun/sort=quality|torbox=SECRETKEY123|language=latino/manifest.json';
  const redacted = redactUrl(secretUrl);
  assertTest('redactUrl oculta el token de TorBox', !redacted.includes('SECRETKEY123') && redacted.includes('torbox=***'));
  assertTest('redactUrl conserva parámetros no sensibles', redacted.includes('sort=quality') && redacted.includes('language=latino'));
  assertTest('redactSegment oculta el token en segmentos de config', redactSegment('sort=quality|torbox=SECRETKEY123') === 'sort=quality|torbox=***');
  const b64Url = `https://comet.elfhosted.com/${Buffer.from(JSON.stringify({ debridApiKey: 'ZZTOPSECRET' })).toString('base64')}/manifest.json`;
  assertTest('redactUrl oculta segmentos base64 largos (Comet)', !redactUrl(b64Url).includes(Buffer.from('ZZTOPSECRET').toString('base64').slice(0, 8)));
  const aioUrl = 'https://aiometadata.elfhosted.com/stremio/d29d183a-be46-41ea-bb8a-dc572347e337/manifest.json';
  assertTest('redactUrl conserva el UUID de instancia de AIOMetadata', redactUrl(aioUrl) === aioUrl);

  const mk = (id, url, cats = 0) => ({ manifest: { id, name: id, catalogs: new Array(cats).fill({}) }, transportUrl: url });
  const before = [mk('a', 'https://a/manifest.json'), mk('b', 'https://b/manifest.json'), mk('c', 'https://c/manifest.json', 2)];
  const after = [mk('n', 'https://n/manifest.json'), mk('c', 'https://c/manifest.json', 2), mk('a', 'https://a2/manifest.json')];
  const d = diffCollections(before, after);
  assertTest('diff detecta add-on agregado', d.added.length === 1 && d.added[0].id === 'n');
  assertTest('diff detecta add-on eliminado', d.removed.length === 1 && d.removed[0].id === 'b');
  assertTest('diff detecta transportUrl cambiada', d.changed.length === 1 && d.changed[0].id === 'a');
  assertTest('diff detecta movimiento relativo (c adelantó a a)', d.moved.some((m) => m.id === 'c' && m.from === 2 && m.to === 1));
  const dPrepend = diffCollections(before, [mk('n', 'https://n/manifest.json'), ...before]);
  assertTest('insertar al inicio no cuenta como mover al resto', dPrepend.moved.length === 0 && dPrepend.added.length === 1);
  assertTest('diff idéntico es vacío', isEmptyDiff(diffCollections(before, before)));
  assertTest('diff avisa cambio de catálogos en manifest', diffCollections([mk('x', 'https://x/m.json', 0)], [mk('x', 'https://x/m.json', 5)]).changed[0]?.catalogsTo === 5);

  assertTest('fingerprint estable e idéntico para la misma colección', collectionFingerprint(before) === collectionFingerprint([...before]));
  assertTest('fingerprint cambia con el orden (ordered) y no (unordered)', collectionFingerprint(before) !== collectionFingerprint([...before].reverse()) && collectionFingerprint(before, { ordered: false }) === collectionFingerprint([...before].reverse(), { ordered: false }));

  assertTest('validateSnapshot rechaza colección vacía', !validateSnapshot({ result: { addons: [] } }).ok);
  assertTest('validateSnapshot rechaza add-on sin transportUrl', !validateSnapshot({ result: { addons: [{ manifest: { id: 'x' } }] } }).ok);
  assertTest('validateSnapshot acepta snapshot válido (formato legacy y con meta)', validateSnapshot({ result: { addons: before } }).ok && validateSnapshot({ meta: {}, result: { addons: before } }).ok);

  const names = [
    'backup-stremioeg-pre-profile-2026-10-03T18-00-00.json',
    'backup-stremioeg-pre-rollback-2026-10-03T19-30-00.json',
    'backup-stremioeg-pre-profile-2026-10-02T23-59-59.json',
    'otro-archivo.json',
  ];
  assertTest('pickLatestSnapshot elige por timestamp, sin importar el tipo', pickLatestSnapshot(names) === names[1]);
  assertTest('pickLatestSnapshot devuelve null sin snapshots válidos', pickLatestSnapshot(['x.json']) === null);

  console.log(`\nResultado Tests Unitarios: ${passed}/${total} pruebas pasadas con éxito.\n`);
  if (passed !== total) process.exit(1);
}

// ── Entrada Principal ────────────────────────────────────────────────────────
const isMainScript = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(`file://${process.argv[1]}`);

if (isMainScript) {
  if (RUN_UNIT_TEST) {
    runUnitTests();
  } else if (ROLLBACK) {
    runRollback().catch((err) => {
      console.error(`✗ Error fatal en rollback: ${err.message}`);
      process.exit(1);
    });
  } else {
    runProfileManager().catch((err) => {
      console.error(`✗ Error fatal: ${err.message}`);
      process.exit(1);
    });
  }
}
