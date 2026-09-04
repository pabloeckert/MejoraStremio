#!/usr/bin/env node
/**
 * apply-encuesta-catalogos.mjs — Aplica a data/preset.json el rework de catálogos que salió de la
 * encuesta de gustos de Pablo (docs/encuesta-catalogos.md, 2026-09-04). UN SOLO USO.
 *
 * Qué hace (sobre aioMetadataConfig.catalogs.standard):
 *  1. Filtro global (lista negra): without_keywords + without_genres en TODO catálogo enabled.
 *  2. Borra: 10 catálogos de Asia, "Crimen y Misterio Europeo/Británico" (redundantes),
 *     "Soap Shows" (telenovela, en lista negra).
 *  3. Agrega ~30 catálogos nuevos (combos policiales, humor negro, familia, nórdicos, director/actor).
 *  4. Reordena el array en las 7 secciones del inicio + Descubrir, y setea showInHome.
 *
 * NO toca la cuenta. Después: node scripts/regenerate-aiometadata.mjs --apply --force
 *
 * Uso: node scripts/apply-encuesta-catalogos.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESET = join(__dirname, '..', 'data', 'preset.json');
const preset = JSON.parse(readFileSync(PRESET, 'utf8'));
const std = preset.aioMetadataConfig.catalogs.standard;

// ── Lista negra ────────────────────────────────────────────────────────────
// anime, gore, doc de naturaleza, religión, faith-based, deportes
const BLACK_KW = '210024,10292,221355,11001,348144,6075';
// series: reality, telenovela/soap, talk, noticias
const BLACK_GENRES_TV = ['10764', '10766', '10767', '10763'];

const GENRE_LABEL = {
  80: 'Crime', 9648: 'Mystery', 53: 'Thriller', 10751: 'Family', 16: 'Animation',
  35: 'Comedy', 28: 'Action', 12: 'Adventure', 878: 'Science Fiction', 14: 'Fantasy',
  10752: 'War', 18: 'Drama', 10749: 'Romance', 36: 'History', 99: 'Documentary',
  27: 'Horror', 10402: 'Music', 37: 'Western', 10759: 'Action & Adventure',
  10765: 'Sci-Fi & Fantasy', 10768: 'War & Politics', 10762: 'Kids',
};

function applyBlacklist(cat) {
  const pr = cat.metadata?.discover?.params;
  const fs = cat.metadata?.discover?.formState;
  if (!pr) return;
  // no pisar un without_keywords propio si ya lo tuviera: fusionar
  const existingKw = (pr.without_keywords || '').split(',').filter(Boolean);
  const merged = [...new Set([...existingKw, ...BLACK_KW.split(',')])].join(',');
  pr.without_keywords = merged;
  if (cat.type === 'series' || cat.metadata?.discover?.mediaType === 'tv') {
    const existingG = (pr.without_genres || '').split(',').filter(Boolean);
    pr.without_genres = [...new Set([...existingG, ...BLACK_GENRES_TV])].join(',');
  }
  if (fs) {
    fs.withoutKeywords = merged.split(',').map((id) => ({ id: Number(id), label: id }));
    if (pr.without_genres) fs.excludeGenres = pr.without_genres.split(',').map((id) => ({ id: Number(id), label: GENRE_LABEL[id] || String(id) }));
  }
}

// ── Constructor de catálogo nuevo ─────────────────────────────────────────
let pabloSeq = 100;
function mkCat(type, name, params, showInHome) {
  const mt = type === 'movie' ? 'movie' : 'tv';
  const id = `tmdb.discover.${mt}.enc-${(name).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pablo${pabloSeq++}`;
  const p = { sort_by: 'popularity.desc', include_adult: false, ...params };
  // lista negra también en los nuevos — EXCEPTO catálogos de persona (si Pablo
  // sigue a un director/actor, quiere su filmografía completa, gore incluido).
  const isPerson = !!(p.with_cast || p.with_crew);
  if (!isPerson) {
    p.without_keywords = [...new Set([...(p.without_keywords || '').split(',').filter(Boolean), ...BLACK_KW.split(',')])].join(',');
    if (mt === 'tv') p.without_genres = [...new Set([...(p.without_genres || '').split(',').filter(Boolean), ...BLACK_GENRES_TV])].join(',');
  }

  const inc = (p.with_genres || '').split('|').filter(Boolean).map((g) => ({ id: Number(g), label: GENRE_LABEL[g] || String(g) }));
  const exc = (p.without_genres || '').split(',').filter(Boolean).map((g) => ({ id: Number(g), label: GENRE_LABEL[g] || String(g) }));
  const va = [Number(p['vote_average.gte'] ?? 0), 10];

  return {
    id, type, name, enabled: true, showInHome: !!showInHome, source: 'tmdb', cacheTTL: 86400,
    metadata: {
      description: `TMDB Discover (${mt})`,
      discover: {
        version: 2, source: 'tmdb', mediaType: mt, params: p,
        formState: {
          catalogName: name, discoverSource: 'tmdb', sortBy: p.sort_by, cacheTTL: 86400, catalogType: type,
          includeGenres: inc, excludeGenres: exc, genreJoinMode: 'or',
          originalLanguage: p.with_original_language || '', originCountry: p.with_origin_country || '',
          certificationCountry: p.certification_country || '', certificationValue: p['certification.lte'] || p.certification || '',
          includeAdult: false, releasedOnly: false,
          selectedPeople: [...(p.with_cast || '').split(',').filter(Boolean), ...(p.with_crew || '').split(',').filter(Boolean)].map((x) => ({ id: Number(x), label: String(x) })),
          peopleJoinMode: 'or', withCompanies: [], withoutCompanies: [], companyJoinMode: 'or',
          withKeywords: (p.with_keywords || '').split('|').filter(Boolean).map((k) => ({ id: Number(k), label: String(k) })),
          withoutKeywords: (p.without_keywords || '').split(',').filter(Boolean).map((k) => ({ id: Number(k), label: String(k) })),
          keywordJoinMode: 'or', watchRegion: '', watchProviders: [], providerJoinMode: 'or',
          voteAverageRange: va, voteCountMin: Number(p['vote_count.gte'] ?? 0), runtimeRange: [0, 400],
          primaryReleaseFrom: p['primary_release_date.gte'] || '', primaryReleaseTo: p['primary_release_date.lte'] || '',
          firstAirFrom: p['first_air_date.gte'] || '', firstAirTo: p['first_air_date.lte'] || '',
          airDateFrom: '', airDateTo: '', releaseRegion: '',
        },
      },
    },
  };
}

// ── 1. Borrar ──────────────────────────────────────────────────────────────
const DELETE_IDS = new Set([
  'tmdb.discover.movie.jp.pablo037', 'tmdb.discover.tv.jp.pablo038',
  'tmdb.discover.movie.kr.pablo039', 'tmdb.discover.tv.kr.pablo040',
  'tmdb.discover.movie.cn.pablo041', 'tmdb.discover.tv.cn.pablo042',
  'tmdb.discover.movie.tw.pablo043', 'tmdb.discover.tv.tw.pablo044',
  'tmdb.discover.movie.in.pablo049', 'tmdb.discover.tv.in.pablo050',
  'tmdb.discover.tv.crime-mystery-europe.pablo051',
  'tmdb.discover.tv.crime-mystery-uk.pablo052',
  'tmdb.discover.tv.soap_shows.37',
]);
let cats = std.filter((c) => !DELETE_IDS.has(c.id));
console.log(`Borrados: ${std.length - cats.length} catálogos`);

// ── 2. Filtro global a todos los que quedan ────────────────────────────────
for (const c of cats) if (c.enabled) applyBlacklist(c);

// ── 3. Catálogos nuevos ────────────────────────────────────────────────────
const CRIME = { with_genres: '80|9648', 'vote_average.gte': 5.5 };
const NEW = [
  // Combos policiales (sección 2, inicio)
  mkCat('movie', 'Crimen Nórdico (Cine)', { ...CRIME, with_origin_country: 'SE|NO|DK|FI|IS', 'vote_count.gte': 8 }, true),
  mkCat('series', 'Crimen Nórdico (Series)', { ...CRIME, with_origin_country: 'SE|NO|DK|FI|IS', 'vote_count.gte': 8 }, true),
  mkCat('movie', 'Crimen Francés (Cine)', { ...CRIME, with_origin_country: 'FR', 'vote_count.gte': 15 }, true),
  mkCat('series', 'Crimen Francés (Series)', { ...CRIME, with_origin_country: 'FR', 'vote_count.gte': 12 }, true),
  mkCat('movie', 'Crimen Español (Cine)', { ...CRIME, with_origin_country: 'ES', 'vote_count.gte': 15 }, true),
  mkCat('series', 'Crimen Español (Series)', { ...CRIME, with_origin_country: 'ES', 'vote_count.gte': 12 }, true),
  mkCat('movie', 'Crimen Italiano (Cine)', { ...CRIME, with_origin_country: 'IT', 'vote_count.gte': 15 }, true),
  mkCat('series', 'Crimen Italiano (Series)', { ...CRIME, with_origin_country: 'IT', 'vote_count.gte': 12 }, true),
  mkCat('movie', 'Cine Negro Clásico', { with_genres: '80|9648', with_keywords: '9807', 'primary_release_date.gte': '1940-01-01', 'primary_release_date.lte': '1969-12-31', sort_by: 'vote_average.desc', 'vote_count.gte': 40 }, true),
  mkCat('movie', 'Thriller Psicológico (Cine)', { with_genres: '53', with_keywords: '12565', 'vote_count.gte': 100 }, true),
  mkCat('series', 'Thriller Psicológico (Series)', { with_genres: '9648|18', with_keywords: '12565', 'vote_count.gte': 40 }, true),
  // Humor negro (sección 3, inicio)
  mkCat('movie', 'Humor Negro (Cine)', { with_genres: '35', with_keywords: '373401|10123', sort_by: 'vote_average.desc', 'vote_count.gte': 150 }, true),
  mkCat('series', 'Humor Negro (Series)', { with_genres: '35', without_genres: '16', with_keywords: '373401|10123', sort_by: 'vote_average.desc', 'vote_count.gte': 60 }, true),
  // Familia (sección 4, inicio)
  mkCat('series', 'Comedia Juvenil (Actores Reales)', { with_genres: '35', without_genres: '16', with_networks: '13|44|294', 'vote_count.gte': 12, sort_by: 'first_air_date.desc' }, true),
  // Nórdicos como país (sección 6, inicio)
  mkCat('movie', 'Cine Suecia', { with_origin_country: 'SE', 'vote_count.gte': 10 }, true),
  mkCat('series', 'Series Suecia', { with_origin_country: 'SE', 'vote_count.gte': 8 }, true),
  mkCat('movie', 'Cine Dinamarca', { with_origin_country: 'DK', 'vote_count.gte': 10 }, true),
  mkCat('series', 'Series Dinamarca', { with_origin_country: 'DK', 'vote_count.gte': 8 }, true),
  mkCat('movie', 'Cine Noruega', { with_origin_country: 'NO', 'vote_count.gte': 10 }, true),
  mkCat('series', 'Series Noruega', { with_origin_country: 'NO', 'vote_count.gte': 8 }, true),
  mkCat('movie', 'Cine Islandia', { with_origin_country: 'IS', 'vote_count.gte': 6 }, true),
  mkCat('series', 'Series Islandia', { with_origin_country: 'IS', 'vote_count.gte': 5 }, true),
  // Solo Descubrir
  mkCat('movie', 'Para Ver en Familia (Cine)', { with_genres: '10751|16|35|12', certification_country: 'US', 'certification.lte': 'PG', 'vote_count.gte': 80 }, false),
  mkCat('series', 'Para Ver en Familia (Series)', { with_genres: '10751|10762|35', 'vote_count.gte': 30 }, false),
  mkCat('movie', 'Director: Guy Ritchie', { with_crew: '956', sort_by: 'primary_release_date.desc' }, false),
  mkCat('movie', 'Director: Quentin Tarantino', { with_crew: '138', sort_by: 'primary_release_date.desc' }, false),
  mkCat('movie', 'Director: Francis Ford Coppola', { with_crew: '1776', sort_by: 'primary_release_date.desc' }, false),
  mkCat('movie', 'Con Leonardo DiCaprio', { with_cast: '6193', sort_by: 'primary_release_date.desc' }, false),
  mkCat('movie', 'Con Gal Gadot', { with_cast: '90633', sort_by: 'primary_release_date.desc' }, false),
  mkCat('movie', 'Con Robert Downey Jr.', { with_cast: '3223', sort_by: 'primary_release_date.desc' }, false),
];
console.log(`Nuevos: ${NEW.length} catálogos`);
cats.push(...NEW);

// ── 4. showInHome según secciones ─────────────────────────────────────────
const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
const byName = Object.fromEntries(cats.map((c) => [c.name, c]));
const setHome = (name, v) => { if (byName[name]) byName[name].showInHome = v; else console.log(`  ⚠ no encontrado: ${name}`); };

// Estrenos: quedan en Home (sección 7)
['Próximos Estrenos', 'Próximos Estrenos (Series)', 'En Cartelera', 'En Cartelera (Series)'].forEach((n) => setHome(n, true));
// Top 10 plataformas → Descubrir
cats.filter((c) => /^flixpatrol\./.test(c.id)).forEach((c) => (c.showInHome = false));
// Géneros generales → Descubrir (quedan solo Crimen/Misterio/Suspenso + Familia/Animación)
const KEEP_GENRE_HOME = new Set(['Crime Movies', 'Mystery Movies', 'Thriller Movies', 'Family Movies', 'Animation Movies', 'Crime Shows', 'Mystery Shows', 'Family Shows', 'Animated Shows']);
cats.filter((c) => /^tmdb\.discover\.(movie|tv)\.[a-z_]+_(movies|shows)\.\d+$/.test(c.id) || /_(movies|shows)\.\d/.test(c.id))
  .forEach((c) => { if (!KEEP_GENRE_HOME.has(c.name)) c.showInHome = false; });
// Géneros generales que Pablo "no usa ese filtro para nada" → DESACTIVAR (no solo
// sacar del inicio): el manifest de AIOMetadata tiene un tope de tamaño y estos
// ~14 catálogos lo hacían reventar. El contenido sigue estando por país /
// Descubrir Maestro / búsqueda. Se dejan enabled solo los que sí usa.
['Comedy Movies', 'Action Movies', 'Adventure Movies', 'Science Fiction Movies', 'Fantasy Movies', 'War Movies', 'Romance Movies', 'History Movies', 'Music Movies', 'Western Movies',
 'War & Politics Shows', 'Comedy Shows', 'Action & Adventure Shows', 'Sci-Fi & Fantasy Shows', 'Western Shows'].forEach((n) => { if (byName[n]) { byName[n].enabled = false; byName[n].showInHome = false; } });
// Drama y Documental quedan navegables en Descubrir
['Drama Movies', 'Documentary Movies', 'Drama Shows', 'Documentary Shows'].forEach((n) => setHome(n, false));

// Familia: activar CN / Nickelodeon + Animación en Home
['Cartoon Network', 'Nickelodeon'].forEach((n) => { if (byName[n]) { byName[n].enabled = true; byName[n].showInHome = true; } });
['Family Movies', 'Family Shows', 'Animation Movies', 'Animated Shows'].forEach((n) => setHome(n, true));

// Cluster policial: subir al Home los que estaban en Descubrir
['Policial Clásico', 'Europe Noir (Cine)', 'Europe Noir (Series)', 'Crimen Alemán (Cine)', 'Crimen Alemán (Series)', 'Crimen Reino Unido (Cine)', 'Crimen Reino Unido (Series)'].forEach((n) => setHome(n, true));
['Crime Movies', 'Crime Shows', 'Mystery Movies', 'Mystery Shows', 'Thriller Movies'].forEach((n) => setHome(n, true));

// Países: solo los 8 + nórdicos + Latam en Home; el resto Descubrir
const HOME_COUNTRIES = ['Cine Argentina', 'Series Argentina', 'Cine España', 'Series España', 'Cine Francia', 'Series Francia',
  'Cine Alemania', 'Series Alemania', 'Cine Italia', 'Series Italia', 'Cine Reino Unido', 'Series Reino Unido',
  'Cine México', 'Series México', 'Cine EE.UU.', 'Series EE.UU.',
  'Cine Suecia', 'Series Suecia', 'Cine Dinamarca', 'Series Dinamarca', 'Cine Noruega', 'Series Noruega', 'Cine Islandia', 'Series Islandia',
  'Latinoamérica (Cine)', 'Latinoamérica (Series)'];
const DISCOVER_COUNTRIES = ['Cine Portugal', 'Series Portugal', 'Cine Colombia', 'Series Colombia', 'Cine Chile', 'Series Chile',
  'Cine Brasil', 'Series Brasil', 'Cine Perú', 'Series Perú', 'Cine Canadá', 'Series Canadá',
  'Cine Australia', 'Series Australia', 'Cine Nueva Zelanda', 'Series Nueva Zelanda'];
HOME_COUNTRIES.forEach((n) => setHome(n, true));
DISCOVER_COUNTRIES.forEach((n) => setHome(n, false));

// Descubrir sueltos que quedaban ON en home por error → off
['Trending Movies', 'Trending Shows', 'Latest Movies', 'Latest Shows', 'Top Rated Movies', 'Top Rated Shows',
 'Best Movies of the 2020s', 'Best Shows of the 2020s', 'Drama Histórico Europeo', 'Crimen y Misterio Europeo',
 'Crimen y Misterio Británico', '30 Minutos o Menos', 'Familiar en Inglés', 'YouTube Premium', 'Warner Bros.',
 'Series Alemania'].forEach((n) => { if (byName[n]) {} }); // no-op, Series Alemania sí va a home (arriba)

// ── 5. Reordenar el array: bloque HOME en orden de secciones, después Descubrir ──
const order = [];
const push = (names) => names.forEach((n) => { if (byName[n] && !order.includes(byName[n])) order.push(byName[n]); });

// Sección 2 — Policial
push(['Crime Movies', 'Crime Shows', 'Mystery Movies', 'Mystery Shows', 'Thriller Movies',
  'Thriller Psicológico (Cine)', 'Thriller Psicológico (Series)', 'Policial Clásico', 'Cine Negro Clásico',
  'Europe Noir (Cine)', 'Europe Noir (Series)', 'Crimen Alemán (Cine)', 'Crimen Alemán (Series)',
  'Crimen Reino Unido (Cine)', 'Crimen Reino Unido (Series)', 'Crimen Francés (Cine)', 'Crimen Francés (Series)',
  'Crimen Español (Cine)', 'Crimen Español (Series)', 'Crimen Italiano (Cine)', 'Crimen Italiano (Series)',
  'Crimen Nórdico (Cine)', 'Crimen Nórdico (Series)']);
// Sección 3 — Humor
push(['Humor Negro (Cine)', 'Humor Negro (Series)']);
// Sección 4 — Familia
push(['Family Movies', 'Family Shows', 'Comedia Juvenil (Actores Reales)', 'Cartoon Network', 'Nickelodeon',
  'Animation Movies', 'Animated Shows']);
// Sección 6 — Países (5 va vacía)
push(['Cine Argentina', 'Series Argentina', 'Cine España', 'Series España', 'Cine Francia', 'Series Francia',
  'Cine Alemania', 'Series Alemania', 'Cine Italia', 'Series Italia', 'Cine Reino Unido', 'Series Reino Unido',
  'Cine México', 'Series México', 'Cine EE.UU.', 'Series EE.UU.',
  'Cine Suecia', 'Series Suecia', 'Cine Noruega', 'Series Noruega', 'Cine Dinamarca', 'Series Dinamarca',
  'Cine Islandia', 'Series Islandia', 'Latinoamérica (Cine)', 'Latinoamérica (Series)']);
// Sección 7 — Estrenos
push(['Próximos Estrenos', 'Próximos Estrenos (Series)', 'En Cartelera', 'En Cartelera (Series)']);

// Resto (Descubrir) — en el orden que ya tenían
const rest = cats.filter((c) => !order.includes(c));
const final = [...order, ...rest];

preset.aioMetadataConfig.catalogs.standard = final;
writeFileSync(PRESET, JSON.stringify(preset, null, 2) + '\n');

const home = final.filter((c) => c.enabled && c.showInHome);
const disc = final.filter((c) => c.enabled && !c.showInHome);
console.log(`\n✓ preset.json escrito: ${final.length} catálogos (${home.length} en Home, ${disc.length} en Descubrir, ${final.length - home.length - disc.length} apagados)`);
console.log('\nHOME (orden):');
home.forEach((c, i) => console.log(String(i + 1).padStart(3), c.name));
