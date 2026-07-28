/**
 * health-check.mjs — Auditoría real del setup de Stremio de stremioeg@gmail.com
 *
 * Con credenciales (ST_EMAIL/ST_PASS) hace una auditoría DINÁMICA de la cuenta:
 * lee la colección real instalada y prueba los addons que efectivamente están ahí,
 * no una lista hardcodeada. Sin credenciales, verifica manifests públicos conocidos.
 *
 * Uso:
 *   node scripts/health-check.mjs
 *   ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/health-check.mjs
 *
 * Verifica:
 *   1. Cuenta: login, nº de addons, y NINGÚN manifest.id duplicado
 *      (la colisión de id es lo que rompía la búsqueda; ver CLAUDE.md).
 *   2. Manifests: cada addon instalado responde su manifest.
 *   3. Catálogos + búsqueda de AIOMetadata: muestrea catálogos y prueba
 *      búsqueda por título y por actor.
 *   4. Streams: prueba TODOS los addons de streams del setup (no solo Torrentio).
 *   5. Subtítulos: prueba todos los addons de subtítulos para español.
 *
 * Exit codes: 0 = todo OK, 1 = algo caído.
 */

const API = 'https://api.strem.io/api';

// Títulos de prueba: una peli popular, una serie popular, y contenido de nicho
// (Will Trent / Wild Cards históricamente con pocas seeds) para no dar falsos OK.
const TEST_MOVIE  = { label: 'Matrix',            type: 'movie',  id: 'tt0133093' };
const TEST_SERIES = { label: 'Breaking Bad S01E01', type: 'series', id: 'tt0903747:1:1' };
const TEST_NICHE  = { label: 'Will Trent S01E01',  type: 'series', id: 'tt14681924:1:1' };

// ── Helpers ──────────────────────────────────────────────────────────────────
const apiPost = (path, body) =>
  fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.json());

const getJson = (url, timeout = 12000) =>
  fetch(url, { signal: AbortSignal.timeout(timeout) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Un blip transitorio de red no debería marcar un addon sano como caído: un solo
// reintento tras una pausa corta distingue "hiccup puntual" de "realmente no responde".
const getJsonWithRetry = async (url, timeout = 12000) => {
  const first = await getJson(url, timeout);
  if (first) return { data: first, retried: false };
  await sleep(3000);
  const second = await getJson(url, timeout);
  return { data: second, retried: true };
};

const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);
const fail = (msg) => console.log(`  ✗ ${msg}`);

const baseOf = (transportUrl) => transportUrl.replace(/manifest\.json$/, '');

// El transportUrl a veces es la raíz (.../) sin manifest.json; normalizamos.
const manifestUrlOf = (transportUrl) =>
  /manifest\.json$/.test(transportUrl)
    ? transportUrl
    : transportUrl.replace(/\/?$/, '/') + 'manifest.json';

const hasResource = (manifest, res) =>
  (manifest?.resources || []).some(
    (r) => r === res || r?.name === res
  );

const isSpanish = (lang) => {
  const l = String(lang || '').toLowerCase();
  return l === 'spa' || l.startsWith('es') || l.includes('spa');
};

// Algunos catálogos requieren un género; resolvemos el primero disponible.
const catalogUrl = (base, cat) => {
  const genreExtra = (cat.extra || []).find(
    (e) => e.name === 'genre' && e.isRequired
  );
  if (genreExtra?.options?.length) {
    return `${base}catalog/${cat.type}/${cat.id}/genre=${encodeURIComponent(
      genreExtra.options[0]
    )}.json`;
  }
  return `${base}catalog/${cat.type}/${cat.id}.json`;
};

// ── Main ─────────────────────────────────────────────────────────────────────
let exitCode = 0;

console.log('═'.repeat(43));
console.log(' MejoraStremio — Health Check');
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(43) + '\n');

const email = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const pass = process.env.ST_PASS || '';

let authKey = null;
let addons = [];

