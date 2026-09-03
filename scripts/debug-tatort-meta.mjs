#!/usr/bin/env node
/**
 * debug-tatort-meta.mjs — Diagnóstico de un solo uso: diagnose-tatort.mjs encontró que Cinemeta
 * solo lista 14 episodios TOTALES para Tatort (tt0806910) — sospechosamente poco para un show que
 * corre desde 1970 con ~30 episodios/año. Este script vuelca la lista cruda (fecha, temporada,
 * episodio, nombre) para entender si es un límite real de la fuente (TheTVDB, que Cinemeta usa
 * para episodios, no maneja bien shows de 50+ temporadas) o un problema de nuestro filtro.
 *
 * Sin credenciales — Cinemeta es público.
 * Uso: node scripts/debug-tatort-meta.mjs
 */
const IMDB_ID = 'tt0806910';
const CINEMETA = 'https://v3-cinemeta.strem.io';

const res = await fetch(`${CINEMETA}/meta/series/${IMDB_ID}.json`, { signal: AbortSignal.timeout(20000) });
console.log(`HTTP status: ${res.status}`);
const data = await res.json();
const meta = data?.meta || {};
console.log(`name: ${meta.name}`);
console.log(`imdb_id: ${meta.imdb_id}`);
console.log(`status: ${meta.status}`);
console.log(`releaseInfo: ${meta.releaseInfo}`);
const videos = meta.videos || [];
console.log(`videos.length: ${videos.length}`);
console.log('');
for (const v of videos) {
  console.log(`S${String(v.season).padStart(2, '0')}E${String(v.number).padStart(3, '0')} released=${v.released || v.firstAired || '?'} name="${v.name || v.title || ''}"`);
}

// También probar el catálogo de series populares de Cinemeta por si el id difiere, y el endpoint
// de meta sin la extensión .json por compatibilidad.
console.log('\n--- Chequeo alternativo: TMDB find (tt -> tmdb id, sin key, endpoint público find) ---');
try {
  const alt = await fetch(`https://api.themoviedb.org/3/find/${IMDB_ID}?external_source=imdb_id`, { signal: AbortSignal.timeout(10000) });
  console.log(`TMDB find status (sin key, esperado 401): ${alt.status}`);
} catch (e) {
  console.log(`TMDB find error: ${e}`);
}
