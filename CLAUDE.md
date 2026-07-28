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
                                    data/anti-frustration-log.json. Deployado (mejorastremio-latino);
                                    reimplementado inline en scripts/deno-hub.ts (/latino/*), que lo
                                    va a reemplazar una vez migrada la cuenta — ver arriba.
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
scripts/install-addon.mjs           Instala un addon NUEVO (manifest.id que no está en la
                                    colección) en una posición dada (--at <índice> o --after
                                    <otro.manifest.id>). A diferencia de reorder-addons.mjs/
                                    update-addon-url.mjs, que solo tocan addons ya presentes.
                                    Guard + backup antes de aplicar.
scripts/deno-hub.ts                 App consolidada de Deno Deploy (`mejorastremio-hub`, config en
                                    deno.jsonc): un Deno.serve con router por prefijo que
                                    reimplementa inline deno-subdl-addon.ts (/subdl/*),
                                    deno-latino-catalog-addon.ts (/latino/*) y
                                    deno-synopsis-enricher.ts (/synopsis/*), + /health. Reemplaza
                                    las 3 apps sueltas (ver "Sesión 2026-07-26/27" más abajo).
                                    Deployado y verificado; migración de la cuenta real de Stremio
                                    a estas URLs todavía pendiente de confirmación.
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
ST_EMAIL=... ST_PASS=... node scripts/install-addon.mjs <manifestUrl> (--at <índice> | --after <manifest.id>) [--apply]
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

## Estado actual de la cuenta (stremioeg, 2026-07-18)

**21 addons** (idx 15 = "Stremio Community Subtitles" (`com.community.stremio-subtitles`), 5º addon
de subtítulos sumado el 2026-07-27, ver "Sesión 2026-07-27" más abajo; idx 17 = "AI Search"
(`au.itcon.aisearch`), búsqueda conversacional por IA instalada 2026-07-18 como catálogo
secundario — ver "Sesión 2026-07-18" más abajo; idx 18 = "MejoraStremio Synopsis IA"
(`com.mejorastremio.synopsis-proxy`), proxy de metadata sumado el 2026-07-27; idx 20 = "Audio
Latino (verificado)", catálogo propio en Deno Deploy, ver más abajo). **Los 3 addons de
`mejorastremio-hub` (Synopsis IA idx 18, SubDL idx 13, Audio Latino idx 20) están caídos desde el
2026-07-28 por `BILLING_SUSPENDED` en Deno Deploy — ver "Sesión 2026-07-28" al final del archivo,
es la fuente de verdad más reciente sobre el estado real de la cuenta.**
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
(idx 13, `mejorastremio-hub.pabloeckert.deno.net/subdl` desde el 2026-07-27, caído por
`BILLING_SUSPENDED` — ver "Sesión 2026-07-28") → OpenSubtitles v3 (idx 14) → Stremio Community
Subtitles (idx 15, sumado 2026-07-27, ver "Sesión 2026-07-27" más abajo). Catálogos de Mubi via
"Mubi Catalog" y plataformas via "Streaming Catalogs" (addons aparte, idx 10 y 16).

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
| SubDL addon (subs ES sin SDH) | Proxy SubDL filtrando hi=true | Deno Deploy (`mejorastremio-hub.pabloeckert.deno.net/subdl`) — **caído, ver "Sesión 2026-07-28"** |
| AIOMetadata catálogos | ~132 catálogos TMDB Discover (idioma `es`) | ElfHosted (UUID en `preset.json → instanceId`) |
| MyTrakt Sync recomendaciones | Watchlist/Recommended/Trending/Popular vía Trakt | ElfHosted (UUID `13e948e9-...` en manifest) |
| SubMaker subs ES | Subs SubDL sin SDH, en la nube | ElfHosted (`submaker.elfhosted.com`) |
| Audio Latino (verificado) | Catálogo de familiar/infantil con audio latino confirmado | Deno Deploy (`mejorastremio-hub.pabloeckert.deno.net/latino`) — **caído, ver "Sesión 2026-07-28"** |
| MejoraStremio Synopsis IA | Enriquece sinopsis cortas/en inglés vía Gemini/OpenRouter | Deno Deploy (`mejorastremio-hub.pabloeckert.deno.net/synopsis`) — **caído, ver "Sesión 2026-07-28"** |
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

**Re-auditoría 2026-07-25 — confirmado que el orden cacheado-primero ya es absoluto, no solo
tendencia (sin cambios aplicados).** Tras el diagnóstico del 2026-07-25 que identificó streams no
cacheados como causa mecánica posible de "carga y reinicia", Pablo pidió endurecer el sort a una
regla de dos niveles estricta (cacheado siempre antes que descarga, sin excepción). Antes de escribir
nada se auditó la config viva (no solo lo documentado acá) y se midió la secuencia completa
cacheado/descarga (no solo el top-3) en 14 títulos reales — Matrix, Breaking Bad, Will Trent y los 11
de `data/test-content.json` (alemanes/españoles, popular y nicho) — contra Torrentio y Comet
directo:

- **Resultado: 100% de las 28 listas (14 títulos × 2 addons) tienen orden estrictamente
  cacheado-primero, sin una sola excepción** — incluso en títulos con muy poca cobertura de caché
  (Criminal: Germany 2/17 cacheados, Sky Rojo 3/57), los pocos cacheados siempre aparecían antes que
  todos los de descarga. Torrentio logra esto sin ningún parámetro de config (no existe la opción,
  ver arriba) — es comportamiento propio del addon con debrid configurado. Comet lo logra vía
  `sortCachedUncachedTogether:false`, ya aplicado desde el 2026-07-11.
- **Conclusión: no hay ningún cambio de config que aplicar** — la regla de dos niveles que se pidió
  endurecer ya está exactamente así, verificado con evidencia real y no solo con la config
  declarada. No se tocó la cuenta (no hubo ningún `addonCollectionSet`, sesión 100% de lectura).
- **Implicancia para el síntoma de "carga y reinicia" (ver diagnóstico del 2026-07-25 más abajo)**:
  como Torrentio es el primer addon de streams en la colección (índice 2), el stream que Stremio
  muestra arriba de todo es el `#1` de Torrentio, que es cacheado siempre que exista al menos un
  cacheado para ese título — confirmado en 12 de los 14 títulos probados. Los únicos 2 casos sin
  ningún cacheado en ningún addon (`Políticamente incorrectos` — 0/13 en Torrentio, 0/12 en Comet;
  y `Höllental`, ya documentado con distribución muy baja) no tienen ningún cambio de sort posible:
  es cobertura real de TorBox para ese título, no un problema de orden. El mecanismo de "elegir sin
  querer un stream de descarga" solo puede darse si (a) el título no tiene ningún cacheado en
  absoluto, o (b) el usuario/dispositivo elige manualmente algo más abajo en la lista — ninguno de
  los dos es arreglable desde la config de sort.

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

**Aplicado (fecha exacta no registrada, confirmado en el código vigente al 2026-07-26)**: la
sugerencia de arriba ya está implementada — `scripts/health-check.mjs` tiene un array
`KNOWN_FLAKY = ['WebStreamrMBG', 'Mubi Catalog']` (paso `[2/5]`) que degrada a `⚠` (sin tocar
`exitCode`) cuando alguno de esos dos no responde ni al reintento, y sigue marcando `✗` +
`exitCode=1` para cualquier otro addon. `SubSense` no está en la lista (nunca se agregó — su caída
del 2026-07-02 se trató como blip puntual, no como flakiness recurrente). Si vuelve a fallar seguido,
agregarlo a `KNOWN_FLAKY` es un cambio de una línea.

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

## Sesión 2026-07-18 — IA en Stremio, Fase A: instalación de stremio-ai-search

Pablo pidió evaluar sumar IA a la cuenta en dos fases: Fase A (esta sección) es instalar un addon
de búsqueda conversacional por IA; Fase B (en curso, ver más abajo) es un proxy propio de
metadata que enriquece sinopsis. Regla de oro de la sesión: **nunca pegar API keys reales en
formularios web de terceros** — toda la configuración de addons de terceros (stremio-ai-search acá,
mismo criterio que TorBox/Comet en su momento) se arma llamando a sus endpoints programáticamente
vía `fetch`, nunca a mano en el configurador.

### Qué es y por qué se eligió

[`itcon-pty-au/stremio-ai-search`](https://github.com/itcon-pty-au/stremio-ai-search) (MIT, activo,
308 commits) — búsqueda en lenguaje natural sobre TMDB interpretada por un LLM (Gemini o cualquier
proveedor OpenAI-compatible, BYOK). Instancia pública hosteada por el autor en
`stremio.itcon.au/aisearch/`, con configurador web propio (mismo patrón que Torrentio/Comet: arma
una URL de manifest a partir de un config). **Es complementario a AIOMetadata, no lo reemplaza**:
AIOMetadata hace TMDB Discover estructurado (filtros exactos) + búsqueda por keyword/actor exacta;
este addon interpreta pedidos abiertos tipo "crimen nórdico oscuro de los 2020" o "comedia romántica
española reciente" y arma la query de TMDB por su cuenta. Expone `catalog` + `meta` + inyecta
resultados tipo `stream` (recomendaciones "similares").

### Validación previa a instalar (sin tocar la cuenta real)

Antes de instalar se probó de punta a punta contra la instancia pública, con las keys reales pero
siempre por API directa (`POST /aisearch/validate` y `/aisearch/encrypt`, nunca el formulario):

- **Sin el error conocido "User location is not supported"** de la API de Gemini (reportado en
  issues del propio proyecto) — la clave conecta limpio desde el servidor de esa instancia.
- **Requiere TMDB API key propia** (obligatoria, gratis, `themoviedb.org`) además de la de Gemini —
  no hay ninguna key de TMDB compartida con AIOMetadata (esa vive server-side en ElfHosted, fuera de
  nuestro control). Guardada como `TMDB_API_KEY_AISEARCH` en `SECRETS.local.md` (sufijo distinto a
  propósito para no confundirla con cualquier referencia a TMDB de AIOMetadata).
- **Idioma**: por defecto responde en inglés (`TmdbLanguage` default `en-US` en el código del
  addon) — hace falta fijar `TmdbLanguage: "es-ES"` explícito en el config. Se confirmó que es un
  campo del config (va embebido una sola vez en la URL del manifest al generar el `encryptedConfig`),
  **no** algo que haga falta pasar por query — probado con 4 queries distintas sobre el mismo
  manifest, todas en español sin repetir el parámetro.
- **Coherencia**: catálogo de `series` con "crimen nórdico oscuro 2020s" → 17 resultados reales y
  bien encuadrados en el género (El caso Hartung, Dinero fácil, La chica de Oslo, etc.). Catálogo de
  `movie` con "comedia romántica española reciente" → 20 resultados reales (La infiltrada, Campeonex,
  Bajo terapia, etc.). El primer test de `movie` con una query de nordic noir dio solo 1 resultado
  flojo — no es un bug del addon, es que el nordic noir es un género casi exclusivo de TV, hay poco
  contenido real cruzando esa combinación específica de género+formato.
- **Latencia**: 2.4-4.0s de punta a punta en frío (Gemini interpreta + TMDB busca) — perceptible
  para un catálogo de Home, no instantáneo, pero dentro de rango usable.
- **Defecto real encontrado, documentado, no bloqueante**: en la respuesta de 17 resultados de
  series apareció **un duplicado** (mismo título e `id` de IMDb dos veces en la misma respuesta —
  "El caso Hartung", `tt10834220`). Es un defecto de calidad de datos del propio addon (no de TMDB
  ni de nuestra config) — vale tenerlo en cuenta si en algún momento se nota contenido repetido en
  este catálogo específico dentro de la app.
- **Cobertura de traducción incompleta**: de los 17 resultados de series, 2 quedaron sin traducir al
  español ("The Investigation", "Svörtu Sandar") — mismo límite ya documentado para AIOMetadata (no
  todos los títulos tienen metadata en español cargada en TMDB, no hay nada que ajustar de nuestro
  lado).

### Instalación

`node scripts/install-addon.mjs <manifestUrl> --after pw.ers.netflix-catalog --apply` (dry-run
primero, confirmado antes de aplicar). **Posición: índice 16, deliberadamente secundaria** — justo
después de Streaming Catalogs (idx 15), junto al resto de catálogos de descubrimiento (Mubi
Catalog, Streaming Catalogs, Trakt Integration, Audio Latino), lejos de los primeros índices
(AIOMetadata/Cinemeta/streams). Motivo: la filosofía del Home curado (ver "Inicio curado opción A"
más arriba) es "clic y anda" — catálogos de descubrimiento estructurado que cargan rápido y sin
fricción. Una búsqueda conversacional por IA, con 2-4s de latencia y dependiente de la disponibilidad
de un proveedor externo, es una herramienta para cuando el usuario quiere buscar algo específico en
lenguaje natural, no algo para competir por espacio en las primeras filas del Home.

**Verificado post-instalación**:
- `addonCollectionGet` (lectura independiente, no solo el output del script): 19 addons,
  `au.itcon.aisearch` en índice 16, ningún otro addon movido de lugar.
- `health-check.mjs`: verde, sin ids duplicados, streams/subs idénticos a antes de instalar (Matrix
  196 streams, Breaking Bad S01E01 185, Will Trent S01E01 71; AI Search aparece respondiendo en el
  conteo de streams de los 3 títulos, sin errores).
- 2 queries reales contra la URL ya instalada en la cuenta (no la de prueba): "thriller político
  alemán" (series) → 20 resultados coherentes (Babylon Berlin, Deutschland 83, Dark, etc.) en 3.96s;
  "animación familiar reciente" (movie) → 20 resultados coherentes (Robot salvaje, Vaiana 2, Sonic 3,
  Kung Fu Panda 4, etc.) en 1.81s. Catálogo aparece y responde con datos reales.

Backup pre-instalación: `.backups/backup-stremioeg-pre-install-au.itcon.aisearch-2026-07-18T13-46-08.json`.

### A vigilar a futuro — mantenimiento del proyecto upstream

`itcon-pty-au/stremio-ai-search` tenía **13 issues abiertos** al momento de instalar, varios
recientes (errores de validación de API keys, fallos generales de búsqueda IA, rendimiento lento en
WebOS/TV), **sin confirmación clara de que el mantenedor esté respondiendo activamente** — no se
tomó como bloqueante (MIT, gratis, BYOK, sin dependencia de debrid pago, instancia pública
funcionando bien en las pruebas), pero es una señal a revisar si en algún chequeo futuro (ej. la
revisión semanal automática) se nota que dejó de responder o empeoró. Si eso pasa, la opción más
simple es remover el addon (no rompe nada más, es un catálogo aislado sin overlap de manifest.id
con el resto) antes que invertir en self-host (mismo criterio de "no sumar infraestructura propia"
ya aplicado al descartar MediaFusion/AIOStreams).

## Sesión 2026-07-26/27 — consolidación en mejorastremio-hub (Deno Deploy)

Pablo pidió terminar de una vez con `deno-synopsis-enricher.ts` (escrito hacía semanas, nunca
deployado) y de paso dejar de tener una app de Deno Deploy por función — consolidar
`mejorastremio` (subdl) + `mejorastremio-latino` + el enricher nuevo en **una sola app**,
`mejorastremio-hub`, con un router por prefijo de path. Regla de la sesión: todo por API/CLI de
Deno Deploy (`DENO_DEPLOY_TOKEN`, guardado en `SECRETS.local.md`), cero pasos por el dashboard
salvo que algo fuera técnicamente imposible por API (y avisar explícitamente antes de pedirlo).

**`scripts/deno-hub.ts` (nuevo)**: un solo `Deno.serve` con router por prefijo — `/subdl/*`,
`/latino/*`, `/synopsis/*` (lógica de negocio idéntica a los 3 scripts originales, que se
mantienen en el repo como referencia, no se borraron) + `/health` (estado de config de las 3
sub-funciones) + logging centralizado por ruta. Los 3 `manifest.id` internos se mantuvieron
idénticos a los originales (`com.mejorastremio.subdl`/`com.mejorastremio.latino-catalog`/
`com.mejorastremio.synopsis-proxy`) para que la migración de la cuenta real sea un simple
`update-addon-url.mjs` sin duplicar entradas.

**Deploy por API — hallazgos reales, no obvios:**
- **Deploy Classic fue discontinuado** (confirmado en la doc oficial: shutdown 2026-07-20) — la
  plataforma vigente es la nueva "Deploy" (`console.deno.com`, modelo de "Apps", API v2). El CLI
  moderno es el subcomando `deno deploy` (parte del propio Deno CLI ≥2.9, se instala con
  `irm https://deno.land/install.ps1 | iex`), **no** `deployctl` (también discontinuado). Tiene un
  modo explícito para agentes/CI: `DENO_DEPLOY_TOKEN` + `--json --non-interactive` (documentado en
  su propio `--help`: "For non-interactive use (CI, AI agents)...").
- **La API REST pública (`api.deno.com/v1` y `/v2`) rechaza el token personal (`ddp_...`)** con
  `INVALID_TOKEN` en ambas versiones — el CLI se autentica igual (confirmado con
  `deno deploy whoami`) pero contra un endpoint interno no documentado públicamente. Conclusión:
  para este token, **el CLI `deno deploy` es el único camino soportado**, no vale intentar curl
  directo a `api.deno.com`.
- **Bug real encontrado en `deno deploy create`**: sin `--do-not-use-detected-build-config`, el
  comando intenta auto-detectar la config de build y, si encuentra CUALQUIER `deno.json(c)` en el
  `root-path` (incluso uno vacío — el propio CLI generó uno en la raíz del repo en su primer uso),
  usa esa detección (aunque esté vacía) **en vez de** los flags explícitos (`--entrypoint`,
  `--runtime-mode`), dejando la app sin entrypoint real (build falla con "No runtime entrypoint
  provided"). Confirmado leyendo el código fuente real de `@deno/deploy` (paquete JSR, cacheado
  localmente por Deno). Fix: **pasar siempre `--do-not-use-detected-build-config`** al crear apps
  por API con flags explícitos.
- **Bug/límite real: no existe forma de borrar o reconfigurar una app por CLI/API.** Enumerados
  todos los métodos tRPC que usa el cliente (`apps.create`, `apps.get`, `apps.list*`, ninguno de
  delete/update) — confirmado leyendo el código fuente completo del paquete, no asumido. Una app
  creada con build config rota queda inutilizable para siempre salvo borrarla a mano en el
  dashboard (`console.deno.com` → app → Settings → Delete app) — el único paso de dashboard de
  toda la sesión, y fue explícitamente avisado y confirmado con Pablo antes de pedírselo, dos veces
  (la primera vez por el bug de arriba; la segunda porque el primer intento de recreación con
  `--do-not-use-detected-build-config` pegó un `GENERIC` internal error de la plataforma en medio
  de la creación, dejando la app igual de inutilizable — confirmado aislado al comparar con una app
  de prueba con nombre nuevo, que deployó al toque con los mismos flags).
- **Bug real en el propio `deno-synopsis-enricher.ts` (heredado al hub), encontrado recién en
  producción real, no en el diagnóstico previo**: el modelo default de Gemini
  (`gemini-2.5-flash-lite`) devuelve **404 "no longer available to new users"** — deprecado.
  Cambiado el default a `gemini-flash-lite-latest` (alias rolling, mismo criterio que
  `OPENROUTER_MODEL=openrouter/free`: no pinnear un modelo puntual). Verificado con la key real.
- **Segundo bug real, mismo hallazgo**: `Deno.openKv()` (usado para cachear sinopsis 90 días)
  **fallaba en silencio** porque en la plataforma nueva las bases KV son un recurso separado que
  hay que provisionar y asignar explícitamente a la app (`deno deploy database provision <name>
  --kind denokv` + `deno deploy database assign <name> --app <app>`) — a diferencia de Deploy
  Classic, donde era automático. Como el catch externo de `enrichSynopsis()` se tragaba cualquier
  error sin loguear, esto hacía que el enriquecimiento pareciera "andar" (devolvía 200 rápido) pero
  en realidad devolvía la sinopsis original de AIOMetadata sin tocar, siempre — detectado solo
  porque la respuesta era sospechosamente rápida (~500ms) para una llamada real a un LLM.
  **Fix aplicado**: (1) se provisionó y asignó una base KV real (`mejorastremio-hub-kv`) a la app;
  (2) el código además se hizo resiliente — si `Deno.openKv()`/`kv.set()` fallan, el enriquecimiento
  sigue funcionando igual, solo sin cachear (nunca más debe fallar en silencio el enriquecimiento
  completo por un problema de infraestructura de cache).

**Verificado end-to-end contra la app real (`https://mejorastremio-hub.pabloeckert.deno.net`)**,
no solo con `deno check`:
- `/health` refleja correctamente qué env vars están configuradas.
- `/latino/manifest.json` y `/synopsis/manifest.json` devuelven manifests válidos.
- `/subdl/manifest.json` devuelve 503 claro (`SUBDL_KEY no configurada` — pendiente, ver abajo).
- **Sinopsis enriquecida real, en español, para los 3 títulos de referencia** (Babylon Berlin
  `tt4378376`, Barbarians `tt9184986`, Criminal: Germany `tt10986056`) — confirmado con texto
  completo, no solo con el flag `configured:true`. Babylon Berlin no necesitó enriquecerse (su
  sinopsis de AIOMetadata ya es larga y en español — comportamiento correcto del proxy, que solo
  reescribe cuando hace falta). Barbarians pasó de 166 a 778 caracteres; Criminal: Germany generó
  599 caracteres nuevos donde antes tenía la sinopsis corta original.

**Pendiente, no bloqueante para lo urgente (sinopsis)**:
- **`SUBDL_KEY` sin migrar** — Deno Deploy no permite leer de vuelta el valor de un secret ya
  guardado (ni por CLI ni por API), así que no se pudo copiar automáticamente desde la app vieja
  `mejorastremio`. Falta que Pablo lo pase para setearlo en el hub con
  `deno deploy env add SUBDL_KEY <valor> --app mejorastremio-hub --secret`.
- **App de prueba descartable `mstremio-hub-test`** quedó viva en la cuenta (se usó para aislar el
  bug de creación, sin secrets ni tráfico real) — mismo límite de arriba: no se puede borrar por
  CLI/API, requiere que Pablo la borre a mano en el dashboard si quiere limpiarla (no es urgente,
  no genera costo ni riesgo real).
- **Migración de la cuenta real de Stremio TODAVÍA NO EJECUTADA** (regla de oro de la sesión:
  requiere confirmación explícita antes de tocar `addonCollectionSet`) — `mejorastremio` y
  `mejorastremio-latino` (las apps viejas) siguen siendo las que la cuenta usa hoy; `deno-hub.ts`
  está deployado y verificado pero todavía no instalado/apuntado desde Stremio. Plan propuesto,
  pendiente de OK: actualizar `transportUrl` de los 2 addons ya instalados a las rutas nuevas del
  hub (`update-addon-url.mjs`, mismo `manifest.id`, sin duplicar) e instalar el synopsis-enricher
  nuevo en índice 0 (AIOMetadata baja a índice 1, Cinemeta a índice 2) — backup obligatorio antes.
- Una vez migrado y confirmado en producción real: borrar `mejorastremio` y `mejorastremio-latino`
  en Deno Deploy (mismo límite: solo por dashboard, con confirmación previa).

`scripts/deno-subdl-addon.ts`, `scripts/deno-latino-catalog-addon.ts` y
`scripts/deno-synopsis-enricher.ts` **se mantienen en el repo** como referencia de la lógica de
cada sub-función (mismo criterio que otros scripts legacy documentados en este archivo) — el hub
las reimplementa inline, no las importa.

## Sesión 2026-07-27 — quinto addon de subtítulos (hash matching) y desync en Wild Cards/ACI

Pablo reportó desincronización de subtítulos en **Wild Cards** (`tt29780951`, CBC, ya documentado
arriba por baja seed count) y en **"ACI"**, título que pidió identificar sin asumir — confirmado
por evidencia (IMDb + FilmAffinity) como **ACI: Alta Capacidad Intelectual** (España, 2021-2025,
`tt14060708`, remake del francés *HPI*, 4 temporadas/32 episodios). Regla de oro: modo diagnóstico
primero, sin `--apply` hasta confirmación explícita.

**Cobertura real medida (4 episodios de prueba, streams reales de los 4 addons de subs ya
instalados)**: escasa pero presente — SubSense y OpenSubtitles v3 devuelven 1-2 subs ES por
episodio en los 4 casos; SubMaker varía (0-2); **SubDL da 0 en los 4** (confirmado que el addon no
está roto — Breaking Bad S01E01 sigue devolviendo resultados normales — es cobertura real
inexistente para estos dos títulos de nicho, no un bug).

**Causa técnica real de la desincronización, confirmada con evidencia, no teoría**: de los addons
de subs instalados, **solo OpenSubtitles v3** (el oficial de Stremio) soporta matching por hash de
video (MovieHash, calculado del lado del cliente Stremio y enviado automático — no configurable de
nuestro lado). **SubDL, SubMaker y SubSense matchean solo por `imdb_id + season + episode`**,
confirmado leyendo el código real de `scripts/deno-subdl-addon.ts` (nuestro propio proxy: nunca
lee filename/hash) y la doc pública de la API de SubDL (no expone búsqueda por moviehash). Evidencia
del mismatch real: para Wild Cards S01E01, Torrentio+TorBox devuelve **17 releases distintos**
(`KONTRAST` WEBRip x265, `FW` MULTi WEB, `Pir8` italiano, `playWEB` AMZN WEB-DL, etc.) mientras los
subs de SubDL/SubMaker/SubSense son genéricos por episodio, sin ligar a un release — si el stream
elegido no coincide con el release al que el subtítulo fue sincronizado, el desfase de intro/cortes
es el síntoma reportado.

**Addon nuevo evaluado y sumado**: `stremio-community-subtitles` (skoruppa,
`github.com/skoruppa/stremio-community-subtitles`, activo, v0.7.2) — matching por hash +
base de datos comunitaria votada. Pablo creó su cuenta a mano en `stremio-community-subtitles.top`
(paso no automatizable — creación de cuenta con email es una acción prohibida para el agente,
dirigida al usuario). Instalado con `install-addon.mjs --after org.stremio.opensubtitlesv3 --apply`
en **índice 15** (20 addons totales, nada más se movió). Backup:
`.backups/backup-stremioeg-pre-install-com.community.stremio-subtitles-2026-07-27T17-16-42.json`.
`health-check.mjs` post-instalación: verde, sin regresiones (Matrix 243 streams, Breaking Bad
S01E01 283, Will Trent S01E01 84; subs ES de Matrix/Breaking Bad incluyen al addon nuevo
respondiendo).

**Resultado real, no especulativo, sobre Wild Cards/ACI con el 5º addon sumado: 0 mejora de
cobertura en los 4 episodios de prueba** (incluso pasando `filename`/`videoSize` reales tomados de
un stream real de Torrentio, para forzar el camino de hash matching). Es una base de datos
**comunitaria** — necesita que alguien ya haya subido/vinculado un subtítulo a ese hash antes de
que aparezca; para estos dos títulos de nicho esa base está vacía hoy. El sitio permite,
opcionalmente, cargar API keys propias (OpenSubtitles/SubDL/Subsource) en la cuenta para que el
addon busque en vivo en esas fuentes además de la base comunitaria — **decisión explícita de Pablo:
NO cargar `SUBDL_KEY` ahí** ("el beneficio es especulativo y agrega otra copia de la key en un
tercero sin resolver nada hoy"). El addon queda instalado igual (no genera regresión, no molesta),
por si la base comunitaria crece a futuro — no hay ninguna acción pendiente de nuestro lado.

**Conclusión y mitigación**: para Wild Cards y ACI, la desincronización es un **hueco real de
cobertura en contenido de nicho** (mismo patrón estructural ya documentado para streams de
contenido exclusivo/nicho en este archivo — ver "Contenido exclusivo Netflix/Disney+ que 'no anda'"
más arriba), **no un problema de configuración** que se arregle sumando parámetros o addons. No hay
ningún ajuste de config disponible en SubDL/SubMaker/SubSense para forzar matching por hash (no
existe el parámetro en ninguna de esas 3 APIs). **Mitigación práctica, a criterio del usuario**:
al elegir stream y subtítulo a mano, preferir el subtítulo cuyo nombre de archivo/release
(visible en el selector de Stremio) coincida con el release del stream elegido — mismo criterio ya
aplicado para elegir variante latino vs. España en subtítulos (ver "Subtítulos, variante latino vs.
España" más arriba). No reinvestigar esto salvo que alguno de los addons cambie de fuente/algoritmo
de matching.

## Sesión 2026-07-28 — outage de Deno Deploy (BILLING_SUSPENDED) y limpieza de producción

Pablo pidió una auditoría completa de problemas/errores y, tras encontrarlos, actuar de forma
autónoma para dejar la cuenta funcionando de punta a punta, con test real post-cambio. Se encontró
un **outage activo en producción hacía más de 24hs**, sin relación con nada documentado en la
sesión 2026-07-26/27 (que dejó `deno-hub.ts` deployado pero la migración de la cuenta "pendiente
de confirmación" — en algún momento posterior, sin session log, esa migración SÍ se ejecutó).

**Hallazgo — causa raíz confirmada, no especulada**: `curl` directo a
`mejorastremio-hub.pabloeckert.deno.net/health` devolvía `503` con body
`"This application is suspended due to usage limits being exceeded"`. Las 3 apps del org
`pabloeckert` (`mejorastremio-hub`, y las 2 viejas `mejorastremio`/`mejorastremio-latino`, todavía
vivas) daban el mismo 503 — es una suspensión a nivel **org**, no de una app puntual. Confirmado
con el CLI (`deno deploy orgs list --json` → `"plan":"free"`) e intentando un redeploy real
(`deno deploy . --org pabloeckert --app mejorastremio-hub --prod --json --non-interactive`), que
devolvió el código de error real: **`BILLING_SUSPENDED`** — *"Add a payment method and redeploy to
restore access, or contact support@deno.com for assistance"*. No es una cuota que resetee sola por
calendario (al menos no según el mensaje de la propia plataforma) — requiere una decisión de
Pablo (agregar método de pago o escribirle a soporte de Deno). **No accionable por el agente**,
por diseño: implica un compromiso de dinero real, fuera del alcance de lo que se puede decidir sin
el usuario.

**Timeline reconstruido** (con `gh run list`/`gh run view` sobre `health-monitor.yml`):
- 2026-07-27 ~17:31 (hora local, según timestamps de backup): se ejecuta la migración —
  `com.mejorastremio.subdl`/`com.mejorastremio.latino-catalog` cambian su `transportUrl` al hub
  nuevo (`update-addon-url.mjs`, con backup), y se instala `com.mejorastremio.synopsis-proxy`
  como addon NUEVO **en índice 0** (`install-addon.mjs`, con backup) — 21 addons totales.
- 2026-07-27 22:53 UTC: se crea la app `mejorastremio-hub` en Deno Deploy (vía CLI, confirmado con
  `deno deploy apps list`).
- 2026-07-27 14:52 UTC: última corrida `success` de `health-monitor`.
- **2026-07-28 01:57 UTC: primer `failure`** — ~3h después de crear la app, la cuota del org ya
  estaba agotada.
- 2026-07-28 14:26 UTC: sigue en `failure`. Ningún cambio hasta esta sesión.

**Impacto real mientras estuvo así**: `SubDL ES (sin SDH)` y `Audio Latino (verificado)` sin
funcionar (degradan sin romper nada más — 4 addons de subs siguen andando, el resto del Descubrir
no se ve afectado). El problema serio era **`MejoraStremio Synopsis IA` en índice 0 con
`resources: meta`**: por el algoritmo de `stremio-core` ya documentado en "Sesión 2026-07-13"
("primero que esté Ready gana"), este proxy experimental de un solo mantenedor había quedado
adelante de AIOMetadata y Cinemeta para resolver la metadata de CUALQUIER título — con el addon
caído, cada apertura de título tenía que esperar su fallo antes de caer a AIOMetadata. Exactamente
el mismo patrón de riesgo que motivó poner AIOMetadata en índice 0 en 2026-07-13, reintroducido sin
querer con una pieza mucho menos probada.

**Acciones tomadas esta sesión (todas verificadas contra la cuenta real, no solo "aplicadas")**:

1. **Reorden de la colección real**: `node scripts/reorder-addons.mjs "com.mejorastremio.synopsis-proxy"
   --after "au.itcon.aisearch" --apply`. AIOMetadata vuelve a índice 0, Cinemeta a índice 1 (orden
   idéntico al documentado antes de la migración del 27/07 para todo lo demás — streams siguen en
   idx 2-7, MyTrakt Sync en idx 9, etc., ningún otro addon se movió). Synopsis IA queda en
   **índice 18** — no bloquea nada mientras esté caído, y en cuanto Deno Deploy se reactive vuelve
   a enriquecer sinopsis sin necesitar ninguna acción manual (queda en `meta` como opción de
   respaldo, no de primera línea). Verificado de forma independiente con un `addonCollectionGet`
   fresco (no solo el output del script): índice 0 = `aio-metadata`, índice 18 = `synopsis-proxy`.
   Backup: `.backups/backup-stremioeg-pre-reorder-2026-07-28T22-43-53.json`.
2. **Fix de un bug de seguridad real, no relacionado con el outage pero encontrado al auditar**:
   `handleSubdl`/`/srt/<path>` en `scripts/deno-hub.ts` (y su gemelo standalone
   `scripts/deno-subdl-addon.ts`, ya en producción desde antes) hacía `fetch()` a cualquier URL que
   empezara con `http` en el path — un **proxy HTTP abierto sin autenticación**, explotable por
   cualquiera (`GET /subdl/srt/http://cualquier-host`). Se agregó una validación de host
   (`new URL(dlUrl).hostname !== "dl.subdl.com"` → `400`) en ambos archivos. Verificado con
   `deno check scripts/deno-hub.ts` (compila limpio). **No se pudo deployar el fix todavía** —
   mismo bloqueo `BILLING_SUSPENDED` de arriba, el deploy en sí está bloqueado, no solo el tráfico
   en runtime. Queda listo en el código para el próximo deploy posible.
3. **`scripts/health-check.mjs`**: se sumaron los 3 addons del hub a `KNOWN_FLAKY` (mismo mecanismo
   ya usado para WebStreamrMBG/Mubi Catalog) con un comentario explícito de por qué (causa =
   `BILLING_SUSPENDED`, no un bug) y la condición para sacarlos de la lista (cuando Deno Deploy
   vuelva a responder). Sin esto, el health-check diario seguía marcando `FALLA` real todos los
   días indefinidamente por algo que no tiene fix de código posible — con el cambio, quedan como
   `⚠` informativo sin disparar el email de `[FALLA]`, evitando fatiga de alertas sobre un problema
   ya conocido y trackeado acá.
4. **Housekeeping de git** (nada de esto tocaba la cuenta, solo el repo): se commitearon
   `scripts/deno-hub.ts` y `deno.jsonc` (estaban sin trackear — el código que corre en producción
   no estaba en el repo) y el drift preexistente de `data/preset.json`/`data/anti-frustration-log.json`
   (cambios sin commitear de una sesión anterior sin log — el nuevo catálogo "Crimen y Misterio
   Europeo" y los 4 catálogos de Asia deshabilitados **ya estaban aplicados en la instancia EN VIVO
   de AIOMetadata**, confirmado comparando `preset.json` contra un fetch real al manifest — no era
   un cambio a medio hacer, sólo faltaba comitear el archivo).

**Verificación final, contra la cuenta real, no solo local**:
- `health-check.mjs`: **exit code 0**, 21 addons, sin ids duplicados, streams (Matrix 183, Breaking
  Bad S01E01 185, Will Trent S01E01 63) y subs (Matrix 36, Breaking Bad 47) normales. Los 3 addons
  del hub aparecen como `⚠` (esperado, no bloquean el exit code).
- `test-content.mjs`: **14/14 títulos con streams**, incluyendo los de nicho alemán/español de
  siempre (Höllental, Tatort, etc. con sus 0 subs ya documentados como límite estructural, sin
  cambios). Sin regresiones.
- `addonCollectionGet` fresco confirma índice 0 = AIOMetadata.

**Pendiente — requiere decisión de Pablo, no accionable por el agente**:
- **Deno Deploy con `BILLING_SUSPENDED`**: agregar un método de pago en el dashboard de Deno Deploy
  (`console.deno.com` → org `pabloeckert` → Billing) o escribir a `support@deno.com`. Hasta que
  eso se resuelva, `SubDL ES (sin SDH)`, `Audio Latino (verificado)` y `MejoraStremio Synopsis IA`
  siguen sin funcionar (degradado, no bloqueante — ver arriba). Una vez resuelto: redeployar
  `deno-hub.ts` (ya tiene el fix de seguridad listo) con
  `deno deploy . --org pabloeckert --app mejorastremio-hub --prod --json --non-interactive`, y
  sacar los 3 nombres de `KNOWN_FLAKY` en `health-check.mjs`.
- **`/miniseries`**: `scripts/deno-hub.ts` ya tiene una 4ª ruta (catálogo TMDB de miniseries, 1
  temporada ≤10 episodios) con manifest propio, pero **no está instalada en la cuenta real** ni
  documentada en ningún session log anterior — parece trabajo a medio terminar de la sesión
  2026-07-26/27 que nunca se instaló. No se tocó (no hay pedido explícito de Pablo para
  instalarla) — queda como decisión pendiente, mencionarlo si se retoma el tema del hub.
- Causa de fondo del `USAGE_EXCEEDED` sin confirmar (no crítico para desbloquear, pero útil si
  Pablo quiere evitar que se repita tras pagar): consolidar 3-4 funciones en una sola app aumentó
  el tráfico combinado contra un único proyecto gratuito; el catálogo `/miniseries` en particular
  hace hasta ~40 llamadas a TMDB por refresh de caché (documentado en el propio código) y ni
  siquiera está instalado — si se decide seguir con el hub, vale revisar `deno deploy logs` para
  confirmar qué ruta generó más tráfico antes de asumir que fue solo volumen normal.

## Reglas del repo

- Commits en formato conventional, mensajes en español, cuerpo con líneas ≤ 100 caracteres.
- `data/preset.json` es la fuente de verdad de los catálogos: no perderlo.
- Secretos (API keys, credenciales de cuenta como ST_EMAIL/ST_PASS, y passwords de config como
  `AIO_PASSWORD` — a pedido explícito de Pablo el 2026-07-11 para no tener que repetirlas cada
  sesión) van en `SECRETS.local.md` en la
  raíz (gitignoreado con una entrada explícita en `.gitignore` — el patrón `*.local` no matchea
  `*.local.md`), formato simple `CLAVE=valor`. Nunca commitear claves en ningún otro archivo del
  repo.
