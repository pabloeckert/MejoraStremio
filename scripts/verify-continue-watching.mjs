#!/usr/bin/env node
/**
 * verify-continue-watching.mjs — Para cada título que Pablo tiene en "Seguir viendo" (actividad
 * reciente, no terminado), verifica que se pueda reproducir: al menos un stream real + al menos un
 * subtítulo en español, contra los addons realmente instalados. Para series calcula el próximo
 * episodio no visto desde el propio libraryItem (state.video_id / state.season+episode).
 *
 * Requiere: ST_EMAIL, ST_PASS
 * Uso: node scripts/verify-continue-watching.mjs [díasAtrás=30]
 */
import { isUtilityStream, isRealStream, isSpanishLang } from './lib/addon-signals.mjs';

const API = 'https://api.strem.io/api';
const daysBack = Number(process.argv[2]) || 30;
const email = process.env.ST_EMAIL, pass = process.env.ST_PASS;
if (!pass) { console.error('Falta ST_PASS'); process.exit(1); }

const post = (p, b) => fetch(`${API}/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(25000) }).then((r) => r.json());
const get = (u, t = 20000) => fetch(u, { signal: AbortSignal.timeout(t) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const baseOf = (u) => (/manifest\.json$/.test(u) ? u.replace(/manifest\.json$/, '') : u.replace(/\/?$/, '/'));
const hasRes = (m, r) => (m?.resources || []).some((x) => x === r || x?.name === r);

const login = await post('login', { authKey: null, email, password: pass });
const authKey = login?.result?.authKey;
if (!authKey) { console.error('Login fallido'); process.exit(1); }

const lib = await post('datastoreGet', { type: 'DatastoreGet', authKey, collection: 'libraryItem', ids: [], all: true });
const items = (lib.result || lib || []).filter((it) => it && it._id && !it._id.startsWith('tt0000'));
const cutoff = Date.now() - daysBack * 86400000;

const active = items.filter((it) => {
  const lw = it.state?.lastWatched ? new Date(it.state.lastWatched).getTime() : 0;
  if (lw < cutoff) return false;
  // no terminado: para series casi siempre hay próximo; para movie, si flaggedWatched u
  // overallTimeWatched cerca del runtime lo consideramos visto — igual lo probamos, es barato.
  return true;
}).sort((a, b) => new Date(b.state?.lastWatched || 0) - new Date(a.state?.lastWatched || 0));

const col = await post('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
const addons = col?.result?.addons || [];
const streamAddons = addons.filter((a) => hasRes(a.manifest, 'stream') && !['Streailer'].includes(a.manifest?.name));
const subAddons = addons.filter((a) => hasRes(a.manifest, 'subtitles') && !(a.manifest?.id || '').startsWith('trakt.addon.v3.'));
const myTrakt = addons.find((a) => (a.manifest?.id || '').startsWith('trakt.addon.v3.'));

console.log('═'.repeat(70));
console.log(` Verificación de "Seguir viendo" — últimos ${daysBack} días (${active.length} títulos)`);
console.log('═'.repeat(70));
console.log('Streams:', streamAddons.map((a) => a.manifest.name).join(', '));
console.log('Subs   :', subAddons.map((a) => a.manifest.name).join(', '), '\n');

async function nextEpisode(imdbId, state) {
  // 1) del propio libraryItem
  if (state?.video_id) {
    const m = state.video_id.match(/:(\d+):(\d+)$/);
    if (m) {
      // el video_id apunta al último visto; el próximo es +1 episodio (aprox)
      return { season: +m[1], episode: +m[2] + 1, from: 'lib+1' };
    }
  }
  // 2) de MyTrakt (watched por episodio)
  if (myTrakt) {
    const meta = await get(`${baseOf(myTrakt.transportUrl)}meta/series/${imdbId}.json`);
    const vids = (meta?.meta?.videos || []).filter((v) => v.season > 0).sort((a, b) => a.season - b.season || a.number - b.number);
    const nx = vids.find((v) => v.watched !== true);
    if (nx) return { season: nx.season, episode: nx.number, from: 'mytrakt' };
  }
  // 3) fallback S01E01
  return { season: 1, episode: 1, from: 'fallback' };
}

let okCount = 0, warnCount = 0;
const problems = [];
for (const it of active) {
  const imdbId = it._id;
  let sid, epInfo = '';
  if (it.type === 'series') {
    const ne = await nextEpisode(imdbId, it.state);
    sid = `${imdbId}:${ne.season}:${ne.episode}`;
    epInfo = ` S${String(ne.season).padStart(2, '0')}E${String(ne.episode).padStart(2, '0')} (${ne.from})`;
  } else {
    sid = imdbId;
  }

  const streamLists = await Promise.all(streamAddons.map((a) => get(`${baseOf(a.transportUrl)}stream/${it.type}/${sid}.json`, 18000)));
  const realStreams = streamLists.flatMap((r) => (r?.streams || []).filter((s) => !isUtilityStream(s) && isRealStream(s))).length;

  const subLists = await Promise.all(subAddons.map((a) => get(`${baseOf(a.transportUrl)}subtitles/${it.type}/${sid}.json`, 16000)));
  const esSubs = subLists.flatMap((r) => (r?.subtitles || []).filter((s) => isSpanishLang(s.lang))).length;

  const mark = realStreams >= 1 && esSubs >= 1 ? '✅' : realStreams >= 1 ? '⚠ sin sub ES' : '✗ SIN STREAM';
  if (mark === '✅') okCount++; else { warnCount++; problems.push(`${it.name}${epInfo} — streams:${realStreams} subES:${esSubs}`); }
  console.log(`${mark}  ${(it.name || imdbId).slice(0, 42).padEnd(43)}${epInfo.padEnd(22)} str=${String(realStreams).padStart(3)} subES=${String(esSubs).padStart(3)}`);
  await new Promise((r) => setTimeout(r, 200));
}

console.log('\n' + '═'.repeat(70));
console.log(`${okCount}/${active.length} reproducen OK (stream + sub ES). ${warnCount} con algún problema.`);
if (problems.length) { console.log('\nA revisar:'); problems.forEach((p) => console.log('  - ' + p)); }
console.log('═'.repeat(70));
process.exit(0);
