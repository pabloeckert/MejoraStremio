# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio. **Este archivo es la única
documentación del repo** (unificado el 2026-08-02 a pedido de Pablo — antes había también un
`README.md` y un `SIESTA-REPORT.md` sueltos, ambos fusionados acá y borrados). No hay `README.md`
a propósito: quien entre al repo por GitHub va a ver el listado de archivos en vez de un README
renderizado — es una decisión consciente, no un descuido.

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

**Cuentas gestionadas por este repo**: además de la principal (`stremioeg@gmail.com`, documentada en
todo este archivo), desde el 2026-08-02 también se gestiona una segunda cuenta —
`stremiojn@gmail.com` ("Joaquín") — con su propio historial y documentación en
`cuentas/stremiojn/CLAUDE.md`. Desde el 2026-08-13 se gestiona además una tercera —
`solotveg@gmail.com`, perfil juvenil/adolescente (hasta 17 años) — documentada en
`cuentas/solotveg/CLAUDE.md`. Ambos archivos son complementarios a este, no lo duplican. Cualquier
trabajo sobre una cuenta puntual va documentado en su propio archivo, no acá.

## Estructura

```
data/preset.json                    Fuente de verdad de los catálogos de AIOMetadata (config
                                    completa + definición de catálogos). Reconstruye la config.
data/test-content.json              Lista curada de contenido de nicho (series/pelis europeas
                                    2020-hoy) con IMDb ids; insumo de test-content.mjs.
data/anti-frustration-log.json      Registro de títulos que "no abren" (streams sin cobertura real)
                                    y su estado; ver scripts/anti-frustration.mjs abajo.
data/premiere-radar-state.json      Estado del radar de estrenos (próximo episodio no visto por
                                    show + si ya se avisó) — ver scripts/premiere-radar.mjs abajo.
data/internal-log.jsonl             Log interno (NO se manda por mail) de las corridas automáticas
                                    diarias — para que Claude lo lea entre sesiones y siga el pulso
                                    de la cuenta + los gustos/uso de Pablo. Ver "Sesión 2026-08-02".
data/test-siesta-titles.json        Lista reusable de los 22 títulos identificados/testeados en la
                                    sesión "siesta" 2026-07-11 (mismo formato que test-content.json).
docs/encuesta-catalogos.md          Encuesta de gustos para curar los catálogos de stremioeg — el
                                    *por qué* de cómo están organizados (preset.json es el *qué*).
                                    Pablo la responde por partes; cada respuesta se aplica al preset
                                    y se registra en su tabla final. Fuente de verdad de la
                                    curaduría — leerla antes de tocar showInHome/orden de catálogos.
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
scripts/regenerate-aiometadata-solotveg.mjs  Variante para la cuenta juvenil (solotveg): misma
                                    fuente (preset.json) pero con ageRating=PG-13 (cap TV-14 en
                                    series), reorden Estrenos→Plataforma→Contenido→resto, país/
                                    región/rating ocultos de Home, y catálogos "Acción Real" nuevos
                                    (sin equivalente en el preset compartido). Instancia propia, no
                                    toca data/preset.json — ver cuentas/solotveg/CLAUDE.md.
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
scripts/premiere-radar.mjs          Calcula el próximo episodio no visto de cada show en progreso/
                                    watchlist en MyTrakt Sync y detecta la primera vez que ese
                                    episodio tiene stream cacheado en TorBox + subtítulo ES real.
                                    Estado en data/premiere-radar-state.json. Sin email (ver
                                    data/internal-log.jsonl más abajo) — Sesión 2026-08-01/02.
scripts/log-status.mjs              Registra el resultado de cada corrida automatizada (health-
                                    monitor, daily-catalog-refresh, anti-frustration-review,
                                    premiere-radar, monthly-digest) en data/internal-log.jsonl —
                                    reemplaza los emails a Pablo (ver "Sesión 2026-08-02"). Poda a
                                    90 días.
scripts/monthly-digest.mjs          "Esto se estrenó de tu gusto": barre el cluster policial/
                                    familia contra /discover/recent del hub (país+género+tipo →
                                    estrenos de los últimos N días) y registra el resumen en el log
                                    interno. Sin API key propia (usa la del hub). 1° de cada mes vía
                                    .github/workflows/monthly-digest.yml — Sesión 2026-09-04.
scripts/torbox-airlock.mjs          Marca en TorBox como "airlocked" (no se purga a los 30 días)
                                    los episodios cacheados de shows en Continue Watching (MyTrakt)
                                    que Pablo todavía no vio. **Cron diario activo** (07:45 ART,
                                    reactivado 2026-09-04 a pedido explícito de Pablo — secret
                                    TORBOX_API_KEY cargado en GitHub). Lado de lectura verificado
                                    (`GET /torrents/mylist`, 261 torrents, campos OK) y una corrida
                                    real con `--apply` sin errores (0 candidatos ese día — el
                                    endpoint de escritura todavía no tuvo un caso real que lo
                                    dispare; la primera vez que aparezca un candidato, revisar
                                    `data/internal-log.jsonl` para confirmar la respuesta cruda del
                                    PUT). Reversible: comentar el bloque `schedule` del workflow si
                                    hace falta volver atrás.
scripts/watch-log.mjs               Log inteligente de visualización: lee libraryItem (datastore
                                    nativo de Stremio, sin Trakt) y reporta qué se mira más/qué
                                    engancha. Con --save <slug> persiste snapshot en
                                    data/watch-log-<slug>.jsonl. Usado para el perfil juvenil
                                    (cuentas/solotveg/CLAUDE.md) — Sesión 2026-08-13.
scripts/lib/addon-signals.mjs       Heurísticas compartidas sobre streams/subtítulos crudos
                                    (cacheado en TorBox, stream "real", idioma español) — usado por
                                    anti-frustration.mjs y premiere-radar.mjs, no reescribir por script.
scripts/tatort-coverage.mjs        Audita la cobertura de Tatort (tt0806910) episodio por episodio,
                                    últimos ~10 años: ¿stream? ¿sub ES? Resumible, deja
                                    data/tatort-coverage.jsonl. Reporta, no escribe. Ver "Sesión
                                    2026-09-03". --report re-imprime el resumen.
scripts/tatort-coverage-after.mjs  Igual pero midiendo la cobertura DESPUÉS de sumar /mediathek y
                                    /translate (Mediathek + Comet para audio DE, traducción IA para
                                    sub ES). data/tatort-coverage-after.jsonl.
scripts/tatort-prewarm.mjs         Calienta la cache de traducción IA→ES latino del hub para los
                                    Tatort de Continuar-viendo/Watchlist de MyTrakt + estrenos
                                    recientes, para que el subtítulo cargue al instante. Base de
                                    traducción = sub alemán oficial de la Mediathek → no consume
                                    cupo de nada. Estado en data/tatort-prewarm-state.json. Corre a
                                    diario vía .github/workflows/tatort-subs-prewarm.yml.
scripts/deno-hub.ts                 App consolidada de Deno Deploy (`mejorastremio-hub`, config en
                                    deno.jsonc): un Deno.serve con router por prefijo que
                                    reimplementa inline deno-subdl-addon.ts (/subdl/*),
                                    deno-latino-catalog-addon.ts (/latino/*) y
                                    deno-synopsis-enricher.ts (/synopsis/*), más /opensubtitles
                                    (OpenSubtitles ES sin SDH vía la API REST moderna, filtro real de
                                    hearing_impaired — ver "Sesión 2026-08-16"), /miniseries (catálogo
                                    TMDB de miniseries), /discover ("Descubrir Maestro", filtros
                                    combinables de servicio/región/país/idioma/género — ver "Sesión
                                    2026-07-30"), /mediathek (streams directos de la Mediathek
                                    alemana para Tatort) y /translate (subtítulo ES latino generado
                                    con IA desde la pista alemana — ver "Sesión 2026-09-03"),
                                    + /health. Reemplaza las 3 apps sueltas (ver
                                    "Sesión 2026-07-26/27" más abajo). Deployado, migrado a la
                                    cuenta real (2026-07-27) e instalado; tuvo un outage por
                                    BILLING_SUSPENDED resuelto por Pablo (ver "Sesión 2026-07-28" y
                                    "Sesión 2026-08-01").
```

Los scripts son Node ≥ 20 sin dependencias (`fetch`/`https` nativos). No hay `package.json` ni
build: es un toolkit, no un paquete. No usar `npm install`. Credenciales (`ST_EMAIL`, `ST_PASS`,
`TORBOX_API_KEY`, `AIO_PASSWORD`, `SUBDL_KEY`) van en `SECRETS.local.md` (gitignorado, formato
`CLAVE=valor`) — cargarlas como variables de entorno antes de correr cualquier script que las pida.

## Comandos

