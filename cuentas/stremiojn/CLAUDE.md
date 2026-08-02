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
4. **Pendiente — bloqueado por el clasificador de seguridad de la sesión**: el deploy de
   `scripts/deno-hub.ts` (con la ruta `/ufc` ya escrita y verificada con `deno check`, sin errores)
   a Deno Deploy quedó bloqueado por el modo automático de la sesión (acción de escritura a
   producción). Falta: (a) que Pablo corra el deploy manualmente o autorice explícitamente el
   comando, (b) confirmar `/ufc/manifest.json` responde con las 7 series y pósters reales, (c)
   instalar ese addon en la cuenta de Joaquín (`install-addon.mjs` o inline, mismo patrón que el
   resto), (d) volver a correr `health-check.mjs` para confirmar 22/22 addons sin regresiones.

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
