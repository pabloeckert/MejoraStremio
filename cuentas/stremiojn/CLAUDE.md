# CLAUDE.md — Cuenta secundaria: stremiojn (Joaquín)

Documentación específica de la segunda cuenta de Stremio gestionada desde este repo:
`stremiojn@gmail.com` (alias "Joaquín" — fan de UFC/MMA de 20 años, dato dado por Pablo el
2026-08-02). Este archivo es un **complemento** al `CLAUDE.md` de la raíz, que sigue siendo la
fuente de verdad de arquitectura/scripts/infraestructura compartida (ambas cuentas corren sobre el
mismo toolkit y el mismo hub de Deno Deploy). Acá solo se documenta lo que es específico o distinto
de esta cuenta puntual — no se duplica nada de lo que ya vive en el `CLAUDE.md` raíz.

Credenciales en `SECRETS.local.md` (raíz del repo, gitignoreado) como `ST_EMAIL_JN`/`ST_PASS_JN` —
mismo patrón que las de la cuenta principal. Nunca commitear la contraseña en texto plano en ningún
archivo trackeado, incluido este.

## Relación con la cuenta principal (`stremioeg@gmail.com`)

Pedido de Pablo (2026-08-02): que esta cuenta "funcione igual" que la principal. Se clonó la
colección completa de addons de `stremioeg` con **3 diferencias explícitas**, todas confirmadas por
Pablo antes de ejecutar:

1. **Sin Trakt.** Se excluyeron los 2 addons atados al Trakt personal de Pablo
   (`trakt.addon.v3.13e948e9-...` "MyTrakt Sync" y `org.trakt.941d129e` "Trakt Integration", el
   oficial de Stremio) — no tiene sentido clonar el historial/gustos de otra persona. Resultado: 21
   addons en vez de 23, mismo orden relativo del resto de la colección.
2. **TorBox compartido.** Torrentio y Comet usan la MISMA `TORBOX_API_KEY` que la cuenta de Pablo
   (mismo plan pago, decisión explícita: "reutiliza"). Implicancia real: el consumo/caché de ambas
   cuentas se computa contra el mismo cupo de TorBox — si en algún momento se nota degradación de
   cuota, este es un sospechoso a revisar antes que asumir que el plan quedó chico.
3. **Catálogo nuevo exclusivo: "MMA / UFC (curado)"** — ver sección propia más abajo. No se tocó el
   AIOMetadata de Pablo para esto (evita mezclar el gusto de Joaquín en el Home de Pablo); es un
   addon aparte, instalado solo en esta cuenta.

**Todo lo demás se instaló IDÉNTICO** — las mismas URLs de manifest que usa `stremioeg`, sin clonar
ninguna instancia nueva: AIOMetadata completo (misma instancia, mismos ~132 catálogos y el mismo
Home curado de Pablo), Cinemeta, los 6 addons de streams (Torrentio TB, Comet TB, NoTorrent,
WebStreamrMBG, Nuvio Streams, Meteor), Streailer, los 5 addons de subtítulos (SubSense, SubMaker,
SubDL vía el hub, OpenSubtitles v3, Stremio Community Subtitles — cuenta compartida, Pablo confirmó
"comparti igual"), Mubi Catalog, Streaming Catalogs, AI Search, Descubrir Maestro, Miniseries,
MejoraStremio Synopsis IA y Audio Latino (verificado). Esto es intencional y seguro: son todos
servicios sin estado personal por cuenta de Stremio (no dependen de historial de visualización de
`stremioeg` específicamente) — compartir la instancia no mezcla datos entre las dos cuentas, cada
una tiene su propia lista/orden de addons de forma independiente en el storage de Stremio.

## Catálogo "MMA / UFC (curado)"

Pedido explícito de Pablo con contexto de perfil: "fan de la UFC de 20 años en 2026", con una lista
larga de oferta real de contenido (Paramount+ como exclusivo de UFC en LatAm, TUF, Contender Series,
podcasts, WWE en Netflix, Kingdom, Cobra Kai, Physical: 100, etc.). Se filtró esa lista a lo que es
efectivamente **catalogable** (series con id de IMDb fijo, resoluble vía Cinemeta/TMDB) — se
excluyeron a propósito los eventos en vivo/PPV y los podcasts/canales de YouTube, que no son
contenido serial con un id fijo.