**Diagnóstico (solo leen, no requieren credenciales para lo básico):**
```
node scripts/validate-config.mjs [--json]         # valida el schema de preset.json (sin red); --json = salida machine-readable
node scripts/audit-catalog-order.mjs              # audita orden de catálogos del inicio
node scripts/health-check.mjs                     # chequeo público (manifests); con ST_EMAIL/ST_PASS es dinámico y prueba streams/subs/búsqueda reales
ST_EMAIL=... ST_PASS=... node scripts/test-content.mjs   # prueba streams+subs de data/test-content.json
node scripts/refresh-dates.mjs --check            # audita si las fechas de En Cartelera/Estrenos están vencidas
SUBDL_KEY=... node scripts/test-subdl.mjs         # mide cobertura de subs SubDL sin SDH
ST_EMAIL=... ST_PASS=... node scripts/anti-frustration.mjs list    # resumen del log antifrustración
ST_EMAIL=... ST_PASS=... node scripts/anti-frustration.mjs review  # re-chequea títulos "pendiente"
ST_EMAIL=... ST_PASS=... node scripts/premiere-radar.mjs           # próximo episodio no visto por show: ¿ya está listo?
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
ST_EMAIL=... ST_PASS=... TORBOX_API_KEY=... node scripts/torbox-airlock.mjs [--apply]   # no toca addonCollectionSet
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
y títulos en español). **Home ampliado (2026-08-02, reemplaza "Inicio curado opción A" del
2026-06-19)**: `showInHome=true` en 114 catálogos, orden fijo Próximos Estrenos → En Cartelera →
Streaming (plataformas+Top10) → Género → País → Región (Latinoamérica) — ver "Sesión 2026-08-02
(tarde)" más abajo para el detalle completo. Trending/Latest/Top Rated/Best 2020s **fuera del
inicio** a pedido explícito de Pablo ("Trending no me interesa más"). Trakt y Simkl conectados. **Streams** (idx 2-7 desde el reorden de MyTrakt del 2026-07-12 — antes idx 3-8;
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

Subtítulos (orden, actualizado 2026-08-16): **OpenSubtitles ES (sin SDH)** (idx 0,
`mejorastremio-hub.pabloeckert.deno.net/opensubtitles` — nuevo, ver "Sesión 2026-08-16" más abajo)
→ SubDL ES (sin SDH) (idx 1, `.../subdl`) → SubSense (idx 13) → SubMaker ElfHosted (idx 14) →
OpenSubtitles v3 (idx 15) → Stremio Community Subtitles (idx 16). Los dos primeros son los únicos
que filtran hearing-impaired (SDH) de forma genuina — ver esa sesión para el porqué. Catálogos de
Mubi via "Mubi Catalog" y plataformas via "Streaming Catalogs" (addons aparte).

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
  igual que health-monitor) corre `review`, commitea el log actualizado y registra el resultado en
  `data/internal-log.jsonl` vía `scripts/log-status.mjs` (sin email desde 2026-08-02, ver "Sesión
  2026-08-02" más abajo).

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
| health-monitor | Health-check 2×/día; registra en el log interno, sin email (ver "Sesión 2026-08-02") | GitHub Actions (`.github/workflows/health-monitor.yml`) |
| SubDL addon (subs ES sin SDH) | Proxy SubDL filtrando hi=true | Deno Deploy (`mejorastremio-hub.pabloeckert.deno.net/subdl`) — **recuperado, ver "Sesión 2026-08-01"** |
| AIOMetadata catálogos | ~132 catálogos TMDB Discover (idioma `es`) | ElfHosted (UUID en `preset.json → instanceId`) |
| MyTrakt Sync recomendaciones | Watchlist/Recommended/Trending/Popular vía Trakt | ElfHosted (UUID `13e948e9-...` en manifest) |
| SubMaker subs ES | Subs SubDL sin SDH, en la nube | ElfHosted (`submaker.elfhosted.com`) |
| Audio Latino (verificado) | Catálogo de familiar/infantil con audio latino confirmado | Deno Deploy (`mejorastremio-hub.pabloeckert.deno.net/latino`) — **recuperado, ver "Sesión 2026-08-01"** |
| MejoraStremio Synopsis IA | Enriquece sinopsis cortas/en inglés vía Gemini/OpenRouter | Deno Deploy (`mejorastremio-hub.pabloeckert.deno.net/synopsis`) — **recuperado, ver "Sesión 2026-08-01"** |
| Antifrustración | Revisión semanal de títulos sin streams reales, registra en el log interno | GitHub Actions (`.github/workflows/anti-frustration-review.yml`) |
| Radar de estrenos | Detecta cuando el próximo episodio no visto de un show ya tiene stream cacheado + sub ES, registra en el log interno | GitHub Actions (`.github/workflows/premiere-radar.yml`) |
| daily-catalog-refresh | Refresca fechas + regenera/aplica AIOMetadata a diario si preset.json cambió | GitHub Actions (`.github/workflows/daily-catalog-refresh.yml`) — ver detalle abajo |
| tatort-subs-prewarm | Calienta la cache de traducción IA→ES latino de Tatort (Continuar viendo/Watchlist + estrenos recientes) | GitHub Actions (`.github/workflows/tatort-subs-prewarm.yml`), 07:30 ART — ver "Sesión 2026-09-03" |
| Mediathek DE (Tatort) | Streams directos de la Mediathek pública alemana para Tatort (audio DE + sub DE oficial) | Deno Deploy (`mejorastremio-hub.pabloeckert.deno.net/mediathek`) |
| Traducción IA → ES latino | Subtítulo ES latino generado con IA desde la pista alemana; cache 90d en KV | Deno Deploy (`mejorastremio-hub.pabloeckert.deno.net/translate`) |

### health-monitor — GitHub Actions (2026-07-01, sin email desde 2026-08-02)

`.github/workflows/health-monitor.yml` corre 2 veces por día (09:00 y 21:00 Argentina) y registra
el resultado completo en `data/internal-log.jsonl` (ver "Sesión 2026-08-02" más abajo — ya no manda
ningún email). El único secret que sigue necesitando es `STREMIO_EMAIL`/`STREMIO_PASS` (login a la
API de Stremio real, no tiene nada que ver con el email de notificaciones que se sacó).

El job sigue marcándose en rojo en la pestaña Actions de GitHub si el health-check da mal (ver paso
final "Fallar job si health check falló") — es la señal visual que queda ahora que no hay email;
Claude puede chequearla con `gh run list --workflow=health-monitor.yml` al arrancar una sesión.

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

### daily-catalog-refresh — GitHub Actions (creado ~2026-07-29, documentado retroactivamente 2026-08-01)

`.github/workflows/daily-catalog-refresh.yml` no había quedado registrado en este archivo pese a
estar activo y corriendo en producción — encontrado y documentado recién al auditar el estado de
todos los workflows el 2026-08-01. Corre a diario (07:00 Argentina): `refresh-dates.mjs` →, si
`data/preset.json` cambió, `regenerate-aiometadata.mjs --apply` contra la cuenta real → audita
orden de catálogos → `health-check.mjs` → commitea `preset.json` si cambió → sube `.backups/` como
artifact → registra el resultado en `data/internal-log.jsonl` (sin email desde el 2026-08-02, ver
esa sesión más abajo) y marca el job en rojo si el regen o el health-check fallaron. Como la ventana
de
fechas de "En Cartelera" se corre todos los días, `preset.json` cambia prácticamente cada corrida →
**regenera una instancia nueva de AIOMetadata todos los días** (mismo límite ya documentado: no hay
endpoint para borrar las viejas en ElfHosted, se van acumulando huérfanas — no es un problema
práctico, solo ruido en el lado de ElfHosted que no controlamos).

**Patrón de falso positivo encontrado en la auditoría del 2026-08-01, no corregido todavía**: el
paso de `health-check.mjs` corre **inmediatamente** después de crear la instancia nueva de
AIOMetadata (segundos de diferencia) — muy poco tiempo para que ElfHosted la termine de levantar.
Confirmado con logs reales de dos corridas fallidas: el 2026-08-01 el health-check dio
`✗ 7/10 catálogos con error` (fetches que fallan/timeoutean, no catálogos vacíos) apenas 45s después
de "Instancia nueva creada"; un `health-check.mjs` corrido a mano ~11h más tarde sobre la MISMA
instancia mostró la cuenta sana (los mismos catálogos bajaron a `⚠ 2/10 vacíos` — arrays vacíos
reales, no fallas de red — que es tolerado sin romper el exit code). Es cold-start de la instancia
recién creada, no una rotura real. Efecto colateral (histórico, ya no aplica desde que se sacaron los
emails el 2026-08-02): como `health-monitor.yml` corre por separado y también puede toparse con la
instancia recién creada, Pablo llegó a recibir dos emails `[FALLA]` distintos el mismo día por la
misma causa de fondo — motivo real detrás de "estoy harto de recibir mails" que disparó esa sesión.
No se tocó el workflow en esta auditoría (solo se detectó y documentó) — arreglo más simple si Pablo
lo pide: esperar unos segundos o hacer un primer fetch de "calentamiento" al manifest nuevo antes de
correr `health-check.mjs` contra él, mismo principio que ya usa `keep-warm.yml` para la instancia
estable. Sigue pendiente — ahora es solo ruido en `data/internal-log.jsonl` (entradas `error` que en
realidad son cold-start), no urgente sin el email de por medio.

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
Con eso se completaron las 6 fases contra los 6 addons de streams + 4 de subtítulos reales. Lista
reusable en **`data/test-siesta-titles.json`** (mismo formato que `test-content.json`). Detalle
completo de los 22 títulos (antes en `SIESTA-REPORT.md`, unificado acá el 2026-08-02):

| # | Título pedido | Identificado como | IMDb ID | Streams (6 addons) | TorBox tagged | Subs ES | Audio latino |
|---|---|---|---|---|---|---|---|
| 1 | El Diablo Viste a la Moda 2 | El diablo viste de Prada 2 (2026) | tt33612209 | 166 | 105 | 30 | — |
| 2 | Will Trent | Will Trent (2023–) | tt17543592 | 100 | 57 | 6 | — |
| 3 | S.W.A.T. / "los hombres de Harrilson" | Mismo show: S.W.A.T. (2017–2025, CBS) — "Los hombres de Harrelson" es el título en español | tt6111130 | 75 | 41 | 15 | — |
| 4 | El Halcón Maltés | The Maltese Falcon (1941) | tt0033870 | 96 | 36 | 42 | — |
| 5 | Dogs of Berlin | Dogs of Berlin (2018, Netflix) | tt6839788 | 56 | 16 | 6 | — |
| 6 | Veteranos contra el crimen | Policial alemán (Colonia), COSMO | tt4449470 | **0** (confirmado en los 6 addons) | — | — | — |
| 7 | Das Quartett | Miniserie criminal alemana (Leipzig) | tt9258854 | **0** (confirmado en los 6 addons) | — | — | — |
| 8 | Einstein | Alemana original (Sat.1, 2017-2019) — no el remake eslovaco | tt5094068 | 10 | 3 | 0 | — |
| 9 | Passenger | ITV, 2024 (el pedido decía "~2023") | tt18827746 | 46 | 23 | 3 | — |
| 10 | Grams | NO IDENTIFICADO — probé Grantchester/Gangs of London/Gomorra/21 Grams, sin match confiable | — | — | — | — | — |
| 11 | El Club de Asesinatos de Marlow | The Marlow Murder Club (2024–) | tt27950663 | 34 | 23 | 7 | — |
| 12 | Las Ovejas Detectives | The Sheep Detectives (2026) | tt32565993 | 123 | 81 | 14 | **SÍ** (Cinecalidad Dual-Lat 🇲🇽 + WebStreamrMBG `[latino]` dedicado) |
| 13 | Si Es Martes, Es Asesinato | Disney+ España (2026) | tt32474482 | 58 | 30 | 1 | — |
| 14 | Se Tiene Que Morir Mucha Gente | Movistar Plus+ (2026) | tt37050740 | 4* | ~3 | 1 | — |
| 15 | Muertos, S.L. | Movistar Plus+/Netflix (2024-2026) | tt29614148 | 8 | 4 | 4 | — |
| 16 | El Fantasma de Mi Mujer | Comedia sobrenatural española (2026) | tt36120705 | 8 | 3 | 0 | — |
| 17 | Spider-Man: Un Nuevo Día | Todavía NO estrenó (31/07/2026) | tt22084616 | No testeado a propósito | — | — | — |
| 18 | Enola Holmes 3 | Netflix, estrenó 01/07/2026 | tt32278481 | 122 | 84 | 12 | **SÍ** (Cinecalidad Dual-Lat 🇲🇽 + WebStreamrMBG `[latino]`) |
| 19 | Minions y Monstruos | Título real confirmado, cines fines de junio 2026 | tt32890033 | 9 | 7 | 0 | **SÍ, solo vía WebStreamrMBG** (Torrentio/Cinecalidad todavía no lo indexó) |
| 20 | The Eternaut / El Eternauta | Netflix AR, T1 30/04/2025 (no "próximo"); T2 recién 2027 | tt27740241 | 84 | 47 | 3 | — |
| 21 | Murder Mindfully T2 | Achtsam Morden S2 (28/05/2026) | tt30217222:2:1 | 47 | 28 | 9 | — |
| 22 | How to Get to Heaven from Belfast | Corrección: Netflix, no BBC | tt31709373 | 62 | 49 | 3 | — |

\* Se Tiene Que Morir Mucha Gente: Torrentio dio timeout en la primera pasada (0 ahí); reintentado
aparte, respondió 3 streams. Total corregido: 3 (Torrentio) + 1 (Meteor) = 4.

**Geo-rescate confirmado con streams reales** (candidatos típicos a no estar licenciados para cuenta
Argentina — Dogs of Berlin, Veteranos contra el crimen, Das Quartett, Einstein de Alemania; Passenger,
El Club de Asesinatos de Marlow, How to Get to Heaven from Belfast de Reino Unido/Irlanda): 5 de los
7 reproducen sin problema (Dogs of Berlin 56, Einstein 10, Passenger 46, Marlow 34, Belfast 62 — el
mejor cubierto). Los otros 2 son los mismos 0 ya diagnosticados en la tabla — ahí ni el mecanismo de
rescate encuentra nada, por ser demasiado nicho incluso para eso. No se verificó presencia específica
en "Streaming Catalogs" (expone 30 servicios pero sin búsqueda por título/id, solo navegación por
plataforma — recorrerlo entero para 7 títulos puntuales no valía el tiempo frente a la evidencia más
fuerte de que los streams ya reproducen).

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
  sacar los 3 nombres de `KNOWN_FLAKY` en `health-check.mjs`. **Reintentado ese mismo comando el
  2026-07-28 más tarde, mismo día: sigue devolviendo `BILLING_SUSPENDED` sin cambios** — confirma
  que no es una cuota que resetee sola en horas, no hace falta reintentar de nuevo hasta que Pablo
  haga algo del lado de Deno.
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

### Chequeo semanal automático (2026-07-26)

**Workflows del domingo**: `anti-frustration-review.yml` corrió a las 15:51 UTC, `success`, y
commiteó/pusheó normalmente (`92b11bf`, confirma que el fix del 2026-07-05 se sigue sosteniendo
semana a semana). `health-monitor.yml` corrió sano todas las veces de esta semana salvo dos
excepciones (ver hallazgo abajo) — 12 corridas seguidas en verde desde el 2026-07-20 14:24 UTC.

**Hallazgo real de la semana — patrón de falla nuevo, distinto del ya documentado de addons
flaky**: de las ~14 corridas de `health-monitor.yml` entre el 2026-07-19 y hoy, 2 terminaron en
`failure` (2026-07-19 13:40 UTC y 2026-07-20 02:25 UTC). Revisadas ambas con los logs del job: por
primera vez **no fue WebStreamrMBG ni Mubi Catalog** (los dos respondieron OK en ambas corridas).
La causa real fue el paso `[3/5]` (catálogos de AIOMetadata): `✗ 1/10 catálogos con error:
tmdb.discover.tv.upcoming.pablo006` (19/07) y `tmdb.discover.movie.upcoming.pablo005` (20/07) — los
catálogos custom de "Próximos Estrenos" (tv/movie). Streams y subtítulos dieron bien en ambos casos,
y ninguna corrida posterior repitió el error (12 corridas verdes seguidas después) — parece un blip
transitorio de AIOMetadata/TMDB en esos dos catálogos puntuales, no una rotura persistente ni
relacionada con el refresh de fechas. **Sugerencia concreta**: extender el mismo criterio de
tolerancia que ya existe para addons flaky (`KNOWN_FLAKY`, agregado el 2026-07-12) a fallas
puntuales de catálogo — si falla 1 de ~10 catálogos pero el resto (streams, subs, búsqueda) están
bien, degradar a `⚠` en vez de `✗` para no disparar `[FALLA]` por un blip de un solo catálogo. No se
aplicó (cambio de comportamiento del script, no un chequeo de esta rutina) — junto con la sugerencia
pendiente del 2026-07-12 (bajar severidad de WebStreamrMBG/Mubi Catalog), queda a definir si Pablo
quiere afinar el health-check para reducir ruido de falsos positivos.

**Log antifrustración**: sin cambios — 9 resueltos, 2 pendientes (Los Mufas y El Marginal, mismo
hueco estructural de contenido exclusivo Netflix Argentina sin cobertura en trackers/scrapers
gratuitos, documentado desde el 2026-07-02).

**Novedades de ElfHosted/addons**: nada nuevo más allá de lo ya documentado (baja de AIOLists/
Archivio/YourIPTV/Stremio-Jackett, deprecación de Nuvio Streams). Dato nuevo, con fecha concreta pero
impacto probablemente bajo para nosotros: la **API pública de Jikan** (que AIOMetadata usa para
datos de MyAnimeList) **cierra el 1 de octubre de 2026**, con "brownout" desde el 1 de septiembre
(confirmado en la documentación del proyecto, `github.com/cedya77/aiometadata`). Nuestra instancia
tiene `mal.search.movie/series` habilitado como motor de búsqueda de respaldo
(`aioMetadataConfig.config.search.engineEnabled` en `preset.json`), pero **`preset.json` no define
ningún catálogo de anime propio** (el proveedor de anime configurado es Kitsu, no MAL) — así que si
ElfHosted no migra su instancia hosteada a un Jikan propio antes de esa fecha, en el peor caso se
degradaría solo la búsqueda de anime como fallback, no ningún catálogo que usemos hoy. Nada para
hacer ahora; vale la pena volver a mirarlo cerca de septiembre.

**Audio latino — sin novedad**: no se encontró ningún addon nuevo esta semana; los dos ya
investigados (Primer Latino, pago; Addon Latam, gratis pero sin garantías) siguen igual, sin
ameritar instalarse.

**Plan de debrid (agosto 2026)**: sin cambios de precio en TorBox (Essential sigue ~US$3/mes, planes
Standard/Pro sin cambios), Real-Debrid (~€4/mes, mismo filtro de copyright/palabras clave ya
documentado, sin escalar) ni AllDebrid (~€3/mes) esta semana. Agosto se acerca y la decisión de
Pablo sigue sin tomarse; se sigue sin presionar.

## Sesión 2026-07-30 — Latinobrid, reorden de Descubrir, AIOStreams, catálogo maestro y Miniseries

Sesión larga, varios pedidos encadenados de Pablo. Cuenta pasó de 21 a **24 addons** en el
transcurso. Regla de oro respetada en todo momento: cualquier escritura contra la cuenta real con
backup previo + `health-check.mjs` verde después.

**1. Addon "Latinobrid | TB" investigado** (índice 8, `community.latinobrid`) — no lo instaló el
agente en ninguna sesión registrada, aparece sumado por fuera. Apunta a `latinobrid.stremx.net`
(tercero, no ElfHosted) usando la API key real de TorBox de Pablo. Autor `drykilllogic7` en GitHub
— mismo desarrollador del `stremio-account-bootstrapper` del que nació este proyecto, nombre
conocido en el espacio. Proyecto chico (2 estrellas, 1 commit, "Checking" sin verificar en
`stremio-addons.net`). Riesgo anotado, no accionado: la key de TorBox ahora también vive en un
servidor de terceros. Se dejó instalado, sin tocar.

**2. Los Mufas / El Marginal re-chequeados** (`anti-frustration.mjs review`): siguen en 0 streams
reales ambos, sin cambios respecto al 26/07. Mismo hueco estructural de siempre.

**3. Reorden de Descubrir — Paso A, aplicado (comit `395d110`)**. Pablo pidió los catálogos
ordenados por **Servicio de stream → Región → País → Idioma → Género**. Hallazgo clave: AIOMetadata
**ya tenía sus propios catálogos de plataforma** (`streaming.*`/`flixpatrol.*` — Netflix, Disney+,
Prime Video, HBO Max, Paramount+, Hulu, Peacock, Apple TV+, Starz, Crunchyroll — 41 catálogos en
total), así que la jerarquía completa se logró reordenando el array `aioMetadataConfig.catalogs.
standard` de un solo addon (índice 0), sin tocar el addon separado "Streaming Catalogs" (30
servicios, otra fuente). El núcleo curado (En Cartelera/Próximos Estrenos/Tendencias, primeros 11
catálogos) se dejó intacto al frente — Pablo no confirmó explícitamente si debía moverse, así que
se optó por no tocarlo (menor riesgo). Clasificación con regex sobre los 153 catálogos restantes,
0 sin clasificar, 0 perdidos/ganados al regenerar (instancia nueva `81aed7e8-...`).
**Hallazgo de depuración pendiente de confirmación de Pablo**: hay **duplicación real** entre los
`streaming.*`/`flixpatrol.*` de AIOMetadata (9 servicios) y el addon separado "Streaming Catalogs"
(30 servicios, incluye esos mismos 9 + 21 más) — dos fuentes distintas para las mismas plataformas
grandes. No se tocó, queda anotado para cuando Pablo confirme qué depurar (ver punto 6).

**4. Series policiales alemanas activas, estilo Mentalist/Cold Case** (investigación, sin
instalar nada): SOKO Leipzig (ZDF, temporada 26 en emisión), Letzte Spur Berlin (ZDF, personas
desaparecidas), Nord Nord Mord (ZDF, detective excéntrico en Sylt, nuevos episodios sept. 2026).

**5. AIOStreams evaluado con TorBox activo — decisión: NO instalar**. La instancia pública gratuita
de ElfHosted (`aiostreams.elfhosted.com`) **deshabilita Torrentio, P2P y HTTP streams** ("a pedido
del desarrollador de Torrentio de no scrapear su instancia... para reducir responsabilidad legal")
— exactamente las fuentes que hoy dan la cobertura real (Torrentio 24 proveedores + TorBox, Comet,
NoTorrent/WebStreamrMBG/Nuvio). Sería una degradación de cobertura, no una mejora. La instancia
privada paga cuesta **US$9/mes** (~3x TorBox) y no ofrece ventaja clara sobre Torrentio+Comet+sort
friction-zero ya confirmado 100% cacheado-primero (auditoría 2026-07-25). Investigado contra la UI
real del configurador (`claude-in-chrome`), no solo documentación — decisión con evidencia directa,
no especulativa.

**6. Paso B — catálogo "Descubrir Maestro" construido, deployado e instalado (comit `473fd12`)**.
Nueva ruta `/discover` en `deno-hub.ts`: un catálogo único con **Servicio + Región + País + Idioma +
Género como filtros TMDB Discover combinables simultáneamente** (`with_watch_providers`+
`watch_region=AR`, `with_origin_country`, `with_original_language`, `with_genres`) — algo que
AIOMetadata no puede hacer nativamente (cada eje ahí es un catálogo fijo separado, no un filtro
dinámico). `provider_id` de TMDB verificados en vivo contra `/watch/providers/movie` (no adivinados)
para 15 servicios: Netflix(8), Disney+(337), Prime Video(9), HBO Max(1899), Paramount+(2303, tier
"Premium" — TMDB ya no expone un id "plano" único para Paramount+), Hulu(15), Peacock(386), Apple
TV+(350), Starz(43), Mubi(11), Criterion Channel(258), Shudder(99), Acorn TV(87), BritBox(151),
Crunchyroll(283). País/Región usan `with_origin_country` (región = unión OR pipe-delimited de
países, ej. Latinoamérica = `AR|MX|CO|CL|BR|PE`). Resuelve `tmdbId→imdbId` por título vía
`external_ids` con cache en memoria (no crítico si se pierde en cold start). Probado en vivo con
combinaciones reales antes de instalar: País=Alemania+Género=Crimen dio Tatort/Der Alte/Polizeiruf
110/Die Rosenheim-Cops/Derrick (calza con el gusto ya documentado del proyecto); Servicio=Netflix+
Género=Crimen, Región=Latinoamérica+Idioma=Español, y una combinación de 3 ejes a la vez
(Servicio+País+Género) — todas con resultados reales y paginación (`skip`) funcionando. Instalado
en índice 19 (junto a AI Search/Streaming Catalogs, sin competir por el Inicio).

**7. Catálogo "Miniseries" instalado** (índice 20) — existía en `deno-hub.ts` desde la sesión
2026-07-26/27 pero nunca se había instalado en la cuenta. Devuelve pocos resultados en la prueba
real (2 títulos: "Agente Kim reactivado", "Overflow") — es una limitación conocida del método
(solo criba los ~40 títulos "Ended" más populares de TMDB Discover antes de filtrar por
`number_of_seasons===1 && episodes<=10`, no un barrido amplio), documentada en el propio código,
no un bug nuevo de esta sesión. Se instaló igual porque funciona (sin errores) y es lo que ya
estaba construido — mejorar la cobertura del barrido queda fuera de esta sesión salvo que Pablo lo
pida.

**Verificación final**: `health-check.mjs` verde, **24 addons, sin duplicados**, streams/subs sin
regresiones (Matrix 208, Breaking Bad 203, Will Trent 66).

**Pendiente — requiere a Pablo confirmar en bloque (depuración "moderada", ver punto 3)**:
- ✅ **RESUELTO 2026-08-02**: Streaming Catalogs (30 servicios) vs. los 9 `streaming.*`/`flixpatrol.*`
  de AIOMetadata — se sacaron los `streaming.*` de AIOMetadata (peor calidad, ver "Sesión 2026-08-02
  (noche)"), se conservan los `flixpatrol.*` (función distinta) y "Streaming Catalogs" queda como
  fuente única de browse por plataforma.
- Bloques de Streaming Catalogs que Pablo marcó como candidatos a revisar: nicho UK (BritBox/Acorn
  TV/ITVX/Sky Go/BBC iPlayer/Channel 4), documentales (Curiosity Stream/MagellanTV/Discovery+),
  holandeses (Videoland/NLZIET), 7 países de Asia habilitados en AIOMetadata (Japón/Corea/China/
  Taiwán/Tailandia/Hong Kong/India) — ¿cuáles se usan de verdad?
  **Mitad técnica resuelta 2026-09-03**: `scripts/audit-streaming-catalogs.mjs` probó los 56
  catálogos reales (movie+series de los 30 servicios) contra la cuenta — **56/56 con contenido
  real, 0 vacíos, 0 con error**, incluidos los 11 marcados arriba como "nicho/en duda" (ej. Acorn TV
  20 películas/98 series, Curiosity Stream 86-89, NLZIET 93-100, Sky Go 98-99). Ninguno está roto —
  no hay nada que sacar por motivo técnico. **La otra mitad de la pregunta (¿Pablo los usa de
  verdad, más allá de que anden?) sigue sin resolver** — es una pregunta de gusto/hábito, no de
  funcionamiento, y este addon (catálogo de solo lectura, sin resource `subtitles`/`stream`) no
  deja rastro de qué browsea Pablo; no hay señal automática disponible para inferirlo sin
  preguntarle directamente. No se sacó nada — dogma de siempre (no perder cobertura sin evidencia
  real de que sobra).

## Sesión 2026-08-01 — Radar de estrenos listos (feature nueva) + Deno Hub recuperado

Pedido en modo autónomo ("una sola pasada", sin consultas salvo bloqueo real de credenciales/
dinero — ninguno se dio, toda la sesión fue posible sin plata ni credenciales nuevas). Antes de
construir, diagnóstico puntual de 4 títulos reportados como "no anda" (Ágata y Lola, ACI,
Balthazar, Wild Cards) que quedó documentado por separado en el log de conversación — resultado:
los 4 tenían streams reales, los problemas eran de otro tipo (episodio no estrenado, subs
desincronizados por matching sin hash, o ausencia total de subs ES pre-hechos). De paso se corrigió
un bug real en `anti-frustration.mjs`: contaba como "no real" cualquier stream con `👤 0` seeds,
ignorando que un stream `[TB+]` (ya cacheado en TorBox) reproduce igual porque no depende del swarm
vivo — ver commit `81a58d1`.

**Deno Hub (`mejorastremio-hub`) recuperado**: el outage por `BILLING_SUSPENDED` documentado en
"Sesión 2026-07-28" ya no está — `health-check.mjs` confirmó `SubDL ES (sin SDH)` respondiendo con
subs reales (3-6 según título) y los manifests de Synopsis IA/Audio Latino en v1.0.0. No se tocó
nada de nuestro lado — Pablo debe haber resuelto el billing en el dashboard de Deno en algún
momento entre el 2026-07-28 y hoy, sin quedar registrado en ningún log de sesión. `KNOWN_FLAKY` en
`health-check.mjs` todavía tiene los 3 nombres del hub — se dejó así a propósito (degradar a `⚠` en
vez de `✗` no genera ningún falso positivo ahora que andan bien; sacarlos de la lista no es
necesario para que el chequeo sea correcto, así que no se tocó sin que Pablo lo pida).

### Radar de estrenos listos — `scripts/premiere-radar.mjs` + `.github/workflows/premiere-radar.yml`

**Objetivo**: avisar por email la primera vez que el próximo episodio no visto de un show en
progreso está realmente listo para ver (no solo "estrenado"), para no tener que entrar a Stremio a
mano a revisar si ya hay stream/subs.

**Fuente de "próximo episodio no visto" — hallazgo clave, sin necesidad de tokens de Trakt**:
`MyTrakt Sync` (ElfHosted) expone en su propio endpoint `meta/series/<imdbId>.json` un campo
`watched: true/false` por episodio, ya sincronizado con Trakt server-side — no hace falta la API de
Trakt ni sus tokens (que ni siquiera son accesibles desde acá, ver "AIOMetadata — reconstruir/editar
la instancia" más arriba sobre por qué los tokens viven server-side). El script arma la lista de
shows a vigilar combinando los catálogos `continue_watching_shows` + `watchlist_shows` del propio
MyTrakt (deduplicados por `imdb_id`), y para cada uno calcula el primer episodio con `watched !==
true` ordenado por temporada/número — ese es el target.

**Criterio "LISTO" (ambos, no uno solo)**:
1. **Cacheado en TorBox**: al menos un stream de Torrentio o Comet para ese episodio puntual con el
   marcador `[TB+]`/`[TB⚡]` (mismo criterio ya usado en el sort friction-zero y ahora también en
   `anti-frustration.mjs` — ver bug fix de arriba). Reusa `isCachedStream()`.
2. **Subtítulo ES real**: al menos un resultado con `lang` que empiece con `es`/`spa` en alguna de
   las 5 fuentes de subs activas (SubSense, SubMaker, SubDL, OpenSubtitles v3, Stremio Community
   Subtitles). A propósito **no** cuenta la traducción automática bajo demanda de SubMaker (aparece
   con `lang: "Make Spanish (Latin America)"`, no un código ISO real) — eso es una promesa de
   traducción futura, no un subtítulo ya hecho; contarla generaría falsos "LISTO".

Si el episodio target todavía no se estrenó (`released`/`firstAired` > hoy), queda "pendiente" sin
gastar requests en streams/subs. Si ya se estrenó pero falla alguno de los dos chequeos, también
"pendiente" — se re-chequea al día siguiente, sin avisar nada (cero spam de falsos positivos).

**Refactor de paso, no opcional**: `isUtilityStream`/`isRealStream` vivían duplicadas dentro de
`anti-frustration.mjs`. Se extrajeron a `scripts/lib/addon-signals.mjs` junto con las funciones
nuevas (`isCachedStream`, `isSpanishLang`) para que ambos scripts compartan la misma lógica en vez
de reimplementarla — mismo patrón de `scripts/lib/collection-guard.mjs`. `anti-frustration.mjs`
ahora importa del lib; comportamiento verificado idéntico post-refactor (`node scripts/
anti-frustration.mjs list` sin cambios).

**Estado persistido en `data/premiere-radar-state.json`** (array, un registro por show con su
episodio target actual): guarda `status`, `lastCheckedAt` y `notifiedAt`. Solo se manda email la
primera vez que un episodio pasa a "listo" (`notifiedAt` null → se completa y no se vuelve a
avisar); verificado corriendo el script dos veces seguidas contra la cuenta real — la segunda
corrida no generó ninguna línea `LISTO_NUEVO`, todo quedó marcado `[ya avisado]`.

**Primer chequeo real contra la cuenta** (17 shows en `continue_watching_shows`, 0 en
`watchlist_shows`): 14 episodios pasaron a LISTO en la primera corrida (esperable — primera vez que
corre, todo lo que ya estaba disponible se notifica de una sola vez), 3 pendientes (`Mentiras, The
Series`, `Time Flies`: cache OK pero sin sub ES todavía; `Los mufas: suerte para la desgracia`: ni
cache ni subs — coincide con el hueco estructural ya documentado de contenido exclusivo Netflix
Argentina), 0 sin estrenar.

**Workflow — horario**: cron diario pensado originalmente para las 07:00 Argentina (10:00 UTC),
elegido para correr antes de los dos horarios de uso típico mencionados por Pablo al pedir la
feature (~11h y ~23h) — así, si algo pasa a LISTO, el email ya está en la bandeja antes de la
primera sesión de mirar del día. **Corregido en la práctica a 07:15 Argentina (10:15 UTC)** —
ver "Sesión 2026-08-02", corrido 15 min después de `daily-catalog-refresh` (07:00 ART) a propósito
para no pisarse en el mismo push a `data/`.
Mismo patrón que `anti-frustration-review.yml`: corre el script, commitea `premiere-radar-state.json`
solo si cambió, y manda un solo email por corrida con TODOS los episodios recién listos (no uno por
episodio — evita spam si varios shows se destraban el mismo día), extrayendo el resumen de las
líneas `LISTO_NUEVO` que el script imprime al final (mismo mecanismo de parseo por líneas que ya usa
`health-monitor.yml` para decidir si envía email). Asunto dinámico: nombre+episodio si es uno solo,
"`N series nuevas`" si son varias.

**Verificado al día siguiente (2026-08-01, más tarde)**: se disparó `workflow_dispatch` manualmente
y corrió bien de punta a punta en GitHub Actions — ver detalle en esa misma sesión más abajo (antes
de "Sesión 2026-08-02"). **El diseño de email de esta sección quedó obsoleto un día después** — ver
"Sesión 2026-08-02" (Pablo pidió sacar todos los emails del proyecto): el asunto dinámico, el parseo
de `LISTO_NUEVO` para el cuerpo del mail y el paso "Enviar email" ya no existen en
`premiere-radar.yml`. Lo que sigue vigente tal cual: el cálculo del episodio target vía MyTrakt, el
criterio LISTO (cache + subs), y el estado en `data/premiere-radar-state.json`.

### Verificación en GitHub Actions (2026-08-01, misma tarde)

Antes de dar por cerrado el radar se encontró una divergencia real de git: el remoto ya tenía 2
commits automáticos (`chore(preset): refresh diario de fechas/catálogos`, de `daily-catalog-refresh`
— workflow que en ese momento todavía no se sabía que existía, ver el hallazgo completo más abajo en
esta misma sesión) que no estaban en el historial local. Se resolvió con `git rebase origin/main`
(sin conflictos, archivos distintos) antes de pushear. Con eso hecho, se disparó
`workflow_dispatch` manualmente (`gh workflow run premiere-radar.yml`) y se lo miró correr con
`gh run watch`: corrió limpio, reconoció los 14 episodios ya notificados (`[ya avisado]`, sin
re-notificar), commiteó el estado actualizado, y saltó el paso de email porque no había nada nuevo
— exactamente el comportamiento esperado un día sin novedades. El único tramo no ejercitado fue el
envío real del email (nunca se disparó porque no hubo nada nuevo ese run) — igual quedó superado un
día después al sacarse los emails por completo.

## Sesión 2026-08-02 — Se sacan todos los emails del proyecto, log interno para Claude

Pablo pidió explícitamente ("estoy harto de recibir mails desde este proyecto") eliminar toda
notificación por email de los 4 workflows automatizados, y en su lugar crear **un log interno que
solo Claude lea** — diario, para hacer seguimiento de cómo funciona todo, y que sirva de memoria y
aprendizaje sobre sus gustos/uso para poder sugerir mejoras a futuro.

**Removido, en los 4 workflows** (`health-monitor.yml`, `anti-frustration-review.yml`,
`daily-catalog-refresh.yml`, `premiere-radar.yml`): el step `dawidd6/action-send-mail@v3` y toda la
lógica de decidir asunto/cuerpo/destinatario. `GMAIL_APP_PASSWORD` queda sin uso en GitHub Secrets
(no se borró el secret en sí — es un cambio de configuración de GitHub, no de código; Pablo puede
borrarlo cuando quiera desde Settings → Secrets, no es urgente ni tiene costo dejarlo).

**Nuevo: `scripts/log-status.mjs`** — reemplaza el email en los 4 workflows. Lee el output completo
de la corrida por stdin, filtra las líneas de chequeo rutinario (`  ✓ ...`) para no acumular ruido
pero conserva encabezados/advertencias/errores/resúmenes, y appendea una entrada JSON a
**`data/internal-log.jsonl`** (`{date, source, status, summary}`), podando automáticamente lo de más
de 90 días. Cada workflow sigue commiteando+pusheando ese archivo igual que ya hacía con sus otros
datos (mismo patrón `git add && git commit && git push`), agregando `git pull --rebase origin main`
antes de cada push nuevo — con 4 workflows tocando `data/` a horarios parecidos (`daily-catalog-
refresh` 07:00 ART y `premiere-radar` corrido a 07:15 ART a propósito para no pisarse en el mismo
minuto), el riesgo de carrera de dos pushes casi simultáneos es real aunque bajo; el rebase lo
absorbe sin intervención.

**Los jobs siguen fallando visualmente en GitHub Actions** (`exit 1` cuando corresponde) — no se
sacó esa señal, solo el email. Es la forma de detectar problemas ahora: `gh run list --workflow=
<nombre>.yml` o mirar la pestaña Actions. Documentado como hábito de arranque de sesión (ver memoria
`reference_internal_log`).

**Migración de memoria (hallazgo aparte, mismo día)**: la memoria persistente de Pablo (gustos,
reglas de trabajo tipo "no usar AskUserQuestion", "push+apply siempre", etc.) vivía guardada bajo la
ruta VIEJA del proyecto (`C--Github-MejoraStremio`, antes de moverlo a `Herramientas/`) — dejó de
cargarse sola hace varias sesiones sin que nadie lo notara, porque el path cambió y la memoria queda
indexada por path exacto. Migrada a la ruta actual, con los datos técnicos ya obsoletos (UUIDs,
conteos de addons de julio) recortados a favor de lo que ya documenta este archivo con más detalle
y vigencia — se conservó el contenido de comportamiento/gustos, que es lo que no se deriva solo de
leer el repo. Ver memoria `reference_internal_log` para el mecanismo pensado a partir de ahora:
Claude debe leer `data/internal-log.jsonl` al arrancar sesiones futuras de este proyecto y, cuando
note un patrón real (no un solo dato suelto), volcarlo a memoria persistente — no todos los días,
solo cuando haya señal genuina.

**Verificación**: `node scripts/log-status.mjs` probado localmente, filtra correctamente. Los 4
workflows quedaron sin ninguna referencia a `action-send-mail`/`GMAIL_APP_PASSWORD` (confirmado con
`grep -r`). **Disparados los 4 vía `workflow_dispatch` más tarde la misma sesión**: el primer intento
de `health-monitor` falló con `git pull --rebase` porque el paso hacía `git add` antes del `pull
--rebase` (git no permite rebasear con cambios ya en el índice sin commitear) — corregido el orden a
`commit → pull --rebase → push` en los 4 workflows, y las 4 re-corridas siguientes (`health-monitor`,
`anti-frustration-review`, `premiere-radar`, `daily-catalog-refresh`) terminaron verdes, cada una
appendeando su entrada a `data/internal-log.jsonl` sin pisarse entre sí.

## Sesión 2026-08-02 (tarde) — Revisión de punta a punta + home ampliado + fix Próximos Estrenos

Pablo pidió una revisión completa y un plan de mejoras, con 4 objetivos explícitos: (1) tener todos
los estrenos y series con catálogo al día, (2) que todo reproduzca rápido con un clic, (3) subtítulos
por default en español latino, (4) reordenar el inicio a Estreno → En Cartelera → Streams → Género →
País → Región, sacando Trending. Pidió ejecutar en modo autónomo ("haz el plan y ejecuta... vuelvo y
quiero ver que esté todo hecho").

**Hallazgo real, no cosmético — "Próximos Estrenos" venía vacío hacía semanas**: el `⚠ 2/10
catálogos vacíos: Próximos Estrenos, Próximos Estrenos (Series)` que aparecía en CADA health-check
de las últimas sesiones (no un blip puntual) tenía causa de fondo: los catálogos de estrenos
FUTUROS llevaban `vote_count.gte: 5`, un filtro que tiene sentido para contenido YA estrenado (En
Cartelera) pero que vacía por completo cualquier catálogo de títulos que todavía no se estrenaron —
nadie los vota todavía. Se sacó `vote_count.gte` de los 4 catálogos de fecha (Próximos Estrenos
movie/series, En Cartelera movie/series), dejando el piso de `with_runtime.gte` (45min película/
15min serie) como único filtro anti-basura — es el que de verdad frenaba el problema real de 2026-07-12
("My Best Friend", entrada fantasma de 2min). Se probó agregar además `popularity.gte:5` para
filtrar contenido extremadamente nicho (títulos chinos/árabes de baja relevancia que aparecían al
tope una vez sacado el filtro de votos) — **el parámetro no tuvo ningún efecto medible** (mismos
resultados con y sin él, TMDB Discover no lo está acotando de forma perceptible a ese umbral) — se
dejó puesto de todas formas por si ayuda en el margen, pero no se puede afirmar que esté filtrando
nada hoy. Verificado en vivo: "Próximos Estrenos" pasó de 0 a 19-20 resultados reales.

**Hallazgo colateral, no resuelto — "Próximos Estrenos (Series)" y "En Cartelera (Series)" devuelven
resultados casi idénticos** pese a tener ventanas de fecha opuestas (una futura ascendente, otra
pasada descendente). Hipótesis más probable: a diferencia de una película (fecha de estreno única),
una serie "en emisión" no tiene un evento de estreno discreto — shows con episodios diarios/
semanales conviven en ambas ventanas alrededor de la fecha de hoy. No parece un bug de nuestro
config sino una limitación conceptual de mapear "estreno"/"cartelera" a series vía TMDB Discover por
fecha. No se investigó más a fondo por tiempo — anotado para revisar si Pablo nota que las dos filas
de series se ven muy parecidas.

**Nuevo catálogo: "En Cartelera (Series)"** (`tmdb.discover.tv.now_playing.pablo062`) — no existía,
solo había el equivalente de películas. Espejo de "En Cartelera" (movie) pero con `first_air_date` y
piso de runtime de 15min. Cubre el pedido de "todas las series", no solo películas.

**Home ampliado a 114 catálogos visibles** (antes 11, "Inicio curado opción A" del 2026-06-19,
ver arriba) — orden exacto pedido por Pablo: Próximos Estrenos(2) → En Cartelera(2) →
Streaming/Top10(41, dentro de AIOMetadata) → Género(30: 19 de película + 11 de serie) → País(41:
todos los países habilitados, individualmente) → Región(2: Latinoamérica). **Trending, Latest,
Top Rated y Best of 2020s sacados del inicio** (`showInHome=false`, quedan `enabled=true` y
navegables en Descubrir) — interpretación: como Pablo dio una lista cerrada de categorías para el
inicio y solo nombró "Trending" como explícitamente no deseado, se tomó su lista como exhaustiva en
vez de sumar Trending/Latest/etc. por fuera de ella. Si prefiere que Latest/Top Rated vuelvan al
inicio, es un cambio de una línea (`showInHome: true` + regenerar).

**CORREGIDO horas más tarde, misma sesión — ver dogma "calidad gana a cantidad"**: la nota de
arriba quedó mal — Pablo corrigió explícitamente la premisa ("todos los estrenos" no significaba
"sin ningún filtro de calidad"). Fix real aplicado a los 4 catálogos de fecha: `sort_by` cambiado a
`popularity.desc` (TMDB Discover no soporta `popularity.gte` como filtro — lo confirmé probándolo,
cero efecto medible — pero sí como criterio de orden, y popularity SÍ tiene señal real para
contenido no estrenado, a diferencia de vote_count/vote_average que dependen de calificaciones
post-estreno). Resultado verificado en vivo: "Próximos Estrenos" pasó de mostrar WWE SummerSlam y
series chinas/árabes de nicho absoluto a mostrar Vengadores: Doomsday, Harry Potter y la piedra
filosofal, Blade Runner 2099, Spider-Man: Brand New Day, Vaiana — títulos reales y reconocibles.
El dogma completo (calidad > cantidad, máximo 1080p, cero contenido de baja calidad, prolijidad
ante todo) queda como criterio permanente para cualquier curación futura de catálogos o streams,
no solo para este fix puntual.

**Auditoría de `scripts/audit-catalog-order.mjs`**: sigue funcionando pero su clasificación interna
de categorías ("Plataformas y Top 10 (al fondo)", "Otros") quedó desactualizada para el nuevo
esquema Género/País/Región — etiqueta mal las filas (llama "Plataformas" a los géneros, "Otros" a
los países) aunque el ORDEN real que reporta es correcto. Es cosmético, no se corrigió por acotar
el alcance de esta sesión — pendiente si se usa seguido este script.

**Subtítulos por default en español (no "latino" específico) — investigado con evidencia, límite
real confirmado por API**: Stremio SÍ tiene un ajuste real "Default Subtitles Language" en la app
(cliente, sincronizable por cuenta según la documentación de `stremio-web`) que auto-selecciona el
primer subtítulo que matchee ese idioma. Se intentó setearlo por API contra la cuenta real
(`datastoreGet` con colecciones `settings`/`userSettings`/`profile`) — **la API devuelve `{"error":
{"code":5992,"message":"Sync disabled"}}` en los 3 intentos**: el sync de settings vía API está
deshabilitado para esta cuenta/deployment, no hay forma de fijarlo de forma remota. **Acción
pendiente de Pablo, un solo toque**: en el TV box, Stremio → Configuración → Subtítulos → Idioma por
defecto → Español. Con eso alcanza para "español por default". La variante **"latino" específica
sigue siendo estructuralmente imposible** (límite ya documentado extensamente arriba, en
"Subtítulos, variante latino vs. España" — ningún addon de subs distingue la variante en su campo
`lang`, solo a veces en el nombre de archivo, no filtrable) — no hay nada nuevo que cambie esa
conclusión, se re-confirmó en vez de asumirla.

**Streams "clic y anda" — CORREGIDO horas más tarde, mismo dogma**: en la primera pasada no se tocó
Torrentio/Comet (fuera de alcance del pedido inicial). Con el dogma "máximo 1080p, cero baja
calidad" ya sí se tocaron los dos, vía `scripts/update-addon-url.mjs` (mismo `manifest.id`, solo
cambia el `transportUrl`, sin duplicar entradas):
- **Torrentio**: `qualityfilter` sumó `4k` y `480p` a la lista ya excluida
  (`brremux,hdrall,dolbyvision,dolbyvisionwithhdr,threed,cam,scr,unknown`). Antes se excluía
  intencionalmente el 4K "liso" pero se dejaba pasar (decisión de 2026-07-11, ahora revertida por
  el dogma nuevo). Tokens exactos confirmados leyendo el código fuente real de Torrentio
  (`TheBeastLT/torrentio-scraper`, `addon/lib/filter.js` → objeto `QualityFilter.options`), no
  adivinados.
- **Comet**: su config JSON (base64 en la URL) sumó `"r480p": false` a `resolutions` (ya excluía
  `r2160p`/`r240p`/`r360p`/`unknown` desde antes — el tope de 1080p ya estaba, faltaba el piso).
- Verificado en vivo antes de aplicar: Matrix contra ambos con las nuevas URLs devuelve solo
  streams `720p`/`1080p`, cero `480p`/`2160p`/`4k`. `health-check.mjs` y `test-content.mjs`
  post-cambio sin regresiones (incluido Höllental, el título de menor cobertura del set de
  prueba — se mantiene en 5 streams reales, la exclusión de 480p no lo dejó en cero).

**Verificación real contra la cuenta**: `health-check.mjs` verde de punta a punta — el warning
crónico de catálogos vacíos que aparecía en TODAS las corridas anteriores **desapareció** (10/10
catálogos muestreados con contenido, antes 8/10). `test-content.mjs` sin regresiones. Backup:
`.backups/backup-stremioeg-preregen-2026-08-01T23-32-05-415Z.json` (antes del primer regen) y
`.backups/backup-stremioeg-preregen-2026-08-01T23-33-39-402Z.json` (antes del segundo, por el ajuste
de popularity). Instancia final: `c41b805f-233c-4903-9f59-bbcd25c6095f`, 0 catálogos perdidos, 1
ganado ("En Cartelera (Series)").

### Sesión 2026-08-02 (noche) — 3 pendientes cerrados: dedup streaming, Latinobrid fuera, Jikan

Pablo pidió resolver de una los 3 puntos que había quedado pendientes de sugerir: la duplicación de
Streaming Catalogs vs. AIOMetadata, sacar Latinobrid, y adelantarse al cierre de Jikan.

**1. Dedup Streaming — resuelto con evidencia, no a ojo**: antes de decidir qué fuente sacar, se
comparó contenido real de las dos para Netflix: `streaming.nfx` de AIOMetadata devolvía **20
títulos, todos estrenos recientísimos de 2026** (parece un discover por fecha, no un browse real del
catálogo); el addon separado **"Streaming Catalogs" devolvió 99 títulos**, incluyendo clásicos de
catálogo real (The Prestige 2006, Inside Man 2006, Encino Man 1992) — mucho más fiel a "qué hay
realmente en Netflix". Con el dogma calidad>cantidad, se sacaron del lado de AIOMetadata los 20
catálogos `streaming.*` que duplican lo que ya cubre mejor "Streaming Catalogs" (nfx/nfk/dnp/amp/
hbm/pmp/hlu/pcp/atp/sta — Netflix, Netflix Kids, Disney+, Prime Video, HBO Max, Paramount+, Hulu,
Peacock, Apple TV+, Starz). **Se conservaron** los `flixpatrol.*` (Top 10 charts — función distinta,
no duplicada, "Streaming Catalogs" no tiene equivalente) y `streaming.cru` (Crunchyroll, único, no
cubierto por el otro addon).
  - **Trade-off aceptado y avisado, no escondido**: la sección "Streams" del home (Estreno→Cartelera→
    **Streams**→Género→País→Región) ahora solo tiene los 18 `flixpatrol.*` Top 10 — el browse
    completo por plataforma (el de mejor calidad, 99 títulos) vive en el addon "Streaming Catalogs",
    que por estar en otro addon de la colección (más atrás) no puede interponerse en esa posición
    exacta del home sin duplicar la instancia de AIOMetadata en dos (partir Estreno/Cartelera de
    Género/País/Región en dos addons separados) — desproporcionado para esto. Se prioriza calidad +
    prolijidad (sin duplicar) sobre la posición exacta.
  - Home pasó de 114 a 96 catálogos visibles.

**2. Latinobrid removido**: `community.latinobrid` (índice 8, addon de un desarrollador chico — 2
estrellas en GitHub, 1 commit — con la API key real de TorBox cargada en su config) sacado de la
colección. Backup pre-cambio en `.backups/`, verificado con un `addonCollectionGet` posterior que ya
no aparece. 23 addons (antes 24).

**3. Jikan/MAL — apagado proactivo**: `mal.search.movie`/`mal.search.series` (motores de búsqueda de
respaldo, no el proveedor de catálogo de anime — ese es Kitsu, sin tocar) puestos en `false` en
`aioMetadataConfig.config.search.engineEnabled`. Jikan brownout 2026-09-01, cierre 2026-10-01 — se
adelantó el apagado en vez de esperar a que se rompa solo. Verificado que la búsqueda general sigue
funcionando (Matrix por título, Tom Cruise por actor) sin ese motor.

**Bug real encontrado en `regenerate-aiometadata.mjs` al aplicar esto**: el guard anti-pérdida
funcionó bien (detectó los 18 catálogos que se sacaban a propósito y pidió `--force`, correcto). Pero
con `--force`, el script reportó **"Swap NO confirmado"** (exit 1) pese a que el `addonCollectionSet`
sí había aplicado bien — el chequeo de verificación post-escritura (`addonCollectionGet` inmediato
después del `Set`) dio un falso negativo, probablemente por un delay de propagación del lado de la
API de Stremio entre escribir y poder leer de vuelta el mismo valor. Confirmado con un
`addonCollectionGet` manual segundos después: el `transportUrl` nuevo ya estaba aplicado
correctamente. Se sincronizó `instanceId` en `preset.json` a mano para no dejar drift. **Corregido
en la misma sesión** (commit `74ac120`): el chequeo post-`Set` ahora reintenta hasta 4 veces con 2s
de espera entre intentos antes de declarar "NO confirmado" — afecta directamente a
`daily-catalog-refresh.yml`, que corre este script sin supervisión todos los días.

**Verificación final**: `health-check.mjs` verde — 23 addons, sin duplicados, búsqueda OK, streams
sin regresión (Matrix 157, Breaking Bad 157, Will Trent 62 — bajaron un poco respecto a la sesión
anterior por la exclusión de 480p/4K, esperado). `test-content.mjs` sin regresiones en los 14
títulos de nicho. Instancia final de AIOMetadata: `fc5d88dc-1965-4c10-b6db-4d1375ea61fa`.

### Chequeo semanal automático (2026-08-02)

**Workflows del domingo**: ambos corrieron y terminaron en verde. `anti-frustration-review.yml`
corrió a las 15:49 UTC (`success`, commit `9dea6fae`). `health-monitor.yml` corrió dos veces hoy
(02:07 y 13:43 UTC, ambas `success`) — las dos corridas `failure` que aparecen en el historial son
de ayer 2026-08-01 (`workflow_dispatch` y `schedule`), ya diagnosticadas y corregidas en la sesión
de esa misma tarde (bug de orden `git add` antes de `pull --rebase`, ver "Sesión 2026-08-02" más
arriba) — no repitieron hoy, confirma que el fix quedó sostenido.

**Log antifrustración**: sin cambios de estado — **15 resueltos, 2 pendientes** (Los Mufas, El
Marginal), mismo hueco estructural de siempre (contenido exclusivo Netflix Argentina sin cobertura
en trackers/scrapers gratuitos). El diff de la corrida de hoy solo refleja el refresh de
`lastCheckedAt` y la salida de "Latinobrid | TB" del desglose por addon (consistente con su
remoción de la cuenta el 2026-08-02 noche) — nada más cambió. **Detalle menor, no accionable**: el
campo `name` de Los Mufas (`tt27763549`) había quedado como "A Man Like Maximilian" en la corrida
del 2026-08-01 (lookup de metadata equivocado, probablemente un hiccup puntual de Cinemeta) y se
autocorrigió solo en la corrida de hoy a "Los Mufas" — no se repitió en ninguna otra entrada del
log, no amerita ningún cambio de código por ahora.

**Plan de debrid (agosto 2026)**: sin cambios de precio en TorBox — sigue en 4 planes (Free 3
slots/10 descargas mes; **Essential ~US$3/mes, descargas ilimitadas, 300GB** — el que usa Pablo;
Standard ~US$5/mes, 500GB; Pro ~US$10/mes, 1TB, Usenet) y sigue siendo, según varias reseñas
independientes de 2026, el servicio de debrid de más rápido crecimiento del mercado. **Dato nuevo
que refuerza la recomendación**: el filtro de copyright de Real-Debrid (activo desde mayo 2026, ya
documentado en la sesión de esa fecha) escaló — reportes de junio/julio 2026 hablan de hasta **50-70%
del contenido cacheado bloqueado** para suscriptores de larga data, no solo "algunos streams rotos"
como se sabía antes. AllDebrid sigue como alternativa económica (~€3/mes) sin señales de aplicar el
mismo tipo de filtro. Nada de esto cambia la recomendación ya dada (TorBox), solo la refuerza más
fuerte que la semana pasada. Agosto ya llegó y la decisión de sumar debrid de pago **ya está
tomada y aplicada** (TorBox activo desde el 2026-07-11) — este punto queda por completitud del
chequeo semanal, no hay nada pendiente de decidir acá.

**Investigación de mejoras — sin hallazgos que ameriten acción**:
- **Nuvio Streams** (ya deprecado, documentado desde 2026-07-03): confirmado que su repo fue
  **archivado en febrero 2026** (desarrollo parado del todo, no solo sin mantenimiento activo) —
  no cambia nada de nuestro lado, el addon se dejó instalado por el mismo criterio ya documentado
  (sigue dando algo de valor en contenido masivo, cero costo de mantenerlo).
- **AIOStreams** sigue apareciendo recomendado en guías/reviews de terceros como agregador
  primario (dedup entre Torrentio/Comet/MediaFusion) — ya evaluado a fondo el 2026-07-30 contra la
  UI real: la instancia pública de ElfHosted **deshabilita justamente Torrentio/P2P/HTTP** (las
  fuentes que dan la cobertura real hoy) y la privada cuesta US$9/mes, ~3x TorBox, sin ventaja
  clara sobre Torrentio+Comet+sort friction-zero ya confirmado 100% cacheado-primero. Sin cambios
  desde esa evaluación — no se reabre.
- **Audio latino**: aparecieron dos nombres nuevos en búsquedas genéricas ("Progreso Latino",
  "Stremio Latino") además de los dos ya evaluados (Primer Latino, pago; Addon Latam, gratis sin
  garantías). Son hallazgos de sitios SEO genéricos, sin ninguna señal de comunidad/GitHub
  verificable en esta pasada (mismo estándar que hizo descartar Latinobrid hace nada por falta de
  trust) — no ameritan investigación más profunda todavía, quedan anotados nomás por si reaparecen
  con más evidencia en futuras revisiones.
- **ElfHosted**: nada nuevo que afecte a los addons instalados (AIOMetadata, MyTrakt Sync, SubMaker,
  Comet, NoTorrent, Stremio Community Subtitles) más allá de lo ya conocido (baja de AIOLists/
  Archivio/YourIPTV/Stremio-Jackett del 1 de julio, deprecación/archivado de Nuvio Streams).

**Conclusión de la semana**: nada roto, nada nuevo que accionar. Los dos workflows automáticos
están sanos, el hueco de Los Mufas/El Marginal sigue siendo el mismo límite estructural de siempre,
y el ecosistema de addons/debrid no tuvo movimientos que ameriten un cambio de configuración.

### Chequeo semanal automático (2026-08-09)

**Workflows del domingo**: los 4 workflows automatizados del proyecto corrieron en verde hoy —
`anti-frustration-review.yml` (15:18 UTC, `success`), `health-monitor.yml` (dos corridas, 01:11 y
13:05 UTC, ambas `success`, "Todo OK — setup funcionando correctamente" en las dos), `daily-catalog-
refresh.yml` (10:40 UTC, `success`, 0 catálogos perdidos/ganados) y `premiere-radar.yml` (10:51 UTC,
`success`). Dato menor, no accionable: `daily-catalog-refresh.yml` tuvo **una falla puntual el
miércoles 2026-08-05** (no el domingo del chequeo), pero se auto-resolvió sola al día siguiente y
las 4 corridas posteriores (06/08 a 09/08) vinieron todas en verde — consistente con el patrón de
cold-start transitorio ya documentado arriba ("Patrón de falso positivo... no corregido todavía"),
no es una rotura nueva.

**Log antifrustración**: sin cambios de estado — **15 resueltos, 2 pendientes** (Los Mufas, El
Marginal), mismo hueco estructural de siempre (contenido exclusivo Netflix Argentina sin cobertura
en trackers/scrapers gratuitos). El único diff de la corrida de hoy fue el refresh de
`lastCheckedAt` y el campo `name` de Los Mufas, que había quedado mal poblado la semana pasada
("A Man Like Maximilian") y se corrigió solo de vuelta a "Los Mufas" — mismo patrón ya visto el
2026-08-02, no amerita ningún cambio de código.

**Hallazgo real de la semana — causa de fondo del outage de Deno Deploy del 2026-07-28, confirmada
con la documentación oficial de pricing**: investigando si el patrón de `BILLING_SUSPENDED` de esa
sesión podía repetirse, se confirmó que **Deno Deploy migró todas las organizaciones al plan Free
por defecto** en la transición de plataforma de julio 2026 (Deploy Classic → Deploy nuevo), con
límites de **1 millón de requests/mes, 100GB de banda saliente y 50ms de CPU por request** — y que,
a diferencia de un plan pago (que factura el excedente), **un org Free que excede cualquiera de esos
límites queda con sus apps PAUSADAS hasta el siguiente ciclo de facturación**, no hay auto-reactivación
inmediata. Esto explica el mecanismo exacto detrás del outage de julio (no solo "se excedió una
cuota", sino un pausado automático de plataforma) y, más importante: **el mismo pausado puede
repetirse cualquier mes** si `mejorastremio-hub` (que sirve SubDL/Audio Latino/Synopsis IA) vuelve a
superar esos límites — no fue un evento de una sola vez ya cerrado. Verificado que el hub está sano
hoy (el health-check de esta semana no mostró ninguna advertencia de los 3 addons del hub, que
siguen en `KNOWN_FLAKY` mientras tanto). No es accionable por el agente (implica decisión de plata:
agregar método de pago o vigilar el uso) — queda anotado para que Pablo lo sepa, no para actuar solo.

**stremio-ai-search (`au.itcon.aisearch`) — señal de mantenimiento floja, sin empeorar**: 6 issues
nuevos abiertos en GitHub desde la instalación del 2026-07-18 (`#230`-`#235`, 23/07 al 01/08), todos
siguen "Open" sin respuesta visible del mantenedor — mismo patrón de baja actividad ya anotado como
"a vigilar" al instalarlo, sin señal de que haya empeorado a "addon roto" todavía. Sin acción por
ahora (mismo criterio: si en algún momento deja de responder de verdad, se remueve sin drama).