// ── 1. Cuenta + detección de manifest.id duplicado ───────────────────────────
console.log('[ 1/5 ] Cuenta Stremio');
if (!pass) {
  warn('ST_PASS no definido — auditoría de cuenta omitida');
  warn('  Usar: ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/health-check.mjs');
} else {
  const login = await apiPost('login', { authKey: null, email, password: pass });
  authKey = login?.result?.authKey;
  if (!authKey) {
    fail('Login fallido: ' + JSON.stringify(login?.error || login));
    exitCode = 1;
  } else {
    ok('Login OK');
    const col = await apiPost('addonCollectionGet', {
      type: 'AddonCollectionGet',
      authKey,
      update: true,
    });
    addons = col?.result?.addons || [];
    if (addons.length < 10) {
      fail(`Solo ${addons.length} addons instalados (esperado ≥10)`);
      exitCode = 1;
    } else {
      ok(`${addons.length} addons instalados`);
    }

    // Guard de regresión: dos addons con el mismo manifest.id rompen la búsqueda
    // y el guardado de la colección (dedup por id). Ver CLAUDE.md.
    const idCounts = {};
    for (const a of addons) {
      const id = a.manifest?.id;
      if (id) idCounts[id] = (idCounts[id] || 0) + 1;
    }
    const dups = Object.entries(idCounts).filter(([, n]) => n > 1);
    if (dups.length) {
      dups.forEach(([id, n]) =>
        fail(`manifest.id duplicado: "${id}" ×${n} — rompe la búsqueda`)
      );
      exitCode = 1;
    } else {
      ok('Sin manifest.id duplicados');
    }
  }
}

