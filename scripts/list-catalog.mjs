#!/usr/bin/env node
/**
 * list-catalog.mjs — Trae los títulos reales de un catálogo de AIOMetadata (en vivo) y los lista
 * con año/fecha de estreno, sin probar streams (mucho más rápido que check-catalog-streams.mjs).
 * Pensado para auditar si el piso de votos (vote_count.gte) de un catálogo está excluyendo
 * estrenos muy recientes que todavía no juntaron calificaciones.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/list-catalog.mjs <catalogId> <movie|series>
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

const [, , catalogId, type] = process.argv;
if (!catalogId || !type) die('Uso: list-catalog.mjs <catalogId> <movie|series>');

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const aio = addons.find((a) => a.manifest?.id === 'aio-metadata');
if (!aio) die('AIOMetadata no está instalado.');

const aioBase = baseOf(aio.transportUrl);
const catalog = await getJson(`${aioBase}catalog/${type}/${catalogId}.json`);
const metas = catalog?.metas || [];

console.log(`Catálogo ${catalogId} (${type}) — ${metas.length} títulos en vivo:\n`);
for (const m of metas) {
  const date = m.releaseInfo || m.release_date || m.year || '?';
  console.log(`  ${date}\t${m.name} (${m.imdb_id || m.id})`);
}