**Audio latino**: sin novedad verificable — reaparecieron los mismos dos nombres genéricos ya
anotados la semana pasada (Progreso Latino, Stremio Latino) en búsquedas SEO, sin ninguna señal de
comunidad/GitHub que los distinga de Latinobrid (ya descartado por falta de trust). No ameritan
investigación todavía.

**ElfHosted**: sin deprecaciones ni novedades nuevas esta semana más allá de lo ya documentado.

**Plan de debrid (agosto 2026)**: sin cambios de precio en TorBox (Essential sigue ~US$3/mes;
aparecen promociones de 20-30% off en planes anuales, sin relevancia porque Pablo ya está en el plan
mensual) ni en AllDebrid. Real-Debrid: sin escalada nueva desde el filtro de mayo 2026, pero se
confirmó con una fuente más autorizada (TorrentFreak) que el filtro **responde a obligaciones legales
de la Digital Services Act de la UE** (no es una política reversible de la empresa) — refuerza que no
es un problema temporal que vaya a aflojar, mismo motivo por el que TorBox sigue siendo la
recomendación. La decisión de agosto ya está tomada y aplicada (TorBox activo desde el 2026-07-11);
este punto queda solo por completitud del chequeo semanal.

**Conclusión de la semana**: nada roto en la cuenta. El hallazgo que sí vale la pena que Pablo tenga
en el radar es el de Deno Deploy — no es una falla, es una condición de plataforma (plan Free con
pausado automático por exceso de uso) que ya pasó una vez en julio y puede repetirse cualquier mes
mientras el hub no tenga un plan pago o el tráfico se mantenga bajo el límite gratuito.

### Chequeo semanal automático (2026-08-16)

**Workflows del domingo**: `anti-frustration-review.yml` corrió a las 15:08 UTC (`success`, commit
`5071aa8`, solo refrescó `lastCheckedAt` de los 2 pendientes — sin cambios de estado).
`daily-catalog-refresh.yml` (10:28 UTC) y `premiere-radar.yml` (10:38 UTC) corrieron ambos en verde,
mismo patrón diario de siempre.

**`health-monitor.yml` — hallazgo real de la semana**: de las 2 corridas de hoy, la de las 00:55 UTC
salió `success`, pero la de las **12:52 UTC salió `failure`** — motivo: `✗ Torrentio TB: NO RESPONDE
(2 intentos)` en el paso `[2/5]` (manifests). Es la **primera vez que falla el propio Torrentio**
(no un addon ya catalogado como flaky) desde que arrancó el log interno (2026-08-01) — hubo un blip
igual, mismo síntoma, el **2026-08-05** (dentro de una corrida de `daily-catalog-refresh`, que
también corre `health-check.mjs`), y en ese caso el chequeo siguiente unas horas después ya daba
`success` de nuevo. Torrentio es el addon de streams más importante de la cuenta (24 proveedores +
TorBox, primero en la colección) — con solo 2 blips en 2 semanas y ambos autorresueltos, no amerita
sumarlo a `KNOWN_FLAKY` todavía (ese mecanismo es para addons con flakiness recurrente y de bajo
riesgo — Torrentio es lo opuesto: alto riesgo si de verdad se cae, así que conviene que siga
disparando `✗` mientras no haya un patrón más sostenido). **No se pudo confirmar en vivo si ya se
recuperó** — esta sesión no tiene `ST_EMAIL`/`ST_PASS` disponibles (corre sin credenciales de cuenta)
y la próxima corrida programada de `health-monitor` es recién ~21:00 ART (00:00 UTC). Vale que Pablo
sepa que, al momento de este chequeo, el health-check más reciente estaba en rojo por este motivo —
si el patrón se repite una tercera vez en las próximas semanas, ahí sí valdría investigarlo más a
fondo (o considerar agregar Torrentio a `KNOWN_FLAKY` si resulta ser blips cortos sin impacto real en
streams, igual que WebStreamrMBG/Mubi Catalog en su momento).

**Log antifrustración**: sin cambios de estado — **19 resueltos, 2 pendientes** (Los Mufas, El
Marginal), mismo hueco estructural de siempre (contenido exclusivo Netflix Argentina sin cobertura en
trackers/scrapers gratuitos). El único diff de la corrida de hoy fue el refresh de `lastCheckedAt` de
esos 2 títulos — nada más cambió.

**Investigación de mejoras — sin hallazgos que ameriten acción esta semana**:
- **ElfHosted**: nada nuevo sobre los addons instalados (AIOMetadata, MyTrakt Sync, SubMaker, Comet,
  NoTorrent, Stremio Community Subtitles) más allá de las deprecaciones ya conocidas de meses
  anteriores (AIOLists/Archivio/YourIPTV/Stremio-Jackett/Nuvio Streams/KnightCrawler/Annatar). Sin
  señales nuevas de riesgo.
