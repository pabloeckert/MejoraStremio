#!/usr/bin/env node
/**
 * check-torrentio-providers.mjs — Chequeo puntual: imprime el transportUrl real de Torrentio
 * guardado en la cuenta, para ver qué proveedores están habilitados hoy (el parámetro "providers"
 * pipe-delimited en la URL) y compararlo contra la lista actual que ofrece Torrentio.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/check-torrentio-providers.mjs
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

const email = process.env.ST_EMAIL;
const pass = process.env.ST_PASS;
if (!email || !pass) die('Faltan ST_EMAIL / ST_PASS');

const login = await apiPost('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) die('Login fallido: ' + JSON.stringify(login?.error || login));

const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const torrentio = addons.find((a) => a.manifest?.id === 'com.stremio.torrentio.addon');
if (!torrentio) die('Torrentio no está instalado.');

console.log('transportUrl completo:');
console.log(torrentio.transportUrl);
console.log();
const m = torrentio.transportUrl.match(/providers=([^|/]+)/);
if (m) {
  console.log('Proveedores habilitados hoy:');
  console.log(m[1].split(',').sort().join(', '));
} else {
  console.log('No se encontró el segmento "providers=" en la URL (¿usa el default?).');
}
