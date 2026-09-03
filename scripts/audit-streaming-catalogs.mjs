#!/usr/bin/env node
/**
 * audit-streaming-catalogs.mjs — Retoma el pendiente abierto desde 2026-07-30: auditar el addon
 * "Streaming Catalogs" (30 servicios: Netflix/Disney+/... + nicho UK/documentales/holandeses) para
 * saber cuáles funcionan de verdad (devuelven contenido real) — primer paso objetivo antes de
 * cualquier decisión de "¿cuáles se usan de verdad?" (esa parte requiere criterio de Pablo, esto
 * solo separa lo roto de lo que anda).
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/audit-streaming-catalogs.mjs
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
    .then((r) => (r.ok ? r.json() : { __httpError: r.status }))
    .catch((e) => ({ __error: String(e) }));
const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const addon = addons.find((a) => a.manifest?.id === 'pw.ers.netflix-catalog');
if (!addon) die('No se encontró el addon "Streaming Catalogs" (pw.ers.netflix-catalog) en la colección.');

const base = baseOf(addon.transportUrl);
console.log(`Streaming Catalogs — transportUrl: ${addon.transportUrl}\n`);

const manifest = addon.manifest;
const catalogs = manifest.catalogs || [];
console.log(`${catalogs.length} catálogo(s) declarados en el manifest.\n`);

// Nicho UK / documentales / holandeses marcados por Pablo el 2026-07-30 como candidatos a revisar.
const FLAGGED = {
  bbo: 'BritBox', act: 'Acorn TV', itv: 'ITVX', sgo: 'Sky Go', bbc: 'BBC iPlayer', al4: 'Channel 4',
  cts: 'Curiosity Stream', mgl: 'MagellanTV', dpe: 'Discovery+',
  nlz: 'NLZIET', vil: 'Videoland',
};

const results = [];
for (const cat of catalogs) {
  const url = `${base}catalog/${cat.type}/${cat.id}.json`;
  const d = await getJson(url, 15000);
  if (d?.__httpError || d?.__error) {
    results.push({ id: cat.id, name: cat.name, count: null, error: d.__httpError ? `HTTP ${d.__httpError}` : d.__error });
    continue;
  }
  const metas = d?.metas || [];
  results.push({ id: cat.id, name: cat.name, count: metas.length });
}

console.log('Resultado por catálogo:\n');
let broken = 0, empty = 0, ok = 0;
for (const r of results) {
  const flag = Object.keys(FLAGGED).some((code) => r.id.toLowerCase().includes(code) || (r.name || '').toLowerCase().includes(FLAGGED[code].toLowerCase()));
  const marker = flag ? ' [nicho/pendiente 07-30]' : '';
  if (r.error) {
    broken++;
    console.log(`  ✗ ${r.name} (${r.id}) — ERROR: ${r.error}${marker}`);
  } else if (r.count === 0) {
    empty++;
    console.log(`  ⚠ ${r.name} (${r.id}) — 0 resultados${marker}`);
  } else {
    ok++;
    console.log(`  ✓ ${r.name} (${r.id}) — ${r.count} resultados${marker}`);
  }
}

console.log('\n' + '═'.repeat(60));
console.log(`RESUMEN: ${ok} con contenido real, ${empty} vacíos, ${broken} con error.`);
console.log('═'.repeat(60));
process.exit(0);