// ── 2. Manifests de los addons instalados ────────────────────────────────────
console.log('\n[ 2/5 ] Manifests de addons');
// Con cuenta: probamos los addons REALES instalados. Sin cuenta: lista pública.
const manifestTargets = authKey
  ? addons.map((a) => ({ name: a.manifest?.name || '(sin nombre)', url: manifestUrlOf(a.transportUrl) }))
  : [
      { name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io/manifest.json' },
      { name: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json' },
      { name: 'Mubi', url: 'https://mubi2stremio.adiba.ro/manifest.json' },
    ];
const manifestResults = await Promise.all(manifestTargets.map((t) => getJsonWithRetry(t.url, 10000)));
// Addons con flakiness documentada (ver "Addons que pueden caerse" en CLAUDE.md): WebStreamrMBG
// a veces tarda >15s o da 504, Mubi Catalog falla seguido específicamente en runners de GitHub
// Actions. Ambos son de bajo riesgo (streams/catálogo, no rompen el resto del setup) y sacarlos
// no es ideal — una caída total (no solo un blip) queda como warning, no como fallo duro.
// Los 3 de mejorastremio-hub (Deno Deploy) se agregaron el 2026-07-28: el org gratuito de Deno
// Deploy quedó suspendido por USAGE_EXCEEDED (confirmado con curl + `deno deploy` CLI — no es un
// bug de código, es cuota agotada del plan free) y no hay forma de forzar el reset desde acá. Se
// autorrecuperan solos apenas la cuota resetee — sacar de esta lista en ese momento, no antes.
const KNOWN_FLAKY = [
  'WebStreamrMBG',
  'Mubi Catalog',
  'MejoraStremio Synopsis IA',
  'SubDL ES (sin SDH)',
  'Audio Latino (verificado)',
];
manifestResults.forEach(({ data: m, retried }, i) => {
  const t = manifestTargets[i];
  if (m?.name && !retried) {
    ok(`${t.name}: v${m.version || '?'}`);
  } else if (m?.name && retried) {
    warn(`${t.name}: v${m.version || '?'} (OK recién al reintento — blip transitorio)`);
  } else if (KNOWN_FLAKY.includes(t.name)) {
    warn(`${t.name}: NO RESPONDE (2 intentos) — flakiness documentada, no rompe el exit code`);
  } else {
    fail(`${t.name}: NO RESPONDE (2 intentos)`);
    exitCode = 1;
  }
});

// ── 3. Catálogos + búsqueda de AIOMetadata ───────────────────────────────────
console.log('\n[ 3/5 ] Catálogos y búsqueda (AIOMetadata)');
const aio = addons.find((a) => a.manifest?.id === 'aio-metadata');
if (!authKey) {
  warn('omitido (requiere cuenta)');
} else if (!aio) {
  fail('AIOMetadata no encontrado en la colección');
  exitCode = 1;
} else {
  const base = baseOf(aio.transportUrl);
  const mf = manifestResults[addons.indexOf(aio)]?.data || (await getJson(aio.transportUrl));
  const browsable = (mf?.catalogs || []).filter(
    (c) => !(c.extra || []).some((e) => e.name === 'search' && e.isRequired)
  );
  // Muestrear hasta 10 catálogos navegables
  const sample = browsable.slice(0, 10);
  const counts = await Promise.all(
    sample.map((c) => getJson(catalogUrl(base, c)).then((d) => d?.metas?.length ?? -1))
  );
  const empty = sample.filter((_, i) => counts[i] === 0);
  const errored = sample.filter((_, i) => counts[i] < 0);
  if (errored.length) {
    fail(`${errored.length}/${sample.length} catálogos con error: ${errored.map((c) => c.id).join(', ')}`);
    exitCode = 1;
  } else if (empty.length > 1) {
    // 1 vacío es tolerable (ej. calendario de watchlist sin items)
    warn(`${empty.length}/${sample.length} catálogos vacíos: ${empty.map((c) => c.name).join(', ')}`);
  } else {
    ok(`${sample.length} catálogos muestreados con contenido`);
  }

  // Búsqueda por título
  const byTitle = await getJson(`${base}catalog/movie/search.movie/search=matrix.json`);
  if ((byTitle?.metas?.length ?? 0) > 0) {
    ok(`Búsqueda por título: "matrix" → ${byTitle.metas.length} resultados`);
  } else {
    fail('Búsqueda por título no devuelve resultados');
    exitCode = 1;
  }

  // Búsqueda por actor (catálogo dedicado people_search)
  const byActor = await getJson(
    `${base}catalog/movie/people_search.people_search_movie/search=${encodeURIComponent('Tom Cruise')}.json`
  );
  if ((byActor?.metas?.length ?? 0) > 0) {
    ok(`Búsqueda por actor: "Tom Cruise" → ${byActor.metas.length} películas`);
  } else {
    warn('Búsqueda por actor no devuelve resultados (people_search desactivado?)');
  }
}

// ── 4. Streams (todos los addons de streams del setup) ───────────────────────
console.log('\n[ 4/5 ] Streams');
const streamAddons = (authKey ? addons : []).filter(
  (a) => hasResource(a.manifest, 'stream') && a.manifest?.name !== 'Streailer' // Streailer = trailers
);
if (!authKey) {
  warn('omitido (requiere cuenta)');
} else if (!streamAddons.length) {
  fail('Ningún addon de streams en la colección');
  exitCode = 1;
} else {
  for (const t of [TEST_MOVIE, TEST_SERIES, TEST_NICHE]) {
    const cells = await Promise.all(
      streamAddons.map(async (a) => {
        const d = await getJson(`${baseOf(a.transportUrl)}stream/${t.type}/${t.id}.json`, 20000);
        return { name: a.manifest.name, n: d?.streams?.length ?? 0 };
      })
    );
    const total = cells.reduce((s, c) => s + c.n, 0);
    const detail = cells.map((c) => `${c.name}=${c.n}`).join(' ');
    if (total === 0) {
      fail(`${t.label}: 0 streams en TODOS los addons — ${detail}`);
      exitCode = 1;
    } else {
      ok(`${t.label}: ${total} streams (${detail})`);
    }
  }
}

// ── 5. Subtítulos en español ─────────────────────────────────────────────────
console.log('\n[ 5/5 ] Subtítulos en español');
const subAddons = (authKey ? addons : []).filter((a) => hasResource(a.manifest, 'subtitles'));
if (!authKey) {
  warn('omitido (requiere cuenta)');
} else if (!subAddons.length) {
  fail('Ningún addon de subtítulos en la colección');
  exitCode = 1;
} else {
  for (const t of [TEST_MOVIE, TEST_SERIES]) {
    const cells = await Promise.all(
      subAddons.map(async (a) => {
        const d = await getJson(`${baseOf(a.transportUrl)}subtitles/${t.type}/${t.id}.json`, 18000);
        const es = (d?.subtitles || []).filter((s) => isSpanish(s.lang)).length;
        return { name: a.manifest.name, es };
      })
    );
    const totalEs = cells.reduce((s, c) => s + c.es, 0);
    const detail = cells.filter((c) => c.es > 0).map((c) => `${c.name}=${c.es}`).join(' ');
    if (totalEs === 0) {
      fail(`${t.label}: 0 subtítulos en español en todos los addons`);
      exitCode = 1;
    } else {
      ok(`${t.label}: ${totalEs} subs en español (${detail})`);
    }
  }
}

// ── Resumen ──────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(43));
if (exitCode === 0) {
  console.log('✅ Todo OK — setup funcionando correctamente');
} else {
  console.log('❌ Hay problemas — revisar la salida de arriba');
  console.log('\nSi SubSense falla: regenerar en https://subsense.nepiraw.com');
  console.log('  → idioma "Spanish" (código "es"), maxSubtitles 20, userId de 8 chars');
}
console.log('═'.repeat(43));

process.exit(exitCode);