- **Torrentio (proyecto, no solo el blip de hoy)**: el repo (`TheBeastLT/torrentio-scraper`) sigue
  activo, con issues abiertos regulares (incluidos varios de julio 2026) y sin señal de abandono —
  el blip de hoy es consistente con el patrón histórico del proyecto (ya tuvo caídas puntuales por
  problemas de hosting antes, ej. issue #450 de marzo 2026), no una señal de deprecación.
- **stremio-ai-search**: actividad de issues sin cambios relevantes respecto al chequeo anterior —
  sigue con baja respuesta del mantenedor pero sin empeorar a "addon roto". Sin acción.
- **Audio latino**: no aparecieron addons nuevos con señal de comunidad/GitHub real esta semana —
  mismos nombres genéricos de siempre (sin trust verificable). Sin acción.
- **Subtítulos**: nada nuevo (SubDL/Community Subtitles/SubSense sin cambios de proveedor o API).

**Plan de debrid (agosto 2026)**: sin cambios de precio en TorBox (sigue Free/Essential ~US$3/mes/
Standard ~US$5/mes/Pro ~US$10/mes) ni en AllDebrid. Real-Debrid: se reconfirma que el filtro de
copyright sigue activo y está atado a obligaciones legales (Digital Services Act de la UE), no es
una política que vaya a revertirse — refuerza la recomendación de TorBox ya tomada y aplicada desde
el 2026-07-11. Nada pendiente de decidir acá, agosto ya está cerrado con la decisión ya ejecutada.

**Conclusión de la semana**: cuenta sana en general — el único punto real es que el health-check más
reciente (12:52 UTC de hoy) está en rojo por Torrentio sin responder al manifest 2 veces seguidas,
segundo blip así en 2 semanas, sin confirmación todavía de que ya se haya recuperado. No es un
addon ya catalogado como flaky, así que vale la pena que Pablo lo tenga presente y, si tiene forma de
chequear la app en el corto plazo, confirme que Torrentio sigue dando streams con normalidad. Nada
más nuevo esta semana en addons/debrid.

## Sesión 2026-08-16 — subtítulos SDH: causa real encontrada + addon propio "OpenSubtitles sin SDH"

Pablo reportó que el subtítulo en español seguía trayendo contenido para sordos (texto descriptivo
entre corchetes tipo "[susurro]"/"[música]") **incluso dentro de Stremio**, no solo con reproductor
externo (VLC/Nova) — descartando la hipótesis inicial de que fuera un problema del reproductor
externo. Diagnóstico + fix hecho de punta a punta, con evidencia real en cada paso, no supuesto.

**Causa raíz confirmada (no adivinada)**: de los 4 addons de subtítulos que tenía la cuenta
(SubSense, SubMaker, SubDL, OpenSubtitles v3), **solo SubDL filtra SDH de verdad** — es la única
fuente con un campo estructurado `hi`/`hearing_impaired` en su API. Los otros 3 corren sobre la base
de datos vieja de OpenSubtitles.org (XML-RPC/legacy), que **no tiene ningún dato de SDH filtrable,
ni siquiera en el nombre del archivo** — comprobado bajando los 20 resultados reales de SubSense
para Matrix: 0/20 con "HI"/"SDH" en el filename, pero seguramente varios sí lo son. Como esos 3
addons sin filtrar aportan ~37 de los ~40 subtítulos ES totales de un título típico (SubDL solo 3),
dominan la lista que ve Stremio — de ahí que un SDH se cuele "incluso adentro de Stremio".

**Mitigación inmediata, gratis**: se reordenó SubDL al frente de los addons de subtítulos
(`reorder-addons.mjs com.mejorastremio.subdl --apply`) — mejora las chances sin resolver el fondo.

**Solución de fondo — addon propio nuevo, `/opensubtitles` en `scripts/deno-hub.ts`**: Pablo consiguió
una API key gratis de `api.opensubtitles.com` (la API REST **moderna**, distinta de la vieja que usan
SubSense/SubMaker/OpenSubtitles v3) — confirmado empíricamente contra la API real que esta sí trae
`hearing_impaired: true/false` por archivo, filtrable con `hearing_impaired=exclude` en la búsqueda.
Se armó un addon nuevo con el mismo patrón que `/subdl` (búsqueda perezosa, descarga solo al abrir el
subtítulo elegido):

- **Cupo real de la key: 100 descargas/día** (no de búsquedas, que están a 5/seg sin límite diario
  aparente), reset a las 23:59:59 UTC — confirmado contra la API real, no documentación. Por eso la
  descarga es perezosa y **cacheada en Deno KV** (90 días, mismo patrón ya usado por
  `/synopsis` — `getKv()` compartida) para no gastar cupo en repeticiones del mismo archivo.
  Verificado en vivo: pedir el mismo `file_id` dos veces solo consume 1 del cupo (la propia API de
  OpenSubtitles tampoco re-descuenta descargas repetidas del mismo archivo en el día, un colchón
  extra además del cache propio).
- **Cobertura real medida**: 50 subtítulos ES (todos con `hearing_impaired:false` confirmado) para
  Matrix, 26 para Breaking Bad S01E01 — muy por encima de los 3 de SubDL, con el mismo nivel de
  confiabilidad del filtro.
- Instalado en **índice 0** de la colección (primero de todos), `manifest.id`
  `com.mejorastremio.opensubtitles`. Secret `OPENSUBTITLES_API_KEY` agregado a Deno Deploy y a
  `SECRETS.local.md`. Deploy verificado en producción antes de instalar (no solo local).
- `health-check.mjs` post-instalación: verde, 24 addons, Matrix pasó de 40 a **90 subs ES**
  (OpenSubtitles sin SDH=50, SubDL sin SDH=3, resto sin filtrar=37 — quedan instalados igual, más
  abajo en la lista, por volumen adicional aunque no filtren).

**Límite que sigue sin solución, confirmado de nuevo, no reinvestigar**: la variante regional
(latino vs. España) sigue sin ser filtrable en ninguna fuente, incluida esta nueva — mismo hallazgo
ya documentado en "Subtítulos, variante latino vs. España" más arriba, la API moderna de
OpenSubtitles tampoco distingue `es-419` de `es-ES`, todo cae bajo `language:"es"` genérico.

**Reproductor externo — sin resolver, es límite del cliente, no de los addons**: investigado con
evidencia real (varios issues abiertos en `Stremio/stremio-bugs`, incluido uno específico del mismo
modelo de caja de Pablo, ZTE B866v2) que el lanzador de reproductor externo de Stremio en Android TV
tiene bugs conocidos y activos (VLC se cierra solo y vuelve a la pantalla de selección). Recomendado
probar **Nova Video Player** (abierto, con interfaz de TV dedicada, mejor reportado que VLC) en vez
de VLC — instalado por Pablo, carga y reproduce bien, pero el traspaso del subtítulo elegido al
reproductor externo específicamente quedó pendiente de que Pablo confirme si preseleccionar el
subtítulo DENTRO de Stremio antes de abrir el externo soluciona el traspaso — no verificable sin el
dispositivo real.

### Chequeo semanal automático (2026-08-23)

**Workflows del domingo**: los 4 workflows automatizados corrieron en verde hoy —
`anti-frustration-review.yml` (15:09 UTC, `success`), `health-monitor.yml` (dos corridas, 00:55 y
12:53 UTC, ambas `success`), `daily-catalog-refresh.yml` (10:29 UTC, `success`) y
`premiere-radar.yml` (10:38 UTC, `success`).

**`health-monitor.yml` — un blip nuevo esta semana, autorresuelto**: la corrida del **2026-08-22
00:52 UTC salió `failure`** — motivo: `✗ AI Search: NO RESPONDE (2 intentos)` en el paso `[2/5]`
(manifests). Es la primera vez que el propio `au.itcon.aisearch` (búsqueda conversacional por IA,
instalada 2026-07-18, ya anotada como "de mantenimiento flojo") tira abajo el health-check — no
está en `KNOWN_FLAKY`. La corrida siguiente, 12 horas después (12:53 UTC), ya dio `success` sin
ninguna advertencia — autorresuelto, sin intervención. Solo un blip por ahora, no amerita sumarlo a
`KNOWN_FLAKY` todavía (mismo criterio que Torrentio la semana pasada: hace falta un patrón
sostenido, no un evento aislado). **Dato relacionado y tranquilizador**: el blip de Torrentio
señalado el 2026-08-16 (dos caídas de manifest en 2 semanas) **no se repitió** en ninguna corrida
de esta semana (17 al 23/08) — parece haber sido ruido puntual, no hace falta seguir vigilándolo
con la misma urgencia.

**Log antifrustración — cambio real, no solo refresco de fecha**: pasó de 19 resueltos/2
pendientes (semana pasada) a **20 resueltos / 10 pendientes** hoy. La diferencia no viene de la
revisión de `anti-frustration-review.yml` (que solo refrescó `lastCheckedAt` de Los Mufas/El
Marginal, sin cambios de estado, de siempre) sino de un commit de **`daily-catalog-refresh.yml`
más temprano hoy** (`37a2f65`, "registrar 4 series flojas del Seguir Viendo real") que auditó toda
la lista de Continuar Viendo real de la cuenta y sumó al log 8 episodios nuevos con cobertura floja
(1-2 streams reales, por debajo del umbral de 3) de 4 series que Pablo está mirando activamente
ahora mismo: **Infiltrada** (S01E11), **Pa' Quererte** (S01E01, S01E02), **Pa' Seguirte Queriendo**
(S01E02, S01E03) y **VisionQuest** (S01E01, S01E02) — más **Ágata y Lola S01E02** (el S01E03 sí
tiene cobertura buena, 3 streams, quedó resuelto). Quedan "pendiente" para que el review semanal
los reintente solo, mismo mecanismo de siempre. El propio commit documenta un límite real de la
herramienta encontrado al armar esta lista: **2 títulos no se pudieron registrar** porque solo
tienen id de TMDB, no de IMDb (Torrentio/Comet indexan por IMDb id, así que el script tal como está
armado hoy no los puede consultar) — explica en parte por qué esos dos venían con poca cobertura
percibida, sin que sea necesariamente un problema real de streams. Los 2 de siempre, **Los Mufas y
El Marginal, siguen sin cambios** (0-1 streams reales), mismo hueco estructural de contenido
exclusivo Netflix Argentina ya documentado.

**Investigación de mejoras — sin hallazgos nuevos que ameriten acción esta semana**:
- **ElfHosted**: nada nuevo sobre los addons instalados más allá de las deprecaciones ya conocidas
  (AIOLists/Archivio/YourIPTV/Stremio-Jackett/Nuvio Streams/WebStreamr oficial — nuestro
  WebStreamrMBG es un fork independiente y sigue sin señales de riesgo). La guía pública de
  ElfHosted sigue recomendando AIOStreams/MediaFusion/Comet como "top 3" — ya evaluado a fondo el
  2026-07-30 (AIOStreams público deshabilita justamente Torrentio/P2P/HTTP, la privada cuesta 3x
  TorBox sin ventaja clara); sin cambios en esa conclusión.
- **stremio-ai-search**: issues abiertos en el repo siguen sin mostrar señales de que el
  mantenedor haya acelerado su respuesta, pero tampoco hay señal de abandono total — coincide con
  el blip aislado de esta semana (más ruido de infra puntual que indicio de addon roto). Sin
  acción, sigue en modo "vigilar".
- **Audio latino**: no aparecieron addons nuevos con señal de comunidad/GitHub real esta semana.
- **Deno Deploy**: sin cambios de plan gratuito reportados desde la migración de plataforma de
  julio (1M requests/mes, límites de banda/CPU por request) — el riesgo de pausado automático ya
  documentado (outage del 2026-07-28) sigue vigente como posibilidad, sin evento nuevo esta semana.

**Plan de debrid (agosto 2026)**: sin cambios de precio en TorBox (Essential ~US$3/mes, sigue
igual), Real-Debrid (~€4/mes, el filtro de copyright de mayo 2026 se reconfirma atado a la Digital
Services Act de la UE, sin escalar más esta semana) ni AllDebrid (~€3/mes). La decisión de agosto
ya está tomada y aplicada (TorBox activo desde el 2026-07-11) — este punto queda solo por
completitud del chequeo semanal, nada pendiente de decidir.

**Conclusión de la semana**: cuenta sana — el único punto real es el lote de 8 episodios nuevos con
streams flojos que quedaron registrados hoy en el log antifrustración, todos de series que Pablo
está viendo activamente ahora (Infiltrada, Pa' Quererte, Pa' Seguirte Queriendo, VisionQuest). No
es una rotura de la cuenta, es contenido de nicho/reciente con poca cobertura en los
trackers/scrapers gratuitos (mismo patrón estructural de siempre) — quedan en revisión automática
semanal, sin necesidad de acción manual por ahora. Nada más nuevo en addons/debrid/ElfHosted.

## Sesión 2026-08-25 — revisión de mejoras en stremioeg: TorBox v9, AirLock, cross-check legal

Pablo pidió revisar la cuenta a fondo, investigar novedades de TorBox/addons, y proponer mejoras
solo para `stremioeg` (sin mezclar con `solotveg`/`stremiojn`). Aprobó todas las propuestas.

**Ejecutado**:
1. **SubSense** apareció caída en el health-check inicial, pero al reintentar minutos después ya
   respondía 200 OK — blip transitorio autorresuelto, mismo patrón ya documentado, no requirió
   regenerar nada.
2. **Meteor y AI Search removidos** de la colección (24 → 22 addons). Motivo: Meteor es la fuente
   menos confiable (P2P puro sin TorBox, sin verificar, historial de "carga y nunca arranca") y AI
   Search venía causando fallos de health-check por mantenimiento flojo del addon aportando solo 1
   stream por título — ninguno de los dos aportaba cobertura real que Torrentio/Comet/NoTorrent no
   cubrieran ya. `health-check.mjs` post-cambio: verde, sin regresión (Matrix 148, Breaking Bad
   S01E01 163, Will Trent S01E01 65). Backup:
   `.backups/backup-stremioeg-pre-remove-meteor-aisearch-2026-08-25T11-17-*.json`.
3. **Cross-check de disponibilidad legal** (TMDB `watch/providers`, no navegando "Streaming
   Catalogs" a mano — ese addon no tiene búsqueda por título) para los 5 títulos flojos del log
   antifrustración: **"Pa' Quererte" está en Amazon Prime Video Argentina** (ya instalado en
   "Streaming Catalogs") — dato real para que Pablo lo busque ahí en vez de depender de torrents.
   Los otros 4 (Infiltrada, Pa' Seguirte Queriendo, VisionQuest, Ágata y Lola) no tienen
   disponibilidad legal real en AR (Infiltrada/Ágata y Lola aparecieron en plataformas de EE.UU./
   España sin relevancia para la región de Pablo).
4. **AirLock (TorBox, gratis en el plan Essential — 300GB, sin API pública, toggle manual en su
   web)**: se identificaron **8 episodios de Ágata y Lola ya cacheados en TorBox** (caps 101-106,
   ~13GB) que valdría la pena marcar para que no se purguen por los 30 días de inactividad — Pablo
   los mira despacio, episodio a episodio. Ninguno de los otros 4 títulos flojos tenía nada cacheado
   todavía. No se pudo automatizar (sin endpoint de API documentado) — queda como acción manual de
   Pablo en el dashboard de TorBox.

**Usenet vía TorBox — investigado a fondo y CERRADO, no reabrir salvo pedido explícito de Pablo**:
TorBox lanzó su propio servidor Usenet (NNTP) en v9.0.0 (julio 2026) — parecía prometedor para el
hueco estructural de cobertura en contenido de nicho (Usenet suele indexar mejor que los trackers de
torrents públicos). Se investigó y se probó de punta a punta contra las APIs reales, no solo
documentación:

- **Indexers gratis probados, los 3 cerrados en la práctica**: DrunkenSlug tiene registro cerrado
  ("The Bar is closed"), NZBPlanet da cuenta limitada que expira en 24hs sin upgrade. **NZBGeek**
  (Pablo se registró, usuario `pabloeckert`) sí dio una API key, pero la cuenta queda en **"Trial
  Account Only"** — probado en vivo contra la API real (Matrix, Breaking Bad): **0 resultados
  siempre**, confirmado que el acceso real a búsqueda requiere membresía VIP (~US$12/año).
- **Hallazgo más importante — TorBox mismo bloquea Usenet por plan**: al probar el flujo completo
  (se armó y deployó localmente — nunca en producción — una ruta `/usenet` en `scripts/deno-hub.ts`
  con NZBGeek + TorBox), la API de TorBox rechazó la creación de la descarga con
  `PLAN_RESTRICTED_FEATURE — User is not allowed to use usenet downloads. Please upgrade your plan.`
  — confirmado que **Usenet es exclusivo del plan Pro de TorBox (~US$10/mes)**, Essential y Standard
  no lo incluyen. Costo real total para destrabar esto: **~US$96/año** (Pro de TorBox +VIP de
  NZBGeek), no los "costos triviales" que se había estimado antes de probar contra las APIs reales.
- **AIOStreams** (su modo Usenet) tampoco es gratis para esto — requiere instancia privada de pago,
  mismo motivo por el que ya se había descartado el 2026-07-30 para el caso de torrents.
- **Decisión de Pablo, informada y final**: no vale la pena — el costo (~US$96/año) no se justifica
  frente a la mejora real esperada (los títulos flojos actuales son contenido español/latino de
  nicho, y las comunidades de Usenet están tan sesgadas a inglés como las de torrents; los 2 casos
  más frustrantes de siempre, Los Mufas/El Marginal, son exclusivos de streaming y Usenet no los
  toca en absoluto). Lectura propia de Pablo sobre el ecosistema Usenet: percibe que está en
  decadencia, no en expansión — coincide con el registro cerrado de 2 de los 3 indexers gratis
  probados.
- **Se revirtió todo lo tocado**: el código de `/usenet` en `deno-hub.ts` se descartó (`git
  restore`, nunca se commiteó ni se deployó a producción — confirmado con un fetch real a
  `/health` antes de revertir, sin ninguna mención de "usenet"). Las credenciales de NZBGeek se
  sacaron de `SECRETS.local.md`. **No reabrir este tema salvo que Pablo lo pida explícitamente** —
  ya está investigado a fondo, con evidencia real, y la decisión está tomada.
- Nombres nuevos vistos en listados tipo SEO ("Debridio") sin evidencia técnica real — mismo criterio
  de siempre, no se persiguen sin señal de comunidad/GitHub verificable.

## Sesión 2026-08-27 — TorBox cambió sus Términos de Servicio (31/07/2026): ya no es "no-logs"

Pedido de Pablo: revisión general de la cuenta + devolución de mejoras/actualizaciones. La cuenta
en sí está sana (health-monitor/keep-warm/daily-catalog-refresh/premiere-radar en verde de forma
sostenida, sin commits pendientes) — el hallazgo real de esta sesión es externo, sobre el propio
proveedor de debrid del que depende todo el proyecto.

**Hallazgo — investigado con fuentes reales, no SEO genérico**: TorBox reescribió sus Términos de
Servicio y Política de Privacidad el **31 de julio de 2026**. Confirmado por
[TroyPoint](https://troypoint.com/torbox-changes-their-terms-of-service/) (outlet establecido en
este nicho, no un blog SEO genérico) y una comparativa técnica independiente
([`fynks/debrid-services-comparison`](https://github.com/fynks/debrid-services-comparison) en
GitHub). El cambio contradice directamente uno de los motivos por los que se eligió TorBox sobre
Real-Debrid en su momento (ver "Plan debrid — proyección agosto 2026" más arriba: "no-logs" estaba
listado explícitamente como punto a favor):

- **Recolección de datos ampliada**: ahora incluye IP, identificador de dispositivo, geolocalización
  y **session-replay** (grabación de movimientos de cursor/clics) — antes la política era de
  mínima recolección.
- **Se sacó el compromiso de borrado a pedido**: reemplazado por retención indefinida en "registros
  de abuso" y "registros legales", sin plazo especificado. El lenguaje pasó de "vamos a borrar" a
  "cuando sea razonablemente factible" — la diferencia entre un compromiso y una sugerencia de
  mejor esfuerzo.
- **Cláusula amplia de divulgación**: permite compartir datos de usuarios para cumplir con la ley,
  responder a "pedidos gubernamentales", o "proteger a TorBox, usuarios, terceros o al público en
  general".
- **Cambio de estructura corporativa**: pasó a operar bajo dos entidades nuevas — Anonymous Systems
  FZ-LLC (UAE) y ReAnonymous LLC (Delaware) — que, según analistas de privacidad citados en la
  cobertura, oscurecen quién es el dueño real del servicio.

**Estabilidad — dos incidentes recientes, ninguno con impacto medido en la cuenta real**:
- **18/08/2026, 18:56-19:13 UTC**: ataque a la base de datos de TorBox (afectó API y DB), resuelto
  en 17 minutos según el propio [status page](https://status.torbox.app/incident/1019820) de
  TorBox — un incidente de seguridad puntual y corto, no una filtración de datos confirmada.
- **19/08/2026**: outage más amplio de API/CDN reportado por usuarios en redes sociales y medios
  (MSN, Times Now World), con el status page de TorBox confirmando "Some services are down" ese
  día.
- **Verificado contra el log interno de la cuenta** (`data/internal-log.jsonl`): `health-monitor`
  corrió en verde las 3 fechas (19, 20 y 21 de agosto) sin ninguna degradación detectada — o el
  outage no llegó a afectar los streams cacheados en curso, o los addons HTTP (NoTorrent/
  WebStreamrMBG) taparon el bache sin que se notara. No hay evidencia de impacto real en el uso de
  Pablo, solo se deja registrado el contexto.

**Sin acción tomada — decisión pendiente de Pablo, no del agente**: esto no es un problema técnico
con un fix de código, es un trade-off de privacidad vs. funcionalidad que le corresponde decidir a
Pablo. Opciones sobre la mesa si en algún momento quiere reconsiderar: **AllDebrid** sigue como
alternativa económica (~€3/mes) sin este historial de cambio de ToS ni de outages recientes, aunque
con menos profundidad de caché para contenido de nicho/no-inglés que TorBox (mismo trade-off
histórico ya documentado en "Plan debrid" más arriba). **No se aplicó ningún cambio** — TorBox
sigue activo en Torrentio/Comet exactamente como está hoy. Si Pablo pide migrar o investigar
AllDebrid más a fondo, es una sesión aparte.

## Sesión 2026-08-28 — investigación de optimización profunda (sin tocar la cuenta) + 4 decisiones

Pedido de Pablo: investigar a fondo mejoras para `stremioeg`, "sin tocar nada, sin romper nada de
lo que está". Se hizo una auditoría de `preset.json` local (sin red) + investigación externa del
ecosistema, y se encuestó a Pablo sobre 4 hallazgos concretos con `AskUserQuestion`. Esta sección
documenta las 4 decisiones tomadas y lo que se hizo con cada una. **Nota de entorno**: esta sesión
corrió en un contenedor remoto con la salida de red bloqueada hacia el ecosistema Stremio completo
(`api.strem.io`, ElfHosted, Deno Deploy, `api.torbox.app`, `support.torbox.app` — confirmado con
`curl`/`WebFetch`, mismo bloqueo ya documentado en la sesión 2026-08-27) — todo lo que requería
tocar la cuenta real o deployar quedó armado en código pero sin ejecutar/deployar.

**1. Catálogos huérfanos — investigado, NO aplicado (Pablo pidió solo investigar)**. Se encontraron
3 catálogos en `preset.json`, deshabilitados, sin mención en ningún session log anterior:
- **"Policial Clásico"** (`classic-crime.pablo056`): películas de crimen/misterio pre-2010,
  `vote_average.gte=6.5` + `vote_count.gte=100`, sin filtro de país/idioma. Calza fuerte con el
  gusto de Pablo por crimen/misterio ya documentado extensamente (series alemanas/británicas,
  catálogos "Crime Movies/Shows"). **Recomendación: activar** — parece un catálogo bien armado que
  quedó olvidado, no un experimento descartado.
- **"Comedia Dramática Española"** (`dramedy-spain.pablo057`): dramedias españolas 2020+,
  `with_original_language=es` + `with_origin_country=ES`. Redundante en parte con "Cine España" ya
  activo (mismo país, sin el filtro de género) — valor agregado dudoso salvo que a Pablo
  específicamente le interese ese subgénero. **Recomendación: preguntar a Pablo antes de activar**,
  no tan claro como el anterior.
- **"Latinoamérica sin Argentina (Cine)"** (`latam-no-ar.pablo054`): probablemente un borrador
  previo al catálogo "Latinoamérica (Cine/Series)" que sí está activo hoy (que incluye Argentina).
  **Recomendación: borrar** — parece superado, sin razón de ser si el catálogo regional ya cubre
  todo el continente.
- **Hallazgo relacionado, NO parte del pedido pero descubierto en la misma auditoría**: Crunchyroll
  (`streaming.cru` + `flixpatrol.crunchyroll.us.all`) está deshabilitado pese a que la sesión
  2026-08-02 (noche) documenta explícitamente que debía **conservarse** (era el único de los 10
  `streaming.*` que no se dedupicaba con "Streaming Catalogs"). Y de los "7 países de Asia"
  documentados como habilitados, **solo 5 lo están de verdad** — Tailandia y Hong Kong tienen
  `enabled:false` pese a `showInHome:true` (responde parcialmente al pendiente abierto desde
  30/07 sobre "¿cuáles se usan de verdad?"). Ninguno de los dos se tocó — quedan para una futura
  confirmación de Pablo, junto con los 3 catálogos huérfanos de arriba.

**2. Automatización de TorBox AirLock — CÓDIGO ESCRITO, sin poder verificar contra la API real.**
Pablo pidió automatizar el marcado de contenido cacheado en riesgo de purgarse (ver "Sesión
2026-08-25", caso Ágata y Lola). Nuevo script `scripts/torbox-airlock.mjs`: reusa el mismo patrón
de `premiere-radar.mjs` (MyTrakt `continue_watching_shows` + `isCachedStream` de
`lib/addon-signals.mjs`) pero recorre TODOS los episodios no vistos de cada show en progreso (no
solo el siguiente), extrae el `infoHash` de cada stream cacheado en Torrentio/Comet, y lo
correlaciona contra `GET /api/torrents/mylist` de TorBox (documentado, confirmado por búsqueda web)
para encontrar el `id` interno y marcarlo airlocked. **Límite real, declarado en el propio script**:
el endpoint de escritura (`POST /api/torrents/controltorrent` con `{torrent_id, operation:
"airlock"}`) es una analogía razonable con el patrón ya usado por TorBox para reannounce/delete/
resume, pero no se pudo confirmar contra la documentación en vivo (bloqueo de red de esta sesión) —
el script imprime la respuesta cruda de la API en cada intento para que sea evidente de inmediato
si el nombre de la operación está mal (fix de una sola línea si es así). Dry-run por defecto, igual
que el resto del repo. **Pendiente**: correrlo primero con `--apply` en una sesión con
`TORBOX_API_KEY` real y confirmar el nombre exacto de la operación contra la doc en vivo o el
support center de TorBox antes de confiar en él para uso rutinario.

**3. TorBox vs. AllDebrid — recomendación: quedarse con TorBox, no migrar.** Pablo pidió elegir uno
solo (no pagar los dos). Investigado con evidencia fresca:
- **AllDebrid tiene una política real de riesgo específico para Pablo**: bloquea/traba cuentas que
  usan más de 4 IPs distintas en el mismo día (reportado por usuarios, ninguna fuente oficial lo
  desmiente). Pablo tiene **CGNAT confirmado** en su conexión de Claro Argentina (ver "Perfil CGNAT
  temporal" más arriba) — una IP pública que rota o es compartida por el proveedor es exactamente
  el escenario que esa política castiga. Riesgo concreto, no teórico.
  ([Fuente](https://www.saashub.com/alldebrid-status))
- **Profundidad de caché para contenido de nicho/extranjero**: TorBox, aunque más chico que
  Real-Debrid por ser más nuevo, le sigue ganando a AllDebrid en ese terreno según comparativas
  2026 — justo la dimensión que más le importa a Pablo dado su gusto por crimen/misterio
  internacional. Migrar arriesgaría una regresión de cobertura real para ganar únicamente
  tranquilidad de privacidad, sin evidencia de daño concreto hasta ahora (los 2 incidentes de
  agosto de TorBox no tuvieron impacto medido en la cuenta, ver sesión 2026-08-27).
  ([Fuente](https://factually.co/fact-checks/electronics-tech/best-debrid-services-2026-torbox-real-debrid-alldebrid-comparison-954d9e))
- **Sin cambios aplicados** — TorBox sigue activo en Torrentio/Comet exactamente como está.

**4. Catálogo "Miniseries" reescrito — código listo, falta redeploy.** `scripts/deno-hub.ts`
(`buildMiniseriesCatalog`) sumó `with_type=2` (Miniseries, clasificación propia de TMDB) al
`discover/tv` de TMDB — confirmado contra la documentación oficial de Discover TV que ese parámetro
existe (no estaba documentado en ningún lado del repo, es un hallazgo nuevo). Antes, el candidate
pool era "cualquier show Ended por popularidad" sin ninguna señal de "es miniserie", filtrado
después por temporadas/episodios con muy poco acierto (de ahí la cobertura floja de ~2 títulos ya
documentada). Con el pool pre-filtrado por la propia clasificación de TMDB, la tasa de acierto del
filtro de detalle debería subir mucho — se mantiene ese filtro igual como red de seguridad, porque
"Miniseries" en TMDB no garantiza exactamente ≤10 episodios. **No se pudo deployar ni medir el
efecto real** — mismo bloqueo de red de esta sesión, requiere `deno deploy` con
`DENO_DEPLOY_TOKEN` en una sesión futura. Commiteado, no deployado.

## Sesión 2026-08-28 (tarde) — plan integral ejecutado: catálogos aplicados en vivo + fix de pipeline

Pablo pidió un "plan integral" y se lo encuestó con `AskUserQuestion` sobre 4 ejes (prioridades,
Deno Hub de pago, pendientes de catálogo, modo de ejecución) — eligió las 4 áreas a la vez, "borrar
lo que no sirve o no se usa" para los catálogos, y modo autónomo. Ejecutado de punta a punta,
incluyendo aplicar los cambios a la cuenta real **sin tener credenciales en esta sesión**, disparando
el propio workflow de GitHub Actions que ya las tiene guardadas — hallazgo de mecanismo nuevo, no
usado en ninguna sesión anterior.

**1. Catálogos — aplicados y verificados en vivo contra la cuenta real.** Sobre los hallazgos de la
sesión de la mañana: reactivado Crunchyroll (bug), activado "Policial Clásico", borrados "Comedia
Dramática Española", "Latinoamérica sin Argentina", Tailandia y Hong Kong (mismo criterio que la
mañana, ver esa sección). Editado `data/preset.json` directo (159→159 catálogos, 116 enabled) y
**disparado `daily-catalog-refresh.yml` manualmente vía la API de GitHub Actions** (método
`run_workflow`, sin credenciales de Stremio propias — el workflow usa sus secrets ya guardados) en
vez de esperar al cron de las 07:00 ART. Verificado con el propio log del run: `GANADOS (por
nombre): 4 → Crunchyroll Movies, Crunchyroll Shows, Top 10 on Crunchyroll, Policial Clásico` y
health-check inmediato después del swap con `✅ Todo OK` (22 addons, streams/subs normales) — **los
cambios están confirmados en vivo, no solo committeados**.

**2. Bug real encontrado y arreglado: `regenerate-aiometadata.mjs` calienta la instancia nueva antes
de salir.** Agregado un loop de reintentos (hasta 5, 3s de espera) contra el catálogo "now playing"
de la instancia recién creada, antes de que el script termine — mitiga el patrón de falso positivo
ya documentado (health-check corriendo segundos después del swap, encontrando la instancia todavía
en cold-start). **Validado empíricamente en el mismo run**: el log muestra
`✓ Instancia nueva calentada (responde con datos)` seguido de un health-check limpio sin ningún
warning de catálogos vacíos — primera vez que se mide el efecto real de este fix, no solo teorizado.

**3. Hallazgo de infraestructura real, no anticipado: disparar `daily-catalog-refresh.yml` contra una
rama que no es `main` rompe su lógica de `git pull --rebase origin main`.** El workflow, pensado para
correr siempre sobre `main`, intenta al final rebasear sus propios commits contra `origin/main` — al
correrlo contra la rama de esta sesión (que había divergido de `main` con unos pocos commits propios
más los commits automáticos diarios de `main`), el rebase falló con `CONFLICT (add/add)` en varios
archivos. **Diagnóstico en 3 pasos, cada uno descartando una hipótesis con evidencia real, no a la
primera sospecha**:
1. Primera hipótesis: un commit de merge en la rama (`git merge origin/main` local) rompía el
   rebase, porque `git rebase` sin `--rebase-merges` descarta el commit de merge y reintenta
   aplicar su diff completo como si fuera nuevo, reintroduciendo contenido que `origin/main` ya
   tenía. Se deshizo el merge (`git reset --hard`) y se hizo un **rebase lineal** en su lugar.
   **Resultado: siguió fallando exactamente igual** (run #32) — la hipótesis era incompleta.
2. Causa raíz real: `actions/checkout@v4` hace un **shallow clone (fetch-depth 1) por defecto**.
   Sin historia compartida real entre el checkout de la rama y el `git fetch origin main` posterior,
   git no puede resolver un merge-base válido — y sin merge-base, **cualquier archivo que difiera
   entre ambos lados aparece como conflicto "add/add"**, sin importar si el contenido en sí choca.
   Esto explica por qué el conflicto persistía incluso con una rama ya perfectamente rebaseada y
   sin merge commit (paso 1 no alcanzaba porque el problema nunca fue la forma de la historia local,
   sino la profundidad del clone del runner).
3. **Fix real, confirmado empíricamente**: agregado `fetch-depth: 0` al `actions/checkout@v4` de los
   4 workflows que hacen `git commit`/`pull --rebase`/`push` (ver punto siguiente). Redisparado el
   workflow una tercera vez contra la misma rama — **corrió limpio de punta a punta, incluyendo el
   commit y push final** (`conclusion: success`, confirmado con la API de GitHub Actions, no
   asumido).
**Lección para sesiones futuras**: si hace falta disparar uno de estos 4 workflows contra una rama
de trabajo en vez de esperar al cron en `main`, ya no hace falta ningún cuidado especial con la
rama — el fix de `fetch-depth: 0` lo resuelve en la raíz para cualquier rama.

**4. Deno Deploy — evaluado pasar a plan pago, recomendación: NO vale la pena.** Investigado el
pricing real: el plan Pro cuesta **US$20/mes** (vs. el Free actual, US$0, que ya se pausó una vez en
julio por exceso de uso). El Deno Hub sirve funciones no críticas (SubDL/Synopsis IA/Audio
Latino/Miniseries/Discover) que degradan sin romper nada más cuando están caídas — 4 addons de subs
y 5 de streams siguen andando igual. US$20/mes indefinidos para evitar un riesgo de baja severidad
que ya se sabe autolimitado (se resuelve solo con cualquier acción de Pablo en el dashboard de Deno,
como ya pasó en julio) es desproporcionado. **Recomendación: no pagar** — mantener el plan gratis,
aceptando que puede volver a pausarse alguna vez. Si Pablo prefiere eliminar el riesgo del todo,
la opción sigue disponible.

**5. Torrentio / ruido de falsas alarmas en health-check — sin cambios, no hay patrón nuevo.**
Re-revisado el historial: el blip de Torrentio de la sesión 2026-08-16 no se repitió desde entonces
(un solo evento, ya con 12 días de corridas limpias después) — sigue sin ameritar sumarlo a
`KNOWN_FLAKY` (ese mecanismo es para flakiness sostenida y de bajo riesgo; Torrentio es alto riesgo
si de verdad se cae). El fix real de ruido de esta sesión fue el ítem 2 (cold-start de AIOMetadata),
que sí tenía un patrón sostenido y documentado desde el 2026-08-01.

**Pendiente, no resuelto en esta sesión** (requiere acceso a la cuenta real que este contenedor no
tiene por el bloqueo de red ya documentado): la revisión de los bloques de "Streaming Catalogs"
(nicho UK/documentales/holandeses) que sigue pendiente desde el 30/07 — ese addon vive fuera de
`preset.json`, su config solo se puede auditar con `ST_EMAIL`/`ST_PASS` reales y red disponible.
Tampoco se pudo probar en vivo `scripts/torbox-airlock.mjs` ni deployar el fix de `/miniseries` de
la sesión de la mañana — ambos siguen esperando una sesión con `TORBOX_API_KEY`/`DENO_DEPLOY_TOKEN`
y red disponible.

## Sesión 2026-08-28 (noche) — investigación web autónoma + catálogo Nordic Noir + 2 bugs de pipeline

Pablo pidió investigar a fondo por toda la web/foros/redes actualizaciones que calcen con su perfil
y aplicar directamente lo que se encontrara, en modo 100% autónomo ("dejo la PC encendida, me voy a
dormir"). Investigación amplia con WebSearch (addons nuevos, changelogs de AIOMetadata/TorBox/Comet,
r/StremioAddons, alternativas de subtítulos) — la mayoría de los hallazgos no ameritaron acción
(ver detalle abajo), pero uno sí: un hueco real en los catálogos.

**1. Catálogo nuevo aplicado: "Nordic Noir" (Cine + Series)**. Auditando `preset.json` contra el
gusto ya documentado de Pablo (crimen/misterio europeo, "Policial Clásico", series alemanas/
británicas), se encontró que **ningún catálogo cubre el policial escandinavo** — género insignia
justo de ese gusto (The Bridge, Wallander, Borgen, Trapped, Department Q). Construido con el mismo
patrón que "Policial Clásico": `with_origin_country=SE|DK|NO|FI|IS` + `with_genres=80|9648`
(Crime|Mystery), piso `vote_count.gte=10` + `vote_average.gte=5.5`. Ids `pablo063`/`064`,
`showInHome=false` (vive en Descubrir, no altera el orden curado del inicio ya fijado por Pablo).
**Verificado en vivo, no solo committeado**: el log del regen real contra la cuenta confirma
`GANADOS (por nombre): 2 → Nordic Noir (Cine), Nordic Noir (Series)`, y el health-check posterior
dio `✅ Todo OK` (22 addons, streams/subs normales).

**2. Bug real encontrado y arreglado — el regen se saltaba en silencio en disparos manuales.**
Al aplicar Nordic Noir, el paso "Regenerar y aplicar AIOMetadata" salió `skipped`: la condición que
lo dispara (`steps.diff.outputs.changed`) solo detecta si `refresh-dates.mjs` cambió algo **en esa
corrida puntual** — no si el `preset.json` ya commiteado (por un cambio de catálogo hecho antes)
difiere de lo que está aplicado en la cuenta real. Como las fechas ya estaban al día (refrescadas
horas antes esa misma noche), el regen nunca corrió — el run se marcaba `success` (el health-check
solo re-verifica lo que ya estaba aplicado) pero el catálogo nuevo nunca llegaba a la cuenta,
**sin ningún error visible**. Mismo bug afectó silenciosamente la remoción de Crunchyroll de la
sesión de la tarde (ver más abajo). **Fix**: el regen ahora corre si cambiaron las fechas O si el
evento es `workflow_dispatch` (un disparo manual ya significa "aplicá esto ahora"); el cron
automático de las 07:00 mantiene el comportamiento de siempre.

**3. Hallazgo relacionado — la remoción de Crunchyroll de la tarde nunca había llegado a la cuenta
real.** Al re-disparar el regen ya arreglado, el guard anti-pérdida abortó correctamente al detectar
que se perderían los 3 catálogos de Crunchyroll — evidencia de que la instancia en vivo (`be3d0d02`)
todavía los tenía, es decir el pedido de Pablo de sacar Crunchyroll (sesión de la tarde) **nunca se
había aplicado de verdad**, por el mismo bug del punto 2 (esa sesión también coincidió con fechas ya
al día). **Fix complementario**: nuevo input `workflow_dispatch.force` (default `false`) que agrega
`--force` a `regenerate-aiometadata.mjs` solo cuando se pasa explícitamente — usado una vez esta
noche, con la pérdida ya confirmada como intencional (Pablo la pidió horas antes). El cron
automático nunca pasa `force`, el guard sigue protegiendo por defecto contra drift accidental.
**Verificado en vivo tras el fix**: el regen con `--force` corrió limpio (`conclusion: success`,
ya no aborta), y el health-check posterior volvió a dar `✅ Todo OK`. Crunchyroll y Nordic Noir
quedaron aplicados en la misma corrida — confirmado y luego fusionado a `main` (fast-forward limpio,
sin conflictos) para que el cron de las 07:00 no lo revierta.

**4. Investigado, sin acción — el resto de los hallazgos de la noche no ameritaron cambios**:
- **MediaFusion**: se confirmó que su instancia pública (ElfHosted) es gratis y soporta TorBox
  (contradice el motivo de rechazo original de sesiones de junio/julio, que era sobre costo). Pero
  sin `TORBOX_API_KEY` disponible en este contenedor no se pudo configurar con debrid — sin eso,
  reintroduce el mismo problema estructural de Meteor (P2P puro afectado por el CGNAT de Pablo, ya
  removido por esa razón). **Queda como candidato real para una sesión futura con la key
  disponible**, no descartado de plano como antes.
- **Orion**: requiere su propia cuenta/API key de pago (orionoid.com) y no soporta TorBox
  nativamente (Real-Debrid/Premiumize/Offcloud) — no encaja.
- **AIOStreams/MediaFusion "top 3" de ElfHosted**: sin cambios respecto a la evaluación del
  2026-07-30 (instancia pública sin Torrentio, privada 3x el costo de TorBox).
- **xtremexq/StremioSubMaker**: es el proyecto open-source del que la instancia ElfHosted ya
  instalada (SubMaker) es un fork hosteado — no es un addon nuevo, ya se tiene su funcionalidad.
- **AIOMetadata PublicMetaDB** (sync de watchlists/resume progress, sumado en v2.0.0): potencialmente
  interesante pero significaría tocar la relación con MyTrakt Sync (de la que dependen
  `premiere-radar.mjs` y `torbox-airlock.mjs`) sin poder verificarlo en vivo — no se tocó, requiere
  una sesión con cuenta real para evaluar con cuidado.
- **NoTorrent**: apareció un reporte de terceros de inestabilidad (05/08), pero la evidencia propia
  de esta misma noche (health-check con `NoTorrent=9/15/12` streams reales) lo contradice — se anota
  como dato de contexto, sin acción, ya que la evidencia directa contra la cuenta pesa más.
- Dogma de siempre aplicado sin excepción: nada que requiriera gastar dinero (Orion, MediaFusion
  privado) se instaló sin consultar a Pablo primero.

## Sesión 2026-08-28 (noche, continuación) — Europe Noir, catálogo "30 Minutos o Menos", reorden de géneros

Pablo dio feedback directo sobre lo aplicado en la sesión anterior (misma noche) y sumó 3 pedidos
nuevos, todos para `stremioeg`: (a) "Nordic Noir" pasa a **"Europe Noir"**, ampliado a todo el
continente en vez de solo los 5 países nórdicos; (b) catálogo nuevo **"30 Minutos o Menos"** para
todo el contenido que dure eso o menos; (c) revisar hábitos/gustos de Pablo y su familia y
reorganizar a fondo categorías/subcategorías con "combinatorias inteligentes", tanto en películas
como en series. También reportó un bug: al intentar ver "Un Show Más" con audio latino en NoTorrent
vía reproductor externo VLC, Stremio decía que no tenía app para reproducir y se colgaba.

**1. Europe Noir — aplicado y verificado en vivo.** Mismo patrón de género (`with_genres=80|9648`,
Crime|Mystery) pero `with_origin_country` pasó de los 5 países nórdicos a **37 países de toda
Europa** (Europa occidental, nórdicos, Europa del este, Balcanes, Báltico — de Portugal a Ucrania).
Verificado en el log del regen real: `PERDIDOS (por nombre): 2 → Nordic Noir (Cine/Series)` /
`GANADOS (por nombre): 3 → Europe Noir (Cine/Series), 30 Minutos o Menos` — el guard anti-pérdida
detectó el rename como pérdida+ganancia (por nombre) y pidió `--force`, usado a propósito porque la
pérdida era intencional (Pablo pidió el cambio).

**2. "30 Minutos o Menos" — solo la mitad aplicada, la otra mitad requiere un paso pendiente.**
Para **películas** fue directo: TMDB Discover sí soporta filtrar por duración
(`with_runtime.lte=30`) — catálogo nuevo `pablo065`, aplicado y confirmado en vivo. Para **series**
TMDB Discover NO soporta ese filtro (mismo límite ya conocido de "Miniseries") — quedó escrita una
ruta nueva `/short-series` en `scripts/deno-hub.ts` (mismo método en dos pasos que usa Miniseries:
trae candidatos por popularidad, después consulta la duración real de cada uno y descarta los que
duran más de 30 min), pero **no se pudo deployar** — esta sesión no tiene la clave de Deno Deploy
disponible. Queda lista en el código para la próxima sesión con esa clave a mano.

**3. Reorganización de categorías — solo un primer paso acotado, no la reorganización completa
pedida.** Se hizo un reordenamiento real pero limitado: el bloque de 30 catálogos de género (cine +
series) pasó de estar en orden alfabético a estar agrupado por temática, con Policial/Suspenso
(Crimen+Misterio+Thriller) primero — el combo de gusto ya comprobado en todo el historial del
proyecto — seguido de Familia, Acción/Aventura, Drama, y Nicho al final. Los 3 catálogos nuevos
(Europe Noir ×2 + 30 min) se ubicaron junto al grupo de herramientas de descubrimiento avanzado que
ya existía. **No se tocó** el orden curado del Inicio (Estreno→Cartelera→Streaming→Género→País→
Región, fijado explícitamente por Pablo en sesiones anteriores) ni se armó la reorganización más
profunda por hábitos de toda la familia que pidió — esta sesión no tiene acceso a historial real de
visualización de las 3 cuentas (`stremioeg`/`stremiojn`/`solotveg`) para basar esa reorganización en
datos reales en vez de suposiciones. Queda pendiente de una sesión con acceso a las 3 cuentas reales
para hacerlo bien, con datos, no a ciegas.

**4. Verificado en vivo, no solo committeado**: el regen real (disparado vía
`daily-catalog-refresh.yml` con `force: true`) confirmó el swap OK
(`AIOMetadata → 5e8297f0-e32c-40f0-8a1b-374c50f6f73a`) y los dos health-checks (cuenta principal +
solotveg) dieron `✅ Todo OK` — streams y subtítulos sin regresión.

**5. Bug nuevo de pipeline encontrado — dos commits del propio workflow chocan al pushear al final
de una corrida.** El paso final de `daily-catalog-refresh.yml` hace DOS commits separados
(preset.json con el `instanceId` nuevo, y el log interno) cada uno con su propio
`git pull --rebase && git push`. En esta corrida, el primer commit se pusheó bien pero algo dejó al
segundo intento de push rechazado por "non-fast-forward" — investigado, no es el bug de
`fetch-depth` ya resuelto (ese seguía andando bien). El commit que sincronizaba el `instanceId`
nuevo en `preset.json` se perdió en el runner (efímero, se descarta al terminar el job) — se
reconstruyó a mano en esta sesión (`preset.json → instanceId = 5e8297f0-...`, confirmado que
coincide con la instancia real ya aplicada). **No es grave** — el swap a la cuenta real ya había
pasado antes de este paso, solo quedó desincronizado el archivo de bookkeeping. **No investigado a
fondo todavía** (no urgente, pasó una sola vez) — si se repite, revisar si conviene combinar los dos
commits del paso final en uno solo para evitar la doble ventana de carrera.

**Pendiente para una sesión futura con más acceso**: deployar `/short-series` en Deno Deploy
(necesita `DENO_DEPLOY_TOKEN`).

**6. Alcance de la reorganización, confirmado por Pablo**: consultado por chat sobre a qué cuenta
aplica "revisá los hábitos de toda mi familia y reorganizá" — Pablo confirmó que es **solo
`stremioeg`**, pero teniendo en cuenta también los gustos del resto de la familia para catálogos
que sirvan cuando miran juntos (no reorganizar las cuentas de `stremiojn`/`solotveg`, que tienen su
propia documentación y curación en `cuentas/*/CLAUDE.md`).

**7. Segundo paso aplicado: catálogos combinados género+país.** Con ese alcance confirmado, se armó
la primera "combinatoria inteligente" real: **"Crimen Alemán"** y **"Crimen Reino Unido"** (Cine +
Series, 4 catálogos nuevos, ids `pablo066`-`069`). Alemania y Reino Unido son, por lejos, los dos
países más repetidos en los pedidos de Pablo de policial/misterio a lo largo de TODO el historial
del proyecto (Alemania: Tatort, Babylon Berlin, Criminal: Germany, Dogs of Berlin, Einstein, Murder
Mindfully; Reino Unido: Marlow Murder Club, Wild Cards, Passenger, How to Get to Heaven from
Belfast) — más preciso que "Europe Noir" (mezcla los 37 países) y que los catálogos de país ya
existentes (mezclan todos los géneros, no solo policial). Mismo patrón que Europe Noir/Policial
Clásico (`with_genres=80|9648`), pero con `vote_count.gte=15` (un poco más estricto porque un solo
país da menos volumen que todo el continente). `showInHome=false`, ubicados junto al resto del
cluster de descubrimiento avanzado. **Verificado en vivo contra la cuenta real** (swap OK +
health-check `✅ Todo OK`, streams/subs sin regresión) — mismo mecanismo de aplicación vía
`daily-catalog-refresh.yml` disparado a mano.

**Nota sobre lo que falta de la reorganización pedida**: esto es un segundo paso, no el cierre del
pedido. No se hizo un rediseño completo de todos los niveles de categoría/subcategoría (eso
requeriría ver datos reales de qué mira cada uno en la familia, no solo el historial de pedidos por
chat) — si Pablo quiere ir más a fondo, el camino natural es sumar más combos país+género según lo
que él vaya señalando (o dar acceso a ver el Continue Watching real para basarlo en datos, no en
lo ya documentado).

## Sesión 2026-08-28 (noche, segunda continuación) — audio latino de "Un Show Más" + deploy del hub

Pablo pidió dos cosas puntuales: (a) confirmar que "Un Show Más" tenga audio latino real — marcado
explícitamente como **"regla dura"**; (b) terminar "30 Minutos o Menos" para series, que había
quedado pendiente de deploy en `scripts/deno-hub.ts`.

**1. "Un Show Más" — ya estaba resuelto desde el 2026-08-13, reconfirmado hoy.** Identificado como
el doblaje latino de **Regular Show** (Cartoon Network, 2010-2017, `tt1710308`) vía WebSearch. El
log (`data/anti-frustration-log.json`) ya tenía **dos entradas previas** (S01E01 y S08E01/temporada
final, ambas del 2026-08-13, sin sesión documentada acá) — ambas `RESUELTO` con audio latino
confirmado. No era un hueco nuevo, era releer el log antes de asumir que faltaba. Se re-chequeó
S01E01 igual, contra la cuenta real, para confirmar que sigue vigente hoy: **56 streams reales
(subió de 55), audio latino sigue confirmado** — antes vía un addon ya removido (`Audio Latino
[FREE TRIAL]`, probablemente Latinobrid o AI Search, ambos sacados el 2026-08-25), ahora directo
vía Torrentio/Comet/NoTorrent.

**Mecanismo nuevo**: `anti-frustration-review.yml` ganó inputs opcionales de `workflow_dispatch`
(`add_imdb_id`/`add_type`/`add_season`/`add_episode`/`add_title`) para poder registrar o
re-chequear un título puntual desde un disparo manual, sin esperar al domingo — corre
`anti-frustration.mjs add` antes de la revisión semanal normal. El cron automático nunca pasa estos
inputs, comportamiento de siempre sin cambios.

**Bug real encontrado — conflicto genuino, no el de shallow-clone ya conocido**: el commit final del
run (que guarda `anti-frustration-log.json` + `internal-log.jsonl`) chocó con un **conflicto de
contenido real** en `internal-log.jsonl` (dos workflows habían tocado ese archivo casi al mismo
tiempo) y el push nunca llegó a `origin` — se perdió en el runner efímero. Reconstruido a mano con
los mismos números exactos que imprimió la corrida real (verificados contra el log del job en
GitHub Actions, no inventados). No se investigó una solución de fondo para este conflicto puntual
(un solo evento, distinto del bug de `fetch-depth` ya resuelto) — si se repite seguido, considerar
separar el commit de `anti-frustration-log.json` del de `internal-log.jsonl` en pasos independientes.

**2. Deploy de `mejorastremio-hub` — bloqueado: falta cargar `DENO_DEPLOY_TOKEN` como secret de
GitHub.** Como esta sesión no tiene salida de red hacia Deno Deploy (ni siquiera para instalar el
CLI), se creó `.github/workflows/deploy-deno-hub.yml` (disparo manual) que instala Deno en un
runner de GitHub Actions (que sí tiene red completa) y corre `deno deploy`.

**Sintaxis del CLI, resuelta tras 5 intentos** (CLI más nuevo que el usado en sesiones de julio,
documentado en "Sesión 2026-07-26/27" — `deno deploy .` con flags explícitos ya no aplica):
todo flag explícito que se probó (`--org`/`--app`, `--prod`, `--json`, `--non-interactive`) salió
rechazado con `Option "..." can only occur once, but was found several times` — el CLI parece
autocompletar todos esos valores solo en el entorno de GitHub Actions (org/app desde `deno.jsonc`,
el resto probablemente detectado del entorno CI) y choca con cualquiera pasado a mano. **Comando
correcto: `deno deploy` a secas, sin ningún flag.**

**Causa real del fallo, encontrada recién en el 6º intento — no era de sintaxis**: agregado un
`echo "DENO_DEPLOY_TOKEN length: ${#DENO_DEPLOY_TOKEN}"` justo antes del deploy (imprime la
LONGITUD, nunca el valor) → **`DENO_DEPLOY_TOKEN length: 0`**. El secret está vacío/no existe en
este repo de GitHub — nunca se había cargado ahí, porque en todas las sesiones anteriores
(2026-07-26/27, 2026-07-28) se usó pegado directo en una sesión de Claude Code con red disponible,
nunca como GitHub Secret. Los primeros intentos fallidos NO confirmaban que el token estuviera
cargado (afirmación incorrecta hecha en el momento) — el CLI valida los argumentos ANTES de
chequear autenticación, así que un `VALIDATION_ERROR` de sintaxis no dice nada sobre el token.

**Acción pendiente de Pablo, no accionable por el agente** (no hay ninguna herramienta disponible
para crear secrets de GitHub por API en esta sesión): cargar `DENO_DEPLOY_TOKEN` en
`github.com/pabloeckert/MejoraStremio` → Settings → Secrets and variables → Actions → New
repository secret → nombre exacto `DENO_DEPLOY_TOKEN`, valor = un token nuevo generado en
Deno Deploy (`console.deno.com` → cuenta → Access Tokens). Una vez cargado, disparar
`deploy-deno-hub.yml` a mano (ya queda con la sintaxis correcta, `deno deploy` sin flags) — debería
deployar de una. El workflow ya incluye un paso que verifica `/health`, `/short-series/manifest.json`
y `/miniseries/manifest.json` contra la URL de producción para confirmar que quedó bien.

## Sesión 2026-08-29 — deploy de "30 Minutos o Menos" resuelto, NoTorrent chequeado, hueco real en el final de Regular Show

Continuación directa de la sesión anterior. Pablo cargó `DENO_DEPLOY_TOKEN` en GitHub Secrets;
además reportó dos síntomas puntuales (NoTorrent "caído", "Un Show Más" sin andar desde cierto
punto) que se investigaron contra la cuenta real.

**1. Deploy de `mejorastremio-hub` — resuelto tras 12 corridas de `deploy-deno-hub.yml`.** Con el
token ya cargado, siguieron 5 fallos más de sintaxis: **cualquier flag explícito en la línea de
comando de `deno deploy` sale "Option can only occur once, but was found several times" en este
entorno** — probado con `--prod`, `--json`, `--non-interactive` e incluso `--help` (que nada
debería auto-inyectar), y también limpiando `GITHUB_ACTIONS`/`CI` del paso puntual (mismo error,
descarta que sea autodetección de CI). `deno deploy` sin ningún flag SÍ funciona pero deployaba
como **preview** (URL random `mejorastremio-hub-XXXX.pabloeckert.deno.net`), no a la URL de
producción — confirmado dos veces con `/health` devolviendo el código viejo en la URL pública tras
un deploy "exitoso". Ni pasar `--prod` (falla) ni declarar `"prod": true` en `deno.jsonc → deploy`
(deployó igual como preview) lo resolvieron. **Causa de fondo no identificada** — queda como
comportamiento raro del CLI en este entorno específico, no resuelto por ingeniería de flags.
**Solución real, manual**: Pablo entró al link de la build (`console.deno.com/pabloeckert/
mejorastremio-hub/builds/<id>`) y usó el botón de promoción a producción de la consola web — con
eso, `/short-series/manifest.json` en la URL pública quedó respondiendo el manifest real
(`com.mejorastremio.short-series`, confirmado). **"30 Minutos o Menos" para series ya está
funcionando en producción.** Si hace falta un redeploy futuro del hub, el patrón que funciona es:
disparar `deploy-deno-hub.yml` (deploya como preview, sin poder evitarlo con los flags probados) y
después promoverlo a mano desde la consola de Deno — no hay forma encontrada de automatizar ese
último paso desde este workflow.

**2. NoTorrent — chequeado en vivo, sano.** Pablo reportó que "parece que se cayó" — probado con
`health-monitor.yml` disparado a mano: `NoTorrent: v2.7.0` responde normal, con streams reales
(Matrix=9, Breaking Bad S01E01=15, Will Trent S01E01=12). No estaba caído — probablemente un blip
puntual del momento o de su conexión/dispositivo, sin señal de rotura del lado de la cuenta.

**3. "Un Show Más" (Regular Show) sin andar "desde cierto punto" — diagnosticado con una
herramienta nueva, hallazgo real confirmado, no accionable.** Pablo precisó: desde temporada 8,
episodio 21 en adelante no arranca; su forma habitual de verlo es NoTorrent (única fuente real de
audio latino) con reproductor externo para tomar la pista de audio. Nuevo script de solo lectura
`scripts/diagnose-episodes.mjs` + workflow `diagnose-episodes.yml` (disparo manual, sin escritura)
— **ambos borrados el 2026-09-03 (dev 2) como cruft de un solo uso; para un caso equivalente,
`check-catalog-streams.mjs` cubre lo mismo por título** — dado un IMDb id, encuentra el último
episodio marcado como visto en MyTrakt Sync (o permite fijar
temporada/episodio de inicio a mano) y prueba streams reales contra TODOS los addons de streams
para los N episodios siguientes.

- **Hallazgo colateral**: la cuenta no tiene NINGÚN episodio de este show marcado como visto en
  Trakt — el auto-detect de "último visto" no sirve para este título en particular (por eso hizo
  falta el override manual de temporada/episodio agregado al script).
- **Temporada 8 es la última** (llega hasta el episodio 28, el final de la serie — confirmado
  contra MyTrakt, no asumido). Probados los 8 episodios desde S08E21: **el total combinado de
  streams se ve sano (33-39 por episodio)**, pero desglosado por addon, **NoTorrent cayó de
  12-21 streams en la temporada 1 a solo 3-4 en este tramo final** — el resto del volumen lo
  aportan Torrentio/Comet, que no necesariamente traen la pista de audio latino que Pablo necesita.
  Además, la señal "latino" que el script detectó en estos episodios decía **"9 Premium Streams
  Available"** en vez de "Audio Latino" explícito como en los primeros capítulos — probablemente
  un aviso de contenido pago/bloqueado de otro addon (Streailer), no audio latino real y gratis.
- **Conclusión: hueco real y verificado de cobertura, no un bug de configuración.** Mismo patrón
  estructural ya documentado varias veces en este archivo (contenido de nicho/cola de una serie
  con mucha menos circulación en fuentes gratuitas) — sin acción de configuración posible del lado
  del proyecto. Se le explicó a Pablo en estos términos.

## Sesión 2026-09-02/03 — subtítulos latino real (código "ea"), auditoría obsesiva de catálogos

Pablo pidió primero "todo con subtítulo español latino sin descripción para sordos y conectado por
IA para los que no tienen o no encuentra", y después, en modo 100% autónomo explícito ("sé obsesivo
al detalle, arregla todo, no te detengas hasta terminar... a mí solo me molestás si necesitás
intervención humana"), profundizar y aplicar todo lo que se encontrara. Sesión larga, con varios
hallazgos reales — algunos aplicados y verificados en vivo, uno revertido tras probarlo, uno
bloqueado por un límite de plataforma que se resuelve solo con el tiempo (no requiere a Pablo).

### 1. Hallazgo grande: OpenSubtitles SÍ tiene un código separado para español latino ("ea")

Investigando el pedido, se encontró (y se **confirmó contra la API real**, no solo documentación)
que la API moderna de OpenSubtitles (`api.opensubtitles.com`, la misma que ya usa nuestro addon
`/opensubtitles`) tiene **tres códigos de idioma español separados**:

```
es → Spanish (genérico)
sp → Spanish (EU)       — España
ea → Spanish (LA)        — Latinoamérica
```

Confirmado con `GET /api/v1/infos/languages` (endpoint público, sin API key) desde un workflow de
GitHub Actions — `scripts/check-os-languages.mjs` +
`.github/workflows/check-os-languages.yml` (quedan en el repo como chequeo de un solo uso, no hace
falta volver a correrlos). **Esto contradice/actualiza la limitación documentada durante meses**
("Subtítulos, variante latino vs. España" más arriba) — esa investigación había probado variantes
como `es-419`/`es-MX`/`es-AR`/`lat` contra **SubSense** (la base vieja de OpenSubtitles, XML-RPC),
que en efecto no las soporta. Nunca se había probado el código `ea` contra la **API moderna**
(la que usa nuestro propio addon desde la Sesión 2026-08-16) — es una fuente distinta, con
taxonomía distinta.

**Aplicado**: `scripts/deno-hub.ts` generalizado — `fetchOpenSubtitlesSubs`/`handleOpenSubtitles`
ahora aceptan el código de idioma como parámetro (antes hardcodeado a `"es"`) — y se agregó una
ruta nueva **`/opensubtitles-latino`** que busca con `languages=ea&hearing_impaired=exclude`.
Mismo mecanismo de caché en Deno KV (compartido por `fileId`, ya que un mismo archivo de subtítulo
es el mismo sin importar por qué ruta se pidió) y de descarga perezosa que la ruta `/opensubtitles`
existente. Manifest nuevo: `com.mejorastremio.opensubtitles-latino`, "OpenSubtitles Latino (sin
SDH)". Router: la ruta nueva va **antes** que `/opensubtitles` porque ese `startsWith` también
matchea `/opensubtitles-latino` (si se agregan rutas nuevas con prefijo compartido en el futuro,
mismo cuidado).

**Actualizado 2026-09-03 (madrugada), después del límite de 15/hora**: el rate limit ya había
liberado la ventana — `deploy-deno-hub.yml` corrió limpio, pero **volvió a quedar como preview**
(`mejorastremio-hub-tw5vj6m789js.pabloeckert.deno.net`, build id `tw5vj6m789js`), no como
producción, mismo patrón ya documentado en la sesión 2026-08-29 pese a `"prod": true` en
`deno.jsonc`. **Verificación empírica ya hecha contra ese preview** (workflow de un solo uso
`check-preview-latino.yml`): `/opensubtitles-latino/subtitles/movie/tt0110912.json` devuelve un
resultado real — `{"lang":"spa","name":"[OpenSubtitles Latino] Pulp Fiction 1994.BDRip...lat...`
— confirma que el código `ea` sí tiene subtítulos cargados de verdad, no solo que el código existe.
El `/health` del preview también muestra `mediathek`/`translate`/`shortSeries` configurados (ver
sección Tatort más abajo) — este preview es el build más nuevo, con TODAS las rutas del hub.

**Bloqueado — requiere el mismo paso manual de Pablo de sesiones anteriores**: promover el build
`tw5vj6m789js` a producción en `console.deno.com/pabloeckert/mejorastremio-hub/builds/tw5vj6m789js`
(un clic, "Promote to Production" o equivalente). La producción actual (`mejorastremio-hub.
pabloeckert.deno.net`) sigue en una revisión vieja — tiene `mediathek`/`translate` (promovida en
algún punto de esta misma sesión, revision `7zhvbe4s9c0g`, ver sección Tatort) pero **todavía NO
tiene `opensubtitlesLatino` ni `shortSeries`**, confirmado con un fetch fresco a `/health` en
producción. Una vez promovido: instalar el addon nuevo en la cuenta real (mismo patrón de siempre,
`install-addon.mjs` + backup), idealmente adelante de `/opensubtitles` genérico en el orden de
subs, ya que "latino real" es más específico que "español genérico" para lo que pidió Pablo.

**Investigación adicional 2026-09-03 (mañana) — hipótesis descartada con test real, no solo
teorizada**: la doc oficial de Deno (`denoland/skills`, `deno-deploy/SKILL.md`) documenta
`deno deploy --prod` como el mecanismo real para apuntar a producción — se probó de nuevo, aislado.
**Primer test**: con `deno.jsonc → deploy` todavía con `"prod": true`, `deno deploy --prod` falló
con `Option "--prod" can only occur once, but was found several times` — hipótesis armada: el CLI
convierte `"prod": true` del config en un `--prod` implícito, y el flag explícito lo duplica.
**Se sacó `"prod": true` de `deno.jsonc`** (deja solo `org`/`app`) y se repitió el test — **mismo
error exacto, sin cambios**. La hipótesis queda **descartada por evidencia directa**: la
duplicación de `--prod` NO viene de `deno.jsonc` — es otra cosa (¿un valor por defecto interno del
propio subcomando `deno deploy`? ¿algo del entorno del runner? — no identificado). El cambio de
`deno.jsonc` (sacar `"prod": true`) se dejó igual — es inocuo y más simple, pero no es la solución.
**Un tercer intento, `deno deploy` sin ningún flag, volvió a pegar el límite de 15 deploys/hora**
(`You have exceeded the deployment limit of 15 per hour for your plan`) — la ventana de una hora
ya estaba consumida por los intentos previos de esta sesión (runs #13/#14/#15 de
`deploy-deno-hub.yml` más los 3 tests de este bloque). **No seguir intentando deploys hasta que
pase al menos una hora desde el último intento real** (el de `deno deploy` sin flags que sí llegó
al servidor, 2026-09-03 11:27 UTC) — cada intento cuenta contra la cuota aunque falle por el bug de
`--prod` duplicado (ese falla client-side, antes de tocar la red, así que NO cuenta; pero el bare
`deno deploy` sí llegó al servidor y si cuenta). **Sigue sin encontrarse una forma 100% por CLI de
llegar a producción** — el camino que funciona siempre es: `deno deploy` (sin flags, deployará como
preview) + promoción manual de Pablo en la consola web. No perder más tiempo en esto salvo pista
nueva real (ej. un changelog de Deno que documente el bug del `--prod` duplicado, o un mensaje de
error distinto en un intento futuro que dé una pista nueva).

### 2. "Conectado por IA para los que no se encuentra" — YA funciona, confirmado con evidencia

Probado contra la cuenta real (`scripts/check-subtitles.mjs`, nuevo, + workflow
`check-subtitles.yml`): para un título sin subtítulo español pre-hecho (**Passenger**,
`tt18827746`), **SubMaker (ya instalado) ofrece 4 resultados con `lang: "Make Spanish (Latin
America)"`** — traduce bajo demanda (vía IA/MT) subtítulos que sí existen en otro idioma (acá,
inglés) y **apunta explícitamente a la variante latinoamericana**, no genérica. Es exactamente el
mecanismo que pidió Pablo, ya andando, sin que hiciera falta tocar nada.

**Límite real encontrado, no un defecto de configuración**: para un título con **cero subtítulos en
absoluto en cualquier idioma** (probado con `Die Rosenheim-Cops` S01E01, `tt0305095` — título tan
de nicho que ni inglés tiene cargado en ninguna de las 7 fuentes), SubMaker también da 0 — no tiene
de dónde traducir. Investigado si existe una vía de generación por audio (Whisper) que pudiera
salvar ese caso: **sí existe, pero es una extensión de Chrome separada** (`SubMaker xSync`,
manual, corre en el navegador de escritorio, no dentro de la app de Stremio) — no es algo que ande
solo en las cajas de TV o el celular de Pablo, así que no es una solución real para su forma de
uso. Conclusión: para contenido con cero cobertura de subtítulos en cualquier idioma, no hay
ningún mecanismo automático posible — es el mismo límite estructural de siempre (contenido de
nicho sin circulación), ahora también confirmado del lado de subtítulos con IA, no solo de streams.

### 3. Auditoría obsesiva de los catálogos de crimen — 2 hallazgos, 1 aplicado, 1 revertido

Con `scripts/list-catalog.mjs` (nuevo, más liviano que `check-catalog-streams.mjs` — solo trae
título+fecha, sin probar streams) se auditaron en vivo los 4 catálogos de crimen/misterio
(Crimen Alemán, Crimen Reino Unido, Europe Noir, Policial Clásico):

- **Umbral de votos vs. estrenos 2026 — sin problema real, verificado.** Se temía que
  `vote_count.gte` estuviera excluyendo estrenos muy recientes de 2026 sin calificaciones
  todavía. Evidencia real: **SÍ aparecen** títulos de 2026 en los 4 catálogos (Sacrificio de
  Sangre, Unfamiliar, Pinocho: Desatado, Las Ovejas Detectives, Ruta de Escape, Cuenta Atrás,
  Peaky Blinders: El Hombre Inmortal, entre otros) — el piso de votos no es un problema práctico
  hoy. No se tocó nada.
- **Crimen Reino Unido (Cine) y Europe Noir (Cine) — mismo bug de "Hollywood coladero" que ya se
  había encontrado y arreglado en Crimen Alemán (Cine), pero SIN el mismo arreglo posible.** Con
  `with_origin_country=GB`, aparecen películas de Hollywood que solo se filmaron/financiaron
  parcialmente en Reino Unido (El Caballero Oscuro: La Leyenda Renace, Eyes Wide Shut, Horizonte
  Final, El Código Da Vinci, Johnny English Returns, Última Noche en el Soho) — no son cine
  británico real. A diferencia del caso alemán, acá **`with_original_language` no sirve** — el
  cine británico genuino también es en inglés, así que ese filtro no distingue nada.
  - **Probado en vivo**: se aplicó `without_companies` excluyendo los majors de Hollywood
    confirmados por id de TMDB (Disney=2, Paramount=4, Columbia=5, MGM=21, 20th Century=25,
    Universal=33, Warner Bros=174, Lionsgate=1632) a Crimen Reino Unido (Cine), y se comparó el
    catálogo real antes/después. **Resultado: mejora parcial pero con daño colateral real** — sacó
    6 títulos claramente de Hollywood (bien), pero **también sacó las dos películas de Kingsman**,
    que SÍ son cine británico genuino (Marv Films, Matthew Vaughn) — el único vínculo con Hollywood
    fue que 20th Century Fox las distribuyó. Y **dejó pasar** varias igual de "no británicas" (El
    Código Da Vinci, Johnny English Returns, Última Noche en el Soho, Misterio en Venecia, The
    Gentlemen 2020) — porque TMDB a veces etiqueta como `production_companies` al distribuidor
    (20th Century/Focus Features/Universal) y a veces a la productora real (Marv/Working
    Title/Film4), sin patrón consistente que `without_companies` pueda capturar de forma limpia.
  - **Decisión: revertido.** El trade-off no es claramente positivo (excluye contenido bueno,
    deja pasar contenido malo) — a diferencia del arreglo alemán, que fue limpio y sin falsos
    positivos. Queda documentado como límite real investigado a fondo, **no reinvestigar salvo que
    aparezca un filtro nuevo de TMDB Discover** (ej. si algún día agregan un filtro por
    "nacionalidad cultural" real, no solo financiamiento). No se aplicó a Europe Noir (Cine) por
    el mismo motivo, ni se tocó Crimen Reino Unido (Series) — la serie no tenía este problema
    (los títulos de esa lista eran genuinamente británicos).
  - **Verificado en la cuenta real**: aplicado y luego revertido, ambos pasos confirmados con
    `daily-catalog-refresh.yml` + health-check verde.

### 4. Proveedores de Torrentio — ya está al día, sin acción

Investigando si había proveedores nuevos que sumar (apareció "MejorTorrent" en listados públicos
recientes de Torrentio, no documentado en la ampliación de 24 proveedores de 2026-07-01), se
verificó contra la cuenta real (`scripts/check-torrentio-providers.mjs`, nuevo) — **ya está
habilitado** en el `transportUrl` guardado. No hacía falta ningún cambio.

### 4.5. Bug real encontrado y arreglado: `torbox-airlock.mjs` usaba el endpoint equivocado

La sesión 2026-08-28 había dejado el mecanismo de escritura de `torbox-airlock.mjs` sin poder
verificar (esa sesión también estaba bloqueada de red hacia TorBox) — asumió por analogía
`POST /api/torrents/controltorrent` con `operation: "airlock"`, con un aviso explícito de "probar
antes de confiar en --apply". Con salida a la web disponible esta sesión, se investigó a fondo y
**se confirmó que esa asunción estaba mal**:

- La documentación oficial del SDK de TorBox (`TorBox-App/torbox-sdk-js` y `torbox-sdk-py` en
  GitHub) confirma que **`controltorrent` solo acepta tres operaciones: Reannounce, Delete,
  Resume** — "airlock" nunca fue un valor válido ahí.
- El mecanismo real, confirmado leyendo el **código fuente real de un cliente TorBox de terceros
  open-source** (`jittarao/torbox-app`, `backend/src/api/ApiClient.js`, método `setAirlock`):
  **`PUT /api/torrents/edittorrent`** con body `{ torrent_id, airlocked: true }` (rutas gemelas
  `editusenetdownload`/`editwebdownload` para los otros tipos de asset, no usadas por nuestro
  script porque solo trabaja con torrents).

**Corregido**: `torboxSetAirlock()` en `scripts/torbox-airlock.mjs` ahora hace el PUT correcto.
Sigue sin poder probarse contra la cuenta real desde esta sesión (mismo bloqueo de red hacia
`api.torbox.app`) — la próxima vez que se corra con `TORBOX_API_KEY` disponible, seguir corriendo
primero sin `--apply` y revisar la respuesta cruda antes de confiar en el endpoint, por las dudas,
aunque ahora la base es mucho más sólida (código fuente real, no una analogía).

### 5. Investigación amplia del ecosistema — sin más hallazgos accionables

- **TorBox**: sigue siendo la recomendación correcta (confirmado de nuevo) — más estable que
  Real-Debrid en 2026 pese a sus propias caídas, mejor caché de estrenos recientes. Real-Debrid
  sigue purgando cachés por copyright (tags WEB-DL/AMZN/RARBG) y con política de una sola IP — no
  cambia la decisión ya tomada. El combo "TorBox + Real-Debrid" (~US$6-7/mes) existe como opción de
  power-user pero no se sugiere activamente — no está pedido, y agregar un segundo debrid de pago
  no calza con el criterio de frugalidad ya establecido salvo que Pablo lo pida.
- **Stremio v5/Web** tuvo una actualización real el 27/07/2026 (Tech Update #83) que corrige que el
  dropdown de addons "saltara" al scrollear y hace que se auto-scrollee a la opción ya seleccionada
  — mejora de estabilidad, pero **no agrega buscador de texto** al selector de catálogos de
  Descubrir, así que no cambia la recomendación de reordenar catálogos para reducir scroll (ya
  aplicado en sesión anterior).
- **`without_companies`** y **`with_release_type`** (parámetro de TMDB Discover para afinar
  "en cartelera"/"estrenos" por tipo de release — teatral limitado vs. amplio) quedan anotados
  como parámetros reales que existen, por si en el futuro hace falta este tipo de ajuste — no se
  aplicaron porque los catálogos de fecha ya funcionan bien desde el fix de la Sesión 2026-08-02.

### Verificación final de la sesión

`health-check.mjs` corrido en vivo varias veces durante la sesión (después de cada cambio real
aplicado a la cuenta): siempre verde, sin regresiones. Cambios efectivamente aplicados a la cuenta
real de `stremioeg` (todos vía `daily-catalog-refresh.yml` disparado a mano, confirmado con
`list-catalog.mjs` antes/después de cada uno): ninguno esta sesión quedó a medio aplicar — el
único pendiente real es el deploy a Deno Deploy, bloqueado por el límite de 15/hora, no por nada
del lado de la cuenta de Stremio.

**Scripts nuevos que quedan en el repo** (todos de diagnóstico, sin efectos secundarios en la
cuenta): `verify-live-account.mjs`, `check-catalog-streams.mjs`, `check-subtitles.mjs`,
`check-os-languages.mjs`, `list-catalog.mjs`, `check-torrentio-providers.mjs` — más sus workflows
correspondientes. Todos siguen el mismo patrón (`ST_EMAIL`/`ST_PASS`, solo lectura salvo que se
indique lo contrario) y quedan disponibles para reusar en diagnósticos futuros sin tener que
reinventarlos.
## Sesión 2026-09-03 — Tatort en alemán con subtítulos ES latino (2 addons nuevos en el hub)

Pablo pidió, en modo autónomo ("no pares hasta terminar, molestame solo si necesitás intervención
humana manual"): poder ver **Tatort** (la antología policial alemana, `tt0806910`) **en alemán con
subtítulos en español latino**, al menos los últimos 10 años, idealmente todo.

### Diagnóstico — por qué no se podía (baseline medido, no asumido)

`scripts/tatort-coverage.mjs` (nuevo, resumible, deja `data/tatort-coverage.jsonl`) auditó los **369
episodios estrenados desde 2016** contra la cuenta real, addon por addon:
- **Streams: 15/369 (4%) tenían algún stream**, casi todos de Comet en 2024-2026. Torrentio: 0 casi
  siempre. Causa raíz confirmada: los indexers de torrents (yts/eztv/1337x/rutracker/…) **no mapean
  los releases de Tatort** al esquema `imdbId:año:número` de Cinemeta — los nombran por número de
  Folge o por título de caso, sin `SxxExx` parseable. Solo los pocos episodios con un release
  scene-style (`Tatort.S2024E10.German…`) matchean. **No es config rota, es estructural.**
- **Subtítulos ES: 0/369.** OpenSubtitles.com (API moderna) tiene **1 subtítulo ES en toda la
  historia de la serie** (S1E25, de los 70). SubDL: 0. Los otros addons: 0. En cambio hay **916
  episodios con subtítulo alemán** y ~123 con inglés en OpenSubtitles. Tatort es contenido
  doméstico alemán que casi nadie subtitula al español. SubMaker (traducción bajo demanda) devuelve
  `[]` para Tatort porque no tiene ninguna base que traducir.

### Solución — 2 rutas nuevas en `scripts/deno-hub.ts`, deployadas e instaladas

**1. `/mediathek` — addon de streams** (`com.mejorastremio.mediathek`, idx 7 de la colección,
`--after stremio.comet.fast`). Fuente: **MediathekViewWeb** (`mediathekviewweb.de/api/query`), la
API JSON pública que agrega las Filmlisten de todos los canales públicos alemanes (ARD/SWR/WDR/NDR/
BR/HR/… + ORF). `topic=Tatort` devuelve ~1550 entradas, ~1140 films completos (`duration > 3300s`,
sin Audiodeskription/Gebärden/klare Sprache). Para un episodio: resuelve el título del caso vía
Cinemeta (`"Odenthal - 81 - Der Stelzenmann"` → `"Der Stelzenmann"`), lo matchea contra la lista
(exacto + containment, **matching estricto a propósito** — token-overlap daba falsos positivos con
otros episodios de Tatort y con otras series alemanas homónimas tipo "Zorn"), y devuelve el MP4
progresivo directo (HD) + adjunta en el propio stream el subtítulo alemán oficial (`url_subtitle`,
EBU-TT-D, perfectamente sincronizado) y un subtítulo `lang:"spa"` que apunta a `/translate`.
Devuelve `{streams:[]}` para cualquier id que no sea `tt0806910` — no molesta al resto del catálogo.

**2. `/translate` — addon de subtítulos IA→ES latino** (`com.mejorastremio.translate`, idx 2,
`--after com.mejorastremio.subdl`). Toma la mejor pista base disponible —**alemán oficial de la
Mediathek** si es Tatort y está, si no **alemán/inglés de OpenSubtitles.com** (non-SDH)— la parsea a
cues, **descarta las cues de puro sonido** (`(Musik)`, `[Tür quietscht]`, `* Musik *` — ruido para
quien mira en alemán), y traduce el diálogo al **español latino neutro de doblaje** con Gemini
(`gemini-flash-lite-latest`, `safetySettings: BLOCK_NONE` — sin eso Gemini bloquea lotes con
descripción de escenas de crimen). Reensambla el SRT y lo cachea 90 días en Deno KV, **por lote**
(`["tr-batch","v7",<ref>,<i>]`) para que un reintento o el pre-warm no rehaga lo ya hecho.
**Se auto-limita**: si OpenSubtitles.com ya tiene algún subtítulo ES real para el título, devuelve
`[]` (no ensucia contenido que ya está bien cubierto — Matrix, etc. no ven este addon).
- Parámetros afinados tras medir: lotes de 220 líneas, 4 en paralelo (el free tier de Gemini tira
  429 con más concurrencia; lotes grandes bajan el total de requests a ~5-6 por episodio), timeout
  48s por lote, hasta 5 rondas + reintento por-línea de lo que la IA saltea (Gemini devuelve
  212-218 de 220 aunque termine con STOP — saltea 2-8 líneas por lote). Umbral de aceptación 0.8:
  un lote con ≥80% traducido se cachea igual (el resto queda en alemán) para no rehacer 30s en cada
  apertura. Backoff en 429 (cuota) y 503 (sobrecarga). Cache de KV versionada (`v8`).
- **Tiempos reales medidos en producción (Deno Deploy)**: primera apertura de un episodio ~30-56s
  (Deno Deploy NO mata el request largo — verificado), completa o ~97%. Cualquier apertura
  posterior (otro dispositivo, otra sesión): **<1.5s desde KV**. Calidad de traducción: buena,
  latino neutro ("¿Qué quieres decir con eso?", "Ay, vamos", "¡Al suelo!").
- **Cuota de Gemini**: el free tier de `gemini-flash-lite` es ~1000 requests/día + ~15 RPM. Un
  episodio = ~5-6 requests. Uso normal (pre-warm diario + alguna apertura en frío) está muy por
  debajo. En esta sesión se agotó la cuota diaria por el volumen de pruebas — resetea a medianoche
  Pacífico; no es un problema de producción.
- **OpenRouter quedó descartado del camino de subtítulos**: su router `openrouter/free` tarda >40s
  por request. Gemini flash-lite hace 220 líneas en ~12-15s. `callGemini` ahora manda
  `safetySettings: BLOCK_NONE` + `generationConfig` (usado también por `/synopsis`, sin efecto
  adverso ahí). El `thinkingConfig` NO va — `gemini-flash-lite-latest` lo rechaza con 400.

**3. Pre-warm — `scripts/tatort-prewarm.mjs` + `.github/workflows/tatort-subs-prewarm.yml`** (07:30
ART diario, 15 min después de premiere-radar). Calienta la cache de traducción para los Tatort que
Pablo tiene más a mano: los "Continuar viendo"/"Watchlist" de MyTrakt (solo si el próximo no visto
es de los últimos 3 años) + los ~10 estrenos más recientes. Como la base de traducción de Tatort es
el subtítulo alemán oficial de la Mediathek (no OpenSubtitles), calentar **no consume cupo de
nada** y se puede correr a diario. Estado en `data/tatort-prewarm-state.json`, tope 16 episodios/
corrida, registra en `data/internal-log.jsonl` vía `log-status.mjs`. Primera corrida manual: 9
episodios calientes, 1 parcial (reintenta), 2 sin base (los "up-next" de Trakt eran de los 70 —
por eso se agregó el filtro de 3 años).

### Resultado

- **Antes**: 15/369 (4%) de los episodios con stream, 0/369 (0%) con subtítulo ES.
- **Después** (medido sobre los **370 episodios 2016-2026** con `scripts/tatort-coverage-after.mjs`
  → `data/tatort-coverage-after.jsonl`):
  - **Audio alemán disponible: 276/370 (74.6%)** — Mediathek (mayoría) + Comet/TorBox.
  - **Subtítulo español disponible: 247/370 (66.8%)** — la traducción IA, cuando hay pista base
    alemana (Mediathek oficial o OpenSubtitles).
  - **Mirable en alemán con sub ES latino (ambos): 247/370 (66.8%)**.
  - Por año: fuerte en 2019-2026 (24-33 de ~35 por año; 2023 y 2026 casi completos), más flojo en
    2016-2018 (13-19 de ~37). La ARD rota su archivo online — muchos episodios viejos simplemente
    no están hoy. Eso es indisponibilidad real, no un bug de matching (se probó token-overlap y
    query por título: daban falsos positivos con otros episodios/series, se descartaron).
- El ~33% que falta: ~94 episodios sin ningún stream (ni Mediathek ni torrent mapeable) y ~29 con
  stream pero sin ninguna pista base alemana para traducir. Sin fuente gratuita para esos hoy.

### Verificación

`health-check.mjs` verde post-instalación (24 addons, sin duplicados, streams/subs de Matrix/BB/
Will Trent sin regresión). `/mediathek` devuelve 0 para no-Tatort (correcto). `/translate` no
aparece en la lista de subs de Matrix/BB (correcto — se auto-silencia donde ya hay ES).
`deno check scripts/deno-hub.ts` limpio. Instancia `mejorastremio-hub` redeployada
(revision `7zhvbe4s9c0g`), `/health` muestra `mediathek` y `translate` configurados.

### Pendiente / notas

- **`OPENSUBTITLES_API_KEY` ya estaba en Deno Deploy** (se usa desde la sesión 2026-08-16) — el
  fallback de `/translate` a base alemana de OpenSubtitles funciona sin tocar nada.
- La primera apertura de ~40s de un episodio no pre-calentado es el único costo visible. El
  pre-warm cubre lo que Pablo mira; para un episodio elegido al azar, es 40s una vez y después
  instantáneo. **Si molesta**: la única mejora real sería habilitar billing en el proyecto de
  Google Cloud de la key de Gemini (a este volumen, centavos/mes) para levantar el límite de RPM y
  poder paralelizar más — requiere decisión de Pablo (ver `feedback_stay_free`), no se hace solo.
- El addon `stremio-ai-search` (`au.itcon.aisearch`) fue **removido de la cuenta el 2026-08-25**;
  no confundir con estos.

## Sesión 2026-09-03 (dev 2) — higiene de repo + auditoría de catálogos

Sesión en paralelo con dev 1 (que hacía el hub: OpenSubtitles Latino, Comedias Cortas, Tatort
prewarm). Lane de dev 2: higiene del repo, auditoría de `preset.json` (lectura + fix de
inconsistencias), validación de la cuenta (solo lectura), y el dry-run de `torbox-airlock.mjs`.
Sin escrituras a la cuenta real ni deploys — eso lo aplica dev 1 tras el merge.

### A. Higiene de repo — cruft de diagnóstico borrado

La sesión anterior (2026-08-28/09-03) dejó muchos workflows+scripts de un solo uso. Borrados
(workflow **y** script cuando había):
- `debug-tatort-meta` — volcado crudo de metadata de Tatort, superado por `tatort-coverage.mjs`.
- `diagnose-tatort` — muestreo de streams/subs de Tatort, superado por `tatort-coverage.mjs`.
- `diagnose-episodes` — "próximos N episodios de un show", one-off del final de Regular Show
  (conclusión fue "hueco real, no accionable"). Para un caso equivalente, `check-catalog-streams.mjs`
  prueba streams por título.
- `check-preview-latino.yml` — verificó el preview de `/opensubtitles-latino`; ya se promovió a
  prod, no vuelve a hacer falta (no tenía script, era curl inline).
- `list-addons` (workflow + script) — volcado de addons instalados, redundante con
  `verify-live-account.mjs`.
- `audit-streaming-catalogs.yml` — el workflow del one-off de dev 1 de esta misma sesión; el
  script `scripts/audit-streaming-catalogs.mjs` **se conserva** (auditor de solo lectura reusable,
  mismo criterio que la familia `check-*.mjs`/`list-catalog.mjs`).
- `test-deno-deploy-prod.yml` — se marcó para borrar pero dev 1 lo seguía usando en paralelo
  (commits `4b05ed7`/`06c4103` para diagnosticar el `--prod` duplicado del CLI de Deno Deploy);
  **se conserva** hasta que dev 1 cierre ese hilo.

**Se conservan** (cron activo o diagnóstico reusable en sesiones con red bloqueada): `keep-warm`,
`health-monitor`, `daily-catalog-refresh`, `premiere-radar`, `anti-frustration-review`,
`tatort-subs-prewarm`, `deploy-deno-hub`, más `check-catalog-streams`, `check-subtitles`,
`check-os-languages`, `check-torrentio-providers`, `list-catalog`, `verify-live-account`
(workflow + script cada uno) y `audit-streaming-catalogs.mjs` (solo script).

### B. Auditoría de `preset.json` — inconsistencias y pendientes

- **Fix aplicado (3 líneas)**: `streaming.cru` (movie+series) y `flixpatrol.crunchyroll.us.all`
  tenían `enabled:false` pero `showInHome:true` — inconsistencia dejada por el commit `cd4cab1`
  ("sacar Crunchyroll de nuevo, a pedido de Pablo", que solo tocó `enabled`). Pasados a
  `showInHome:false`. Crunchyroll sigue OUT (decisión de Pablo, respetada). No cambia el conteo de
  catálogos visibles (96) porque `enabled:false` ya los excluía de Home.
- **Catálogos huérfanos — tema CERRADO**: `dramedy-spain` y `latam-no-ar` ya **no existen** en
  `preset.json` (borrados el 2026-08-28 tarde). `classic-crime`/"Policial Clásico" está
  `enabled:true` (activo, correcto). Nada que borrar.
- **Tailandia / Hong Kong** ya no están (borrados el 2026-08-28 tarde). 5 países de Asia activos
  (Japón/Corea/China/Taiwán/India), todos `showInHome:true`.
- **`validate-config.mjs`**: OK — 166 catálogos, 120 enabled (era 120 antes también; el fix de
  Crunchyroll no cambia `enabled`).

### B'. Streaming Catalogs — cerrada con evidencia de uso real (watch-log)

dev 1 cerró la "mitad técnica" (56/56 catálogos andan, 0 rotos — ver su nota más arriba). dev 2
cerró la **mitad de uso** con `watch-log.mjs` (lee `libraryItem`, el datastore nativo de Stremio):
**290 títulos con actividad real** en `stremioeg`. Resultado:
- **Bloque UK — muy usado, se CONSERVA entero**: Ghosts (1318 min), Ludwig (396 min), Slow Horses,
  Dept. Q, Douglas Is Cancelled, Harry Wild, The Boroughs. UK es la 2ª región más mirada por
  lejos. ITVX/Acorn TV/BritBox/BBC iPlayer/Channel 4/Sky Go quedan.
- **Documentales (Curiosity Stream, MagellanTV, Discovery+)**: 0 minutos en 290 títulos.
- **Holandeses (NLZIET, Videoland)**: 0 minutos.
- **Hayu (reality)**: 0 minutos.

**Aplicado a la KEEP list de `scripts/curate-streaming-catalogs.mjs`** (30 → 24 servicios): sacados
`cts`, `mgl`, `dpe`, `nlz`, `vil`, `hay`, con el detalle de la evidencia en un comentario del
script. **El `--apply` contra la cuenta lo hace dev 1** (dev 2 no tiene acceso de escritura). Report
mode confirmado: 46 catálogos nuevos (antes 56), swap limpio.
- **Asia en AIOMetadata** (Japón/Corea/China/Taiwán/India ×2 = 10 catálogos `showInHome:true`, al
  fondo del Home): 0 contenido asiático en el historial. **Propuesta, NO aplicada** (Pablo los armó
  a propósito el 2026-07-01 con filtro de calidad — es decisión de gusto, no inconsistencia): pasar
  esos 10 a `showInHome:false` dejándolos `enabled` para Descubrir. A confirmar con Pablo.

### C. Validación de la cuenta (solo lectura)

- `health-check.mjs` contra la cuenta real: **✅ Todo OK, exit 0**, 24 addons (corrido antes de que
  dev 1 instalara OpenSubtitles Latino + Comedias Cortas → 26), sin `manifest.id` duplicados,
  streams (Matrix 156, BB S01E01 163, Will Trent 65) y subs (Matrix 90, BB 81) normales.
- `audit-catalog-order.mjs`: exit 0, 96 catálogos visibles, orden correcto (las etiquetas de
  categoría siguen cosméticamente desactualizadas — ya documentado, no se tocó).
- `refresh-dates.mjs --check`: fechas al día.
- `anti-frustration.mjs review`: 0 resueltos, **8 pendientes** (Los Mufas, El Marginal, Ágata y
  Lola S01E02, Infiltrada S01E11, Pa' Seguirte Queriendo S01E02/03, VisionQuest S01E01/02) — mismo
  hueco estructural de contenido exclusivo Netflix AR / Movistar. Log commiteado. La review sumó la
  columna del addon nuevo "Mediathek DE (Tatort)" (0 en todos, esperado — no es Tatort).

### C'. BUG REAL — `premiere-radar.mjs` borró todo su estado el 2026-09-02

La corrida programada del **2026-09-02 14:28 UTC** commiteó `data/premiere-radar-state.json`
pasándolo de 158 líneas a `[]`. Causa: si `MyTrakt Sync` devuelve 0 shows (fallo transitorio del
endpoint — `getJson` → `null` → `metas: []`), `shows` queda vacío, el loop no corre, y
`saveState([])` **borra todo el estado**. La corrida siguiente ve el estado vacío y trata cada
episodio como nuevo → re-"notifica" todo desde cero. Sin emails desde 2026-08-02 ya no spamea a
Pablo, pero ensucia `internal-log.jsonl` y pierde la memoria de "ya avisado".
- **Fix**: guard `if (shows.size === 0) die(...)` antes de `saveState`, en `premiere-radar.mjs` y
  (mismo patrón) en `torbox-airlock.mjs`. Ahora una corrida con MyTrakt caído sale con exit 1 (job
  rojo, señal visible) en vez de borrar el estado en silencio.
- **Estado regenerado**: la corrida de dev 2 produjo 17 entries válidas (16 LISTO + 1 pendiente:
  Los Mufas). Commiteado — es mejor que el `[]` que había. Los `notifiedAt` quedaron todos con
  fecha de hoy (se perdió el histórico real en el wipe del 02/09), pero como no hay emails eso solo
  afecta ruido de log, no comportamiento.

### D. `torbox-airlock.mjs` — dry-run: el fix del endpoint parece correcto

- **Read endpoint** `GET /api/torrents/mylist`: HTTP 200, `success: true`, **256 torrents**. Cada
  objeto torrent trae `id` (entero, ej. `89071413`), `hash` y `airlocked` — los 4 campos que usa el
  script (`t.id`, `t.hash`, `t.airlocked`, `t.name`) existen y están bien nombrados. `airlocked`
  presente en 256/256, hoy en `true` en 0 (Pablo no marcó nada).
- **Write endpoint** `PUT /api/torrents/edittorrent` con `{ torrent_id, airlocked: true }`:
  `torrent_id` = `t.id`, coherente. **No probado** (requiere `--apply` sobre un torrent real).
  Recomendación: dev 1 o Pablo corren `--apply` una vez cuando haya contenido cacheado sin ver que
  valga la pena bloquear, y revisan la respuesta cruda. La base es sólida (campos confirmados +
  código fuente de tercero ya citado en el header del script).
- **Bug de usabilidad arreglado**: el dry-run recorría TODOS los episodios no vistos de los 17
  shows de Continue Watching (X-Files 200+ eps) probando 2 streams c/u → no terminaba nunca
  (>20 min). Acotado: ventana de 2 años sobre `released`/`firstAired` + tope de 30 eps/show
  (mismo criterio de "reciente" que `tatort-prewarm.mjs`). Con el bound, el dry-run cierra limpio:
  **0 candidatos hoy** (nada cacheado reciente sin ver que matchee un torrent de la mylist — Pablo
  se puso al día con lo de Ágata y Lola de la sesión 2026-08-25).

### Archivos tocados por dev 2 (para el merge)

- `data/preset.json` — 3 líneas (Crunchyroll `showInHome:false`)
- `data/anti-frustration-log.json` — `review` (refresh + columna Mediathek)
- `data/premiere-radar-state.json` — regenerado (17 entries, sale del `[]`)
- `scripts/premiere-radar.mjs` — guard `shows.size === 0`
- `scripts/torbox-airlock.mjs` — guard `shows.size === 0` + bound de 2 años / 30 eps por show
- `scripts/curate-streaming-catalogs.mjs` — KEEP list 30 → 24 (`--apply` pendiente para dev 1)
- borrados: 6 workflows (`debug-tatort-meta`, `diagnose-tatort`, `diagnose-episodes`,
  `check-preview-latino`, `list-addons`, `audit-streaming-catalogs.yml`) + 4 scripts
  (`debug-tatort-meta`, `diagnose-tatort`, `diagnose-episodes`, `list-addons`). `test-deno-deploy-prod.yml`
  NO se borró (dev 1 lo sigue usando). — ver bloque A
- `CLAUDE.md` — esta sección + nota inline en la sesión 2026-08-29 sobre `diagnose-episodes`

## Sesión 2026-09-03 (dev 1, continuación) — /short-series usable, OpenSubtitles Latino, pre-warm ampliado

Lane de dev 1 en la sesión coordinada de dos agentes (dev 2 hizo higiene de repo + catálogos, arriba).

**1. `/short-series` reescrito y por fin usable → "Comedias Cortas (≤30 min)"** (instalado idx 22).
La query vieja era `discover/tv` por popularidad SIN filtro de runtime, y recién el fetch de detalle
filtraba por `episode_run_time` → quedaban ~7 títulos (telediarios, anime, soaps regionales).
Hallazgo: **`with_runtime.lte` SÍ funciona en `/discover/tv`** — la nota de la sesión 2026-08-28 que
decía que no, estaba equivocada (probablemente se probó sin `vote_count.gte`/género y el ruido tapó
el resultado). Ahora: `discover/tv` con `with_runtime.lte=30` + `with_genres=35` (comedia) +
`without_genres=16,10762,10763,10767` (animación/kids/noticias/talk) + confirmación por
`episode_run_time<=30` en paralelo (de a 8). **41 sitcoms live-action reales** (Frasier, Parks and
Rec, New Girl, 30 Rock, Big Bang, Golden Girls, El Chavo del Ocho, Bromistas Imprácticos…). Se
acotó a comedia a propósito: "series ≤30min por popularidad" a secas es 90% anime/dibujos a nivel
mundial. Si Pablo quiere incluir animación adulta o drama corto, es sacar `with_genres=35` / el `16`
del `without_genres`.

**2. `OpenSubtitles Latino` (código `ea`) instalado** (idx 0, primero de todos los subs). La sesión
anterior (commit `37ad73a`) creó y deployó la ruta `/opensubtitles-latino` (código de idioma `ea` =
Spanish LA, distinto del `es` genérico) pero **nunca la instaló**. Verificado en vivo que devuelve
subs latino reales (Matrix 1, Enola Holmes 3 1) — cobertura fina pero cuando pega es latino de
verdad, mejor que el `es` genérico. Se auto-silencia donde no hay `ea`. Orden de subs ahora:
OpenSubtitles Latino (`ea`) → OpenSubtitles ES (`es`) → SubDL → Traducción IA → SubSense → SubMaker →
OpenSubtitles v3 → Community. `/translate` también actualizado: `osHasSpanish` ahora chequea
`es,sp,ea` (los 3 códigos), no solo `es`, para no ofrecer traducción IA donde ya hay sub real.

**3. Pre-warm de Tatort ampliado** (`scripts/tatort-prewarm.mjs`, workflow `--recent 12 --max 24`):
además de recientes/watchlist, ahora hace **backfill de los últimos 4 años** todavía sin calentar
(tope 24/corrida). La base de traducción de Tatort es el subtítulo alemán oficial de la Mediathek →
no consume cupo de OpenSubtitles, solo de Gemini, y el tope lo mantiene bajo. Los "sin-base" no se
reintentan a diario (se re-chequean al mes por si la ARD los sube). Con lo corrido esta sesión,
**~108/132 episodios del backfill de 4 años ya están cacheados**; el resto cae en ~1 semana de
corridas diarias. Nota: durante esta sesión se agotó la cuota diaria de Gemini por volumen de
pruebas — varios episodios quedaron "parcial" (~96% traducido, cacheados 2 días); se completan solos
cuando la cuota resetea.

**4. Streaming Catalogs curado — APLICADO** (era el `--apply` que dev 2 dejó pendiente).
`curate-streaming-catalogs.mjs --apply` sacó los 6 servicios con **0 minutos de uso real**
(evidencia `watch-log.mjs`, 290 títulos): Curiosity Stream, MagellanTV, NLZIET, Hayu, Videoland,
Discovery+. Quedan 24 servicios / 46 catálogos (antes 30/~60). El bloque UK (ITVX/Acorn TV/BritBox/
BBC iPlayer/Channel 4) se conservó entero — es el más usado (Ghosts 1318min, Ludwig, Slow Horses,
Dept Q…). Backup: `.backups/backup-streaming-catalogs-pre-curate-*.json`. health-check verde.

**5b. Catálogos de Asia fuera del Home — APLICADO** (Pablo lo confirmó al cierre; lo ejecutó una
sesión de Claude en paralelo, commit `a852730`). Los 10 catálogos
`tmdb.discover.{movie,tv}.{jp,kr,cn,tw,in}.pablo0NN` (Cine/Series de Japón, Corea, China, Taiwán,
India) → `showInHome:false`, `enabled:true` intacto → siguen navegables en Descubrir. Motivo: 0
contenido asiático en 290 títulos del historial real (medición de dev 2). Reemplaza el pedido de
2026-08-02 tarde ("todos los países en el Home"). Instancia AIOMetadata regenerada por el cron
(`e4fd56c7`), 10 catálogos de Asia confirmados en el manifest en vivo (127 total), health-check
verde. Nota: dos sesiones hicieron el mismo cambio casi simultáneo — el commit local duplicado
`414b33c` se descartó con `git reset --hard origin/main`, la cuenta quedó consistente
(`preset.json instanceId == transportUrl en vivo == e4fd56c7`).

**5. Pendientes que quedan (NO aplicados — requieren a Pablo):**
- **`torbox-airlock.mjs --apply`** — el fix del endpoint (PUT `edittorrent`) tiene la base
  verificada (read `/api/torrents/mylist` OK, 256 torrents, campos correctos) pero el write nunca se
  ejerció. Dry-run hoy: 0 candidatos (nada cacheado sin ver que valga la pena bloquear). Correr
  `--apply` una vez cuando haya un candidato real y revisar la respuesta cruda.
- test-content.mjs: con 26 addons tarda >12min; health-check (camino crítico) cubre lo importante.

**6. Deploy del hub — conclusión definitiva (probado a fondo esta sesión).**
- **LOCAL funciona**: `deno deploy --prod --org=pabloeckert --app=mejorastremio-hub` → producción
  directa, limpio. Se usó ~8 veces esta sesión. `deno.jsonc` tiene solo `{org, app}` (NO `"prod":
  true` — rompe el `--prod` local por duplicación).
- **CI (`deploy-deno-hub.yml`) NO deploya a producción**: en el runner de GitHub Actions cualquier
  flag se duplica y falla (`Option "--prod" can only occur once`), y `"prod": true` en `deno.jsonc`
  tampoco alcanza — el workflow "tiene éxito" pero deja el deploy en **preview**, hay que promoverlo
  a mano en `console.deno.com`. Confirmado con una corrida real (run 33757090985, "Preview url:").
  El workflow queda como fallback documentado, no como camino principal.
- Límite real de Deno: **15 deploys/hora**. Se agotó esta sesión por volumen.
- Borrado `test-deno-deploy-prod.yml` (diagnóstico de un solo uso, tema cerrado).

**Estado de la colección al cierre: 26 addons** (idx 0 OpenSubtitles Latino, idx 3 Traducción IA,
idx 8 Mediathek DE, idx 22 Comedias Cortas). Sin `manifest.id` duplicados. `mejorastremio-hub` en
producción con `/short-series` v1.1.0 y `osHasSpanish` chequeando `es,sp,ea` (verificado en vivo:
`/translate` devuelve `[]` para Matrix porque ya tiene sub `es`+`ea`).

## HANDOFF 2026-09-03 — para la próxima sesión (aplicar lo de stremioeg a las otras cuentas)

Pablo cerró la sesión por límite y pidió **continuar con "la otra cuenta"** — llevar las mejoras de
`stremioeg` de esta sesión a `stremiojn` (Joaquín, `cuentas/stremiojn/CLAUDE.md`) y/o `solotveg`
(perfil juvenil PG-13, `cuentas/solotveg/CLAUDE.md`), respetando la curación propia de cada una.

**Estado de `stremioeg` al cierre (TODO aplicado y verificado, health-check verde):**
- Hub `mejorastremio-hub` en producción con rutas nuevas: `/mediathek` (streams Tatort de la
  Mediathek alemana), `/translate` (sub ES latino por IA desde pista alemana), `/short-series`
  (Comedias Cortas ≤30min, reescrito). `/opensubtitles-latino` (código `ea`) ya existía.
- Addons instalados en stremioeg esta sesión: OpenSubtitles Latino (idx 0), Mediathek DE (idx 8),
  Traducción IA (idx 3), Comedias Cortas (idx 22). 26 addons total.
- Streaming Catalogs curado (30→24, sacados los de 0 uso). Asia fuera del Home. Repo limpio de
  cruft de diagnóstico. Bugs arreglados: premiere-radar wipe, torbox-airlock endpoint+bound.
- Pre-warm de Tatort corriendo a diario (`tatort-subs-prewarm.yml`).

**Qué evaluar para stremiojn / solotveg (decidir con criterio, no copiar a ciegas):**
1. **`/opensubtitles-latino` + `/translate`**: ambas cuentas se benefician de subs ES latino real /
   por IA. `/mediathek` solo si esa cuenta ve Tatort u otro contenido alemán (revisar su
   `watch-log.mjs` primero). `/short-series` (comedias cortas) probablemente sí para ambas.
2. **`solotveg` es PG-13**: `/translate` traduce Tatort (contenido policial adulto, violencia) — no
   encaja con el perfil juvenil. `/short-series` con `with_genres=35` sin animación puede servir,
   pero OJO que ahí sí quitó Kids/animación — para un perfil juvenil quizás querés animación. Ver
   `regenerate-aiometadata-solotveg.mjs` (esa cuenta tiene instancia y reglas propias).
3. `install-addon.mjs` funciona con `ST_EMAIL_JN`/`ST_PASS_JN` y `ST_EMAIL_TEEN`/`ST_PASS_TEEN`
   (en `SECRETS.local.md`) — exportar la que corresponda antes de correr.
4. Documentar el trabajo de cada cuenta en SU propio `cuentas/*/CLAUDE.md`, no acá.

**Pendientes que quedan abiertos (stremioeg, NO bloquean, requieren a Pablo o verificación):**
- ~~`torbox-airlock` — cron DESACTIVADO~~ **RESUELTO 2026-09-04**: secret cargado, cron reactivado,
  ver sesión "2026-09-04 (noche, continuación)" más abajo.
- Deno hub: si hay que redeployar, hacerlo LOCAL con `--prod` (ver punto 6 arriba), no por el
  workflow.
- Episodios de Tatort "parciales" en la cache de traducción — **era 100% cuota de Gemini agotada**
  (por el volumen de pruebas del 2026-09-03). Con cuota fresca los episodios completan en 8-15s.
  El pre-warm diario limpia el backlog solo; 2026:15 tiene un lote puntual medio terco (~96%,
  cacheado 2 días) que no vale perseguir.
- **`stremiojn` (Joaquín) POSPUESTO "hasta nuevo aviso"** (Pablo, 2026-09-03 tarde). Falta: los 2
  addons de OpenSubtitles (subs ES 40→~90, como se hizo en solotveg) + cerrar la incidencia vieja
  "no carga nada" del 2026-08-03. NO tocar hasta que Pablo lo pida.
- `check-account.yml` es one-off ("de un solo uso"), ya cumplió su función (decidir qué instalar en
  solotveg). Tuvo 1 corrida en rojo (probable falta de secrets JN). `install-account-addon.yml`
  queda como reusable para cuando se retome stremiojn.
- **Múltiples sesiones de Claude tocaron este repo en paralelo el 2026-09-03** (al menos 4): carreras
  de git y trabajo duplicado (Asia lo hicieron 2 sesiones; solotveg lo hizo una tercera). Antes de
  arrancar una nueva, confirmar con `ListAgents` + `git fetch` que no hay otra activa.

## Sesión 2026-09-03 (noche) — auditoría completa + research de ecosistema

Pedido de Pablo: auditoría completa, actualizarse con foros/redes/internet, informe en lenguaje
sencillo, arreglar todo lo autónomo. Resultado: **nada roto**, un par de fixes chicos aplicados,
varios hallazgos externos anotados (no accionables sin decisión de Pablo).

**Auditoría técnica — todo verde:**
- Las 3 cuentas (`stremioeg` 26 addons / `solotveg` 22 / `stremiojn` 23): `health-check.mjs` exit 0,
  sin `manifest.id` duplicados, todos los manifests responden. Streams (Torrentio 111/97 cacheados,
  Comet 20/19) y subtítulos normales.
- Hub `mejorastremio-hub`: las 12 rutas responden 200 en <1s. Gemini quota OK. `deno deploy --prod
  --org=pabloeckert --app=mejorastremio-hub` (local) sigue siendo el camino de deploy.
- `validate-config` OK (166 catálogos, 120 enabled), fechas al día, orden de catálogos OK.
- Versiones al día: AIOMetadata v2.16.5 (release 2026-09-02), Torrentio v0.0.15, Comet v2.0.0,
  NoTorrent v2.7.0, WebStreamrMBG v0.73.2, MyTrakt v3.16.3, SubMaker v1.4.94.
- Cache de traducción Tatort: 50 completos (era 35), self-healing con el pre-warm diario.

**Fixes aplicados esta sesión:**
1. **`/discover` (Descubrir Maestro)**: `without_genres=10763,10767` (Noticias/Talk) para
   `type=series`. "País Alemania + Crimen" traía Tagesschau al tope; ahora arranca con Tatort/Der
   Alte/Die Rosenheim-Cops/Dark. Deployado a producción. (Nota: el catálogo funcionaba bien, esto
   es solo prolijidad — un primer test dio 0 resultados porque usé el id `discover-movie` en vez de
   `discover-master`, falso positivo.)
2. **`anti-frustration-log.json`**: sacada la entrada fantasma "Infiltrada S01E11" con id
   `tt29780951` (ese id es **Wild Cards** en Cinemeta; TMDB tiene el mapeo roto y alguien registró
   Infiltrada con él en la sesión 2026-08-23). Cinemeta no tiene la serie "Infiltrada" → esa
   entrada nunca iba a resolver. 28→27 entradas.
3. **`torbox-airlock` cron DESACTIVADO** (ya documentado arriba): fallaba en rojo a diario por
   falta del secret + write endpoint sin probar.

**Research del ecosistema (foros/GitHub/web) — hallazgos, NINGUNO accionable sin Pablo:**
- **AIOMetadata (ElfHosted) tuvo 3+ caídas cortas la última semana** (28/08, 02/09 ×2) — todas
  auto-recuperadas. El `keep-warm` (ping cada 20 min) + Cinemeta en idx 5 como fallback lo cubren.
  A vigilar si escala.
- **Torrentio**: hubo un reporte de "caído" (Cloudflare Host Error) en r/StremioAddons hace 2 días.
  Nuestra instancia funciona bien (111 streams, 97 cacheados). Fue transitorio.
- **TorBox**: siguen los reportes de inestabilidad (outage multi-día 19-21/08, "6 caídas en 4
  días"). Septiembre limpio hasta ahora. Ya documentado (cambio de ToS 27/08). Sin acción nueva.
- **Real-Debrid muy degradado** ("80% streams bloqueados", restricciones de búsqueda) — no lo
  usamos, refuerza la elección de TorBox.
- **Jikan/MAL API cierra el 1/10/2026** — ya lo cubrimos (motores `mal.search.*` apagados el
  2026-08-02). Nada que hacer.
- **OmniCatalogs v1.7.0 — EVALUADO A FONDO, NO se adopta (2026-09-03 noche).** Addon de catálogos
  por plataforma, mejor mantenido que nuestro "Streaming Catalogs" (`pw.ers.netflix-catalog` =
  repo `rleroi/Stremio-Streaming-Catalogs-Addon`, **último commit 2026-01-10, ~8 meses sin tocar**).
  A favor de OmniCatalogs: filtro por género combinable, nombres en español, 3 filas por plataforma
  (Popular/Tendencias/Nuevo), canales de Amazon/Apple TV (MGM+/PBS Masterpiece/Acorn…), dev activo.
  **Por qué NO se cambia:**
  1. **Es de un solo país por instalación** (arquitectura: `{país}_{idioma}_{providers}` en la URL).
     El setup actual de Pablo es cross-region a propósito (24 plataformas mezclando AR/UK/US/EU —
     `countryCode` vacío en la config del addon actual = "sin filtro de país"). Pablo pidió
     explícitamente (2026-07-02) "todas las plataformas de Europa occidental + América + Oceanía,
     sin filtrar por si llega a Argentina", y el `watch-log` del 2026-09-03 confirma que el bloque
     **UK (BritBox/Acorn/ITVX/BBC iPlayer/Channel 4) es el más usado** (Ghosts 1318 min, etc.).
     Con OmniCatalogs habría que elegir UN país y perder el resto.
  2. **No se puede multi-instalar** para cubrir varios países: las 3 configs (AR/GB/US) devuelven el
     MISMO `manifest.id` (`community.omnicatalogs.stremio.addon`) → es exactamente el bug de
     manifest.id duplicado que rompe la búsqueda global (ver "Búsqueda rota por manifest.id
     duplicado" arriba). El hint del propio addon ("instalá para varios países") ignora ese límite
     de Stremio.
  3. **Su ventaja principal (filtro de género combinable) YA la tenemos** en "Descubrir Maestro"
     (`/discover` del hub): `service=Netflix&genre=Crimen` cross-region, en español, mantenido por
     nosotros — probado funcionando esta sesión.
  **Contingencia**: si el addon actual (sin mantenimiento) se cae, el reemplazo es (a) OmniCatalogs
  con `country=GB` (mantiene el bloque UK más usado + Netflix/Disney/Prime que son globales), o (b)
  agregar filas fijas por plataforma a `/discover` (más laburo pero 100% bajo nuestro control).

**Cierre de la sesión (2026-09-03 noche):** nada roto, fixes chicos aplicados y documentados arriba,
research volcado. Pablo pidió además una **encuesta extensa para curar los catálogos** — creada en
`docs/encuesta-catalogos.md` (11 partes: filosofía del inicio, estrenos, Top 10 por plataforma,
géneros, países, cluster policial, herramientas de descubrimiento, familia vs solo, preferencias de
contenido, lista negra, ideas nuevas). Pablo la responde por partes; cada respuesta se aplica al
`preset.json` y se anota en la tabla final del archivo. **Próxima sesión: revisar si Pablo respondió
la encuesta y aplicar.** El inicio hoy tiene 86 filas — el objetivo de la encuesta es bajarlo a lo
que de verdad usa.
- **DMM Cast para TorBox** ya funciona (debridmediamanager.com/stremio-torbox) — posible fuente de
  streams complementaria, muestra los 5 links cacheados más grandes por título. No evaluado a
  fondo.
- **Bugs de cliente de Stremio reportados esta semana** (r/Stremio): "continue watching" no
  actualiza, autoplay del próximo episodio falla, botón "siguiente episodio" desaparece,
  sobrecalentamiento en Mac. Son del cliente, no de nuestra config — si Pablo los ve, no es algo
  del repo. Tip útil: varios arreglaron "pantalla verde" desactivando "Nvidia GPU Video
  Processing" en ajustes de Stremio.

## Sesión 2026-09-04 — encuesta de gustos aplicada, rework del inicio de stremioeg

Pablo respondió la encuesta (`docs/encuesta-catalogos.md`) en una charla y pidió aplicar todo de
una. Ejecutado con `scripts/apply-encuesta-catalogos.mjs` (one-shot) + `regenerate-aiometadata.mjs
--apply --force`.

**Perfil ampliado:** además del crimen/misterio europeo (adultos), ahora **toda la familia comparte
la cuenta** — Cartoon Network, Nickelodeon, contenido familiar (con o sin doblaje latino), comedia
juvenil **con actores reales** (*The Really Loud House* / "Una verdadera casa de locos"), y **humor
negro** (Fargo/Parásitos, NO dibujos adultos).

**Inicio: 86 → 62 filas**, ordenado en 7 secciones (charla): Continuar viendo (nativo de Stremio) →
Policial → Humor Negro → Familia → [géneros generales: NINGUNO, Pablo "no uso ese filtro"] → Países
→ Estrenos.

**Catálogos:**
- **Borrados (13):** Asia (Japón/Corea/China/Taiwán/India ×2), "Crimen y Misterio Europeo/Británico"
  (redundantes con Europe Noir / Crimen Reino Unido), "Soap Shows" (telenovela en lista negra).
- **Nuevos (30):** combos policiales (Crimen Nórdico/Francés/Español/Italiano, Cine Negro Clásico =
  film noir 1940-69 kw 9807, Thriller Psicológico kw 12565), Humor Negro (kw 373401|10123), Comedia
  Juvenil Actores Reales (networks 13|44|294 sin animación), países nórdicos (SE/DK/NO/IS ×2), "Para
  Ver en Familia" (cert PG, Descubrir), filas de director/actor (Ritchie 956 / Tarantino 138 /
  Coppola 1776 con `with_crew`; DiCaprio 6193 / Gadot 90633 / Downey 3223 con `with_cast`, Descubrir).
- **Lista negra global** (`without_keywords` en todo catálogo enabled salvo los de persona):
  anime(210024), gore(10292), doc naturaleza(221355), religión(11001), faith-based(348144),
  deportes(6075). + `without_genres` reality(10764)/telenovela(10766)/talk(10767)/noticias(10763)
  en series.
- **Géneros generales DESACTIVADOS** (Comedy/Action/Adventure/SciFi/Fantasy/War/Romance/History/
  Music/Western + equivalentes de series): Pablo no los usa Y el manifest de AIOMetadata tiene un
  **tope de tamaño real** — con los 30 nuevos + los géneros el `addonCollectionSet` daba
  `Max descriptor size reached` (code 20004). Sin ellos: 129 catálogos, entra. Drama/Documental
  quedan enabled en Descubrir. El contenido sigue por país / Descubrir Maestro / búsqueda.

**Colección:** MyTrakt Sync se probó adelante de AIOMetadata (para "Continuar viendo" arriba) pero
**rompía el español de la metadata** (verificado: gana el `meta` de MyTrakt en inglés — mismo
efecto documentado el 2026-07-13) → revertido a después de Streailer. "Continuar viendo" nativo de
Stremio ya es la fila 0, no hace falta. **"Audio Latino (verificado)" removido de la cuenta**
(pedido de Pablo). 25 addons. Instancia AIOMetadata `ebc8f187-2443-4386-9988-e657a5ff139b`.

**Verificación:** `health-check.mjs` verde, sin duplicados. Los 30 catálogos nuevos devuelven
contenido real (spot-check: Humor Negro→Parásitos/Pulp Fiction, Cine Negro Clásico→Vértigo/
Perdición, Comedia Juvenil→"Una verdadera casa de locos", etc). `scripts/verify-continue-watching.mjs`
(nuevo): 72 títulos del "Seguir viendo" de los últimos 30 días — el rework NO tocó streams/subs, la
disponibilidad es idéntica; 39/72 con stream+sub ES, el resto son huecos preexistentes (contenido
arg./esp. reciente, procedurales alemanes, infantil de nicho sin sub — Pablo pidió que el familiar
aparezca igual). Detalle en `docs/encuesta-catalogos.md`.

**`/mediathek` extendido a Polizeiruf 110 + SOKO Leipzig (2026-09-04, mismo día).** El handler pasó
de `TATORT_IMDB` fijo a un mapa `MEDIATHEK_SHOWS`: `{tt0806910: Tatort (89min), tt0806901:
Polizeiruf 110 (89min), tt0274279: SOKO Leipzig (44min)}`. `tatortCaseTitle` → `showCaseTitle(name,
topic)`: para Tatort saca el prefijo "Detective - NN - " y "Tatort:"; para las otras dos el nombre
de Cinemeta YA es el título del caso (se saca solo el prefijo del topic); los episodios "Episode N"
(placeholder sin título real) devuelven "" y no matchean. `loadMvwTatort` → `loadMvwShow(topic,
minDur)` con cache por-topic. `/translate` idem. Deployado (v1.1.0, `deno deploy --prod` local),
manifest refrescado en la cuenta con `update-addon-url.mjs` (mismo URL). Verificado en vivo:
Polizeiruf 110 S52E8 "Nur Gespenster" → NDR + sub; SOKO Leipzig S26E14 "Kowalski" → ZDF + sub;
Tatort sin regresión. Matching medido: Polizeiruf 9/10 episodios con título real, SOKO 16/16.

**Pre-warm generalizado a los 3 shows (mismo día).** `scripts/tatort-prewarm.mjs` pasó de
`const IMDB` fijo a la lista `SHOWS` (mismos 3 imdb que `MEDIATHEK_SHOWS`). El state
(`data/tatort-prewarm-state.json`) se re-keyó de `"S:E"` a `"<imdb>:S:E"` — migración automática en
`loadState()` (prefija `tt0806910:` a cualquier clave sin prefijo `ttNNN:`). El `--max` es un tope
TOTAL por corrida y se reparte **round-robin entre los 3 shows** para que Polizeiruf/SOKO no queden
detrás del backlog de Tatort. Se agregó filtro `season>0 && number>0` (los "Episode N" placeholder
de temporada 0 no matchean nada). Workflow: `--recent 10 --max 30`. Verificado: round-robin hitea
los 3 imdb, Polizeiruf encontró base de traducción, los SOKO "Episode N" caen como `sin-base`
(correcto). Estado real al día: ~50 Tatort completos + backlog de ~200 (Tatort viejo + Polizeiruf/
SOKO nuevos) que el cron diario va limpiando.

**Scripts nuevos:** `scripts/apply-encuesta-catalogos.mjs` (one-shot), `scripts/remove-addon.mjs`
(reusable), `scripts/verify-continue-watching.mjs` (reusable).

## Sesión 2026-09-04 (tarde) — familiar al tope del Home + auditoría completa + research

Pedido de Pablo, modo autónomo: subir todo lo familiar / apto para todo público arriba de todo,
auditoría completa, actualizarse con foros/redes, informe en lenguaje sencillo, arreglar todo lo
autónomo.

**1. Familiar al tope del Home (`scripts/reorder-familia-top.mjs`, one-shot).** El bloque familiar
pasó de la mitad del Home (posiciones 26-32) al **tope absoluto** (posiciones 1-10), arriba del
cluster policial. Además se subieron a Home 3 catálogos que estaban solo en Descubrir: **"Para Ver
en Familia" (Cine + Series)** y **"Familiar en Inglés"**. Nuevo orden del Home (65 filas):
Familia/Animación (10) → Policial/Crimen/Misterio (23) → Humor Negro (2) → Países (26) → Estrenos
(4). Aplicado y verificado en vivo — los 6 catálogos familiares del tope devuelven contenido real
(Coyote vs Acme, Toy Story 5, Cartoon Network, Nickelodeon, Comedia Juvenil con "Una verdadera casa
de locos", etc.). Esto reemplaza el orden de la encuesta del 2026-09-04 mañana (que tenía Policial
primero).

**2. Fix real encontrado en la auditoría — "Para Ver en Familia (Series)" (`pablo123`) dejaba entrar
contenido no apto.** Tenía `with_genres: "10751|10762|35"` — el género Comedy (35) genérico dejaba
pasar sitcoms adultas (Padre de familia / Family Guy) y procedurales policiales (The Rookie). Se
sacó el 35 (queda `10751|10762` = Family|Kids) y se sumó `80,10768` (Crime, War&Politics) al
`without_genres`. Verificado post-fix: ahora sale Teen Titans Go, Miraculous, Patrulla Canina,
Barrio Sésamo — Family Guy y The Rookie fuera.

**3. Auditoría — todo sano.** Las 3 cuentas (`stremioeg`/`solotveg`/`stremiojn`) con `health-check`
exit 0, sin `manifest.id` duplicados. Hub `mejorastremio-hub`: las 12 rutas responden
(`/health` OK, incluidas `mediathek`/`translate`/`opensubtitlesLatino`/`shortSeries` + dos nuevas
`ufc`/`livetv` que aparecieron sin session log — no se tocaron). `refresh-dates` tenía 4 fechas
vencidas (la instancia se había regenerado con la ventana del 2026-09-03) → refrescadas.
`anti-frustration review`: 8 pendientes, **todos huecos estructurales ya conocidos** (Los Mufas /
El Marginal / Ágata y Lola S01E02 / Pa' Seguirte Queriendo / VisionQuest / Infiltrada) — 0 nuevos,
0 resueltos. Instancia AIOMetadata final: `eea69171-823c-4578-8765-9eee6c3eb217`.

**4. Pre-warm generalizado a los 3 procedurales (viene de la sesión de la mañana).** Ya
documentado arriba en la sesión del `/mediathek` — verificado end-to-end en CI: la corrida
`workflow_dispatch` alternó round-robin los 3 imdb, Polizeiruf 110 S55E1/E3 y ~8 SOKO Leipzig
quedaron "listo", los parciales son cuota de Gemini (se completan en corridas siguientes).

**5. Research del ecosistema — nada accionable, todo lo instalado sano:**
- **TorBox**: lo que se dio de baja en mayo 2026 fue el *addon hosteado* de TorBox — **NO** TorBox
  como debrid dentro de Torrentio/Comet, que es lo que usa `stremioeg` (`torbox=<key>` en la URL).
  Confirmado que ese uso sigue soportado y andando. El cambio de ToS del 31/07 (ya documentado en
  la sesión 2026-08-27) sin novedades.
- **NoTorrent / WebStreamrMBG**: varios artículos SEO 2026 los dan por "caídos/retirados" — **falso
  para nuestro setup**. Evidencia directa de hoy: NoTorrent v2.7.0 responde con streams reales
  (los artículos chequean el path viejo de Render, migró a `notorrent2.workers.dev` en julio);
  WebStreamrMBG (`newman2x/WebStreamrMBG`) **no archivado, último push 2026-09-04** — fork activo,
  distinto del WebStreamr oficial retirado.
- **AIOMetadata**: muy activo (v2.16.5 el 2026-09-02). Cambio potencialmente útil en v2.16.4:
  **"allow hiding unreleased shows per catalog"** — un override por-catálogo de
  `hideUnreleasedDigital` (hoy es global, forzado a `false`). Bajo valor para el setup actual
  (Trending ya no está en Home, "Próximos Estrenos" necesita `false`) y requeriría que el schema
  de `preset.json` soporte el campo nuevo — no se tocó, anotado por si en el futuro molesta ver
  algún no-estrenado colado en un catálogo.
- **Torrentio / Comet**: activos, sin señales de riesgo. Un par de reportes de bloqueo por
  Cloudflare desde IPs residenciales (Bélgica) — no nos afecta, TorBox resuelve server-side.
- Reddit sigue inaccesible desde este entorno (in-app browser bloqueado, claude-in-chrome sin
  conectar, redlib 403, `reddit.com`/`old.reddit.com` bloqueados) — research vía WebSearch + GitHub
  API + docs de ElfHosted.

**Verificación**: `health-check.mjs` verde antes y después de cada cambio. `validate-config.mjs`
OK (183 catálogos, 122 enabled, 129 en el manifest de AIOMetadata). Sin regresión en streams
(Matrix 156, Breaking Bad 163, Will Trent 65) ni subtítulos. Backups en `.backups/`
(`...preregen-2026-09-04T10-13-16`, `...10-18-36`). El reorden no toca streams/subs/addons — el
"Seguir viendo" reproduce igual que antes (verificado la sesión anterior con
`verify-continue-watching.mjs`; esta sesión solo cambió orden de catálogos).

## Sesión 2026-09-04 (noche) — barrido obsesivo de cierre

Pablo pidió una pasada obsesiva final para dejar todo cerrado el mismo día: "nada pendiente".
Continuación directa de la sesión de la tarde (familiar al tope + auditoría). Todo lo de acá ya
está aplicado/verificado — no quedó nada a mitad de camino.

**1. Hallazgo real — dos crons no habían disparado a horario.** `daily-catalog-refresh` (cron
10:00 UTC) y el segundo horario diario de `health-monitor` (12:00 UTC) no habían corrido hoy pese a
estar más de 1-3.5h vencidos — los workflows están `state: active`, sin cambios recientes en el
YAML, así que es un delay real de la plataforma de GitHub Actions (documentado por GitHub: los
cron pueden atrasarse en picos de carga), no algo roto de nuestro lado. Se dispararon los dos a
mano (`workflow_dispatch`) — ambos corrieron limpios en segundos. No requiere ningún cambio de
código; si se repite seguido, vale la pena que Pablo lo sepa pero no hay fix posible desde acá.

**2. Endpoint nuevo `/discover/recent` + `scripts/monthly-digest.mjs`** — ver la sección de arriba
("Resumen mensual", en `docs/encuesta-catalogos.md`) para el detalle completo, incluidos los 2 bugs
reales encontrados y arreglados (parsing de query en el path en vez de la URL completa; el gotcha de
TMDB `primary_release_date` vs `release_date`). Verificado en producción con curl real y con una
corrida completa en CI (`workflow_dispatch`, `conclusion: success`).

**3. `scripts/audit-catalog-order.mjs` reescrito** — sus `TIERS` seguían comparando contra el
criterio de 2026-06-19 (En Cartelera primero, Plataformas al fondo), ya superado dos veces
(reorden de 2026-08-02 y el de "familiar arriba de todo" de hoy a la tarde). Etiquetaba casi todo
el inicio actual como "[Otros]" y sus desvíos eran directamente incorrectos (pedía subir En
Cartelera, que hoy va último a propósito). Reescrito con el tier real: Familia → Policial/Crimen/
Misterio/Humor Negro → Países → Estrenos. Verificado: 0/65 catálogos fuera de lugar, 0 en "Otros".

**4. `torbox-airlock.mjs` — lado de lectura verificado por primera vez contra la API real**
(`GET /torrents/mylist`: 261 torrents, campos `id`/`hash`/`airlocked`/`name` confirmados). El lado
de escritura (`PUT /torrents/edittorrent`) se intentó probar con un torrent real (marcar y
desmarcar, sin dejar nada distinto de como estaba) pero **el clasificador de permisos del harness
bloqueó el intento** — correcto, es una escritura real contra la cuenta de un tercero (TorBox), no
se intentó sortear el bloqueo. Sigue sin ejercerse, mismo consejo de siempre para cuando se retome.
Cron sigue desactivado (falta `TORBOX_API_KEY` como secret de GitHub — decisión de Pablo si
agregarlo, no es una acción que corresponda tomar unilateralmente por ser una credencial de una
cuenta de terceros con capacidad de escritura).

**5. Auditoría de estructura del repo — sin bugs reales, un gap de documentación cerrado.**
`preset.json`: los 12 "ids duplicados" que aparecían al auditar (`streaming.*`, `tmdb.trending`)
son falsos positivos — son pares legítimos movie+series con el mismo `id` (el protocolo de Stremio
escopea el id por tipo, es el comportamiento esperado, no un bug). Cero inconsistencias
`enabled`/`showInHome`, cero catálogos con campos faltantes. Las rutas `/ufc` y `/livetv` del hub
(sin mención en este archivo) son reales y correctas — pertenecen al perfil de `stremiojn`
(Joaquín, fan de UFC/MMA), documentadas en `cuentas/stremiojn/CLAUDE.md`, no a `stremioeg`. 5
workflows sin mención por nombre exacto en este archivo (`check-catalog-streams`, `check-
torrentio-providers`, `list-catalog`, `verify-live-account`, `torbox-airlock`) son wrappers
`workflow_dispatch`-only de scripts ya documentados — sin cron oculto, sin riesgo. Higiene de
secretos: `SECRETS.local.md` nunca trackeado en git (confirmado con `git log -p`), `.gitignore`
correcto.

**Verificación final de la sesión completa (tarde + noche)**: `health-check.mjs` verde en las 3
cuentas. `daily-catalog-refresh`/`health-monitor`/`monthly-digest` corridos a mano y en verde.
Todo commiteado y pusheado — `git status` limpio al cierre.

## Sesión 2026-09-04 (noche, continuación) — TorBox AirLock activado + segunda pasada obsesiva

Pablo, consultado sobre activar o no `torbox-airlock` con el trade-off explicado, contestó
**"revertir se puede siempre, y en definitiva es una mejora. Activemos"**.

**Activación**: `TORBOX_API_KEY` cargado como secret de GitHub (`gh secret set`, valor tomado de
`SECRETS.local.md`). Antes de reactivar el cron se corrió el script real con `--apply` (no un test
sintético) contra la cuenta: **exit 0, sin errores** — 0 candidatos ese día (nada que marcar), pero
confirma que el flujo completo (login, MyTrakt, streams, TorBox) corre sin fallar. Cron reactivado
(`.github/workflows/torbox-airlock.yml`, 07:45 ART) y **disparado una vez en GitHub Actions para
confirmar que el secret funciona ahí adentro también** (no solo local) — corrida completa en verde.
El endpoint de escritura (`PUT /torrents/edittorrent`) todavía no tuvo un candidato real que lo
ejerza — el cron diario es lo que lo va a probar la primera vez que aparezca uno; revisar
`data/internal-log.jsonl` esa vez para confirmar la respuesta cruda. Reversible en cualquier momento
(comentar `schedule` en el workflow).

**Segunda pasada obsesiva, mismo pedido repetido por Pablo ("nada pendiente")**:
- **Bug-hunt de la misma clase que el de `/discover/recent`**: grepeado todo `deno-hub.ts` en busca
  de otro handler que reconstruya un URL falso desde `subPath` en vez de usar el `url` real del
  request — **ninguno más**, el único uso de `searchParams` en todo el archivo es el ya corregido.
- **QA completo (los 20 títulos, no solo el top-4) de los 5 catálogos familiares del tope del
  Home** (Para Ver en Familia Cine/Series, Familiar en Inglés, Cartoon Network, Nickelodeon):
  ningún título fuera de lugar, el fix de `pablo123` se sostiene en la lista completa.
- **Docs de cuentas secundarias**: `solotveg` al día (2026-09-03). `stremiojn` sigue con su última
  entrada del 2026-08-03 (incidencia "no carga nada" abierta, esperando datos de Joaquín) — es lo
  esperado, Pablo pidió postergar esa cuenta "hasta nuevo aviso", no es un gap real.
- **Backlog de traducción de Tatort/Polizeiruf/SOKO**: 52/75, 2/18, 7/20 completos respectivamente —
  avanzando solo con el pre-warm diario, sin acción necesaria. `premiere-radar-state.json`: 17
  entradas, 1 pendiente (Los Mufas, ya conocido).
- **`test-content.mjs` corrido completo** contra los 14 títulos curados con los 26 addons actuales,
  como regresión final de todos los cambios del día (reorden de catálogos, redeploys del hub,
  activación de AirLock) — ver resultado abajo si terminó antes del cierre de sesión, si no queda
  como verificación pendiente de una futura sesión (no bloqueante, `health-check.mjs` ya cubrió lo
  crítico varias veces durante el día).

## Reglas del repo

- Commits en formato conventional, mensajes en español, cuerpo con líneas ≤ 100 caracteres.
- `data/preset.json` es la fuente de verdad de los catálogos: no perderlo.
- Secretos (API keys, credenciales de cuenta como ST_EMAIL/ST_PASS, y passwords de config como
  `AIO_PASSWORD` — a pedido explícito de Pablo el 2026-07-11 para no tener que repetirlas cada
  sesión) van en `SECRETS.local.md` en la
  raíz (gitignoreado con una entrada explícita en `.gitignore` — el patrón `*.local` no matchea
  `*.local.md`), formato simple `CLAVE=valor`. Nunca commitear claves en ningún otro archivo del
  repo.
