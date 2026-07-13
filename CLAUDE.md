# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio.

# MejoraStremio

**Caja de herramientas personal de mantenimiento de una cuenta de Stremio** (la de Pablo,
`stremioeg@gmail.com`), operada por terminal contra las APIs de Stremio y de los addons. **No es
una app web.**

Empezó como un fork de la SPA
[DryKillLogic/stremio-account-bootstrapper](https://github.com/DryKillLogic/stremio-account-bootstrapper)
— un wizard web que instalaba un preset de addons. El 2026-06-19 se **eliminó toda la SPA** (Vue,
Vite, deploy a GitHub Pages, etc.): Pablo gestiona el setup por terminal, no usaba el sitio. El
sitio `pabloeckert.github.io/MejoraStremio` se despublicó. El historial de git conserva la versión
SPA si alguna vez hiciera falta.

## Estructura

```
data/preset.json                    Fuente de verdad de los catálogos de AIOMetadata (config
                                    completa + definición de catálogos). Reconstruye la config.
data/test-content.json              Lista curada de contenido de nicho (series/pelis europeas
                                    2020-hoy) con IMDb ids; insumo de test-content.mjs.
data/anti-frustration-log.json      Registro de títulos que "no abren" (streams sin cobertura real)
                                    y su estado; ver scripts/anti-frustration.mjs abajo.
scripts/health-check.mjs            Auditoría de la cuenta y los addons (ver abajo).
scripts/anti-frustration.mjs        Registra/revisa títulos sin streams reales (add/review/list) y
                                    detecta audio latino en contenido familiar/infantil. Ver abajo.
scripts/deno-latino-catalog-addon.ts Addon Stremio (Deno Deploy) que expone un catálogo con el
                                    contenido familiar/infantil con audio latino confirmado en
                                    data/anti-frustration-log.json. No deployado todavía.
scripts/test-content.mjs            Prueba streams + subs ES de data/test-content.json contra los
                                    addons reales instalados (ST_PASS). Reporta, no escribe.
scripts/test-subdl.mjs              Mide subs ES sin SDH (hi=false) en SubDL para data/test-content.json
                                    (SUBDL_KEY). Reporta, no escribe.
scripts/validate-config.mjs         Valida el schema de preset.json (sin red ni credenciales).
scripts/audit-catalog-order.mjs     Audita el orden de los catálogos del inicio (solo reporta).
scripts/regenerate-aiometadata.mjs  Regenera la instancia de AIOMetadata desde el preset; reporta
                                    por defecto, swap en la cuenta con --apply (guard anti-pérdida).
scripts/refresh-dates.mjs           Recalcula las fechas de En Cartelera/Próximos Estrenos a hoy
                                    (--check para auditar sin escribir).
scripts/fix-subtitles.*             Regenera la config de SubSense (.mjs Node, .ps1 PowerShell).
scripts/swap-aiolists-mytrakt.mjs   Script de un solo uso: reemplazó AIOLists por MyTrakt Sync en
                                    la colección (ver "MyTrakt Sync" abajo). Mantener como referencia
                                    del patrón, no se espera reusarlo salvo otro swap de addon único.
scripts/lib/collection-guard.mjs    Guard compartido: antes de cualquier addonCollectionSet, aborta
                                    si un addon no modificado en la corrida quedaría con catalogs=[]
                                    pese a tener catálogos reales en su manifest en vivo. Ver "Bug
                                    real: catalogs:[] indiscriminado" más abajo.
scripts/repair-frozen-catalogs.mjs  Detecta y restaura addons con manifest.catalogs congelado en 0
                                    en el storage de Stremio (sin tocar transportUrl/orden/config).
                                    Reporta por defecto, escribe con --apply.
scripts/reorder-addons.mjs          Mueve un addon al índice 0, o justo después de otro addon con
                                    --after <manifest.id> (usado para MyTrakt Sync/Streailer, ver
                                    abajo). Guard anti-congelado + backup antes de aplicar.
scripts/update-addon-url.mjs        Cambia el transportUrl de un addon ya instalado (mismo
                                    manifest.id, sin duplicar la entrada) y refresca su manifest.
                                    Útil cuando un addon migra de infraestructura del lado del
                                    proveedor (usado para NoTorrent, ver abajo). Guard + backup.
```

Los scripts son Node ≥ 20 sin dependencias (`fetch`/`https` nativos). No hay `package.json` ni
build: es un toolkit, no un paquete. No usar `npm install`. Credenciales (`ST_EMAIL`, `ST_PASS`,
`TORBOX_API_KEY`, `AIO_PASSWORD`, `SUBDL_KEY`) van en `SECRETS.local.md` (gitignorado, formato
`CLAVE=valor`) — cargarlas como variables de entorno antes de correr cualquier script que las pida.

## Comandos

**Diagnóstico (solo leen, no requieren credenciales para lo básico):**
```
node scripts/validate-config.mjs                 # valida el schema de preset.json (sin red)
node scripts/audit-catalog-order.mjs              # audita orden de catálogos del inicio
node scripts/health-check.mjs                     # chequeo público (manifests); con ST_EMAIL/ST_PASS es dinámico y prueba streams/subs/búsqueda reales
ST_EMAIL=... ST_PASS=... node scripts/test-content.mjs   # prueba streams+subs de data/test-content.json
node scripts/refresh-dates.mjs --check            # audita si las fechas de En Cartelera/Estrenos están vencidas
SUBDL_KEY=... node scripts/test-subdl.mjs         # mide cobertura de subs SubDL sin SDH
ST_EMAIL=... ST_PASS=... node scripts/anti-frustration.mjs list    # resumen del log antifrustración
ST_EMAIL=... ST_PASS=... node scripts/anti-frustration.mjs review  # re-chequea títulos "pendiente"
```

**Escritura contra la cuenta real** (todos son dry-run por defecto; agregar `--apply` para escribir.
Todos hacen backup en `.backups/` antes de aplicar y corren `assertNoFrozenEmptyCatalogs` —
`scripts/lib/collection-guard.mjs` — cuando tocan `addonCollectionSet`):
```
node scripts/refresh-dates.mjs                                        # recalcula ventana de fechas en preset.json (sin red)
AIO_PASSWORD=... ST_EMAIL=... ST_PASS=... node scripts/regenerate-aiometadata.mjs [--apply] [--force]
ST_EMAIL=... ST_PASS=... node scripts/reorder-addons.mjs <manifest.id> [--after <otro.manifest.id>] [--apply]
ST_EMAIL=... ST_PASS=... node scripts/repair-frozen-catalogs.mjs [--apply]   # restaura catalogs=[] congelados
ST_EMAIL=... ST_PASS=... node scripts/update-addon-url.mjs <manifest.id> <nuevaTransportUrl> [--apply]
ST_EMAIL=... ST_PASS=... TORBOX_API_KEY=... node scripts/apply-torbox-profile.mjs [--apply]
ST_EMAIL=... ST_PASS=... node scripts/apply-friction-zero-sort.mjs [--apply]
ST_EMAIL=... ST_PASS=... node scripts/curate-streaming-catalogs.mjs [--apply]
ST_EMAIL=... ST_PASS=... node scripts/anti-frustration.mjs add <imdbId> [movie|series] [season] [episode] ["título"]
```
`scripts/apply-cgnat-profile.mjs` y `scripts/swap-aiolists-mytrakt.mjs` son de un solo uso
histórico (ver "Perfil CGNAT temporal" y "MyTrakt Sync" abajo) — mantener como referencia del
patrón, no correr de nuevo salvo un caso equivalente.

Después de cualquier `--apply` real: correr `health-check.mjs` y `test-content.mjs` antes/después
para confirmar que no hay regresiones, y verificar con `addonCollectionGet` (o el propio guard) que
ningún addon quedó con catálogos congelados.

## Estado actual de la cuenta (stremioeg, 2026-07-13)

18 addons (idx 17 = "Audio Latino (verificado)", catálogo propio en Deno Deploy, ver más abajo).
**AIOMetadata en índice 0** (UUID **`82055fec-d0e2-4109-bdd0-2da9975ffa1e`**, regenerado 2026-07-12
al aplicar sort por fecha desc/asc + piso de calidad en En Cartelera/Próximos Estrenos — ver
"Sesión 2026-07-12 — orden por fecha" más abajo — reemplaza a `861ff75d-...`), **Cinemeta en
índice 1** (invertidos el 2026-07-13 para arreglar la metadata en inglés — ver "Sesión 2026-07-13"
más abajo; Cinemeta se mantiene instalado como red de resiliencia, ya no compite por ganar la
metadata). **MyTrakt Sync** (UUID **`13e948e9-04c8-4917-a0d5-96af15b63d2f`**) sigue en **índice 9,
justo después de Streailer** (pedido explícito de Pablo el 2026-07-12) — reemplazó a AIOLists
deprecado, ver "MyTrakt Sync" abajo. 153 catálogos en `preset.json` (125 enabled); el manifest
expone ~132 (125 + ~7 catálogos de búsqueda que AIOMetadata inyecta). Catálogos: globales (Trending,
Latest, Top Rated, géneros, plataformas + Top 10 FlixPatrol, décadas), 15 países occidentales
(Argentina, Latam, España, Francia, Alemania, Italia, Reino Unido, Portugal, México, Colombia, Chile,
Brasil, Perú, EE.UU., Canadá + Oceanía), **7 países de Asia** con filtro de calidad (Japón, Corea,
China, Taiwán, Tailandia, Hong Kong, India — `vote_count.gte` alto + `vote_average.gte=7`),
"Próximos Estrenos", "En Cartelera", y búsqueda por título y por actor. **Idioma TMDB: `es`** (sinopsis
y títulos en español). **Inicio curado (opción A)**: solo En Cartelera + Próximos Estrenos + Tendencias
(Trending/Latest/Top Rated/Best 2020s) tienen `showInHome=true`; géneros, países, décadas y
plataformas quedan en `enabled=true` pero fuera del inicio (navegables en Descubrir). Trakt y Simkl
conectados. **Streams** (idx 2-7 desde el reorden de MyTrakt del 2026-07-12 — antes idx 3-8;
**reordenados originalmente 2026-07-11** al integrar TorBox — ver
`## TorBox (debrid activo)` más abajo, que supera al perfil temporal CGNAT de 2026-07-09):
Torrentio (idx 2, **TorBox** como debrid — 24 proveedores habilitados, se agregaron
Wolfmax4k/BestTorrents/Rutracker/Torrent9/Comando/BluDV/MicoLeaoDublado/ilCorSaRoNeRo/nekoBT/Rutor
para mejorar cobertura de contenido en español/portugués) → Comet (idx 3, **TorBox** como debrid,
`enableTorrent:false`) → NoTorrent (idx 4, scraper HTTP, `transportUrl` migrado el 2026-07-13 de
`addon-osvh.onrender.com` a `addon.notorrent2.workers.dev` — ver "Sesión 2026-07-13" más abajo)
→ WebStreamrMBG (idx 5, scraper HTTP, a
veces tarda >15s en responder o da 504 en el endpoint de streams — timeout/gateway flaky conocido)
→ **Nuvio Streams** (idx 6, ElfHosted, respaldado por Cuevana/Xprime — scraper HTTP con foco en
streaming services) → Meteor (idx 7, P2P puro sin debrid, va último porque a veces sólo tiene
torrents sin seeds que "cargan y nunca arrancan" — mitigado desde 2026-07-09 con un filtro
`minSeeders:1`, que se mantiene porque Meteor no tiene debrid y el CGNAT lo sigue afectando igual,
ver perfil CGNAT). Tabla de clasificación (relevante para el perfil CGNAT, ahora superado para
Torrentio/Comet):

| Addon | Tipo | Depende de conexión P2P entrante |
|---|---|---|
| Torrentio | TorBox (debrid) | No — TorBox descarga en sus propios servidores |
| Comet | TorBox (debrid) | No — TorBox descarga en sus propios servidores |
| NoTorrent | HTTP scraper | No |
| WebStreamrMBG | HTTP scraper | No |
| Nuvio Streams | HTTP scraper | No |
| Meteor | P2P puro, sin debrid | Sí |

Subtítulos (orden): SubSense (idx 11) → SubMaker ElfHosted (idx 12) → SubDL Deno
(idx 13, `mejorastremio.pabloeckert.deno.net`) → OpenSubtitles v3 (idx 14). Catálogos de Mubi via
"Mubi Catalog" y plataformas via "Streaming Catalogs" (addons aparte, idx 10 y 15).

**MyTrakt Sync** (`trakt.addon.v3.13e948e9-04c8-4917-a0d5-96af15b63d2f`, hosteado en ElfHosted,
**índice 9** desde el 2026-07-12 — ver sección de esa fecha, antes índice 2) reemplazó a AIOLists
(deprecado por ElfHosted el 2026-07-01) y da las recomendaciones por gustos:
10 catálogos — Continue Watching (Movies/TV), Watchlist (Movie/TV), Recommended (Movies/TV),
Trending (Movies/TV) y Popular (Movies/TV). Conectado a Trakt (`jarvis-15483776`). URL del manifest:
`https://mytrakt.elfhosted.com/addon/13e948e9-04c8-4917-a0d5-96af15b63d2f/manifest.json` — es la
instancia que controla Pablo (passkey guardado en memoria). Swap hecho con
`scripts/swap-aiolists-mytrakt.mjs --apply` (backup previo en `.backups/`); health-check post-swap
verde. Detalle completo del conflicto de dos cuentas MyTrakt que bloqueó esto varios días, resuelto
por soporte el 2026-07-02, en "MyTrakt Sync — migración desde AIOLists" más abajo.

## Mantenimiento

### Script de health-check

```
node scripts/health-check.mjs
ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/health-check.mjs
```

Con credenciales hace una auditoría **dinámica**: lee la colección real de la cuenta y prueba los
addons efectivamente instalados (no una lista hardcodeada). Verifica 5 cosas:
1. Cuenta: login, ≥10 addons, y **ningún `manifest.id` duplicado** (guard de regresión: la
   colisión de id es lo que rompía la búsqueda — ver abajo).
2. Manifests: cada addon instalado responde su manifest (normaliza URLs sin `manifest.json`).
3. Catálogos + búsqueda de AIOMetadata: muestrea catálogos y prueba búsqueda por título y por
   actor (`people_search`).
4. Streams: prueba TODOS los addons de streams (Torrentio, Comet, Meteor, NoTorrent, WebStreamr),
   incluyendo un título de nicho (Will Trent) para no dar falsos OK.
5. Subtítulos: prueba SubSense + OpenSubtitles v3 para español.

Sin credenciales degrada a verificar manifests públicos. Exit code 0 = todo OK.

### Registro "antifrustración" (2026-07-02)

Pablo pidió un mecanismo persistente para cuando un título "se ve en el catálogo pero no abre"
(streams que cargan sin fin o no aparecen) — que quede registrado y se pueda revisar cada tanto,
en vez de re-diagnosticar todo a mano cada vez (como se hizo con Los Mufas/El Marginal el
2026-07-01 y Balthazar el 2026-07-02).

`scripts/anti-frustration.mjs` (Node, sin deps, mismo estilo que el resto del repo):

```
node scripts/anti-frustration.mjs add <imdbId> [movie|series] [season] [episode] ["título"]
node scripts/anti-frustration.mjs review   # re-chequea todo lo "pendiente"
node scripts/anti-frustration.mjs list     # resumen del log
```

- Prueba streams contra TODOS los addons de streams instalados y cuenta como "real" un stream sin
  contador de seeds (addons HTTP: NoTorrent/WebStreamrMBG/Nuvio/Streailer) o con seeds > 0
  (Torrentio, que sí expone `👤 N`). **Meteor se excluye del conteo** — no expone contador de seeds
  y tiene fama documentada de dar torrents sin seeds que "cargan y nunca arrancan"; sin forma de
  verificarlo, no cuenta como señal de que algo abre.
- **Filtra los "streams" de MyTrakt Sync** (`[MyTrakt] Mark Watched / Add to Watchlist / Remove
  from Watchlist` — un mp4 de 27KB para scrobbling, detectable por `behaviorHints.bingeGroup`
  empezando con `mytrakt-`): no son contenido, y si no se descartan inflan el conteo con un +3 fijo
  en CUALQUIER título (bug real encontrado al testear: Los Mufas y El Marginal mostraban "3 streams
  reales" antes del fix, cuando en realidad tienen 0).
- Resuelto si el total de streams reales ≥ 3 (`RESOLVED_THRESHOLD`); si no, queda "pendiente".
- Para títulos de género `Animation`/`Family` (via Cinemeta `meta.genre`), además busca audio latino
  en los títulos de los streams (`🇲🇽`/`🇦🇷`/`🇨🇴` o la palabra "latino") — pedido de Pablo: para
  contenido familiar/adolescente/infantil, registrar si hay alternativa de audio latino.
- Log persistido en `data/anti-frustration-log.json` (versionado en git, no gitignoreado).
- **Revisión automática semanal**: `.github/workflows/anti-frustration-review.yml` (domingos, cloud,
  igual que health-monitor) corre `review`, commitea el log actualizado y manda un resumen a
  `pabloeckert@gmail.com` de qué se resolvió y qué sigue pendiente.

**Catálogo de audio latino — deployado e instalado (2026-07-02)**: `scripts/deno-latino-catalog-addon.ts`
expone un catálogo Stremio (`Audio Latino (verificado)`, movie+series) con los títulos del log que
son `isFamily && latino.found`. Lee el log en vivo desde GitHub raw (cache 10 min) — no hace falta
redeployar cuando se agregan títulos nuevos al log. Mismo patrón que `scripts/deno-subdl-addon.ts`
(Deno Deploy, gratis, sin api key). **Deployado en Deno Deploy** (proyecto `mejorastremio-latino`
en la org `pabloeckert`) → `https://mejorastremio-latino.pabloeckert.deno.net/manifest.json` →
instalado en la colección de Stremio en **índice 17** (18 addons totales). Health-check verde
post-instalación.

### Búsqueda rota por `manifest.id` duplicado (resuelto 2026-06-19)

Stremio identifica addons por `manifest.id`, **no** por `transportUrl`. Dos instancias del mismo
addon con el mismo id (típico: dos AIOMetadata, cuyo id `aio-metadata` es fijo) rompen la búsqueda
global aunque cada backend responda bien por separado. La cuenta tenía dos AIOMetadata; se
consolidaron en una sola. El health-check ahora falla si detecta ids duplicados.

### AIOMetadata — reconstruir/editar la instancia

La config se guarda con un POST a `https://aiometadata.elfhosted.com/api/config/save` con
`{ config, password }`; devuelve `installUrl` (un UUID nuevo). Para validar sin instalar: GET ese
`manifest.json` y luego `catalog/<type>/<id>.json` para ver resultados reales. La base de `config`
está en `data/preset.json` → `aioMetadataConfig.config`; los catálogos en `aioMetadataConfig.catalogs.standard`
(cada uno con `metadata.discover.params` = lo que va a TMDB Discover, y `formState` = espejo para
el Catalog Builder web). Los `pablo0NN` son catálogos custom (países, Próximos Estrenos, En Cartelera).

- **Búsqueda por actor**: usar el catálogo dedicado `people_search.people_search_movie/series` (no
  el agregador `search.movie`, que devuelve documentales SOBRE el actor en vez de su filmografía).
  Requiere `search.engineEnabled.people_search_movie/series = true`.
- **`hideUnreleasedDigital` debe ser `false`** para que "Próximos Estrenos"/"En Cartelera" devuelvan
  resultados (con `true` AIOMetadata oculta todo lo no estrenado, sin override por catálogo). Costo:
  catálogos como Trending mezclan algún título aún no disponible.
- **Caveat de fechas**: "Próximos Estrenos"/"En Cartelera" usan fechas absolutas
  (`primary_release_date.gte/lte`) fijadas al generar el JSON. TMDB Discover no soporta fechas
  relativas → se degradan con los meses. **Refrescar**: `node scripts/refresh-dates.mjs` (recalcula
  la ventana deslizante a hoy en el preset) y después `node scripts/regenerate-aiometadata.mjs
  --apply`. El refresh preserva el ancho de ventana existente (75 días para En Cartelera) y es
  idempotente (si ya está al día, no hace nada). Pensado para automatizar (cron/Task Scheduler).
- **Trakt/Simkl**: los tokens OAuth viven server-side y NO aparecen en `config.apiKeys`. Hallazgo
  2026-06-19: parecen compartidos a nivel cuenta de ElfHosted (leer `/api/config?id=<cualquier-uuid>`
  devuelve los tokens reales). Al regenerar la instancia conviene **pasar `trakt`/`simkl` en el
  payload del save** (top-level, `config.trakt/simkl` y `config.apiKeys.trakt/simkl`); el swap del
  2026-06-19 (añadir "En Cartelera") se hizo así y la instancia nueva mostró los tokens. **Confirmar
  igual en la app** (que el watch-tracking siga andando) tras cualquier regeneración; si falla,
  restaurar la colección (los UUID viejos persisten en el server → reversible).
- **El save exige `password` no vacío** (`"Password is required"`). Es el password del config de
  AIOMetadata, **distinto del de la cuenta Stremio**. El de la cuenta sirve para el login de la API
  (`/api/login`); el del config para `/api/config/save`. No confundirlos.
- **El GET `/api/config?id=<uuid>` NO devuelve los catálogos** (solo config reducida + tokens). No
  hay endpoint público para leer la lista de catálogos de una instancia → la fuente para
  reconstruir es **`data/preset.json`**, y por eso hay que mantenerlo sincronizado (ver drift abajo).

### Reorden del inicio + drift de preset.json (2026-06-19)

Pablo quería que la pantalla de inicio abriera con **En Cartelera → Próximos Estrenos → Tendencias →
Géneros → Países → Plataformas/Top 10 al fondo** (antes En Cartelera/Estrenos quedaban ÚLTIMOS, bajo
18 catálogos de plataformas). El orden del board lo determina el orden de los catálogos en el
manifest de AIOMetadata = el orden del array `catalogs.standard`. Se reordenó el array y se regeneró.

- **Auditar el orden**: `node scripts/audit-catalog-order.mjs` (`--json` para salida de máquina).
  Lee `preset.json`, muestra el orden actual de los catálogos visibles (`showInHome && enabled`),
  marca desvíos y propone el orden a gusto. Solo reporta, no escribe.
- **DRIFT detectado**: `preset.json` se había desincronizado de la instancia en vivo — le faltaban
  **11 países (×2 = 22 catálogos)**: España, Francia, Alemania, Italia, Reino Unido, Portugal,
  México, Colombia, Chile, Brasil, Perú (ids `tmdb.discover.{movie,tv}.<cc>.pabloNN`, con
  `with_origin_country=<CC>`). Regenerar desde el preset viejo los habría borrado. Se reconstruyeron
  clonando el template de Argentina (`pablo001/002`). **Lección: antes de cualquier swap, diffear el
  manifest NUEVO contra el de la instancia EN VIVO y confirmar CERO catálogos perdidos.**
- preset.json ahora tiene **153 catálogos** en `standard` (125 enabled; el manifest expone ~132 =
  125 + ~7 catálogos de búsqueda que AIOMetadata inyecta). Última adición: 7 países de Asia
  con filtro de calidad (2026-07-01).
- "New on MUBI" / plataformas vienen de los addons **"Mubi Catalog"** y **"Streaming Catalogs"**, no
  de AIOMetadata. Su prioridad en el board depende del **orden de la colección de addons**, no del
  preset. Mubi está en posición baja (índice 8 de 14); el reorden de AIOMetadata ya lo despriorizó.
- **Orden de la colección (2026-06-30, revertido 2026-07-13)**: Cinemeta en **índice 0**, AIOMetadata
  en **índice 1**, AIOLists en **índice 2**. Cambio respecto a 2026-06-19 (cuando AIOMetadata estaba
  en #0): Cinemeta volvió al #0 para resolver cortes de pantalla — el cold start de AIOMetadata en
  ElfHosted colgaba la carga inicial de la app hasta que el keep-warm de GitHub Actions lo calentaba.
  Con Cinemeta en #0 la app siempre arranca. Cinemeta expone Popular/New/Featured que se pisan con
  Tendencias/Latest de AIOMetadata — ocultado desde la app (Board → configurar catálogos).
  **Este orden se revirtió el 2026-07-13** (AIOMetadata volvió a #0, Cinemeta a #1) al confirmarse
  que tenía un efecto secundario serio no previsto: rompía el idioma de la metadata en toda la app —
  ver "Sesión 2026-07-13 — metadata en inglés y migración de NoTorrent" más abajo para el diagnóstico
  completo y la razón de por qué revertirlo ya no era tan riesgoso como en 2026-06-30. Reversible vía
  `addonCollectionSet` con el backup en `.backups/`.

### Metadata en español — títulos sí, sinopsis no (verificado 2026-07-02)

Con `config.language: "es"` (cambiado 2026-07-01), verificado contra la instancia en vivo
(`6c91e26e-...`): **el título/nombre SÍ viene en español** ("Super Mario Bros: La película", "El
día de la revelación"), pero **la sinopsis/descripción sigue en inglés** en meta y en catálogo, en
varios títulos populares (Matrix, Coco, Oppenheimer, Super Mario). No hay un campo de config
separado para el idioma de la descripción (`data/preset.json` solo tiene `language`). Parece una
limitación del addon (probablemente trae el "overview" de una fuente/llamada que no respeta el
locale) — no hay nada más para ajustar desde nuestro lado sin tocar el código de AIOMetadata en sí.

**Búsqueda por palabra clave**: confirmada funcionando (`search=zombie` → 16 resultados). **Búsqueda/
filtro por año**: el catálogo de Trending solo expone extras `genre` (Day/Week) y `skip`, sin
extra de año — no se encontró un catálogo con filtro de año nativo; si hace falta, se puede armar
un catálogo custom en el Catalog Builder con rango de fecha (como ya se hizo para Estrenos).

**Subtítulos, variante latino vs. España — limitación CONFIRMADA, investigada a fondo (2026-07-12)**:
los 4 addons de subtítulos (SubSense, SubMaker, SubDL, OpenSubtitles v3) devuelven el idioma como
`lang: "spa"` genérico, sin distinguir la variante regional de forma filtrable. Investigado a pedido
de Pablo tras un caso real (El Diablo Viste a la Moda 2 reprodujo con subtítulo de España en vez de
latino):
- **Causa de fondo, no un descuido nuestro**: el protocolo de subtítulos de Stremio y las fuentes
  que usan estos addons (OpenSubtitles, SubDL) taxonomizan el español con un solo código ISO-639
  (`spa`/`ES`) — **confirmado contra la documentación oficial de SubDL**
  (`subdl.com/api-files/language_list.json`): un único `"ES": "Spanish"`, sin variante LatAm/México/
  Argentina. No es que nuestros addons no configuren bien un parámetro que existe — el parámetro no
  existe en ningún lado de la cadena.
- **Probado empíricamente contra SubSense** (que sí acepta un array `languages` en su config):
  `es-419`, `es-MX`, `es-AR`, `spa-419` y `lat` NO filtran nada — cualquier código que no sea
  exactamente `"es"` hace que SubSense ignore el filtro y devuelva resultados sin filtrar (mayoría
  en inglés). Solo `"es"` funciona, y no distingue variante.
- **SubSense es el único de los 4 que expone un hint de región**, pero solo en campos descriptivos
  no filtrables (`fileName`/`releaseName`/`label`/`releases`) cuando el uploader original tageó el
  release — ej. para El Diablo Viste a la Moda 2 apareció `es-419` en el filename y hasta el texto
  "en Español (Latinoamericano)" en `releases`. Esto es inconsistente (probado con Matrix/Breaking
  Bad vía SubDL: sus nombres de archivo no traen ningún hint de región) y no se puede usar como
  parámetro de filtro/orden — solo ayuda si Stremio muestra ese texto en el selector y el usuario lo
  lee a mano (mismo mecanismo ya documentado, sin cambios).
- **Conclusión**: no hay nada más para configurar de nuestro lado. Es una limitación real de la
  taxonomía de idiomas que usan estos addons, no del proyecto — no reinvestigar esto en el futuro
  salvo que alguno de los 4 addons cambie de proveedor de subtítulos. Elegir la variante correcta
  sigue quedando a criterio del usuario al ver el nombre del release en el selector de Stremio.

### Streaming Catalogs — regla de cobertura regional (2026-07-02)

Pablo fijó el criterio para qué servicios mantener en el addon "Streaming Catalogs"
(`pw.ers.netflix-catalog`, idx 15): **Europa occidental + todo el continente americano ("de
Ushuaia a Alaska") + Oceanía van TODOS**, sin filtrar por si el servicio llega a Argentina/España o
no (a Pablo le sirve el catálogo igual, ver `project_content_taste` en memoria). **Asia, Medio
Oriente y África solo si están comprobados y valorados** — ninguno lo está todavía, quedan afuera.

`scripts/curate-streaming-catalogs.mjs` (mismo script, KEEP list actualizada) pasó de 19 a **30
servicios** (sumó Netflix Kids, Curiosity Stream, MagellanTV, NLZIET, Hayu, Videoland, Mubi, Acorn
TV, BritBox, Criterion Channel, Shudder — 56 catálogos en el manifest). Excluidos por ahora:
Crunchyroll, JioHotstar, Zee5, Rakuten Viki, Sony Liv, iQIYI, Shahid VIP (todos Asia/Medio Oriente).
Aplicado con `--apply`, backup en `.backups/`, health-check verde post-cambio.

### SubSense — reglas críticas

Token con formato `{userId}-{configString}`:
- `userId` debe ser **exactamente 8 caracteres**. Con más, el servidor devuelve solo inglés.
- `configString` = `encodeURIComponent(JSON.stringify({languages:["es"],maxSubtitles:20}))`
- Idioma: `"es"` (NO `"spa"`, `"es-AR"`, `"es-419"` — esos devuelven inglés).
- Regenerar: `https://subsense.nepiraw.com` → Spanish → copiar la URL del manifest. O usar
  `scripts/fix-subtitles.mjs <email> <password> <subsense-manifest-url>`.

### Backup y restauración de addons

Backups en `.backups/` (gitignorado). Para restaurar una cuenta:

```powershell
$raw = Get-Content .backups\backup-NAME.json -Raw | ConvertFrom-Json
$addons = if ($raw.result.addons) { $raw.result.addons }
          elseif ($raw.addons) { $raw.addons }
          else { $raw }
$authKey = "..."   # obtener via login
Invoke-RestMethod -Uri "https://api.strem.io/api/addonCollectionSet" -Method POST `
  -ContentType "application/json" `
  -Body (@{type="AddonCollectionSet";authKey=$authKey;addons=$addons} | ConvertTo-Json -Depth 20)
```

### Addons que pueden caerse

| Addon                    | Tipo     | Alternativa si cae                    |
|--------------------------|----------|---------------------------------------|
| OpenSubtitlesPRO         | subs     | Removido; usar OpenSubtitles v3       |
| Community Subtitles      | subs     | Removido; usar SubSense / OpenSubtitles v3 |
| GTSubs                   | subs     | Removido 2026-06-21; usar SubSense / OpenSubtitles v3 |
| Subsense con userId >8ch | subs     | Regenerar con userId de 8 chars       |
| WebStreamrMBG (manifest volvió 2026-07-01) | streams  | Responde pero a veces tarda >15s (timeout del health-check) — flaky, no ideal remover |
| Mubi Catalog (`mubi2stremio.adiba.ro`)      | catálogo | Falla el chequeo de manifest en varias corridas de GitHub Actions (2026-07-02/03), incluso con reintento, pero responde `200 OK` normal desde otras redes — server chico y flaky específicamente para el runner de Actions, no una caída real. Addon de bajo riesgo (solo catálogo), no ideal remover |

### Wild Cards (Vanessa Morgan, CBC) — mitigado

Episodios S01E07+ tienen pocas seeds en Torrentio (2–8) por ser producción canadiense con baja
distribución. **Comet lo resuelve** (20–26 streams/episodio medidos el 2026-06-19). No es problema
de configuración.

### Contenido exclusivo Netflix/Disney+ que "no anda" — mitigado parcialmente (2026-07-01)

Pablo reportó: ve un título en el catálogo (addon "Streaming Catalogs", Netflix/Disney+) que le
gusta, entra y no arranca (streams que cargan sin fin, o directamente ninguno). Diagnóstico contra
la cuenta real (`tt27763549` "Los Mufas: Suerte para la desgracia", Netflix AR 2025; también
`tt5834132` "El Marginal", Netflix AR 2016-2020, éxito local):

- El catálogo de "Streaming Catalogs" da IDs de IMDb correctos — **no es un problema de matching**.
- Torrentio/Comet/WebStreamrMBG/Nuvio: **0 streams** para ambos títulos, incluso con Torrentio
  ampliado a sus 24 proveedores. Meteor sí encontraba resultados pero con ~0 seeds (de ahí el "carga
  y nunca arranca"). NoTorrent (scraper) resolvía "Los Mufas" a un HLS real y válido, pero quedaba
  perdido entre los resultados P2P muertos de Meteor.
- **Comparación con contenido masivo** (Loki, Wednesday): ahí Torrentio solo ya trae 40-50 streams.
  El patrón confirma que **el hueco es estructural**: contenido exclusivo en español/portugués
  (incluso éxitos locales) casi no circula en los trackers/scrapers públicos que indexan estos
  addons, optimizados para contenido masivo en inglés. No es algo que se arregle con más addons o
  reordenando catálogos — **sin un servicio de pago (fuera de alcance del proyecto, ver
  [[feedback_stay_free]]) puede no haber solución para ciertos títulos**.

**Se aplicó igual, gratis, para sumar cobertura real:**
1. **Torrentio ampliado** de 14 a **24 proveedores** (se sumaron Wolfmax4k, BestTorrents, Rutracker,
   Torrent9, Comando, BluDV, MicoLeaoDublado, ilCorSaRoNeRo, nekoBT, Rutor) — no resolvió los dos
   títulos de prueba, pero subió Matrix de 88 a 141 streams en el health-check, así que ayuda en
   general.
2. **Addon nuevo: Nuvio Streams** (`org.nuvio.streams`, ElfHosted, respaldado por Cuevana/Xprime —
   scraper HTTP, no P2P) instalado en idx 7.
3. **Reorden de addons de streams**: las fuentes HTTP (NoTorrent, WebStreamrMBG, Nuvio) quedan antes
   que Meteor (P2P), para que en el selector de Stremio las opciones que no dependen de seeds
   aparezcan primero y sea menos probable elegir un torrent muerto por error.

Backup pre-cambio: `.backups/backup-stremioeg-pre-streaming-fix-2026-07-01T16-13-47.json`.
Health-check post-cambio: verde (17 addons, sin ids duplicados, streams y subs OK).

### ⚠️ Nuvio Streams deprecado (detectado 2026-07-03)

El addon agregado dos días antes (arriba) **ya fue deprecado por su propio desarrollador**;
ElfHosted retiró la instancia pública donada (`nuviostreams-is-deprecated.elfhosted.com`).
Verificado contra la cuenta real: **NO está muerto del todo** — sigue dando streams para
contenido masivo (Matrix=3, Breaking Bad=3, Wednesday=2), pero dio **0 en las 9 pruebas de
contenido de nicho/familiar** del log antifrustración (Balthazar, Coco, Minions, etc. — ver
`data/anti-frustration-log.json`). Va a seguir degradando con el tiempo (scrapers Cuevana/Xprime
sin mantenimiento). **Alternativas que sugiere ElfHosted (AIOStreams, MediaFusion) requieren
debrid de pago** para torrents — no sirven para este proyecto (ver [[feedback_stay_free]];
MediaFusion ya se había descartado el 2026-06-17 por el mismo motivo). **No se removió** —
sigue dando algo de valor en contenido masivo y no rompe nada, pero dejar de esperar que tape el
hueco de nicho para el que se instaló. Sin mejor alternativa gratuita conocida por ahora.

### MyTrakt Sync — migración desde AIOLists (resuelto 2026-07-02)

ElfHosted anunció (post oficial de `funkypenguin`, confirmado en
https://stremio-addons-guide.elfhosted.com/) que dio de baja **AIOLists, Archivio y YourIPTV el
1 de julio de 2026**. AIOLists perdió sus 8 catálogos `trakt_*` (recomendaciones/trending/watchlist)
y quedó con 5 catálogos genéricos sin Trakt — de ahí la necesidad de reemplazarlo.

**Reemplazo**: `MyTrakt Sync` (`mytrakt.elfhosted.com`, ~29.5k usuarios, activamente mantenido).
Cubre todo lo que hacía AIOLists y más: continue watching/up-next, mark-as-watched.

**Bloqueo temporal (2026-07-02, resuelto el mismo día)**: el Trakt `jarvis-15483776` había quedado
vinculado a una cuenta MyTrakt (`61b5d704-...`) cuyo passkey/email Pablo no controlaba, en vez de a
la documentada `13e948e9-...`. Intentar vincular Trakt a `13e948e9` daba `username_conflict`.
Soporte de MyTrakt (`mytrakt.sync@gmail.com`) borró la cuenta vieja y confirmó que el Trakt podía
conectarse directo a `13e948e9`. Pablo hizo el OAuth manual y curó los catálogos visibles en la
config web (ocultó Anticipated, AniList, Favorites, Watched, Collected, Most Played/Watched/
Collected, Box Office, y el catálogo Reddit `r/movieleaks`).

**Resultado**: `scripts/swap-aiolists-mytrakt.mjs --apply` reemplazó AIOLists por MyTrakt Sync en
el índice 2 de la colección (17 addons, sin duplicados). 10 catálogos activos: Continue Watching
(Movies/TV), Watchlist (Movie/TV), Recommended (Movies/TV), Trending (Movies/TV), Popular
(Movies/TV). Health-check post-swap verde. Detalle completo del conflicto de las dos cuentas en la
memoria `reference_mytrakt_account`.

### Vigilancia de r/Stremio y r/StremioAddons (2026-07-01)

Pablo pidió un workflow permanente para vigilar ambos subreddits y anticipar roturas/deprecaciones
(así se encontró lo de AIOLists arriba). Intenté automatizarlo con un cron en GitHub Actions
pegándole a la API pública de Reddit — **Reddit bloquea duro el acceso no-browser**: el endpoint
JSON (`/r/<sub>/new.json`) devuelve 403 incluso con User-Agent de navegador real, y el RSS
(`/r/<sub>/new/.rss`) devuelve 429 (rate limit agotado) con una sola request. No hay forma limpia de
sortear esto sin un browser headless tipo Playwright (que Reddit suele detectar igual, y agrega una
dependencia pesada que este proyecto evita) — no se automatizó por ese motivo, no por falta de
intento.

**Lo que sí protege en piloto automático (ya en producción, cloud, sin depender de la PC)**:
`scripts/health-check.mjs` 2x/día vía `health-monitor.yml` — pega directo a los manifests/streams/
catálogos reales que usa la cuenta. Es la señal más rápida y confiable de "algo se rompió" (mucho
antes que enterarse por un post de Reddit).

**Lo que se complementa a mano**: al arrancar una sesión con Pablo (o si pide un "chequeo"), repasar
r/StremioAddons y r/Stremio con el browser real (`claude-in-chrome`) — ahí sí funciona, porque es
una sesión de navegador auténtica, no un script. Buscar: deprecaciones de ElfHosted, addons caídos
que Pablo usa, problemas masivos de TorBox/Real-Debrid si en algún momento se suma un debrid. No es
automatizable sin la PC/Chrome prendidos, así que queda como hábito de sesión, no como cron — no
rompe el principio de "todo cloud" porque no es una dependencia crítica, es vigilancia extra.

## Infraestructura cloud-only (2026-06-30)

**Principio**: el sistema de Stremio de Pablo debe funcionar con la PC apagada. Nada crítico
depende de que Windows esté prendido.

| Servicio | Qué hace | Dónde corre |
|---|---|---|
| keep-warm (AIOMetadata) | Pingea el manifest cada 20 min para evitar cold start | GitHub Actions (`.github/workflows/keep-warm.yml`) |
| health-monitor | Health-check 2×/día; email diario + alerta inmediata si falla | GitHub Actions (`.github/workflows/health-monitor.yml`) |
| SubDL addon (subs ES sin SDH) | Proxy SubDL filtrando hi=true | Deno Deploy (`scripts/deno-subdl-addon.ts`) — `mejorastremio.pabloeckert.deno.net` |
| AIOMetadata catálogos | ~132 catálogos TMDB Discover (idioma `es`) | ElfHosted (UUID en `preset.json → instanceId`) |
| MyTrakt Sync recomendaciones | Watchlist/Recommended/Trending/Popular vía Trakt | ElfHosted (UUID `13e948e9-...` en manifest) |
| SubMaker subs ES | Subs SubDL sin SDH, en la nube | ElfHosted (`submaker.elfhosted.com`) |
| Audio Latino (verificado) | Catálogo de familiar/infantil con audio latino confirmado | Deno Deploy (`mejorastremio-latino.pabloeckert.deno.net`) |
| Antifrustración | Revisión semanal de títulos sin streams reales | GitHub Actions (`.github/workflows/anti-frustration-review.yml`) |

### health-monitor — GitHub Actions (2026-07-01)

`.github/workflows/health-monitor.yml` corre 2 veces por día:
- **09:00 Argentina** (12:00 UTC): health-check completo. Email solo si hay falla.
- **21:00 Argentina** (00:00 UTC): health-check completo. **Siempre envía resumen** a `pabloeckert@gmail.com`.

Los 3 **GitHub Secrets** que necesita (`STREMIO_EMAIL`, `STREMIO_PASS`, `GMAIL_APP_PASSWORD`) están
✅ cargados (confirmado con `gh secret list`) — el health-check corre autenticado, da verde, y el
email llega. El job aparece rojo en GitHub si hay algún problema, así que las fallas también son
visibles ahí.

**Reintento en manifests (2026-07-03)**: paso `[2/5]` de `health-check.mjs` reintenta una vez
(tras 3s) antes de marcar `NO RESPONDE`, para no disparar FALLA por blips transitorios de un
addon sano (motivo: la alerta de SubMaker del 2026-07-02 respondía 200 OK al reprobarla a mano
minutos después). Si el reintento salva el chequeo queda como `⚠` (no marca `exitCode=1`).

### keep-warm — GitHub Actions (reemplazó Task Scheduler 2026-06-30)

`.github/workflows/keep-warm.yml` corre cada 20 min vía cron de GitHub Actions. Lee el UUID de
AIOMetadata de `data/preset.json → aioMetadataConfig.instanceId` y hace un curl al manifest.
No requiere ningún secret (el manifest es público). Si el UUID cambia al regenerar AIOMetadata,
`regenerate-aiometadata.mjs` actualiza `instanceId` en `preset.json` → el workflow lo toma
automáticamente en el próximo push.

**Scripts legacy (mantener, no borrar):**
- `scripts/keep-warm.mjs` — reemplazado por el workflow de GitHub Actions
- `scripts/setup-keep-warm.ps1` — reemplazado por el workflow de GitHub Actions
- Tarea Windows `StremioKeepWarm` — desregistrada: `Unregister-ScheduledTask -TaskName "StremioKeepWarm" -Confirm:$false`

### subdl-addon — Deno Deploy (reemplazó Task Scheduler local 2026-06-30)

`scripts/deno-subdl-addon.ts` es el port Deno de `scripts/subdl-addon.mjs`. Usa Deno.serve() y
la Web Streams API (DecompressionStream) en vez de Node.js. El baseUrl se deriva del request
entrante, así que funciona sin configuración extra tanto en local (`deno run`) como en Deno Deploy.

**Deploy en Deno Deploy:**
1. Ir a [deno.com/deploy](https://deno.com/deploy) → Sign in with GitHub
2. New Project → "Deploy from GitHub repo" → seleccionar `pabloeckert/MejoraStremio`
3. Entry point: `scripts/deno-subdl-addon.ts`
4. En "Environment Variables": agregar `SUBDL_KEY` = tu API key de SubDL
5. Deploy → copiar la URL pública (ej. `https://[proyecto].deno.dev`)
6. Instalar en Stremio: `https://[proyecto].deno.dev/manifest.json`

**Orden de subtítulos (después del deploy):** SubSense → SubMaker (ElfHosted) → SubDL (Deno) → OpenSubtitles v3

**Scripts legacy (mantener, no borrar):**
- `scripts/subdl-addon.mjs` — reemplazado por `deno-subdl-addon.ts` en Deno Deploy
- `scripts/setup-subdl-addon.ps1` — reemplazado por Deno Deploy
- `scripts/_subdl-addon-runner.ps1` — gitignoreado, puede borrarse del disco local
- Tarea Windows `StremioSubdlAddon` — nunca existió; Deno Deploy en producción desde 2026-06-30

## TorBox (debrid activo)

**Aplicado 2026-07-11.** Pablo contrató y pagó TorBox Essential (~USD 3/mes) — ver "Plan debrid"
más abajo para el análisis que llevó a esta elección. Con debrid activo, la explicación técnica del
CGNAT (sección siguiente) deja de aplicar a los addons que lo soportan: TorBox descarga los
torrents en sus propios servidores (no en la conexión de Pablo) y los sirve por HTTP directo, así
que el swarm P2P inestable ya no es parte del camino crítico para esos dos addons.

**Addons conectados**: Torrentio y Comet (los dos únicos ya instalados que soportan TorBox
nativamente; no se agregó MediaFusion ni ningún addon nuevo — decisión explícita de Pablo, scope
limitado a lo ya instalado).
- **Torrentio**: `torbox=<TORBOX_API_KEY>` agregado como segmento pipe-delimited en su
  `transportUrl` (sintaxis confirmada contra `torrentio.strem.fun/configure` antes de tocar la
  cuenta real), preservando los 24 proveedores/`sort=seeders`/`qualityfilter` existentes. Todos los
  streams devueltos quedan tageados `[TB+] Torrentio` en el campo `name` y su `url` resuelve vía
  `torrentio.strem.fun/resolve/torbox/<key>/...` (confirmado con un dump crudo de streams de The
  Matrix: 120/120 con el tag).
- **Comet**: `debridServices: [{service:"torbox", apiKey:<TORBOX_API_KEY>}]` agregado a su config
  JSON (base64 en el path), y **`enableTorrent: false`** — TorBox puede descargar torrents no
  cacheados en sus propios servidores, así que mantener el fallback a P2P crudo solo reintroducía
  el problema de CGNAT para esa porción de resultados sin sumar cobertura real (verificado: para
  "Die Toten von Marnow" S01E01, que dio 0 streams, se probó también con `enableTorrent:true` sin
  login contra la cuenta y dio 0 igual — confirma que es un título con cero cobertura en Comet, no
  una regresión del cambio). Marcadores vistos en streams reales: `[TB⚡]` (cacheado/instantáneo) y
  `[TB⬇️]` (TorBox todavía lo está descargando en su servidor).
- Sintaxis de ambos addons descubierta usando sus configuradores públicos con una clave de prueba
  (nunca la real) antes de escribir nada contra la cuenta — la clave real sólo se usó
  programáticamente vía la API de Stremio, nunca pegada en un formulario web.

**Script**: `scripts/apply-torbox-profile.mjs` (dry-run por defecto, `--apply` para escribir; mismo
patrón que `apply-cgnat-profile.mjs`/`swap-aiolists-mytrakt.mjs`). Requiere `ST_EMAIL`, `ST_PASS`,
`TORBOX_API_KEY` (esta última en `SECRETS.local.md`, gitignoreado). Backup pre-cambio en
`.backups/backup-stremioeg-pre-torbox-2026-07-11T16-01-20.json`.

**Criterio de orden nuevo** (ver tabla de clasificación en "Estado actual de la cuenta"):
Torrentio → Comet (TorBox-backed, inmunes al CGNAT) → NoTorrent → WebStreamrMBG → Nuvio Streams
(HTTP, tampoco dependen de P2P entrante) → Meteor (P2P puro, sin debrid, único que sigue expuesto
al CGNAT — se mantiene su fix `minSeeders:1` del perfil temporal, ver abajo).

**Verificado con `health-check.mjs`** post-cambio: 18 addons, sin ids duplicados, streams y subs
OK (Matrix 208 streams combinados, Breaking Bad S01E01 198, Will Trent S01E01 77).

### Sort "friction-zero" (2026-07-11)

Pablo no quiere evaluar streams a mano — entrar al título, tocar play, que ande, sin elegir entre
20 opciones. Dos ajustes sobre Torrentio y Comet, investigados contra sus configuradores públicos
antes de tocar la cuenta (`scripts/apply-friction-zero-sort.mjs`, dry-run por defecto, `--apply`
para escribir):

- **Cacheado en TorBox siempre primero:**
  - **Comet** tiene el campo exacto para esto: `sortCachedUncachedTogether` (tooltip real del
    configurador: "Disable the default behavior of sorting cached results first, and instead mixes
    cached and uncached results together"). El default del addon ya es `false` (cacheados primero),
    pero la cuenta no lo tenía seteado explícito — se fijó `false` de forma explícita para no
    depender de un default implícito que podría cambiar. Confirmado con streams reales: top-3 de
    Comet en Matrix/Breaking Bad/Enola Holmes 3/Las Ovejas Detectives — **12/12 cacheados `[TB⚡]`**.
  - **Torrentio no tiene ningún sort por estado de cacheado** (su dropdown "Sorting" solo ofrece
    quality/qualitysize/seeders/size, con o sin debrid configurado — verificado en el configurador
    con TorBox seleccionado). No se inventó un ajuste que no existe. Mitigación real: con debrid
    configurado, TODOS los resultados de Torrentio ya se resuelven vía TorBox (tageados `[TB+]` o
    `[TB download]` según si está cacheado o lo tiene que buscar) — ninguno depende del swarm P2P
    del usuario, así que el objetivo de fondo ("que ande sin depender de mi conexión") ya está
    cubierto aunque no haya un sort explícito por cache.
- **Audio latino prioritario:**
  - **Torrentio** tiene `language=latino` (🇲🇽) en su selector "Priority foreign language" —
    agregado al `transportUrl` (pipe-delimited, junto a `torbox=`). Efecto medido: **fuerte y
    dominante** — para The Matrix, el resultado #1 pasó a ser un DVDRip con audio latino, por
    encima de releases 1080p sin latino (la prioridad de idioma le gana a calidad/seeders). Mismo
    patrón confirmado en Breaking Bad, Enola Holmes 3 y Las Ovejas Detectives (releases
    `-Dual-Lat` en el top).
  - **Comet** ya tenía `languages.preferred: ["la","en"]` de una sesión anterior (no se tocó, ya
    estaba bien puesto). Efecto medido: **más débil que en Torrentio** — en el spot-check de Enola
    Holmes 3, el resultado #2 de Comet no tenía ningún audio en español/latino (era
    Tamil/Telugu/Hindi/Inglés) pese a la preferencia configurada. `preferred` en Comet actúa como
    señal blanda mezclada con otros criterios de ranking, no como prioridad dura tipo la de
    Torrentio. No se buscó una alternativa más agresiva (`languages.required`) porque excluiría
    resultados no-latino por completo, perdiendo el fallback — mismo criterio que "no sacrificar
    cobertura por preferencia" ya aplicado en el resto del proyecto.
  - No se aplicó ningún criterio condicional por tipo de contenido (familiar vs. general) porque
    ni Torrentio ni Comet exponen un sort que dependa del género/tipo del título — se aplicó de
    forma general a todo el catálogo, tal como preveía el pedido si el condicional no era posible.
- Backup pre-cambio: `.backups/backup-stremioeg-pre-frictionzero-2026-07-11T19-55-03.json`.
  `health-check.mjs` post-cambio: verde, mismos conteos de streams que antes (el sort no cambia
  cuántos streams hay, solo el orden).

## Perfil CGNAT temporal (sin debrid) — CERRADA/SUPERADA por TorBox (2026-07-11)

**Esta sección queda como referencia histórica, no se aplica más tal cual.** Con TorBox activo en
Torrentio/Comet (sección de arriba), el criterio de "priorizar seeders sobre calidad" que este
perfil aplicaba pierde sentido para esos dos addons — el debrid sirve el archivo ya
descargado/cacheado, no negocia con el swarm. **Excepción: Meteor mantiene `minSeeders:1`** tal
cual quedó acá — no fue un olvido. Meteor no soporta ningún proveedor de debrid, sigue siendo P2P
puro, y el CGNAT le pega exactamente igual que antes de TorBox.

**Aplicado 2026-07-09.** Se confirmó CGNAT en la conexión de Claro Argentina de Pablo: la IP
pública vista por servicios externos no coincide con la IP WAN del router, y no hay acceso al
router (usuario/contraseña desconocidos, no recuperables) para abrir puertos o pedir IP fija.
Efecto directo: los swarms P2P de torrents conectan de forma inconsistente (los peers no pueden
alcanzar al usuario por conexión entrante) → streams que conectan, cargan hasta ~1MB, caen a 0 y
repiten el ciclo. Es la explicación técnica del síntoma que Pablo venía reportando.

La solución real es un debrid de pago (**TorBox**, ver "Plan debrid" más abajo), proyectado para
~agosto 2026. Mientras tanto, este es un perfil **temporal** sobre el setup 100% gratis para
mitigar el impacto, aplicado con `scripts/apply-cgnat-profile.mjs` (dry-run por defecto, `--apply`
para escribir; mismo patrón que `scripts/swap-aiolists-mytrakt.mjs`):

- **Reorden de los addons de streams**: los HTTP (NoTorrent, WebStreamrMBG, Nuvio Streams — no
  dependen de conexión P2P entrante, ver tabla de clasificación en "Estado actual de la cuenta"
  más arriba) pasaron a estar antes que los P2P (Torrentio, Comet, Meteor) en la colección.
- **Torrentio: sin cambios.** Ya usaba `sort=seeders` y un `qualityfilter` que excluye BR-REMUX/
  HDR/3D/cam/scr/unknown pero **no** excluye 4K liso — ya cumplía el objetivo de "priorizar por
  seeders sin descartar 4K, sólo dejarlo rankear más abajo si tiene pocos seeds". Verificado, no
  salteado en silencio.
- **Comet: sin cambios**, por decisión de criterio. Su config (JSON en base64 en la URL) no tiene
  ningún campo de "sort" — el ranking interno sólo es ajustable vía exclusión binaria de
  resoluciones (ya excluye 2160p/240p/360p/unknown) y un umbral `remove_ranks_under` hoy
  desactivado. No hay forma de "despriorizar sin excluir" en su esquema, así que se deja como está
  (ya es conservador en ancho de banda, lo cual ayuda igual bajo esta conexión).
- **Meteor: `minSeeders` 0 → 1** (filtra torrents con 0 seeds confirmados — exactamente el patrón
  "carga y nunca arranca" ya documentado) y `sortOrder` reordenado para que `seeders` pese más que
  resolución/calidad: `["pack","cached","seeders","seadex","resolution","size","quality","language"]`.
  Efecto medido (spot-check directo al addon, sin login): Matrix 157→47 streams, Will Trent S01E01
  39→21 — más de la mitad de lo que mostraba antes eran torrents muertos de 0 seeds. Höllental
  S01E01 se mantuvo en 0 (no hay seeds de ningún tipo disponibles para ese título, no es un efecto
  del cambio).
- Validado con `health-check.mjs` y `test-content.mjs` antes/después: ambos verdes, sin
  regresiones — ningún título curado quedó en 0 streams que antes tuviera alguno.

**Checklist de reversión/ajuste cuando llegue TorBox** (ver "Plan debrid" para los pasos generales
de esa integración — no se repiten acá):
1. Con la API key de TorBox, agregarla a Torrentio (parámetro debrid en la URL) y a Comet (selector
   de proveedor en su config).
2. Con debrid activo, Torrentio/Comet dejan de depender de conexión P2P directa → el criterio de
   "sort por seeders" de este perfil pierde relevancia (el debrid sirve el archivo cacheado, no
   negocia con el swarm).
3. La restricción `minSeeders:1` de Meteor probablemente se puede relajar, o directamente sacar
   Meteor de la colección — sin debrid propio, queda redundante frente a Torrentio/Comet ya
   cacheados.
4. Volver a correr `health-check.mjs` + `test-content.mjs` para confirmar la mejora real (mismo
   paso que ya pide "Plan debrid").
5. El reorden HTTP-antes-que-P2P probablemente sigue teniendo sentido igual (no hace daño), pero
   deja de ser crítico una vez que el debrid resuelve el problema de raíz.

**Chequeo manual en el set-top-box (ZTE B866v2, Android TV) — no automatizable.** En la app de
Stremio del dispositivo: ir a Configuración/Settings → buscar una sección de
Reproducción/Streaming/Playback. Buscar una opción tipo "perfil de torrent"/"BT profile" o
"conexiones simultáneas"/"max connections", y si existe, ponerla en el valor más permisivo (más
intentos de conexión en paralelo a peers ayuda a compensar la tasa baja de éxito por conexión que
causa el CGNAT). **Aviso**: las etiquetas exactas del menú varían según versión/build de la app —
esto hay que verificarlo mirando el dispositivo en vivo, no asumir que el menú va a tener
exactamente estos nombres. Si no existe tal opción en la build instalada, no hay nada que ajustar
de este lado y no bloquea el resto del perfil.

## Plan debrid — proyección agosto 2026 (analizado 2026-07-03)

**Ejecutado 2026-07-11, antes de lo proyectado — ver "TorBox (debrid activo)" más arriba.** Esta
sección queda como el análisis histórico que llevó a la elección de TorBox; los pasos de
integración de abajo ya se hicieron.

Pablo pidió analizar el mejor servicio de debrid de pago ("mejor calidad, mejor precio"), con
proyección de sumarlo posiblemente en **agosto 2026**. Esto matiza la premisa histórica de
proyecto 100% gratis: Pablo mismo lo pidió tras chocar reiteradamente con el techo real de lo
gratis (Los Mufas, El Marginal — 0 streams reales; Nuvio Streams deprecado sin reemplazo gratis).

**Recomendación: TorBox** (plan Essential, ~US$3/mes, cache ilimitado):

| Servicio | Precio | A favor | En contra |
|---|---|---|---|
| **TorBox** | ~$3/mes | Sin purgas de caché por reclamos de copyright (a diferencia de Real-Debrid); multi-IP; no-logs; soportado nativamente por Torrentio y Comet (ya instalados); PayPal/cripto/tarjeta | Cache algo más débil en contenido viejo/no-inglés muy nicho |
| Real-Debrid | ~$3-4/mes | Barato, cache profundo de contenido viejo | Borra activamente archivos cacheados por reclamos de copyright → streams rotos, el mismo síntoma que ya venimos peleando gratis |
| AllDebrid | ~€3/mes | UI/extensión pulida | Sin ventaja real sobre TorBox acá |
| Premiumize | Más caro | Bundle cloud/Usenet/VPN, cripto | Funciones extra que no hacen falta |

**Integración cuando Pablo decida avanzar** (no requiere addons nuevos): Torrentio y Comet ya
soportan TorBox nativamente como proveedor de debrid.
1. Pablo crea la cuenta TorBox y consigue su API key.
2. Reconfigurar Torrentio (config vía URL — agregar parámetro de debrid con la key) y Comet (su
   config UI tiene selector de proveedor de debrid).
3. Recopiar/reinstalar esas dos URLs en la colección (mismo patrón de siempre, backup antes).
4. Correr `health-check.mjs` + `scripts/anti-frustration.mjs review` para confirmar mejora real en
   los títulos "pendiente" (Los Mufas, El Marginal).

**Para la rutina semanal automática (ver sección de arriba)**: si en algún chequeo dominical hay
novedades relevantes de precios/políticas de TorBox/Real-Debrid/AllDebrid, o se acerca agosto sin
que Pablo haya decidido, mencionarlo brevemente en el resumen — sin presionar, es su decisión.

## Sesión "siesta" 2026-07-11 — identificación + test completo de 22 títulos

Pablo pidió (modo autónomo, sin interrumpir) identificar 22 títulos con nombres a veces mal
transcriptos, testearlos end-to-end, buscar contenido geo-rescatado y curar catálogos según el
gusto que esa lista revela (fuerte inclinación a crimen/misterio alemán y británico). El pedido
volvió a traer `authKey` vacío, pero ST_EMAIL/ST_PASS ya se habían pasado antes en el mismo chat
(sesión de TorBox) — Pablo pidió explícitamente guardarlos para no repetirlos, así que quedaron en
`SECRETS.local.md` junto a `TORBOX_API_KEY` (mismo patrón gitignoreado, ver "Reglas del repo").
Con eso se completaron las 6 fases contra los 6 addons de streams + 4 de subtítulos reales.
Detalle completo, tabla de los 22 títulos y diagnóstico de cada 0-stream en **`SIESTA-REPORT.md`**
(raíz del repo) y en **`data/test-siesta-titles.json`** (mismo formato que `test-content.json`,
reusable).

Hallazgos que quedan permanentes acá:
- **21/22 títulos identificados**; "Grams" no se pudo (se probaron varias hipótesis de error de
  transcripción sin éxito — Grantchester, Gangs of London, Gomorra, 21 Grams). "Los hombres de
  Harrelson" no es un título aparte — es el nombre en español de **S.W.A.T.** (2017-2025,
  tt6111130). "How to Get to Heaven from Belfast" es de **Netflix, no BBC** (se movió de Channel 4
  en desarrollo). "Minions y Monstruos" es un título real (no un error), estrenó en cines fines de
  junio 2026.
- **Spider-Man: Brand New Day** (tt22084616) todavía no estrenó (31/07/2026) — no se testeó a
  propósito.
- **18/20 títulos testeados tienen streams reales** contra los 6 addons (no solo Torrentio), con
  TorBox cacheando también contenido de estreno muy reciente (Enola Holmes 3, Las Ovejas
  Detectives). Los dos 0 (`Veteranos contra el crimen`, `Das Quartett`) están confirmados en los 6
  addons, mismo patrón ya conocido de nicho alemán de canal chico (ver Höllental/Los Mufas más
  arriba) — no es config rota.
- **Audio latino confirmado con evidencia real** para los 3 títulos familiares/infantiles: Las
  Ovejas Detectives y Enola Holmes 3 tienen releases Cinecalidad Dual Audio 🇲🇽 vía Torrentio+TorBox
  más streams dedicados `[latino]` en WebStreamrMBG. Minions y Monstruos (estreno más reciente)
  todavía solo aparece en WebStreamrMBG — vale la pena re-testear en 1-2 semanas.
- **`preset.json` refrescado y aplicado**: `refresh-dates.mjs` (En Cartelera/Próximos Estrenos a
  hoy 2026-07-11) + `regenerate-aiometadata.mjs --apply` contra la cuenta real, con
  `AIO_PASSWORD` confirmado por Pablo en el chat (guardado en `SECRETS.local.md` junto al resto).
  Instancia nueva `861ff75d-...` (ver "Estado actual de la cuenta"), 132 catálogos, 0 perdidos/0
  ganados, tokens Trakt/Simkl conservados.
- **MyTrakt Sync ya da recomendaciones reales** (Recommended/Trending/Popular vía Trakt) — el
  estado "quedó con MDBList en vez de Recommended" que a veces se menciona es de la época vieja de
  AIOLists (pre-2026-07-02), ya superado, no hace falta re-resolverlo.
- **Catálogos de crimen (`Crime Movies`/`Crime Shows`) y por país (`Series Alemania`/`Series Reino
  Unido`) reordenados** dentro de Descubrir (antes en posiciones 15/32/50/54 del array, ahora
  11-14, justo después del bloque que se ve en el inicio) — `showInHome` **no se tocó**, sigue
  siendo la decisión "Inicio curado opción A" del 2026-06-19. Verificado con
  `audit-catalog-order.mjs`: 0 de los 11 catálogos del inicio cambiaron de lugar.
- **`health-check.mjs` — bug real encontrado y corregido**: el reintento genérico (2026-07-03) solo
  salva blips cortos; en esta sesión WebStreamrMBG tuvo una caída completa (NO RESPONDE ni al
  reintento) y seguía rompiendo el exit code. Se agregó una lista `KNOWN_FLAKY` (WebStreamrMBG +
  Mubi Catalog, mismo criterio que la tabla "Addons que pueden caerse" más abajo) que ahora degrada
  a warning incluso en una caída total. Confirmado con una corrida real que reprodujo el bug y otra
  después del fix que ya no lo rompió.
- `health-check.mjs` y `test-content.mjs` corridos frescos post-sesión: verdes, sin regresiones.
  Dato nuevo: **Höllental** (el caso documentado abajo como "0 streams, ni Comet, no es efecto del
  perfil CGNAT") ahora da **3 streams** — primera mejora real medida ahí, atribuible a TorBox.
- Única escritura a la cuenta real en toda la sesión: el swap de AIOMetadata, con backup en
  `.backups/backup-stremioeg-preregen-2026-07-11T19-34-26-181Z.json`.

## Bug real: catalogs:[] indiscriminado — causa raíz de catálogos/búsqueda perdidos (resuelto 2026-07-12)

Pablo reportó, al arrancar la sesión siguiente a la de "siesta": búsqueda rota, listas perdidas,
sugerencias de Home perdidas, catálogos perdidos, y un subtítulo de España en vez de latino en El
Diablo Viste a la Moda 2. El diagnóstico de esa sesión (guardado en el historial de chat, no en este
archivo) había atribuido el problema a un cold-start transitorio de ElfHosted. **Esa hipótesis era
incorrecta.** Investigando el pedido de un guard defensivo, apareció la causa real:

- **El bug**: `apply-torbox-profile.mjs`, `apply-cgnat-profile.mjs`, `reorder-addons.mjs` y
  `apply-friction-zero-sort.mjs` hacían `addons.map(a => ({...a, manifest: {...a.manifest,
  catalogs: []}}))` antes de todo `addonCollectionSet` — vaciando `catalogs` de **todos** los
  addons del payload, no solo el que cada script modificaba. La justificación original ("evitar
  exceder el tamaño máximo del descriptor de la API") era una premisa falsa:
  `regenerate-aiometadata.mjs` (que nunca vació nada) probó corrida tras corrida, durante meses,
  que el payload completo —con los ~132 catálogos de AIOMetadata embebidos— se acepta sin problema.
- **Por qué no lo detectaba nada**: `health-check.mjs` verifica catálogos con un fetch EN VIVO al
  `transportUrl` de cada addon (`manifestResults`), nunca lee el campo `manifest.catalogs` que
  Stremio guarda en el storage tras un `addonCollectionSet`. Por eso el health-check daba siempre
  verde mientras el storage tenía los catálogos congelados en 0 — son dos fuentes de datos
  distintas, y solo la del storage es la que (probablemente) usa el cliente de Stremio para poblar
  Discover/Board.
- **Alcance real, verificado en la cuenta el 2026-07-12**: no eran solo AIOMetadata/MyTrakt Sync —
  **8 addons** tenían `catalogs=[]` congelado en el storage pese a que su manifest en vivo tenía
  catálogos reales: Cinemeta (8), AIOMetadata (132), MyTrakt Sync (10), NoTorrent (7), Mubi Catalog
  (2), Streaming Catalogs (56), Trakt Integration (8), Audio Latino verificado (2). Cualquier
  addon con `resources` incluyendo `"catalog"` quedaba afectado apenas corría cualquiera de los 4
  scripts. Esto lleva potencialmente corriendo desde antes del perfil CGNAT (2026-07-09, primer
  script con este patrón) — no fue algo puntual del 2026-07-11.
- **Fix aplicado**:
  1. Los 4 scripts (+`curate-streaming-catalogs.mjs`, `swap-aiolists-mytrakt.mjs`,
     `fix-subtitles.mjs`, que no tenían el bug pero sí `addonCollectionSet`) ya NO vacían
     `catalogs` de addons que no modifican — mandan el manifest tal cual lo leyeron.
  2. Guard compartido nuevo: `scripts/lib/collection-guard.mjs` →
     `assertNoFrozenEmptyCatalogs(addons, modifiedIds)`. Antes de cualquier `addonCollectionSet`,
     para cada addon NO modificado en esa corrida que declare `resources` con `"catalog"` y tenga
     `catalogs.length === 0`, hace un fetch EN VIVO de su manifest — si el vivo tiene catálogos
     reales, aborta con un error claro (evita persistir un manifest roto). Importante: comparar
     contra el manifest en vivo (no contra un umbral fijo) es necesario porque algunos addons sanos
     tienen legítimamente `catalogs:[]` en ciertos momentos; comparar contra su propio vivo es lo
     que evita falsos positivos. Integrado en los 7 scripts que hacen `addonCollectionSet`.
  3. **Reparación de la cuenta real**: `scripts/repair-frozen-catalogs.mjs` (dry-run por defecto,
     `--apply` para escribir) detecta y restaura el manifest de cualquier addon con catálogos
     congelados, sin tocar transportUrl/orden/config — solo refresca el campo `manifest` con un
     fetch fresco del mismo `transportUrl`. Corrido con `--apply` el 2026-07-12: los 8 addons
     restaurados y verificados (backup en
     `.backups/backup-stremioeg-pre-repair-frozen-catalogs-2026-07-12T02-29-54.json`).
     `health-check.mjs` post-reparación: verde, sin regresiones.
- **Lección para scripts futuros**: nunca vaciar/mutar el `manifest` de un addon que un script no
  está modificando intencionalmente al armar el payload de un `addonCollectionSet`. Si hace falta
  reducir tamaño de payload en algún caso puntual futuro, achicar solo el manifest del addon que
  ese script YA está reescribiendo (con datos frescos), nunca el de terceros no relacionados.

## Sesión 2026-07-12 — orden por fecha, tercer filtro, sinopsis, subtítulos latino, reorden MyTrakt

Pablo pidió 5 cambios puntuales y acotados, con regla de oro explícita de **no tocar streams**
(TorBox/Torrentio/Comet/friction-zero/perfil CGNAT quedaron intactos — todo lo de esta sesión es
catálogos/orden de colección, no streams). Backup + `health-check.mjs` + `test-content.mjs` antes
y después; `collection-guard.mjs` (ver bug de la sesión anterior) usado en el reorden de MyTrakt.

**1. Catálogos ordenados por fecha desc (más nuevo primero) en Descubrir** — extendido el criterio
ya aplicado a los 13 catálogos de país (2026-06-24) a los 3 catálogos restantes que ordenaban por
`popularity.desc`: "En Cartelera" → `primary_release_date.desc`, "Próximos Estrenos" (movie/tv) →
`primary_release_date.asc`/`first_air_date.asc` **(ascendente, no descendente)** — para una lista de
estrenos futuros, "más nuevo primero" se interpretó como "el más próximo a estrenarse primero", no
"el más lejano en el futuro primero" (que es lo que daría un `.desc` literal); decisión de criterio,
no un desvío por error.
- **Bug real encontrado al aplicar**: sin piso de calidad, ordenar por fecha pura saca basura al
  tope — "En Cartelera" mostraba `My Best Friend` (rating 0.0, runtime 2min, entrada fantasma) antes
  que estrenos reales. Los catálogos de género/país ya tenían `vote_count.gte`/`vote_average.gte`/
  `with_runtime.gte` de la sesión de 2026-06-24 (por eso nunca mostraron este problema); "En
  Cartelera"/"Próximos Estrenos" NO tenían ningún piso (solo la ventana de fechas). Se agregó
  `vote_count.gte: 5` + `with_runtime.gte: 45` (movies) / `with_runtime.gte: 15` (tv) a los 3
  catálogos — verificado post-fix: top-10 de "En Cartelera" pasó a ser contenido real y reconocible
  (Vaiana, Posesión infernal: En llamas, etc.) con ratings normales.
- **Excepciones documentadas, no tocadas** (con criterio explícito, no por descuido):
  - **Top Rated Movies/Shows**: sigue en `vote_average.desc` — por definición un catálogo de "mejor
    valorados" pierde su sentido si se ordena por fecha. Coincide textualmente con el ejemplo que dio
    Pablo en el pedido.
  - **Best Movies/Shows of the 2020s**: sigue en `popularity.desc` — mismo razonamiento que Top
    Rated: un catálogo de "los mejores de la década" es una curación de calidad, no un feed
    cronológico; convertirlo a fecha desc lo volvería redundante con "Latest Movies/Shows" (que ya
    existe, ya ordenado por fecha) y le haría perder su propósito.
  - **Trending Movies/Shows** (`tmdb.trending`): no tiene `metadata.discover.params` — es el
    endpoint TMDB Trending, no TMDB Discover, y ese endpoint no soporta `sort_by` en absoluto. No es
    algo configurable desde nuestro lado.
  - **Catálogos de streaming/FlixPatrol** (`streaming.*`/`flixpatrol.*`, ~43 catálogos): tampoco
    usan TMDB Discover — vienen de listas de plataforma/charts externos sin parámetro de sort
    disponible. Los "Top 10" de FlixPatrol además pierden todo sentido si se reordenan por fecha (son
    un ranking de popularidad por diseño).
  - **"Latest Movies"/"Latest Shows"**: ya estaban en `primary_release_date.desc`/`first_air_date.desc`
    desde antes — no requirieron cambio.
  - Catálogos deshabilitados (`enabled:false`: décadas 80s-2010s, catálogos por estudio) quedaron
    fuera del alcance por instrucción explícita ("catálogos habilitados").

**2. Tercer filtro (género + idioma original + posterior a 2020) — investigado, NO viable como
selector en vivo; documentado como limitación real del addon**. Se clonó y leyó el código fuente de
AIOMetadata (`github.com/cedya77/aiometadata`, addon hosteado por ElfHosted, no self-hosted por
nosotros):
  - **Género**: YA estaba expuesto como extra filtrable (`extra: [{name:"genre", options:[...]}]`)
    en el manifest en vivo de TODOS los catálogos TMDB Discover — confirmado con un fetch real al
    manifest. Nada que agregar.
  - **Idioma original y año como filtro seleccionable en la app**: **no soportado por el código del
    addon**. La función `createTMDBDiscoverCatalog()` en `addon/lib/getManifest.ts` hardcodea
    `extra: [{name:"genre"}, {name:"skip"}]` para todo catálogo de tipo `tmdb.discover.*`, sin
    ninguna rama que agregue `language`/`year` como extra en runtime (ese repurposing de la dropdown
    de "genre" para year/language solo existe para catálogos `mdblist.*`, una fuente totalmente
    distinta que no usamos). Como es un addon hosteado por ElfHosted (no self-hosted por este
    proyecto), no hay forma de agregar esto sin forkear y mantener nuestra propia instancia — fuera
    de alcance (mismo criterio que rechazó MediaFusion/AIOStreams por requerir infraestructura
    propia, ver `[[feedback_stay_free]]`).
  - **Camino viable más cercano** (no ejecutado esta sesión, requeriría decisiones de curación de
    Pablo): el mismo patrón ya usado para los 15 catálogos de país — catálogos NUEVOS con
    `with_original_language` + `primary_release_date.gte=2020-01-01` fijos en la definición
    (build-time, vía Catalog Builder/preset.json), no un selector dinámico. No se creó ninguno sin
    que Pablo elija qué combinaciones idioma/género quiere — hacerlo a ciegas sería inventar
    catálogos no pedidos.

**3. Sinopsis más larga en español latino — investigado, confirma y profundiza la limitación ya
documentada arriba ("Metadata en español — títulos sí, sinopsis no")**. Leído el código real de
`addon/lib/getMeta.js` y `addon/utils/parseProps.js`:
  - `processOverviewTranslations()` hace una búsqueda **exacta** por `config.language` (`"es"`) en
    las traducciones de TMDB, con fallback a `en-US` si esa traducción está vacía. No compara
    longitud entre variantes ni intenta concatenar/preferir la más completa — es un lookup de
    idioma único, igual en TMDB, TVDB y TVmaze (mismo patrón de 3 líneas repetido en los 3
    providers).
  - **La opción `providers.movie/series = "imdb"` NO trae la sinopsis real de IMDb**: el código de
    `addon/lib/imdb.ts` (`getMetaFromImdb`) resulta ser un proxy a **Cinemeta** (`v3-cinemeta.strem.io`),
    no un scraper de imdb.com — devuelve descripciones en inglés únicamente (vía OMDb), sin
    localización a español. Cambiar el provider sería un downgrade neto (se perdería también la
    traducción de títulos que hoy sí funciona), no una mejora.
  - **Conclusión**: no existe ninguna fuente/config alternativa dentro de AIOMetadata que dé
    sinopsis más largas en español latino. Es una limitación real de cobertura de traducciones de
    TMDB (muchos títulos simplemente no tienen `overview` cargado en español) — no hay nada más
    para ajustar de nuestro lado sin forkear el addon. No reinvestigar salvo que AIOMetadata cambie
    de fuente de metadata.

**4. Addons de subtítulos latino/argentino — investigados 3 candidatos, NINGUNO sumado** (ninguno
pasó la barra de "cobertura real" + "vivo/mantenido"):
  - **Subdivx** (`stremio-subdivx.xor.ar`, `github.com/ogero/stremio-subdivx`): manifest vivo, pero
    **exige una API key obligatoria** de un servicio de terceros no oficial ("SubX API",
    `subx-api.duckdns.org` — hosteado en un dominio dynamic DNS personal, señal de proyecto de un
    solo mantenedor sin garantías). Confirmado en el código (`internal/app.go`): sin `apiKey`, el
    endpoint de subtítulos devuelve 400 siempre. Requeriría que Pablo cree una cuenta nueva en un
    servicio hobby de terceros — no se hizo unilateralmente. Además, el propio ecosistema confirma
    que la API SubX "vieja" es conocida por caerse (`github.com/fr0gb1t/subx-bridge`, un bridge para
    Bazarr creado explícitamente porque "esa API ya no está funcionando de forma confiable").
    **Bloqueado, no sumado — requiere decisión y cuenta de Pablo si se quiere reconsiderar.**
  - **TuSubtitulo** (`github.com/IsraPerez98/stremio-tusubtitulo`): **confirmado muerto** — repo sin
    commits desde 2023-04, el sitio fuente (`tusubtitulo.com`) devuelve 403, y una prueba real contra
    el manifest en vivo dio **0 subtítulos** hasta para Breaking Bad S01E01 (título masivo, no de
    nicho). Solo cubre `series` (no `movie`) igual. No sumado.
  - **Argenteam**: el sitio cerró permanentemente el 2024-01-01 (anuncio oficial de los moderadores).
    No existe sucesor activo en 2026. No hay addon posible.
  - **SubSource**: ya es una de las fuentes agregadas dentro de SubSense (ya instalado) — sumarlo
    aparte sería redundante.
  - Los 4 addons de subtítulos existentes (SubSense, SubMaker, SubDL, OpenSubtitles v3) quedaron sin
    tocar, sin reordenar.

**5. MyTrakt Sync movida junto a Streailer** — de índice 2 a índice 9 (justo después de Streailer,
índice 8), sin alterar la posición de ningún otro addon. `scripts/reorder-addons.mjs` se extendió
con un flag `--after <manifest.id>` (antes solo movía al índice 0) para soportar esto de forma
reusable a futuro. `assertNoFrozenEmptyCatalogs` corrió limpio antes de escribir (un reorden no
toca ningún `manifest`, así que no había riesgo del bug de la sesión anterior). Verificado
independientemente con `addonCollectionGet` post-cambio: MyTrakt Sync en índice 9 con sus 10
catálogos intactos, Streailer en índice 8 sin moverse, resto de la colección idéntico.

**Verificación final**: `health-check.mjs` verde antes y después (mismos 18 addons, streams
idénticos: Matrix 206, Breaking Bad S01E01 190, Will Trent S01E01 84). `test-content.mjs` verde
antes y después (14/14 títulos con streams, sin regresiones). `addonCollectionGet` confirmó 0
addons con catálogos congelados. Instancia AIOMetadata regenerada dos veces esta sesión (una vez
para el sort, otra para el piso de calidad tras detectar el bug de basura) — UUID final
`82055fec-d0e2-4109-bdd0-2da9975ffa1e`, 0 catálogos perdidos/ganados en ambas regeneraciones.
Backups: `.backups/backup-stremioeg-pre-reorder-2026-07-13T01-06-12.json` (reorden MyTrakt),
`.backups/backup-stremioeg-preregen-2026-07-13T01-07-15-865Z.json` y
`...-2026-07-13T01-09-26-502Z.json` (las dos regeneraciones de AIOMetadata).

### Chequeo semanal automático (2026-07-05)

**Bug real encontrado y corregido**: `.github/workflows/anti-frustration-review.yml` corría bien
(`review` completado en 1m34s) y "commiteaba" el log actualizado en el runner, pero **nunca lo
pusheaba** — el paso final repetía `git diff --cached --quiet || git push`, y como el `git commit`
anterior ya había vaciado el staging area, ese diff daba "sin cambios" y el `push` no se ejecutaba
nunca (bug de lógica shell, no de la review en sí). Resultado: cada corrida dominical desde que se
armó el sistema (2026-07-02) revisaba los pendientes de verdad pero el resultado se perdía al
terminar el job — `data/anti-frustration-log.json` en el repo quedó congelado con `lastCheckedAt`
del 2026-07-02 pese a que el workflow reportaba `success` cada domingo. Corregido a
`if ! git diff --cached --quiet; then git commit ...; git push; fi` (un solo chequeo, commit y
push en el mismo bloque). **Verificado**: disparé manualmente el workflow ya corregido
(`workflow_dispatch`) y esta vez sí commiteó y pusheó (`chore(anti-frustration): actualizar log
semanal`, `lastCheckedAt` refrescado a 2026-07-05) — el fix funciona, las próximas corridas
dominicales van a persistir de verdad.

**Estado del log antifrustración** (re-chequeado hoy 2026-07-05 con el fix aplicado, 11 títulos):
9 resueltos, 2 siguen pendientes — **Los Mufas y El Marginal siguen en 0 streams reales**, sin
cambios respecto al 2026-07-02. Consistente con el hueco estructural ya documentado (contenido
exclusivo Netflix Argentina, sin cobertura en los trackers/scrapers gratuitos); no es una
regresión nueva, es la misma limitación de siempre.

**Workflows**: `health-monitor.yml` corriendo sano varias veces por día (no commitea nada, no tiene
este bug). `anti-frustration-review.yml` corrió el domingo 2026-07-05 (`success`, sin el fix
todavía) — de ahí se detectó el problema de arriba.

**Novedades de ElfHosted/addons**: nada nuevo que afecte a los addons instalados (AIOMetadata,
MyTrakt Sync, SubMaker, Comet, NoTorrent) más allá de lo ya documentado (baja de AIOLists/Archivio/
YourIPTV y deprecación de Nuvio Streams, ambas de principios de julio). Dato nuevo menor: ElfHosted
también dio de baja **Stremio-Jackett** (`stremio-jackett-is-deprecated.elfhosted.com`) — no lo
usamos, no requiere acción. Alternativas de addons de streams que aparecen recomendadas en guías
2026 (AIOStreams, MediaFusion) siguen requiriendo debrid de pago, mismo motivo por el que ya se
habían descartado — no accionable mientras el proyecto sea gratis. Para el catálogo de audio
latino: aparecieron un par de addons privados de terceros enfocados en audio latino ("Primer
Latino", "Addon Latam") — no investigados en profundidad (uno requiere Real-Debrid/TorBox), quedan
como posible lectura futura, no como recomendación todavía.

**Plan de debrid (agosto 2026)**: sin cambios en la recomendación de TorBox (~US$3/mes, sigue
estable, sin señales de suba). Sí apareció una confirmación nueva a favor de esa recomendación:
desde mayo 2026 Real-Debrid suma, a la purga de caché por copyright ya conocida, un **filtro por
palabras clave en el nombre de archivo** (bloquea tags como WEB-DL/WEBRip/AMZN/NF/YTS/RARBG) que
está generando más streams rotos ("removido por infracción de copyright") — refuerza por qué TorBox
es la opción más segura cuando Pablo decida avanzar. Agosto todavía no llegó y la decisión sigue
sin tomarse; se sigue sin presionar.

### Chequeo semanal automático (2026-07-12)

**Workflows del domingo**: `anti-frustration-review.yml` corrió a las 15:45 UTC, `success`, y esta
vez sí commiteó y pusheó (`651ef4c`, confirma que el fix del 2026-07-05 sigue funcionando).
`health-monitor.yml` corrió sano hoy (dos corridas, 02:06 y 13:44 UTC, ambas `success`).

**Hallazgo de la semana — ruido de falsos positivos en health-monitor**: revisando las últimas ~28
corridas (desde el 2026-07-02), **9 terminaron en `failure`** (~1 de cada 3). Ninguna es una rotura
real: en cada caso el motivo es que uno de los addons ya documentados como flaky (`WebStreamrMBG`
×2, `Mubi Catalog` ×3, `SubSense` ×1) no respondió ni al reintento (`NO RESPONDE (2 intentos)`), y
eso alcanza para marcar el job entero como falla y disparar el email `[FALLA]`. El reintento
agregado el 2026-07-03 ayuda cuando el segundo intento sí responde (queda como `⚠`, no falla), pero
no cuando el addon está caído en ambos intentos — que es justamente el patrón de Mubi Catalog en el
runner de GitHub Actions (ya documentado como specific a ese runner) y de WebStreamrMBG (timeout
lento conocido). **Sugerencia concreta**: si a Pablo le sirve, se podría bajar la severidad de esos
dos addons puntuales (Mubi Catalog y WebStreamrMBG — ambos ya catalogados como "bajo riesgo, no
ideal remover") a `⚠` en vez de `✗` cuando fallan ambos intentos, para que el health-check solo
mande `[FALLA]` cuando algo nuevo o de mayor riesgo se cae (streams principales, subs, catálogos,
cuenta). Así como está hoy, cerca de un tercio de los emails de falla son ruido conocido — el riesgo
es que Pablo empiece a ignorarlos y se pierda una falla real entre medio. No lo apliqué porque es un
cambio de comportamiento del script, no un chequeo — a definir si Pablo lo quiere.

**Log antifrustración**: 9 resueltos, 2 pendientes — **Los Mufas y El Marginal siguen en 0 streams
reales**, sin cambios respecto al 2026-07-05. Mismo hueco estructural de siempre (contenido
exclusivo Netflix Argentina sin cobertura en trackers/scrapers gratuitos).

**Novedades de ElfHosted/addons**: nada nuevo más allá de lo ya documentado (baja de AIOLists/
Archivio/YourIPTV/Stremio-Jackett, deprecación de Nuvio Streams). Aclaración útil encontrada esta
semana: el **WebStreamr oficial** (`webstreamr-is-deprecated.elfhosted.com`) fue deprecado por su
autor en abril 2026 — pero **WebStreamrMBG, el que tenemos instalado, es un fork independiente y
activamente mantenido** de otro autor (`newman2x/WebStreamrMBG` en GitHub), no la misma instancia.
No hay señal de que le vaya a pasar lo mismo, solo vale la aclaración porque el nombre se presta a
confusión. Sin alternativas gratuitas nuevas a los addons de streams ya instalados.

**Audio latino — sin novedad accionable**: de los dos addons mencionados la semana pasada
("Primer Latino", "Addon Latam"), se los miró un poco más de cerca: **Primer Latino** es un
servicio pago (~US$2.45/mes) que trae su propio debrid incluido — no es gratis y no encaja con el
proyecto. **Addon Latam** sí tiene un camino gratis (con anuncio semanal, tras 7 días de prueba)
pero es un deploy chico y sin marca en Railway.app, sin ninguna reseña o mención en Reddit — no hay
forma de verificar que sea confiable o que se mantenga. Ninguno de los dos amerita instalarse
todavía; quedan como lectura futura.

**Plan de debrid (agosto 2026)**: sin cambios de precio en TorBox/Real-Debrid/AllDebrid esta
semana. Sí salió **TorBox v9** (1 de julio) con funciones nuevas (soporte Usenet/NNTP,
almacenamiento permanente "AirLock", integración S3) sin tocar el precio — refuerza que sigue
siendo el proyecto más activo de los tres, pero no cambia la cuenta de agosto. Real-Debrid sigue con
el mismo filtro de copyright de mayo, sin escalar esta semana. Agosto se acerca y la decisión sigue
sin tomarse; se sigue sin presionar.

## Sesión 2026-07-13 — metadata en inglés y migración de NoTorrent

Pablo reportó dos problemas nuevos, con regla de oro de **modo diagnóstico primero** (no escribir
sin confirmación explícita) y de no tocar streams/TorBox/friction-zero. Sesión dividida en dos
partes: diagnóstico (sin escritura) y, en un pedido posterior ya confirmado, la ejecución.

### Problema 1 — Metadata en inglés (título/sinopsis/género/actores, en toda la app)

**Diagnóstico**: se descartó que fuera el bug ya cerrado de "sinopsis corta en inglés" (eso es sobre
la sinopsis únicamente; acá el reporte era sistémico — título, sinopsis, género y actores, en
Descubrir/Buscar/Home/Biblioteca y al abrir un título puntual). Se confirmó con evidencia real:
- Consulta directa a Cinemeta vs. AIOMetadata para 3 títulos (Babylon Berlin, Barbarians, Criminal:
  Germany): **AIOMetadata devolvía todo en español perfectamente** ("Bárbaros", "Criminal: Alemania",
  sinopsis y géneros en español) — el problema no era AIOMetadata.
- **Causa raíz encontrada en el código fuente oficial de Stremio** (`Stremio/stremio-core`, el
  engine real de la app, no una suposición): en `stremio-core-web/.../serialize_meta_details.rs`,
  el comentario del propio código dice *"For MetaDetails: 1. If at least 1 item is ready we show
  the first ready item's data"* — Stremio consulta a TODOS los addons que proveen `meta` para un id,
  **en el orden de la colección**, y usa la respuesta del **primero que esté listo** (`Ready`), no
  la más rápida ni la mejor. Con Cinemeta en índice 0 y AIOMetadata en índice 1, Cinemeta (liviano,
  casi siempre responde bien) ganaba siempre — la respuesta en español de AIOMetadata se descartaba
  aunque llegara perfecta. Confirmado también que no hay ningún campo de "prioridad por tipo de
  recurso" en el protocolo de Stremio: el orden de colección es global (aplica a `meta`, `catalog` y
  `stream` por igual), no hay forma de decirle a Stremio "para meta preferí a X, para catálogo a Y".
- `config.language` de AIOMetadata seguía en `"es"` intacto tanto en `preset.json` como en la
  instancia en vivo — no se había perdido nada en ninguna escritura reciente.

**Opciones presentadas** (A: no tocar nada: 0 riesgo, 0 arreglo; B: invertir el orden
AIOMetadata↔Cinemeta, manteniendo Cinemeta instalado como red de resiliencia en índice 1; C: sacar
Cinemeta de la colección directamente). **Pablo eligió B.**

**Ejecutado**: `node scripts/reorder-addons.mjs "aio-metadata" --apply` — AIOMetadata pasó de
índice 1 a **índice 0**, Cinemeta de índice 0 a **índice 1**. Ningún otro addon cambió de posición
(verificado: streams siguen en idx 2-7, MyTrakt Sync en idx 9, etc. — mismo orden relativo de
siempre). Backup pre-cambio: `.backups/backup-stremioeg-pre-reorder-2026-07-13T20-06-55.json`.

**Por qué revertir ahora era menos riesgoso que en 2026-06-30**: el motivo original del orden
Cinemeta-primero fue el cold-start de AIOMetadata colgando el arranque de la app. El workflow
`keep-warm.yml` (ping cada 20 min) corre ininterrumpidamente desde el mismo 2026-06-30 — **dos
semanas sostenidas sin que se reportara el freeze** — lo que da bastante confianza en que hoy el
escenario que justificó el orden original ya no ocurre. No es garantía absoluta (un corte simultáneo
de ElfHosted y GitHub Actions todavía podría colgar el arranque en el peor momento), por eso Cinemeta
se mantiene instalado en índice 1 como red de resiliencia, no se removió.

**Verificación real, no solo contra AIOMetadata directo**: se simuló el algoritmo exacto de
`stremio-core` (consultar a todos los addons que proveen `meta` — `aio-metadata`, `com.linvo.cinemeta`
y, sorpresa, también `trakt.addon...` (MyTrakt Sync) — en orden de colección, y quedarse con el
primero `Ready`) para los mismos 3 títulos del diagnóstico. **Resultado: `aio-metadata` gana ahora
en los 3 casos** ("Babylon Berlin", "**Bárbaros**", "**Criminal: Alemania**", sinopsis y géneros en
español) — antes de este cambio hubiera ganado Cinemeta en inglés en los 3.

**Camino de vuelta si el arranque se cuelga** (probarlo en el set-top-box unos días primero): restaurar
el backup de arriba, o correr `node scripts/reorder-addons.mjs "com.linvo.cinemeta" --apply` para
devolver a Cinemeta al índice 0. Ninguna de las dos opciones tiene efectos secundarios sobre
streams/TorBox/friction-zero — es exclusivamente un reorden de colección.

### Problema 2 — Cartel "⚠️ REINSTALL NOTORRENT"

**Diagnóstico**: comparación del manifest guardado (`addonCollectionGet`) vs. el manifest EN VIVO de
NoTorrent (`https://addon-osvh.onrender.com/manifest.json`, mismo patrón usado para el bug de
catálogos congelados) mostró que el proveedor había sobreescrito `name`, `description` y los 7
nombres de catálogo a **"⚠️ REINSTALL NOTORRENT"** (incluso el logo cambió a un ícono de error),
mientras `manifest.version` seguía en `2.0.0` sin cambios — no era una corrupción nuestra ni un
problema de versión, era el proveedor señalizando a propósito que esa URL quedó obsoleta.
Encontrada la URL nueva en el directorio comunitario (`stremio-addons.net/addons/notorrent`):
`https://addon.notorrent2.workers.dev/manifest.json` — **mismo `manifest.id`** (`com.notorrent.addon`),
versión más nueva (**2.4.0**), nombre/catálogos limpios, 871 títulos reales en su catálogo de
Netflix, streams reales confirmados (7 para Matrix). El addon migró de Render.com a Cloudflare
Workers del lado del desarrollador — no es una rotura de nuestro lado.

**Ejecutado**: nuevo script genérico `scripts/update-addon-url.mjs <manifest.id> <nuevaTransportUrl>
[--apply]` (aborta si el `manifest.id` de la URL nueva no coincide con el addon que se está
reemplazando, para no instalar otra cosa por error) — `node scripts/update-addon-url.mjs
"com.notorrent.addon" "https://addon.notorrent2.workers.dev/manifest.json" --apply`. Mismo
`manifest.id`, no se duplicó la entrada. Backup pre-cambio:
`.backups/backup-stremioeg-pre-update-url-2026-07-13T20-08-08.json`.

**Verificación**: `addonCollectionGet` confirma `com.notorrent.addon` con `transportUrl` nuevo,
`name: "NoTorrent"` (limpio, sin el aviso) y `version: 2.4.0`. Stream real de Matrix contra la URL
nueva: 7 streams reales devueltos.

### Verificación final de la sesión

Backup adicional tomado justo antes de aplicar ambos cambios (por pedido explícito, además del que
ya existía del diagnóstico): `.backups/backup-stremioeg-pre-apply-metadata-notorrent-2026-07-13T20-06-12.json`.
`health-check.mjs` y `test-content.mjs` corridos antes y después de ambos cambios: verdes, sin
regresiones (Matrix 225 streams, Breaking Bad S01E01 193, Will Trent S01E01 80; 14/14 títulos de
`test-content.json` con streams reales). `addonCollectionGet` confirmó 0 addons con catálogos
congelados tras ambas escrituras. TorBox/Torrentio/Comet/sort friction-zero: sin cambios, como pedía
la regla de oro de esta sesión.

## Reglas del repo

- Commits en formato conventional, mensajes en español, cuerpo con líneas ≤ 100 caracteres.
- `data/preset.json` es la fuente de verdad de los catálogos: no perderlo.
- Secretos (API keys, credenciales de cuenta como ST_EMAIL/ST_PASS, y passwords de config como
  `AIO_PASSWORD` — a pedido explícito de Pablo el 2026-07-11 para no tener que repetirlas cada
  sesión) van en `SECRETS.local.md` en la
  raíz (gitignoreado con una entrada explícita en `.gitignore` — el patrón `*.local` no matchea
  `*.local.md`), formato simple `CLAVE=valor`. Nunca commitear claves en ningún otro archivo del
  repo.
