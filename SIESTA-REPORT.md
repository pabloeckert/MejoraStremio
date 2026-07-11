# Reporte de sesión "siesta" — 2026-07-11

**Estado: PARCIAL, bloqueado en Fase 2 desde el arranque.** El pedido traía de nuevo
`authKey: [PEGÁ TU AUTHKEY ACÁ]` vacío — sin ST_EMAIL/ST_PASS/authKey no hay forma de
hacer login contra la API de Stremio. Como el pedido explícitamente decía "no me
interrumpas", avancé con todo lo que se podía hacer sin login (investigación web,
razonamiento, archivos locales, y un test real parcial contra Torrentio reusando la
API key de TorBox ya conocida de esta sesión) y dejé documentado con precisión qué
falta y por qué. En cuanto pases ST_EMAIL/ST_PASS puedo terminar Fase 2 completa
(los 5 addons de streams + subtítulos), el backup, health-check/test-content.mjs
frescos, y aplicar los cambios de curación de Fase 4.

## 1. Resumen ejecutivo

De 22 títulos, **21 quedaron identificados con confianza** (1 "Grams" no se pudo
identificar — ver tabla). Con un test parcial contra Torrentio (sin necesitar login,
reusando la key de TorBox), **16 de 20 títulos testeados devolvieron streams reales**,
la gran mayoría ya tageados `[TB+]` (TorBox activo y funcionando también para
contenido nuevo/nicho, no solo para lo masivo). 4 títulos dieron 0 en Torrentio —
todos casos de contenido europeo muy nicho (alemán/policial de canal chico), causa
diagnosticada, no config rota. El sistema en su base (TorBox, health-check, cloud-only)
sigue en buen estado según lo verificado en esta misma sesión hace instantes (ver
Fase 5). Lo que falta para el cuadro completo es 100% dependiente de credenciales.

## 2. Los 22 títulos

| # | Título pedido | Identificado como | IMDb ID | Streams Torrentio* | TorBox `[TB+]` | Audio latino / subs latino |
|---|---|---|---|---|---|---|
| 1 | El Diablo Viste a la Moda 2 | El diablo viste de Prada 2 (2026) | tt33612209 | 97 | 93 | No verificado (bloqueado) |
| 2 | Will Trent | Will Trent (2023–) | tt17543592 | 32 | 29 | No verificado (bloqueado) |
| 3 | S.W.A.T. / "los hombres de Harrilson" | **Es el mismo show**: S.W.A.T. (2017–2025, CBS) — "Los hombres de Harrelson" es el título en español, no algo distinto | tt6111130 | 21 | 21 | No verificado (bloqueado) |
| 4 | El Halcón Maltés | The Maltese Falcon (1941) | tt0033870 | 28 | 18 | No verificado (bloqueado) |
| 5 | Dogs of Berlin | Dogs of Berlin (2018, Netflix) | tt6839788 | 32 | 2 | No verificado (bloqueado) |
| 6 | Veteranos contra el crimen | Serie policial alemana (Colonia), COSMO | tt4449470 | **0** — causa (a) | — | No verificado |
| 7 | Das Quartett | Miniserie criminal alemana (Leipzig), 2019-2024 | tt9258854 | **0** — causa (a) | — | No verificado |
| 8 | Einstein | Versión alemana original (Sat.1, 2017-2019) — no el remake eslovaco tt26762978 | tt5094068 | 7 | 2 | No verificado |
| 9 | Passenger | Passenger (ITV, 2024 — el pedido decía "~2023") | tt18827746 | 17 | 8 | No verificado |
| 10 | Grams | **NO IDENTIFICADO** — probé Grantchester/Gangs of London/Gomorra/21 Grams, ninguna coincidencia confiable | — | — | — | — |
| 11 | El Club de Asesinatos de Marlow | The Marlow Murder Club (2024–) | tt27950663 | 11 | 9 | No verificado |
| 12 | Las Ovejas Detectives | The Sheep Detectives / Three Bags Full (2026) | tt32565993 | 72 | 70 | No verificado — **es familiar/infantil, prioridad Fase 2** |
| 13 | Si Es Martes, Es Asesinato | Disney+ España (2026) | tt32474482 | 20 | 15 | No verificado |
| 14 | Se Tiene Que Morir Mucha Gente | Movistar Plus+ (2026) | tt37050740 | 3 | 3 | No verificado |
| 15 | Muertos, S.L. | Movistar Plus+/Netflix (2024-2026) | tt29614148 | 3 | 2 | No verificado |
| 16 | El Fantasma de Mi Mujer | Comedia sobrenatural española (2026) | tt36120705 | 2 | 1 | No verificado |
| 17 | Spider-Man: Un Nuevo Día | Brand New Day — **estrena 31/07/2026, todavía NO salió** | tt22084616 | **No testeado** — no tiene sentido, no estrenó | — | — |
| 18 | Enola Holmes 3 | Netflix, ya estrenó 01/07/2026 | tt32278481 | 76 | 69 | No verificado — **familiar, prioridad Fase 2** |
| 19 | Minions y Monstruos | Título real confirmado (no era error), cines fines de junio 2026 | tt32890033 | 1 | 1 | No verificado — **infantil, prioridad Fase 2. Solo 1 stream: esperable, recién ~2 semanas de estreno en cines, sin release digital todavía (causa b/nueva)** |
| 20 | The Eternaut / El Eternauta | Netflix Argentina, T1 ya estrenó 30/04/2025 (no es "próximo"); T2 recién 2027 | tt27740241 | 31 | 25 | No verificado |
| 21 | Murder Mindfully T2 | Achtsam Morden S2 (28/05/2026) | tt30217222:2:1 | 19 | 18 | No verificado |
| 22 | How to Get to Heaven from Belfast | **Corrección: es Netflix, no BBC** (se movió de Channel 4 a Netflix) | tt31709373 | 29 | 28 | No verificado |

