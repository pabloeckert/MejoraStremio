#!/usr/bin/env node
/**
 * tatort-coverage-after.mjs — Mide la cobertura de Tatort DESPUÉS de sumar el addon
 * Mediathek DE y el de Traducción IA→ES latino. Chequea, por episodio de los últimos
 * ~10 años: ¿hay stream con audio alemán? (Mediathek oficial o Comet+TorBox) y ¿hay
 * subtítulo en español disponible? (la traducción IA, que existe si hay una pista
 * base alemana). Reporte, no escribe nada en la cuenta.
 *
 * Salida: data/tatort-coverage-after.jsonl + tabla por año.
 * Uso: node scripts/tatort-coverage-after.mjs
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'tatort-coverage-after.jsonl');
const IMDB = 'tt0806910';
const HUB = 'https://mejorastremio-hub.pabloeckert.deno.net';
const COMET = 'https://comet.feels.legal/eyJtYXhSZXN1bHRzUGVyUmVzb2x1dGlvbiI6MTAsIm1heFNpemUiOjAsImNhY2hlZE9ubHkiOmZhbHNlLCJyZW1vdmVUcmFzaCI6dHJ1ZSwicmVzdWx0Rm9ybWF0IjpbImFsbCJdLCJkZWJyaWRTZXJ2aWNlIjoidG9ycmVudCIsImRlYnJpZEFwaUtleSI6IiIsImRlYnJpZFN0cmVhbVByb3h5UGFzc3dvcmQiOiIiLCJsYW5ndWFnZXMiOnsiZXhjbHVkZSI6W10sInByZWZlcnJlZCI6WyJsYSIsImVuIl19LCJyZXNvbHV0aW9ucyI6eyJyMjQwcCI6ZmFsc2UsInIzNjBwIjpmYWxzZSwicjQ4MHAiOmZhbHNlLCJ1bmtub3duIjpmYWxzZSwicjIxNjBwIjpmYWxzZX0sIm9wdGlvbnMiOnsicmVtb3ZlX3JhbmtzX3VuZGVyIjotMTAwMDAwMDAwMDAsImFsbG93X2VuZ2xpc2hfaW5fbGFuZ3VhZ2VzIjp0cnVlLCJyZW1vdmVfdW5rbm93bl9sYW5ndWFnZXMiOmZhbHNlfSwiZGVicmlkU2VydmljZXMiOlt7InNlcnZpY2UiOiJ0b3Jib3giLCJhcGlLZXkiOiI5ZmU1YzIwMi0xNWVjLTRhZWItYjRlNy04NjEzNzI4Y2YwNDQifV0sImVuYWJsZVRvcnJlbnQiOmZhbHNlLCJzb3J0Q2FjaGVkVW5jYWNoZWRUb2dldGhlciI6ZmFsc2V9';

const getJson = (u, t = 20000) =>
  fetch(u, { signal: AbortSignal.timeout(t) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const meta = await getJson(`https://v3-cinemeta.strem.io/meta/series/${IMDB}.json`, 30000);
const now = new Date();
const vids = (meta?.meta?.videos || [])
  .filter((v) => v.season >= 2016 && v.season < 3000 && new Date(v.released || v.firstAired || 0) <= now)
  .sort((a, b) => a.season - b.season || a.number - b.number);

const done = new Set(
  existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []
);
const rows = existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

let n = 0;
for (const v of vids) {
  const key = `${v.season}:${v.number}`;
  if (done.has(key)) continue;
  const sid = `${IMDB}:${v.season}:${v.number}`;
  const [mh, comet, tr] = await Promise.all([
    getJson(`${HUB}/mediathek/stream/series/${sid}.json`, 20000),
    getJson(`${COMET}/stream/series/${sid}.json`, 20000),
    getJson(`${HUB}/translate/subtitles/series/${sid}.json`, 25000),
  ]);
  const mhStreams = (mh?.streams || []).length;
  const cometStreams = (comet?.streams || []).length;
  const mhWithSub = (mh?.streams || []).some((s) => (s.subtitles || []).some((x) => x.lang === 'spa'));
  const trSub = (tr?.subtitles || []).length > 0;
  const trBase = tr?.subtitles?.[0]?.name || '';
  const row = {
    key, imdb: sid, season: v.season, number: v.number, title: v.name || '',
    released: (v.released || v.firstAired || '').slice(0, 10),
    mediathek: mhStreams, comet: cometStreams,
    germanAudio: mhStreams > 0 || cometStreams > 0,
    esSubAvailable: trSub || mhWithSub,
    esSubBase: trBase,
    checkedAt: new Date().toISOString(),
  };
  rows.push(row);
  writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  n++;
  process.stdout.write(
    `[${n}] ${sid} ${row.released} DE-audio:${row.germanAudio ? 'SÍ' : 'no'}(mh${mhStreams}/co${cometStreams}) ES-sub:${row.esSubAvailable ? 'SÍ' : 'no'}  ${(v.name || '').slice(0, 38)}\n`
  );
  await sleep(150);
}

// ── Resumen ────────────────────────────────────────────────────────────────
const byYear = {};
for (const r of rows) {
  (byYear[r.season] ||= { eps: 0, de: 0, es: 0, both: 0 });
  const b = byYear[r.season];
  b.eps++;
  if (r.germanAudio) b.de++;
  if (r.esSubAvailable) b.es++;
  if (r.germanAudio && r.esSubAvailable) b.both++;
}
console.log('\n' + '═'.repeat(72));
console.log(' TATORT — cobertura DESPUÉS (Mediathek DE + Traducción IA→ES latino)');
console.log('═'.repeat(72));
console.log('año   eps   audio-DE   sub-ES   ambos (=mirable en alemán con sub español)');
const T = { eps: 0, de: 0, es: 0, both: 0 };
for (const y of Object.keys(byYear).sort()) {
  const b = byYear[y];
  for (const k of Object.keys(T)) T[k] += b[k];
  console.log(`${y}  ${String(b.eps).padStart(4)}   ${String(b.de).padStart(6)}   ${String(b.es).padStart(6)}   ${String(b.both).padStart(6)}`);
}
console.log('─'.repeat(72));
console.log(`TOT ${String(T.eps).padStart(5)}   ${String(T.de).padStart(6)}   ${String(T.es).padStart(6)}   ${String(T.both).padStart(6)}`);
console.log('═'.repeat(72));
console.log(`\nAudio alemán disponible:        ${T.de}/${T.eps} (${((100 * T.de) / T.eps).toFixed(1)}%)`);
console.log(`Subtítulo español disponible:  ${T.es}/${T.eps} (${((100 * T.es) / T.eps).toFixed(1)}%)`);
console.log(`Episodios mirables (ambos):    ${T.both}/${T.eps} (${((100 * T.both) / T.eps).toFixed(1)}%)`);
process.exit(0);
