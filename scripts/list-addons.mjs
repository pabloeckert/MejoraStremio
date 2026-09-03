#!/usr/bin/env node
/**
 * list-addons.mjs — Diagnóstico de un solo uso: volcar la lista completa de addons instalados
 * (índice, nombre, manifest.id, transportUrl, resources) para identificar addons no documentados
 * en CLAUDE.md — encontrado al diagnosticar Tatort: "Mediathek DE (Tatort)" da streams reales para
 * Tatort pero no aparece en ningún session log anterior.
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/list-addons.mjs
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
console.log(`${addons.length} addon(s) instalados:\n`);
addons.forEach((a, i) => {
  const m = a.manifest || {};
  console.log(`[${i}] ${m.name || '?'}  (id=${m.id || '?'}, v=${m.version || '?'})`);
  console.log(`     resources: ${(m.resources || []).map((r) => r?.name || r).join(', ')}`);
  console.log(`     transportUrl: ${a.transportUrl}`);
  console.log('');
});
