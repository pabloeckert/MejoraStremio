#!/usr/bin/env node
/**
 * community-radar.mjs — Radar de versiones de add-ons comunitarios de Stremio.
 *
 * Consulta periódicamente GitHub (Releases / Tags / Commits) y manifests de los
 * principales add-ons de la comunidad Stremio para detectar nuevas versiones,
 * cambios importantes o actualizaciones de compatibilidad.
 *
 * Persiste el último estado conocido en data/community-radar-state.json para
 * registrar solo las novedades entre corridas.
 *
 * Opciones CLI:
 *   --check / --dry-run   Consulta e informa sin persistir cambios en el estado.
 *   --category <cat>      Filtra por categoría (Streams, Metadatos, Subtítulos, Ecosistema).
 *   --json                Imprime la salida estructurada en JSON.
 *   --verbose             Muestra detalles adicionales (notas de la release).
 *
 * Variables de entorno:
 *   GITHUB_TOKEN          Token de GitHub opcional (para evitar rate-limits de 60 req/h;
 *                         GitHub Actions provee secrets.GITHUB_TOKEN automáticamente).
 *
 * Node >= 20, sin dependencias externas.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_PATH = join(ROOT, 'data', 'community-radar-state.json');

// Catálogo curado de add-ons clave en el ecosistema Stremio
export const COMMUNITY_ADDONS = [
  // ── Streams & Debrid Providers ─────────────────────────────────────────────
  {
    id: 'torrentio',
    name: 'Torrentio',
    repo: 'TheBeastLT/torrentio-scraper',
    category: 'Streams',
    manifestUrl: 'https://torrentio.strem.fun/manifest.json',
    description: 'Scraper de torrents y proveedores Debrid (Torbox, RealDebrid, AllDebrid)',
  },
  {
    id: 'comet',
    name: 'Comet',
    repo: 'g0ldyy/comet',
    category: 'Streams',
    manifestUrl: 'https://comet.elfhosted.com/manifest.json',
    description: 'Add-on veloz de torrents/Debrid en Python con soporte StremThru',
  },
  {
    id: 'mediafusion',
    name: 'MediaFusion',
    repo: 'mhdzumair/MediaFusion',
    category: 'Streams',
    manifestUrl: 'https://mediafusion.elfhosted.com/manifest.json',
    description: 'Add-on multipropósito: cine, series, TV en vivo y eventos deportivos',
  },
  {
    id: 'aiostreams',
    name: 'AIOStreams',
    repo: 'Viren070/AIOStreams',
    category: 'Streams',
    description: 'Agregador de streams configurable con filtrado y balanceo',
  },
  {
    id: 'stremthru',
    name: 'StremThru',
    repo: 'MunifTanjim/stremthru',
    category: 'Streams',
    description: 'Proxy y túnel de Debrid/Store para add-ons comunitarios',
  },
  {
    id: 'jackettio',
    name: 'Jackettio',
    repo: 'arvida42/jackettio',
    category: 'Streams',
    description: 'Integración de Jackett con resolución Debrid para Stremio',
  },
  {
    id: 'stremio-jackett',
    name: 'Stremio-Jackett',
    repo: 'aymene69/stremio-jackett',
    category: 'Streams',
    description: 'Add-on de búsqueda torrent/Debrid vía Jackett/Prowlarr',
  },

  // ── Catálogos & Metadatos ──────────────────────────────────────────────────
  {
    id: 'aiometadata',
    name: 'AIOMetadata',
    repo: 'cedya77/aiometadata',
    category: 'Metadatos',
    description: 'Metadatos unificados multicatálogo (TMDB, TVDb, Kitsu, Trakt)',
  },
  {
    id: 'stremio-official-addons',
    name: 'Stremio Official Addons',
    repo: 'Stremio/stremio-official-addons',
    category: 'Metadatos',
    description: 'Add-ons oficiales de Stremio (Cinemeta, WatchHub, catálogos base)',
  },

  // ── Subtítulos ─────────────────────────────────────────────────────────────
  {
    id: 'subsense',
    name: 'SubSense',
    repo: 'NepiRaw/Stremio-SubSense',
    category: 'Subtítulos',
    description: 'Agregador inteligente de subtítulos (SubDL, OpenSubtitles, SubSource)',
  },
  {
    id: 'submaker',
    name: 'StremioSubMaker',
    repo: 'xtremexq/StremioSubMaker',
    category: 'Subtítulos',
    description: 'Buscador y traductor automatizado de subtítulos con IA',
  },
  {
    id: 'community-subtitles',
    name: 'Stremio Community Subtitles',
    repo: 'skoruppa/stremio-community-subtitles',
    category: 'Subtítulos',
    description: 'Subtítulos sincronizados aportados por la comunidad',
  },

  // ── Aplicación & Ecosistema ────────────────────────────────────────────────
  {
    id: 'stremio-web',
    name: 'Stremio Web',
    repo: 'Stremio/stremio-web',
    category: 'Ecosistema',
    description: 'Cliente web oficial de Stremio (web.strem.io)',
  },
];

// Helpers de parseo y CLI
const args = process.argv.slice(2);
const isDryRun = args.includes('--check') || args.includes('--dry-run');
const isVerbose = args.includes('--verbose') || args.includes('-v');
const isJsonOutput = args.includes('--json');
const categoryIndex = args.indexOf('--category');
const filterCategory = categoryIndex !== -1 ? args[categoryIndex + 1]?.toLowerCase() : null;

let GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
if (!GITHUB_TOKEN) {
  try {
    const { execSync } = await import('node:child_process');
    GITHUB_TOKEN = execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
  } catch {
    // gh no disponible o sin autenticar
  }
}

const getHeaders = () => {
  const h = {
    'User-Agent': 'MejoraStremio-CommunityRadar/1.0',
    Accept: 'application/vnd.github.v3+json',
  };
  if (GITHUB_TOKEN) {
    h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }
  return h;
};

let rateLimitWarned = false;

const getJson = async (url, timeoutMs = 15000) => {
  try {
    const res = await fetch(url, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Monitoreo de cuota de la API de GitHub
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining !== null && Number(remaining) < 5 && !rateLimitWarned) {
      if (Number(remaining) === 0) {
        console.warn('  ⚠ GitHub API: Límite de solicitudes alcanzado (rate limit agotado).');
        rateLimitWarned = true;
      } else {
        console.warn(`  ⚠ GitHub API: Quedan ${remaining} solicitudes disponibles antes del límite.`);
      }
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      const msg = errData?.message || res.statusText;
      return { ok: false, status: res.status, statusText: msg };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { lastRun: null, addons: {} };
  }
  try {
    const raw = readFileSync(STATE_PATH, 'utf8').trim();
    if (!raw) return { lastRun: null, addons: {} };
    return JSON.parse(raw);
  } catch {
    return { lastRun: null, addons: {} };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function checkAddonVersion(addon) {
  const result = {
    id: addon.id,
    name: addon.name,
    repo: addon.repo,
    category: addon.category,
    version: null,
    sourceType: null, // 'release' | 'tag' | 'commit'
    title: null,
    publishedAt: null,
    url: `https://github.com/${addon.repo}`,
    notesSnippet: null,
    manifestVersion: null,
    error: null,
  };

  // 1. Intentar consultar Latest Release oficial en GitHub
  const releaseRes = await getJson(`https://api.github.com/repos/${addon.repo}/releases/latest`);
  if (releaseRes.ok && releaseRes.data?.tag_name) {
    const rel = releaseRes.data;
    result.version = rel.tag_name;
    result.sourceType = 'release';
    result.title = rel.name || rel.tag_name;
    result.publishedAt = rel.published_at || rel.created_at;
    result.url = rel.html_url || `https://github.com/${addon.repo}/releases/tag/${rel.tag_name}`;
    if (rel.body) {
      result.notesSnippet = rel.body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .slice(0, 3)
        .join('; ');
    }
  } else {
    // 2. Fallback a Tags si el repositorio no publica Releases formales
    const tagsRes = await getJson(`https://api.github.com/repos/${addon.repo}/tags?per_page=1`);
    if (tagsRes.ok && Array.isArray(tagsRes.data) && tagsRes.data.length > 0) {
      const tag = tagsRes.data[0];
      result.version = tag.name;
      result.sourceType = 'tag';
      result.title = tag.name;
      result.url = `https://github.com/${addon.repo}/tree/${tag.name}`;
    } else {
      // 3. Fallback a Commits en rama principal si no usa versionado por tags
      const commitsRes = await getJson(`https://api.github.com/repos/${addon.repo}/commits?per_page=1`);
      if (commitsRes.ok && Array.isArray(commitsRes.data) && commitsRes.data.length > 0) {
        const commit = commitsRes.data[0];
        const shaShort = (commit.sha || '').slice(0, 7);
        result.version = `commit-${shaShort}`;
        result.sourceType = 'commit';
        result.title = commit.commit?.message?.split('\n')[0] || shaShort;
        result.publishedAt = commit.commit?.committer?.date || commit.commit?.author?.date;
        result.url = commit.html_url || `https://github.com/${addon.repo}/commit/${commit.sha}`;
      } else {
        result.error = releaseRes.error || releaseRes.statusText || 'No se pudo obtener versión de GitHub';
      }
    }
  }

  // 4. Si tiene endpoint de manifest público configurado, consultar versión en vivo
  if (addon.manifestUrl) {
    try {
      const mfRes = await fetch(addon.manifestUrl, { signal: AbortSignal.timeout(8000) });
      if (mfRes.ok) {
        const mf = await mfRes.json();
        if (mf?.version) {
          result.manifestVersion = mf.version;
        }
      }
    } catch {
      // No consideramos error fatal si el host público del manifest falla puntualmente
    }
  }

  return result;
}

// ── Ejecución Principal ──────────────────────────────────────────────────────
async function main() {
  const state = loadState();
  const stateAddons = state.addons || {};

  const targetAddons = filterCategory
    ? COMMUNITY_ADDONS.filter((a) => a.category.toLowerCase() === filterCategory)
    : COMMUNITY_ADDONS;

  if (!isJsonOutput) {
    console.log('═'.repeat(65));
    console.log(' MejoraStremio — Radar de Add-ons Comunitarios');
    console.log(' ' + new Date().toISOString());
    console.log('═'.repeat(65));
    if (isDryRun) console.log(' Modo: DRY-RUN (--check) — No se guardará el estado');
    if (!GITHUB_TOKEN) console.log(' ℹ GITHUB_TOKEN no presente: usando solicitudes públicas (rate-limit 60/h)\n');
    else console.log(' ✓ GITHUB_TOKEN autenticado\n');
  }

  const updates = [];
  const results = [];

  for (const addon of targetAddons) {
    const info = await checkAddonVersion(addon);
    results.push(info);

    const previous = stateAddons[addon.id];
    const hasChanged = previous && previous.version && info.version && previous.version !== info.version;
    const isNewRegistration = !previous || !previous.version;

    if (info.error) {
      if (!isJsonOutput) {
        console.log(`  ⚠ [${addon.category}] ${addon.name}: ${info.error}`);
      }
    } else if (hasChanged) {
      updates.push({
        id: addon.id,
        name: addon.name,
        category: addon.category,
        oldVersion: previous.version,
        newVersion: info.version,
        sourceType: info.sourceType,
        publishedAt: info.publishedAt,
        url: info.url,
        notes: info.notesSnippet,
        manifestVersion: info.manifestVersion,
      });

      if (!isJsonOutput) {
        console.log(`  🎉 [${addon.category}] ${addon.name}: ¡NUEVA ACTUALIZACIÓN!`);
        console.log(`     Versión: ${previous.version} ➔ ${info.version} (${info.sourceType})`);
        if (info.manifestVersion) console.log(`     Manifest en vivo: v${info.manifestVersion}`);
        if (info.publishedAt) console.log(`     Publicado: ${info.publishedAt}`);
        console.log(`     Enlace: ${info.url}`);
        if (info.notesSnippet && isVerbose) console.log(`     Notas: ${info.notesSnippet}`);
      }
    } else if (isNewRegistration) {
      if (!isJsonOutput) {
        const liveInfo = info.manifestVersion ? ` [manifest live: v${info.manifestVersion}]` : '';
        console.log(`  ✓ [${addon.category}] ${addon.name}: ${info.version} (${info.sourceType})${liveInfo} — registrado`);
      }
    } else {
      if (!isJsonOutput) {
        const liveInfo = info.manifestVersion ? ` [manifest: v${info.manifestVersion}]` : '';
        console.log(`  ✓ [${addon.category}] ${addon.name}: ${info.version}${liveInfo} (al día)`);
      }
    }

    // Actualizar registro en estado para este addon
    if (!info.error && info.version) {
      stateAddons[addon.id] = {
        name: addon.name,
        repo: addon.repo,
        category: addon.category,
        version: info.version,
        sourceType: info.sourceType,
        publishedAt: info.publishedAt || null,
        url: info.url,
        manifestVersion: info.manifestVersion || null,
        lastChecked: new Date().toISOString(),
      };
    }

    // Pausa breve para cuidar rate-limit de GitHub
    await new Promise((res) => setTimeout(res, 250));
  }

  // Guardar estado a menos que sea dry-run
  if (!isDryRun) {
    state.lastRun = new Date().toISOString();
    state.addons = stateAddons;
    saveState(state);
  }

  if (isJsonOutput) {
    console.log(JSON.stringify({ lastRun: new Date().toISOString(), updates, results }, null, 2));
    return;
  }

  console.log('\n' + '─'.repeat(65));
  if (updates.length > 0) {
    console.log(` Resumen: ${targetAddons.length} add-ons consultados | ${updates.length} ACTUALIZACIÓN(ES) DETECTADA(S):`);
    for (const u of updates) {
      console.log(`   • ${u.name} (${u.category}): ${u.oldVersion} ➔ ${u.newVersion} — ${u.url}`);
    }
  } else {
    console.log(` Resumen: ${targetAddons.length} add-ons consultados | Todos al día (0 actualizaciones nuevas)`);
  }
  console.log('─'.repeat(65));
}

main().catch((err) => {
  console.error(`✗ Error fatal en community-radar: ${err.message}`);
  process.exit(1);
});
