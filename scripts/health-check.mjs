/**
 * health-check.mjs â€” AuditorÃ­a real del setup de Stremio de stremioeg@gmail.com
 *
 * Con credenciales (ST_EMAIL/ST_PASS) hace una auditorÃ­a DINÃMICA de la cuenta:
 * lee la colecciÃ³n real instalada y prueba los addons que efectivamente estÃ¡n ahÃ­,
 * no una lista hardcodeada. Sin credenciales, verifica manifests pÃºblicos conocidos.
 *
 * Uso:
 *   node scripts/health-check.mjs
 *   ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/health-check.mjs
 *
 * Verifica:
 *   1. Cuenta: login, nÂº de addons, y NINGÃšN manifest.id duplicado
 *      (la colisiÃ³n de id es lo que rompÃ­a la bÃºsqueda; ver GEMINI.md).
 *   2. Manifests: cada addon instalado responde su manifest.
 *   3. CatÃ¡logos + bÃºsqueda de AIOMetadata: muestrea catÃ¡logos y prueba
 *      bÃºsqueda por tÃ­tulo y por actor.
 *   4. Streams: prueba TODOS los addons de streams del setup (no solo Torrentio).
 *   5. SubtÃ­tulos: prueba todos los addons de subtÃ­tulos para espaÃ±ol.
 *
 * Exit codes: 0 = todo OK, 1 = algo caÃ­do.
 */
import { apiPost as _apiPost } from './lib/stremio-api.mjs';

// TÃ­tulos de prueba: una peli popular, una serie popular, y contenido de nicho
// (Will Trent / Wild Cards histÃ³ricamente con pocas seeds) para no dar falsos OK.
const TEST_MOVIE  = { label: 'Matrix',            type: 'movie',  id: 'tt0133093' };
const TEST_SERIES = { label: 'Breaking Bad S01E01', type: 'series', id: 'tt0903747:1:1' };
const TEST_NICHE  = { label: 'Will Trent S01E01',  type: 'series', id: 'tt14681924:1:1' };

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const apiPost = (path, body) => _apiPost(path, body, { timeout: 15000 });

const getJson = (url, timeout = 12000) =>
  fetch(url, { signal: AbortSignal.timeout(timeout) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Un blip transitorio de red no deberÃ­a marcar un addon sano como caÃ­do: un solo
// reintento tras una pausa corta distingue "hiccup puntual" de "realmente no responde".
const getJsonWithRetry = async (url, timeout = 12000) => {
  const first = await getJson(url, timeout);
  if (first) return { data: first, retried: false };
  await sleep(3000);
  const second = await getJson(url, timeout);
  return { data: second, retried: true };
};

const ok = (msg) => console.log(`  âœ“ ${msg}`);
const warn = (msg) => console.log(`  âš  ${msg}`);
const fail = (msg) => console.log(`  âœ— ${msg}`);

const baseOf = (transportUrl) => transportUrl.replace(/manifest\.json$/, '');

// El transportUrl a veces es la raÃ­z (.../) sin manifest.json; normalizamos.
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

// Algunos catÃ¡logos requieren un gÃ©nero; resolvemos el primero disponible.
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

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let exitCode = 0;

console.log('â•'.repeat(43));
console.log(' MejoraStremio â€” Health Check');
console.log(' ' + new Date().toISOString());
console.log('â•'.repeat(43) + '\n');

const email = process.env.ST_EMAIL || 'stremioeg@gmail.com';
const pass = process.env.ST_PASS || '';

let authKey = null;
let addons = [];

// â”€â”€ 1. Cuenta + detecciÃ³n de manifest.id duplicado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('[ 1/5 ] Cuenta Stremio');
if (!pass) {
  warn('ST_PASS no definido â€” auditorÃ­a de cuenta omitida');
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
      fail(`Solo ${addons.length} addons instalados (esperado â‰¥10)`);
      exitCode = 1;
    } else {
      ok(`${addons.length} addons instalados`);
    }

    // Guard de regresiÃ³n: dos addons con el mismo manifest.id rompen la bÃºsqueda
    // y el guardado de la colecciÃ³n (dedup por id). Ver GEMINI.md.
    const idCounts = {};
    for (const a of addons) {
      const id = a.manifest?.id;
      if (id) idCounts[id] = (idCounts[id] || 0) + 1;
    }
    const dups = Object.entries(idCounts).filter(([, n]) => n > 1);
    if (dups.length) {
      dups.forEach(([id, n]) =>
        fail(`manifest.id duplicado: "${id}" Ã—${n} â€” rompe la bÃºsqueda`)
      );
      exitCode = 1;
    } else {
      ok('Sin manifest.id duplicados');
    }
  }
}

