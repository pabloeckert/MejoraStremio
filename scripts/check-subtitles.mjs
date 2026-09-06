#!/usr/bin/env node
/**
 * check-subtitles.mjs — Prueba subtítulos ES reales contra TODOS los addons de subs instalados
 * para un título puntual, mostrando el detalle crudo (lang, id) de cada resultado. Pensado para
 * verificar en qué orden aparecen las fuentes y si el addon de traducción IA (SubMaker) ofrece un
 * resultado "Make Spanish" cuando no hay subtítulo ya hecho.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/check-subtitles.mjs <imdbId> <movie|series> [season] [episode]
 *
 * Node >= 20, sin dependencias.
 */
const API = 'https://api.strem.io/api';
const die = (m, code = 1) => { console.error(`✗ ${m}`); process.exit(code); };
const apiPost = (path, body) =>
  fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  }).then((r) => r.json());
const getJson = (url, t = 20000) =>
  fetch(url, { signal: AbortSignal.timeout(t) })
    .then((r) => (r.ok ? r.json() : null))
    .catch((e) => ({ __error: String(e) }));
const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));
const hasRes = (m, r) => (m?.resources || []).some((x) => x === r || x?.name === r);

const [, , imdbId, type, season, episode] = process.argv;
if (!imdbId || !type) die('Uso: check-subtitles.mjs <imdbId> <movie|series> [season] [episode]');

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

console.log('═'.repeat(70));
console.log(` MejoraStremio — Chequeo crudo de subtítulos: ${imdbId} (${type})`);
console.log(' ' + new Date().toISOString());
console.log('═'.repeat(70));

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const subAddons = addons.filter((a) => hasRes(a.manifest, 'subtitles'));

console.log(`\n${subAddons.length} addon(s) de subtítulos instalados, en este orden:\n`);

const idPlain = type === 'series' ? `${imdbId}:${season}:${episode}` : imdbId;
// Formato REAL que manda el cliente de Stremio durante la reproducción: ":" percent-
// codeado + un segmento extra con los datos del archivo de video. NUESTRO hub tenía un
// bug (2026-09-06) que devolvía [] con este formato pero OK con ":" literal — por eso
// nunca lo detectó el tooling. Se prueban los DOS y se marca si difieren.
const idReal = type === 'series'
  ? `${imdbId}%3A${season}%3A${episode}/videoHash=0000000000000000&videoSize=1&filename=${imdbId}.mkv`
  : `${imdbId}/videoHash=0000000000000000&videoSize=1&filename=${imdbId}.mkv`;

let mismatch = 0;
for (let i = 0; i < subAddons.length; i++) {
  const a = subAddons[i];
  const base = baseOf(a.transportUrl);
  const [dp, dr] = await Promise.all([
    getJson(`${base}subtitles/${type}/${idPlain}.json`, 18000),
    getJson(`${base}subtitles/${type}/${idReal}.json`, 18000),
  ]);
  const np = (dp?.subtitles || []).length;
  const nr = (dr?.subtitles || []).length;
  const flag = np !== nr ? '  ⚠ DIFIERE plain/real' : '';
  if (np !== nr) mismatch++;
  console.log(`[${i}] ${a.manifest.name} (${a.manifest.id}) — plain:${np} real:${nr}${flag}`);
  for (const s of (dr?.subtitles || dp?.subtitles || []).slice(0, 10)) {
    console.log(`      lang="${s.lang}" label="${s.label || s.name || ''}" id="${s.id}"`);
  }
  if (dp?.__error) console.log(`      ✗ error (plain): ${dp.__error}`);
  if (dr?.__error) console.log(`      ✗ error (real): ${dr.__error}`);
}
if (mismatch) {
  console.log(`\n⚠ ${mismatch} addon(s) devuelven distinto con el formato real de Stremio vs ":" literal.`);
  console.log('  Si es un addon NUESTRO, es un bug de parsing del id (ver "Sesión 2026-09-06").');
}

console.log('\n' + '═'.repeat(70));
process.exit(0);