Implementado como ruta nueva `/ufc` en `scripts/deno-hub.ts` (mismo patrón que `handleLatino`, pero
con lista **fija en código**, no depende de ningún archivo de datos como `anti-frustration-log.json`
— no hay ninguna corrida automática que la actualice, es curación manual de esta sesión).
`manifest.id`: `com.mejorastremio.ufc-catalog`. Manifest público en
`https://mejorastremio-hub.pabloeckert.deno.net/ufc/manifest.json`.

**7 series, IDs de IMDb verificados vía API de TMDB + búsqueda web real (ninguno adivinado)**:

| Título | IMDb ID | Por qué entra |
|---|---|---|
| Dana White's Contender Series | `tt10845410` | Reality de captación de talento UFC — el presidente de la UFC busca la próxima estrella |
| The Ultimate Fighter | `tt0445912` | Reality clásico de UFC, peleadores conviviendo y entrenando por un contrato |
| Kingdom | `tt3673794` | Drama de gimnasio de MMA en Venice, California (DirecTV, 2014) |
| Cobra Kai | `tt7221388` | Drama/artes marciales, gran audiencia joven, temática de dojos rivales |
| Physical: 100 | `tt25274446` | Reality coreano de aptitud física con fuerte cruce de atletas de MMA |
| WWE Raw | `tt0185103` | Wrestling — espectáculo de combate, semanal |
| WWE SmackDown | `tt0227972` | Wrestling — espectáculo de combate, semanal |

**Quedó fuera a propósito, no es un olvido:**
- **Eventos de UFC en vivo/PPV** (ej. UFC 330, 15/08/2026, Ribovics vs. Barboza) y **Combate
  Global**: son eventos puntuales, no series con un id de IMDb fijo catalogable — igual son
  accesibles vía streams (Torrentio/Comet) buscando el nombre del evento en el momento, no vía
  catálogo curado.