// â”€â”€ 2. Manifests de los addons instalados â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('\n[ 2/5 ] Manifests de addons');
// Con cuenta: probamos los addons REALES instalados. Sin cuenta: lista pÃºblica.
const manifestTargets = authKey
  ? addons.map((a) => ({ name: a.manifest?.name || '(sin nombre)', url: manifestUrlOf(a.transportUrl) }))
  : [
      { name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io/manifest.json' },
      { name: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json' },
      { name: 'Mubi', url: 'https://mubi2stremio.adiba.ro/manifest.json' },
    ];
const manifestResults = await Promise.all(manifestTargets.map((t) => getJsonWithRetry(t.url, 10000)));
// Addons con flakiness documentada (ver "Addons que pueden caerse" en GEMINI.md): WebStreamrMBG
// a veces tarda >15s o da 504, Mubi Catalog falla seguido especÃ­ficamente en runners de GitHub
// Actions. Ambos son de bajo riesgo (streams/catÃ¡logo, no rompen el resto del setup) y sacarlos
// no es ideal â€” una caÃ­da total (no solo un blip) queda como warning, no como fallo duro.
// Los 3 de mejorastremio-hub estuvieron acÃ¡ 2026-07-28/30 por USAGE_EXCEEDED en Deno Deploy
// (org gratuita suspendida). Sacados el 2026-07-30 al confirmarse el redeploy con el hub ya
// respondiendo 200 en los 4 manifests â€” si vuelve a pasar, reagregar los que corresponda.
// SubSense / SubMaker / Community Subtitles / Nuvio: hosteados en ElfHosted, cold-starts
// esporÃ¡dicos en el manifest (blip cada ~1-2 semanas en el log interno, 2026-08/09). Son
// fuentes SECUNDARIAS â€” hay 8 addons de subtÃ­tulos y los 3 primarios (OpenSubtitles/SubDL/
// OpenSubtitles Latino, servidos por el hub keyless) son confiables. Un blip de manifest de un
// secundario no debe marcar el job en rojo; una caÃ­da real de streams/catÃ¡logos/cuenta sÃ­.
const KNOWN_FLAKY = [
  'WebStreamrMBG', 'Mubi Catalog',
  'SubSense', 'SubMaker | ElfHosted', 'Stremio Community Subtitles', 'Nuvio Streams | Elfhosted',
];
manifestResults.forEach(({ data: m, retried }, i) => {
  const t = manifestTargets[i];
  if (m?.name && !retried) {
    ok(`${t.name}: v${m.version || '?'}`);
  } else if (m?.name && retried) {
    warn(`${t.name}: v${m.version || '?'} (OK reciÃ©n al reintento â€” blip transitorio)`);
  } else if (KNOWN_FLAKY.includes(t.name)) {
    warn(`${t.name}: NO RESPONDE (2 intentos) â€” flakiness documentada, no rompe el exit code`);
  } else {
    fail(`${t.name}: NO RESPONDE (2 intentos)`);
    exitCode = 1;
  }
});

// â”€â”€ 3. CatÃ¡logos + bÃºsqueda de AIOMetadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('\n[ 3/5 ] CatÃ¡logos y bÃºsqueda (AIOMetadata)');
const aio = addons.find((a) => a.manifest?.id === 'aio-metadata');
if (!authKey) {
  warn('omitido (requiere cuenta)');
} else if (!aio) {
  fail('AIOMetadata no encontrado en la colecciÃ³n');
  exitCode = 1;
} else {
  const base = baseOf(aio.transportUrl);
  const mf = manifestResults[addons.indexOf(aio)]?.data || (await getJson(aio.transportUrl));
  const browsable = (mf?.catalogs || []).filter(
    (c) => !(c.extra || []).some((e) => e.name === 'search' && e.isRequired)
  );
  // Muestrear hasta 10 catÃ¡logos navegables
  const sample = browsable.slice(0, 10);
  const counts = await Promise.all(
    sample.map((c) => getJson(catalogUrl(base, c)).then((d) => d?.metas?.length ?? -1))
  );
  const empty = sample.filter((_, i) => counts[i] === 0);
  const errored = sample.filter((_, i) => counts[i] < 0);
  if (errored.length) {
    fail(`${errored.length}/${sample.length} catÃ¡logos con error: ${errored.map((c) => c.id).join(', ')}`);
    exitCode = 1;
  } else if (empty.length > 1) {
    // 1 vacÃ­o es tolerable (ej. calendario de watchlist sin items)
    warn(`${empty.length}/${sample.length} catÃ¡logos vacÃ­os: ${empty.map((c) => c.name).join(', ')}`);
  } else {
    ok(`${sample.length} catÃ¡logos muestreados con contenido`);
  }

  // BÃºsqueda por tÃ­tulo â€” sondeo configurable: cuentas con cap de edad (ver
  // cuentas/solotveg/GEMINI.md) filtran tÃ­tulos R/NC-17 hasta de la bÃºsqueda,
  // asÃ­ que "matrix" da 0 ahÃ­ a propÃ³sito. HEALTH_CHECK_SEARCH_PROBE permite
  // usar un tÃ­tulo apto para esa cuenta sin tocar el resto del chequeo.
  const searchProbe = process.env.HEALTH_CHECK_SEARCH_PROBE || 'matrix';
  const byTitle = await getJson(`${base}catalog/movie/search.movie/search=${encodeURIComponent(searchProbe)}.json`);
  if ((byTitle?.metas?.length ?? 0) > 0) {
    ok(`BÃºsqueda por tÃ­tulo: "${searchProbe}" â†’ ${byTitle.metas.length} resultados`);
  } else {
    fail(`BÃºsqueda por tÃ­tulo ("${searchProbe}") no devuelve resultados`);
    exitCode = 1;
  }

  // BÃºsqueda por actor (catÃ¡logo dedicado people_search)
  const byActor = await getJson(
    `${base}catalog/movie/people_search.people_search_movie/search=${encodeURIComponent('Tom Cruise')}.json`
  );
  if ((byActor?.metas?.length ?? 0) > 0) {
    ok(`BÃºsqueda por actor: "Tom Cruise" â†’ ${byActor.metas.length} pelÃ­culas`);
  } else {
    warn('BÃºsqueda por actor no devuelve resultados (people_search desactivado?)');
  }
}

// â”€â”€ 4. Streams (todos los addons de streams del setup) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('\n[ 4/5 ] Streams');
const streamAddons = (authKey ? addons : []).filter(
  (a) => hasResource(a.manifest, 'stream') && a.manifest?.name !== 'Streailer' // Streailer = trailers
);
if (!authKey) {
  warn('omitido (requiere cuenta)');
} else if (!streamAddons.length) {
  fail('NingÃºn addon de streams en la colecciÃ³n');
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
      fail(`${t.label}: 0 streams en TODOS los addons â€” ${detail}`);
      exitCode = 1;
    } else {
      ok(`${t.label}: ${total} streams (${detail})`);
    }
  }
}

// â”€â”€ 5. SubtÃ­tulos en espaÃ±ol â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('\n[ 5/5 ] SubtÃ­tulos en espaÃ±ol');
const subAddons = (authKey ? addons : []).filter((a) => hasResource(a.manifest, 'subtitles'));
if (!authKey) {
  warn('omitido (requiere cuenta)');
} else if (!subAddons.length) {
  fail('NingÃºn addon de subtÃ­tulos en la colecciÃ³n');
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
      fail(`${t.label}: 0 subtÃ­tulos en espaÃ±ol en todos los addons`);
      exitCode = 1;
    } else {
      ok(`${t.label}: ${totalEs} subs en espaÃ±ol (${detail})`);
    }
  }
}

// â”€â”€ Resumen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('\n' + 'â•'.repeat(43));
if (exitCode === 0) {
  console.log('âœ… Todo OK â€” setup funcionando correctamente');
} else {
  console.log('âŒ Hay problemas â€” revisar la salida de arriba');
  console.log('\nSi SubSense falla: regenerar en https://subsense.nepiraw.com');
  console.log('  â†’ idioma "Spanish" (cÃ³digo "es"), maxSubtitles 20, userId de 8 chars');
}
console.log('â•'.repeat(43));

process.exit(exitCode);