\* Streams contados **solo contra Torrentio** (probado sin login, reconstruyendo su URL con la
TorBox key ya conocida de esta sesión). Comet, NoTorrent, WebStreamrMBG, Nuvio Streams, Meteor y
los 4 addons de subtítulos requieren login — no se testearon en esta pasada. El total real de
streams por título en Fase 2 completa va a ser mayor a lo de esta tabla.

**Diagnóstico de los 0 streams** (`Veteranos contra el crimen`, `Das Quartett`):
**causa (a)** — contenido policial/criminal alemán de canal chico (COSMO, ZDF), el mismo patrón
ya documentado varias veces en `CLAUDE.md` para nicho alemán (Höllental, Die Toten von Marnow):
casi no circula en los trackers/scrapers públicos que indexan Torrentio, optimizados para
contenido masivo en inglés. No descarto que Comet (que busca en fuentes algo distintas) encuentre
algo — pendiente de confirmar con login.

## 3. Contenido rescatado pese a restricción geográfica (razonamiento, sin verificar en vivo)

De la lista, estos son candidatos típicos a **no estar disponibles con cuenta de streaming
Argentina** aunque la persona pague Netflix/HBO/Disney+, porque son producciones europeas de
nicho que rara vez se licencian fuera de su región de origen:

- **Dogs of Berlin**, **Veteranos contra el crimen**, **Das Quartett**, **Einstein** (Alemania)
- **Passenger**, **El Club de Asesinatos de Marlow**, **How to Get to Heaven from Belfast** (Reino
  Unido/Irlanda)

**No pude confirmar en vivo** que estos títulos aparezcan en el catálogo de "Streaming Catalogs"
(`pw.ers.netflix-catalog`) ni que reproduzcan streams reales de forma independiente a la licencia
regional — ambas cosas requieren la colección real de la cuenta (login). Lo que sí puedo confirmar
con el test parcial de la Fase 2: **Dogs of Berlin, Einstein, Passenger y El Club de Asesinatos de
Marlow ya tienen streams reales vía Torrentio** (32, 7, 17 y 11 respectivamente) — el mecanismo de
addons de streams (que no depende de licencias, busca en trackers públicos) efectivamente no
respeta la restricción geográfica de las plataformas oficiales. Veteranos contra el crimen y Das
Quartett son los dos casos donde ni siquiera el mecanismo "rescate" encuentra algo, por ser
demasiado nicho incluso para eso (ver diagnóstico arriba). **Pendiente**: confirmar con login que
estos 7 títulos aparecen listados en el catálogo de Streaming Catalogs de la cuenta.

## 4. Curación de catálogos (Fase 4) — propuesta concreta, NO aplicada

Revisé `data/preset.json` (153 catálogos) buscando cobertura de "crimen europeo/policial" para el
perfil de gusto que muestra esta lista (fuerte inclinación a crimen/misterio alemán y británico).
Encontré:

- `tmdb.discover.movie.crime_movies.80` ("Crime Movies") y `tmdb.discover.tv.crime_shows.80`
  ("Crime Shows") — catálogos genéricos por género (mundiales, no filtran por país).
- `Series Alemania` y `Series Reino Unido` (`with_origin_country: DE` / `GB`) — catálogos por país,
  sin filtrar por género.

Los 4 están `enabled:true` pero **`showInHome:false`** — viven en Descubrir, no en el inicio. Esto
es **intencional**, no un descuido: `CLAUDE.md` documenta que Pablo eligió el "Inicio curado
(opción A)" el 2026-06-19 — solo En Cartelera/Próximos Estrenos/Tendencias van al inicio; géneros,
países, décadas y plataformas quedan deliberadamente fuera. **No cambié ese `showInHome`** porque
tocaría una decisión de diseño que ya tomaste explícitamente, no algo que se me haya pedido revisar
en este pedido puntual.

