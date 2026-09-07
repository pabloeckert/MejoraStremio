#!/usr/bin/env node
/**
 * apply-orden-estreno.mjs — one-shot (2026-09-07).
 *
 * "Ley dura" de Pablo: en Descubrir / Buscar / Biblioteca / Home, TODO ordenado por fecha de
 * estreno o emisión, de más reciente a más antiguo, SIEMPRE. Cualquier catálogo/filtro orientado
 * a popularidad o ranking, borrar (deshabilitar).
 *
 * Qué hace sobre data/preset.json:
 *   1. Deshabilita los catálogos irremediablemente orientados a popularidad/ranking
 *      (no tienen sort_by re-ordenable): Trending, Top 10 de FlixPatrol, Top Rated, Best of 2020s.
 *   2. Convierte a fecha desc los que sí tienen sort_by pero estaban en popularity/asc:
 *      "30 Minutos o Menos", "YouTube Premium", "Próximos Estrenos" (movie+series).
 *   3. Barrido final: cualquier catálogo enabled que todavía tenga sort_by con "popularity" o
 *      un "*.asc" de fecha → lo pasa a "<campo>.desc".
 *
 * No toca la red. Después: regenerate-aiometadata.mjs --apply --force (vía daily-catalog-refresh).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const PRESET = new URL('../data/preset.json', import.meta.url);
const preset = JSON.parse(readFileSync(PRESET, 'utf8'));
const cats = preset.aioMetadataConfig.catalogs.standard;

const DISABLE_BY_ID_PREFIX = ['flixpatrol.'];
const DISABLE_BY_ID = new Set(['tmdb.trending']);
const DISABLE_BY_NAME = new Set([
  'Top Rated Movies', 'Top Rated Shows',
  'Best Movies of the 2020s', 'Best Shows of the 2020s',
]);

const dateFieldFor = (c) => {
  const t = c.type || (/(\.tv\.|shows?|series)/i.test(c.id || '') ? 'series' : 'movie');
  return t === 'series' ? 'first_air_date' : 'primary_release_date';
};

let disabled = 0, resorted = 0;
for (const c of cats) {
  const name = c.name || '';
  const id = c.id || '';

  if (
    DISABLE_BY_ID.has(id) ||
    DISABLE_BY_NAME.has(name) ||
    DISABLE_BY_ID_PREFIX.some((p) => id.startsWith(p))
  ) {
    if (c.enabled !== false) { c.enabled = false; disabled++; }
    c.showInHome = false;
    continue;
  }

  if (c.enabled === false) continue;
  const params = c?.metadata?.discover?.params;
  if (!params || !params.sort_by) continue;

  // "Próximos Estrenos" (movie/series) queda en *_date.asc a propósito: es una lista de contenido
  // FUTURO, y .asc = "lo que se estrena antes primero" = el orden cronológico que tiene sentido.
  // .desc ahí trae basura (títulos placeholder de TMDB fechados 2043/2047 al tope). No es
  // popularidad, así que no viola la ley dura.
  if (/upcoming\.pablo00[56]/.test(id)) continue;

  const sb = params.sort_by;
  if (/^popularity\./.test(sb) || /\.asc$/.test(sb)) {
    const target = `${dateFieldFor(c)}.desc`;
    if (sb !== target) {
      params.sort_by = target;
      if (c.formState) c.formState.sort_by = target;
      resorted++;
      console.log(`  re-sort: ${name || id}  ${sb} → ${target}`);
    }
  }
}

writeFileSync(PRESET, JSON.stringify(preset, null, 2) + '\n');

const enabled = cats.filter((c) => c.enabled !== false).length;
console.log(`\n✓ ${disabled} catálogo(s) deshabilitado(s) (popularidad/ranking), ${resorted} re-ordenado(s) a fecha desc.`);
console.log(`  preset.json: ${cats.length} catálogos, ${enabled} enabled.`);
