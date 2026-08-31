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

const streamId = type === 'series' ? `${imdbId}:${season}:${episode}` : imdbId;

for (let i = 0; i < subAddons.length; i++) {
  const a = subAddons[i];
  const base = baseOf(a.transportUrl);
  const d = await getJson(`${base}subtitles/${type}/${streamId}.json`, 18000);
  const subs = d?.subtitles || [];
  console.log(`[${i}] ${a.manifest.name} (${a.manifest.id}) — ${subs.length} resultado(s)`);
  for (const s of subs.slice(0, 10)) {
    console.log(`      lang="${s.lang}" id="${s.id}"`);
  }
  if (d?.__error) console.log(`      ✗ error: ${d.__error}`);
}

console.log('\n' + '═'.repeat(70));
process.exit(0);