**Lo que sí propongo** (no aplicado, pendiente tu confirmación + la password de config de
AIOMetadata que no tengo en esta sesión): reordenar la posición de esos 4 catálogos dentro del
array `catalogs.standard` para que aparezcan más arriba en Descubrir (no en el inicio, dentro de
su categoría actual) — un cambio menor, reversible, que no toca `showInHome`. Si querés que lo
aplique, decime y lo hago con `regenerate-aiometadata.mjs --apply` en la próxima sesión con
credenciales.

**MyTrakt Sync / recomendaciones reales**: **ya resuelto**, no pendiente. `CLAUDE.md` documenta que
el 2026-07-02 se migró de AIOLists (que había quedado con catálogos genéricos tipo MDBList/Search)
a MyTrakt Sync, con 10 catálogos reales conectados a Trakt: Continue Watching, Watchlist,
Recommended, Trending y Popular (Movies/TV). Esto ya no es el estado "quedó con MDBList en vez de
Recommended" que menciona el pedido — esa era la situación vieja con AIOLists, ya superada.

**Fechas de En Cartelera/Próximos Estrenos**: estaban desactualizadas (última vez 2026-07-03, hace
8 días). Corrí `node scripts/refresh-dates.mjs` — **actualicé el `preset.json` local** (ventana
movida a hoy 2026-07-11, mismo ancho de 75 días para En Cartelera, ya validado con
`validate-config.mjs`). **Falta el paso final**: `regenerate-aiometadata.mjs --apply` para que la
instancia en vivo de AIOMetadata tome estas fechas nuevas — bloqueado, necesita la password de
config de AIOMetadata (distinta de la de Stremio) que no vino en este pedido.

## 5. Salud general del sistema

- **Backup antes de escribir**: no aplica todavía — no hubo ninguna escritura a la cuenta esta
  sesión (todo lo hecho fue local: `preset.json`, este reporte, el JSON de test). Cuando se
  apliquen los cambios de Fase 4 pendientes, se hace backup antes, como siempre.
- **`health-check.mjs`**: el más reciente que corrió con credenciales fue durante la integración de
  TorBox, minutos antes de este pedido (mismo estado de cuenta, nada cambió desde entonces salvo
  archivos locales) — dio **✅ Todo OK**, 18 addons, sin duplicados, streams y subs verdes. No corrí
  uno nuevo en esta sesión porque no hay credenciales; el de recién sigue siendo válido como
  fotografía del estado real.
- **`test-content.mjs`** (14 títulos curados): mismo bloqueo, no corrido en esta sesión.
- **WebStreamrMBG — exit code**: **ya estaba resuelto**, no hacía falta tocar nada. `health-check.mjs`
  ya tiene reintento genérico (línea ~49-170): si un manifest falla, reintenta una vez tras 3s y si
  se recupera queda como `⚠` (warning), no dispara `exitCode=1`. Confirmado en el propio
  health-check de recién: `⚠ WebStreamrMBG: v0.73.2 (OK recién al reintento — blip transitorio)`
  sin romper el resultado global.
- **Dependencia de localhost/PC prendida**: confirmado que no — todos los addons de streams
  (Torrentio `torrentio.strem.fun`, Comet/Nuvio/MyTrakt/SubMaker en ElfHosted, NoTorrent/
  WebStreamrMBG/Meteor en sus propios hosts) y los servicios propios (keep-warm, health-monitor,
  SubDL/Audio Latino en Deno Deploy) corren 100% en la nube — ver sección "Infraestructura
  cloud-only" de `CLAUDE.md`, sin cambios desde la última verificación.

## 6. Pendientes que necesitan tu acción

1. **ST_EMAIL / ST_PASS** (o un authKey real) — para completar Fase 2 en los 5 addons de streams +
   4 de subtítulos, correr backup + health-check + test-content.mjs frescos, y aplicar la Fase 4.
2. **Password de config de AIOMetadata** (la de `/api/config/save`, distinta de la de Stremio) —
   para `regenerate-aiometadata.mjs --apply` con las fechas ya refrescadas localmente.
3. **"Grams"** — no lo pude identificar. Si me das más contexto (plataforma, año aproximado, de
   qué trata) lo busco de nuevo.
4. **Confirmación** sobre si aplicar el reorden de catálogos de crimen/país propuesto en Fase 4
   (o dejarlo como está).
5. **Verificación en vivo pendiente** (Fase 3): confirmar que los 7 títulos europeos de nicho
   aparecen en "Streaming Catalogs" y reproducen — necesita login.

## 7. CLAUDE.md

Actualizado con una entrada nueva resumiendo esta sesión (ver sección "Sesión 'siesta'
2026-07-11" en el archivo) — qué se identificó, qué quedó pendiente y por qué, para que la
próxima sesión no tenga que releer este reporte entero.