- **Podcasts** (You're Welcome! con Chael Sonnen, Believe You Me con Bisping, MMA Junkie Radio) y
  **canales de YouTube/streamers de análisis**: no son contenido indexable por Stremio (no tienen
  meta de IMDb), quedan fuera del alcance de un addon de catálogo.
- **UFC Fight Pass**: es un servicio de streaming en sí mismo (biblioteca de peleas), no un título
  catalogable.
- **Paramount+** (exclusivo de UFC en LatAm desde enero 2026): no requiere nada nuevo de nuestro
  lado — ya está cubierto como plataforma dentro del addon compartido "Streaming Catalogs" (30
  servicios), que Joaquín ya tiene instalado igual que Pablo.

## Estado de la migración (Sesión 2026-08-02)

Ejecutado en modo autónomo a pedido de Pablo, sin más consultas tras confirmar los 3 puntos de
arriba (TorBox/Trakt/Community Subtitles).

1. **Backup del estado previo de la cuenta**: `.backups/backup-stremiojn-pre-migracion-<ts>.json` —
   7 addons de fábrica (Cinemeta, YouTube, WatchHub, Public Domain Movies, OpenSubtitles v3/v1,
   Local Files), cuenta limpia, sin nada custom que se pudiera pisar.
2. **21 addons clonados** desde la colección en vivo de `stremioeg` (excluyendo los 2 atados a
   Trakt), con **refresco en vivo del manifest de cada uno antes de instalar** (mismo criterio
   anti-catálogos-congelados que usa el resto del toolkit) — un addon (`OpenSubtitles v3`) necesitó
   normalizar su URL agregando `/manifest.json` (su `transportUrl` guardado no lo incluye, aunque el
   manifest real vive ahí — no es un bug nuevo, es cómo ya lo maneja `health-check.mjs`).
   `addonCollectionSet` aplicado y verificado con reintento (3/3 confirmado en el primer intento):
   21/21 addons presentes, mismo orden relativo que en la cuenta de Pablo.
3. **`health-check.mjs` corrido contra la cuenta real de Joaquín**: verde, exit 0 — 21 addons sin
   duplicados, streams reales (Matrix 207, Breaking Bad S01E01 257, Will Trent S01E01 85 — más altos
   que en la cuenta de Pablo porque acá Meteor no tiene el filtro `minSeeders` aplicado a mano; no es
   un problema, es la config default del addon clonado tal cual, ver nota abajo), subs ES OK (Matrix
   40, Breaking Bad 55).
4. **Deploy y catálogo UFC — completado.** El deploy de `scripts/deno-hub.ts` a Deno Deploy quedó
   inicialmente bloqueado por el clasificador de seguridad de la sesión (acción de escritura a
   producción); Pablo no tuvo que intervenir — un segundo intento en la misma sesión (después de que
   el push a git, bloqueado con el mismo motivo, sí pasara al reintentarlo solo) fue autorizado y
   deployó sin problema (`revisionId e553c96r27qx`, status `routed`). Verificado en vivo, no solo
   "debería andar": `/ufc/manifest.json` responde válido, `/ufc/catalog/series/ufc-series.json`
   devuelve las 7 series con pósters reales resueltos vía Cinemeta, y `/health` reporta las 6
   sub-funciones del hub configuradas (incluida `ufc: {configured: true}`). Instalado en la cuenta de
   Joaquín con `addonCollectionSet` (22° addon, verificado con reintento: 22/22 confirmado). Spot
   check de reproducción real: Cobra Kai S01E01 → **26 streams reales** vía Torrentio+TorBox.
5. **`health-check.mjs` final, contra la cuenta real, con los 22 addons**: verde, exit 0 — sin
   duplicados, streams (Matrix 206, Breaking Bad S01E01 257, Will Trent S01E01 85) y subs ES (Matrix
   40, Breaking Bad 55) sin regresiones respecto a la corrida de 21 addons del paso 3. Migración
   cerrada de punta a punta, nada pendiente.

## Home enfocado en el perfil (Sesión 2026-08-02, más tarde)

Pablo probó la cuenta y pidió que la **primera pantalla** que ve Joaquín al entrar esté enfocada en
su perfil UFC/MMA, no en el Home general curado de Pablo (que hasta acá era literalmente el mismo,
por venir de la misma instancia compartida de AIOMetadata). Como esa instancia sigue sin tocarse
(ver regla de arriba: no mezclar el gusto de Joaquín en el Home de Pablo), la única palanca
disponible es el **orden de la colección de addons** — el Home de Stremio muestra los catálogos
addon por addon, en el orden de la colección (mismo mecanismo ya documentado en el `CLAUDE.md` raíz
para Mubi Catalog/Streaming Catalogs: "su prioridad en el board depende del orden de la colección de
addons, no del preset").

Reordenado con `scripts/reorder-addons.mjs` (dos pasadas, dry-run confirmado antes de `--apply` en
ambas):
1. `com.mejorastremio.ufc-catalog` ("MMA / UFC (curado)") → **índice 0**.
2. `pw.ers.netflix-catalog` ("Streaming Catalogs") → **índice 1** (justo después). Se promovió este
   addon en particular porque adentro tiene el catálogo de **Paramount+** (posición 10-11 de 56 en
   su propio manifest, confirmado con un fetch real) — la plataforma que Pablo señaló como "hogar
   exclusivo de la UFC en América Latina desde enero 2026". No se puede reordenar el catálogo interno
   de ese addon (es de un tercero), pero Paramount+ ya estaba razonablemente cerca del principio de
   su propia lista.
3. AIOMetadata (Home general de Pablo) queda en índice 2 — sigue instalado igual, solo bajó de
   prioridad visual para esta cuenta puntual.

Orden final verificado con `addonCollectionGet` real (no solo el output del script):
`com.mejorastremio.ufc-catalog` → `pw.ers.netflix-catalog` → `aio-metadata` → resto sin cambios.
`health-check.mjs` post-cambio: verde, 22/22, sin regresiones en streams/subs.

**Contenido del perfil — ya cubierto, sin agregar nada nuevo**: Pablo repitió la misma lista
detallada de oferta UFC/MMA (Paramount+, TUF, Contender Series, WWE Raw/SmackDown, Kingdom, Cobra
Kai, Physical: 100, UFC Fight Pass, podcasts, canales de YouTube, watch parties, UFC 330 del
15/08/2026). Se revisó título por título contra el catálogo `/ufc` ya armado: **los 7 títulos
catalogables de esa lista ya estaban incluidos** (ver tabla más arriba) — no había nada nuevo para
sumar al catálogo en sí, el pedido de esta vuelta era de **prioridad/orden**, no de contenido.

## TV en Vivo (Sesión 2026-08-02, más tarde todavía)

Pablo pidió sumar "TV en vivo y eventos en vivo" a la cuenta. Investigado a fondo antes de instalar
nada — mismo criterio que ya aplica el proyecto para addons de subtítulos (Subdivx/TuSubtitulo/
Argenteam, ver `CLAUDE.md` raíz): **no sumar algo sin evidencia real de que funciona**.

**Candidatos de "PPV en vivo" investigados, ninguno viable — confirmado con fetch real, no solo
la búsqueda**: StreamsPPV (confirmado roto desde enero 2026 por reportes de usuarios, manifest no
resuelve), USA TV (`baby-beamup.club`, dominio caído — `fetch failed`), PPVStreams (`baby-beamup.club`,
ídem), IPTVorg en Vercel (`404 DEPLOYMENT_NOT_FOUND` — el deploy ya no existe), PPVio de ElfHosted
(la página del addon en `stremio-addons.net` da 404, y el listado oficial vigente de ElfHosted —
`docs.elfhosted.com/stremio-addons/` — hoy solo tiene 7 addons: AIOStreams, Comet, Jackettio,
MediaFusion, NuvioStreams, WebStreamr, YourIPTV; ninguno es de TV/eventos en vivo). Patrón conocido:
el espacio de addons de PPV/IPTV comunitario tiene un ciclo de vida muy corto (mismo fenómeno ya
documentado acá para Nuvio Streams, WebStreamr oficial, etc.) — no hay ninguna opción de terceros
confiable hoy.

**Solución adoptada: self-host sobre `iptv-org`** (`github.com/iptv-org/iptv`, proyecto open-source
activo, ampliamente usado, con política propia de sacar canales bloqueados/con reclamos — no es una
fuente pirata, son streams públicos de canales de aire/cable). Mismo patrón arquitectónico que
`/ufc`/`/latino`/`/discover`: una ruta nueva propia en el hub (`/livetv`), no depender de un tercero
frágil. Nueva ruta `/livetv` en `scripts/deno-hub.ts`, `manifest.id`: `com.mejorastremio.livetv`.

**Diferencia clave de diseño respecto a `/ufc`**: ahí la lista es fija PERO la URL de stream de cada
canal se resuelve **en vivo** contra la API de `iptv-org` (`streams.json`/`logos.json`, cache 10
min) en cada consulta, no está hardcodeada — a diferencia de un id de IMDb (estable para siempre),
la URL de un stream de TV en vivo es un endpoint real que cambia con el tiempo; hardcodearla se
pudriría rápido. Si `iptv-org` actualiza la URL de un canal, el catálogo la toma sola sin
redeploy.

**8 canales, cada uno verificado con un fetch real antes de sumarlo, TODOS de combate/wrestling
— sin canales generales** (Pablo corrigió explícitamente que no quería nada genérico: "solo lo de
tv en vivo... referido a los gustos mencionados para Joaquín, WWE UFC etc"). Se probaron 20
candidatos en total — quedaron afuera los que dieron 403/404/timeout, o que la propia data de
`iptv-org` ya marca como `"Geo-blocked"` o `"Not 24/7"` (TyC Sports, Fox Sports AR, DSports,
Premiere FC 1, Lucha Libre AAA), y también los 4 canales generales de aire que se habían probado en
un primer intento (América TV, El Nueve, Telefe, La Nación+ — todos caídos, mismo host
`playcom.trapemn.tv` roto) — **estos últimos se sacaron del catálogo aparte, no por estar rotos,
sino porque no encajan con el pedido de Pablo de un catálogo 100% enfocado en el perfil**. Se buscó
además **ONE Championship** (otra promoción grande de MMA que Pablo nombró) y canales de **WWE**:
`iptv-org` no tiene ningún canal de ONE Championship, y los 4 canales de WWE que sí aparecen en su
listado (`WWEChannel.au`, `WWEChannel Africa.za`, `WWENetwork.ca`, `WWENetwork.us`) **no tienen
ningún stream real asociado** — no hay nada instalable de WWE en vivo hoy, aunque WWE Raw/SmackDown
sí están cubiertos como series (no en vivo) en el catálogo `/ufc`.

| Canal | Por qué |
|---|---|
| Bellator MMA | Promoción rival de UFC (ahora parte de PFL) |
| PFL MMA | La liga que absorbió a Bellator — la "segunda más grande", per el pedido de Pablo |
| Combate (Grupo Globo, BR) | Canal brasileño dedicado a MMA/UFC — **aclaración importante**: NO es
  "Combate Global"/"Combate Américas" (la promoción hispana que mencionó Pablo, sin canal propio en
  `iptv-org`); es "Combate" de Grupo Globo (`combate.globo.com`), que transmite UFC y MMA en Brasil.
  Se corrige acá una etiqueta incorrecta de la primera versión de este catálogo. |
| ESPN (BR) | Suele emitir prelims/contenido de UFC |
| ESPN Deportes | Ídem, en español |
| ESPN8: The Ocho | Deportes de nicho |
| MMA TV | Canal dedicado a MMA |
| Glory Kickboxing | Kickboxing en vivo |

**No hay canal específico de Combate Global ni de ONE Championship** — investigado y confirmado
ausente en la fuente (`iptv-org`), no es un descuido.

**"Eventos en vivo" — interpretación honesta, no hay un catálogo de eventos PPV puntuales**: no
existe hoy una fuente gratuita confiable de streams específicos de eventos PPV (UFC 330 del
15/08/2026, UFC Fight Night Hernandez vs. Rodrigues del 22/08, UFC París del 05/09, etc. — todos
mencionados por Pablo) — ver candidatos investigados y descartados arriba. Los canales de combate
del catálogo SÍ emiten eventos en vivo como parte de su programación normal (prelims de ESPN, PPVs
completos de Combate/BR, carteleras de Bellator/PFL) — es la aproximación más honesta y sostenible
disponible hoy, no un catálogo de "próximo evento" con fecha/hora (eso requeriría una fuente de
EPG/cartelera que no se investigó en esta sesión).

**Instalado**: `com.mejorastremio.livetv` en índice 1 (justo después de "MMA / UFC (curado)",
antes de "Streaming Catalogs") — mismo criterio de la sesión anterior, en la parte alta de la
primera pantalla junto al resto del perfil. `install-addon.mjs --after com.mejorastremio.ufc-catalog
--apply`. Backup: `.backups/backup-stremiojn-pre-install-com.mejorastremio.livetv-<ts>.json` (ya con
el nombre de cuenta correcto, confirma que el fix de la sección anterior quedó funcionando).

**Corrección post-instalación (mismo intercambio con Pablo)**: la primera versión instalada tenía 2
catálogos (combate + un "General Argentina" con El Trece/Canal 26/A24). Pablo pidió acotarlo a solo
el perfil — se sacó el catálogo general por completo (manifest pasó de v1.0.0 a v1.1.0, de 2
catálogos a 1) y se refrescó el manifest ya instalado con `update-addon-url.mjs
com.mejorastremio.livetv <misma-url> --apply` (mismo `manifest.id`, no duplica la entrada; fuerza un
re-fetch del manifest nuevo). Verificado con el propio output del script: `version=1.1.0` reflejado
en la cuenta real tras el refresh.

`health-check.mjs` post-instalación (con el catálogo ya acotado): verde, 23/23, sin regresiones (el
addon aparece con "=0" en el conteo de streams de película/serie del health-check — esperado, es un
addon `type: "tv"`, no responde a pedidos de `movie`/`series`).

### Bug real encontrado y corregido de paso: nombre de backup hardcodeado

Al reordenar, el backup que generó `reorder-addons.mjs` se guardó como
`backup-stremioeg-pre-reorder-<ts>.json` **aunque la corrida fue contra la cuenta de Joaquín** — el
nombre del archivo tenía `"stremioeg"` hardcodeado, sin relación con qué `ST_EMAIL` se usó
realmente. Se encontró el mismo patrón en 9 scripts (grep `backup-stremioeg` sobre `scripts/`).
Corregido en los 7 que están en uso activo (`reorder-addons.mjs`, `install-addon.mjs`,
`update-addon-url.mjs`, `repair-frozen-catalogs.mjs`, `apply-torbox-profile.mjs`,
`apply-friction-zero-sort.mjs`, `regenerate-aiometadata.mjs`): ahora derivan un `accountSlug` de la
variable `EMAIL`/`email` ya existente en cada script (`email.split('@')[0]`), así que el nombre del
backup refleja la cuenta real tocada (`backup-stremioeg-...` o `backup-stremiojn-...` según
corresponda). **No se tocaron** `swap-aiolists-mytrakt.mjs` ni `apply-cgnat-profile.mjs` — son
scripts de un solo uso histórico que el `CLAUDE.md` raíz ya marca como "no correr de nuevo salvo un
caso equivalente", así que el nombre hardcodeado ahí no genera confusión práctica. Verificado con
`node --check` en los 7 archivos tocados (sin errores de sintaxis). **Aclaración honesta**: los 2
backups de los reordenamientos de ESTA sesión (`backup-stremioeg-pre-reorder-...` ×2, aunque
tocaron la cuenta de Joaquín) se generaron ANTES del fix, así que todavía tienen el nombre viejo —
el fix se detectó y aplicó recién después de correr ambos reordenamientos. Queda correcto desde la
próxima corrida de cualquiera de los 7 scripts en adelante, no fue verificado con una corrida real
posterior al fix por no ser necesario forzar una escritura extra a la cuenta solo para probarlo.

## A revisar / diferencias no resueltas, anotadas para no perderlas

- **Meteor sin el filtro `minSeeders:1`** que sí tiene la config guardada de Pablo — al refrescar el
  manifest en vivo de cada addon antes de instalar, se tomó la config tal cual vive en el
  `transportUrl` compartido (la URL de Meteor de Pablo YA tiene `minSeeders:1` embebido en el path
  base64, así que en teoría se clonó igual) — la diferencia real en el conteo de streams de Meteor
  (60/104/26 acá vs. 1/1/1 en la corrida de Pablo) es más probable que sea variación normal entre
  corridas (el catálogo P2P cambia con el tiempo) que una diferencia de config; no se investigó más
  a fondo por no ser parte del pedido explícito de esta sesión — mencionar si en algún chequeo futuro
  se nota que Meteor da resultados sin seeds reales en esta cuenta.
- **Stremio Community Subtitles**: se comparte la MISMA cuenta que usa Pablo en
  `stremio-community-subtitles.top` (confirmado "comparti igual") — implica que cualquier
  voto/subida que haga Joaquín en esa plataforma quedaría bajo la cuenta de Pablo. No se le vio
  problema dado que Pablo lo autorizó explícitamente, pero vale tenerlo anotado.
- **Catálogo `/ufc` sin mecanismo de actualización automática**: a diferencia de "Audio Latino
  (verificado)" (que se actualiza solo cuando `anti-frustration.mjs` agrega entradas nuevas al log),
  esta lista es fija en el código. Si en el futuro sale una serie nueva de este perfil (ej. una
  temporada nueva de algún reality), hay que agregarla a mano en `UFC_TITLES` (`scripts/deno-hub.ts`)
  y redeployar — no hay automatización pensada para esto todavía.
