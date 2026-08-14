# CLAUDE.md — Cuenta terciaria: solotveg (perfil juvenil/adolescente)

Documentación específica de la tercera cuenta de Stremio gestionada desde este repo:
`solotveg@gmail.com`, perfil juvenil/adolescente (hasta 17 años inclusive). Este archivo es un
**complemento** al `CLAUDE.md` de la raíz — acá solo se documenta lo específico o distinto de esta
cuenta, no se duplica arquitectura/scripts compartidos.

Credenciales en `SECRETS.local.md` (raíz, gitignoreado) como `ST_EMAIL_TEEN`/`ST_PASS_TEEN`.

## Origen — hallazgo y migración (Sesión 2026-08-13)

Pablo pidió configurar "la cuenta juvenil/adolescente" pasando credenciales por un archivo `.env`
suelto en la raíz del repo (`STREMIO_EMAIL`/`STREMIO_PASSWORD` + variables de perfil). Antes de
tocar nada se frenó por 3 motivos reales (no por exceso de cautela): la cuenta no estaba
documentada en ningún lado del proyecto (a diferencia de `stremiojn`), el `.env` **no estaba
gitignoreado** (contraseña en texto plano en riesgo real de commitearse), y el pedido de "cero
contenido sin doblaje latino no debe indexarse" no es técnicamente alcanzable como filtro de
catálogo automático (ver sección de audio más abajo). Pablo confirmó la cuenta, pidió migrar el
`.env` a la convención del repo, y ajustó el pedido de audio a algo realmente alcanzable.

**Migrado**: credenciales → `SECRETS.local.md` (`ST_EMAIL_TEEN`/`ST_PASS_TEEN`), `.env` agregado a
`.gitignore` y borrado del disco (su contenido no-secreto — `MAX_AGE_RATING`, `ALLOWED_RATINGS`,
etc. — queda documentado acá en texto en vez de como variables de entorno sueltas, no hay ningún
script que las lea como config).

## Estado al momento de migrar — la cuenta NO estaba virgen

A diferencia de `stremiojn` (que arrancó con los 7 addons de fábrica sin tocar), esta cuenta ya
tenía **20 addons instalados de forma orgánica** (no por este proyecto), varios ya descartados en
este mismo repo por motivos documentados:

| Addon removido | Motivo |
|---|---|
| GTSubs | Ya documentado como "Removido 2026-06-21" en el `CLAUDE.md` raíz — addon conocido roto |
| Tu Subtitulo | Confirmado muerto en este mismo repo (2026-07-12): repo sin commits desde 2023, sitio fuente 403, 0 subs incluso en Breaking Bad |
| MediaFusion \| ElfHosted | Requiere debrid de pago propio — descartado repetidas veces en este proyecto por el mismo motivo |
| Primer Latino | Servicio de pago (~US$2.45/mes, `manifest.id` literalmente `SIN-PREMIUM`) — ya evaluado y descartado el 2026-07-12 |
| opensubtitles PRO | Ya documentado como "Removido; usar OpenSubtitles v3" |
| SubSource Subtitles | Redundante — SubSource ya es una de las fuentes agregadas dentro de SubSense |
| stremio-addons.net | Catálogo-directorio de addons, no contenido — ruido |
| WatchHub, Public Domain Movies, Local Files, OpenSubtitles (v1) | Extras de fábrica de bajo valor frente al stack curado que se instaló |
| Torrent to weblink | Addon de origen no verificado, sin evidencia de calidad/mantenimiento |
| Clockrr (Top Right) | Widget de reloj, sin relación con contenido |
| Torrentio (bare, sin TorBox/latino) | Reemplazado por la versión ya configurada con TorBox + prioridad latino |
| YouTube Trailers | Confirmado roto en esta sesión: `HTTP 402 Payment Required` consistente (cuota de Vercel del desarrollador agotada, no un blip — instalado brevemente y sacado en la misma sesión) |

**Se conservaron sin tocar** (ya estaban bien configurados, mejor de lo que se habría armado desde
cero): `YouTube` (oficial, `com.linvo.stremiochannels`) y `YouTubio \| ElfHosted` — ver sección de
YouTube más abajo.

Backup del estado previo: `.backups/backup-solotveg-pre-migracion-2026-08-14T00-32-57-582Z.json`.

## Arquitectura — clonada de `stremioeg`, sin Trakt personal

Mismo criterio que `stremiojn`: se clonaron los 21 addons base de la cuenta principal
**excluyendo** los 2 atados al Trakt personal de Pablo (`trakt.addon.v3.13e948e9-...` "MyTrakt
Sync" y `org.trakt.941d129e` "Trakt Integration") — no tiene sentido heredar el historial/gustos de
otra persona. Se sumaron los 2 addons de YouTube ya buenos que la cuenta traía. Total: **23
addons**, refrescados en vivo antes de instalar (mismo criterio anti-catálogos-congelados que usa
todo el toolkit).

**TorBox compartido**: Torrentio y Comet son literalmente la MISMA entrada (mismo `transportUrl`,
mismo `manifest.id`) que usa `stremioeg` — no se reconstruyó ningún parámetro a mano, se copió tal
cual. Esto significa que ya traen: TorBox con la key de Pablo (mismo cupo compartido, igual que en
`stremiojn` — si se nota degradación de cuota en el futuro, revisar acá también), 24 proveedores,
`qualityfilter` sin 4K/480p (dogma "calidad gana a cantidad" del 2026-08-02), y **prioridad
`language=latino`** en Torrentio + **`preferred:["la","en"]`** en Comet.

**AIOMetadata compartido**: misma instancia que usan `stremioeg`/`stremiojn` (mismos ~132
catálogos, mismo Home general de Pablo). No se creó una instancia separada — ver limitación
pendiente sobre el filtro de edad más abajo.

Verificado con `health-check.mjs` (`ST_EMAIL=solotveg@gmail.com ...`): 23/23 addons, sin
duplicados, streams (Matrix 160, Breaking Bad S01E01 206, Will Trent S01E01 80) y subs ES (Matrix
40, Breaking Bad 55) reales, sin regresiones.

## Audio latino/argentino — mismo mecanismo que la cuenta principal, con el mismo límite real

Pedido original: "cero contenido sin doblaje latino/argentino no debe indexarse". **No es
alcanzable como filtro automático de catálogo** — ya investigado a fondo en el `CLAUDE.md` raíz
("Subtítulos, variante latino vs. España"): ni TMDB Discover (lo que arma los catálogos) ni ningún
addon de streams tiene un campo "tiene doblaje verificado" filtrable a nivel catálogo — esa
información solo existe (a veces) en el nombre de archivo de un stream puntual, después de abrir el
título. Pablo confirmó esto y ajustó el pedido a algo real: **prioridad estricta a nivel addon**
(banderitas/texto/"Dual-Lat"/"multilingual" en el nombre del release), que es exactamente lo que ya
trae Torrentio (`language=latino`) y Comet (`preferred:["la","en"]") heredado de `stremioeg` — sin
cambios adicionales, ya está aplicado.

**Límite que sigue sin solución técnica** (mismo ya documentado, no reinvestigado de nuevo):
ningún addon distingue `es-419` (latino genérico) de `es-AR` (argentino específico) — ambos caen
bajo el mismo tag "latino"/🇲🇽 que usan los releases. No hay forma de priorizar Argentina por
separado de "Latinoamérica" en general.

**Catálogo curado ampliable**: mismo patrón que "Audio Latino (verificado)" — se puede ir sumando
títulos verificados con `anti-frustration.mjs add <id>` a medida que se identifiquen, igual que se
hizo con Regular Show para la cuenta principal.

## YouTube — ya estaba bien resuelto, no se reconstruyó

La cuenta ya traía la combinación correcta, mejor de lo que se habría armado desde cero:

- **`YouTube` (oficial, `com.linvo.stremiochannels`)**: navegación por canal/género. Su propia
  descripción, tal cual la expone el manifest: *"Watch your favourite YouTube channels ad-free and
  get notified when they upload new videos."* — confirma "sin publicidad" con la fuente oficial del
  addon, no una suposición.
- **`YouTubio \| ElfHosted`**: resuelve los streams reales. Config ya embebida en su URL:
  `dearrow:1` (títulos/miniaturas menos clickbait, crowd-sourced) y `sponsorblock` activado para
  **8 tipos de segmento** (sponsor, self-promo, interacción, intro, outro, preview, hook, filler) —
  es decir, salta publicidad/segmentos patrocinados DENTRO del video, no solo pre-roll. Catálogo
  `Video` hace búsqueda libre estilo YouTube (con orden por fecha/vistas/relevancia) y catálogo
  `Channel` busca canales.

**Sobre "posibilidad de shorts"**: técnicamente reproducibles — YouTubio resuelve cualquier ID de
video sin importar si es Short o formato largo, así que un Short que aparezca en una búsqueda se
puede abrir y ver igual. **Lo que no existe es un feed dedicado de scroll infinito de Shorts** —
eso es un choque estructural real entre el paradigma de Stremio (grilla de pósters) y el paradigma
de Shorts (swipe vertical), no algo que un addon de catálogo pueda resolver con config. Dato a favor
del perfil: la ausencia de ese feed de scroll infinito no es necesariamente una pérdida para un
perfil pensado para adolescentes.

## Log inteligente de visualización (Sesión 2026-08-13)

Pedido: poder ver qué mira más y qué más le engancha. Se investigó si hacía falta conectar Trakt
(cómo lo hace MyTrakt Sync) — **no hace falta**: la colección nativa `libraryItem` del datastore de
Stremio (accesible por API con el `authKey` de la cuenta, sin ningún addon de por medio) ya trae
tiempo total visto, veces completado y última vez visto por título. Confirmado empíricamente: a
diferencia de la colección `settings` (bloqueada con `"Sync disabled"`, ver `CLAUDE.md` raíz),
`libraryItem` respondió con datos reales sin restricción.

**`scripts/watch-log.mjs`** (nuevo, ver `CLAUDE.md` raíz): lee `libraryItem`, rankea por minutos
vistos y veces completado, imprime un resumen legible. Con `--save <slug>` además persiste un
snapshot fechado en `data/watch-log-<slug>.jsonl` (mismo patrón append-only que el resto de los
logs del proyecto).

```
ST_EMAIL=solotveg@gmail.com ST_PASS=... node scripts/watch-log.mjs --save solotveg
```

**Estado real al armar esto (transparencia, no inflar el resultado)**: la cuenta tiene muy poco
historial todavía — solo 2 títulos tocados, ambos el 2026-03-22, ambos vistos menos de un minuto y
marcados `removed`/`temp` (no quedaron en biblioteca): *Will Trent* y *The Dinosaurs*. No hay un
patrón real de "lo que más le gusta" para reportar todavía — el mecanismo está construido y
verificado, va a mostrar algo útil a medida que la cuenta se use de verdad. Primer snapshot ya
guardado en `data/watch-log-solotveg.jsonl`.

**No automatizado con un workflow propio todavía** (a diferencia de `anti-frustration-review.yml`)
— con el historial actual tan vacío no había nada que programar; si a futuro se quiere una corrida
periódica (ej. semanal, mismo patrón que el resto), es agregar un `.yml` que llame a este script con
`--save solotveg`, no hace falta tocar el script en sí.

## Filtro de edad (hasta 17, excluir R/NC-17/TV-MA) — implementado (Sesión 2026-08-13, cont.)

Cerrado en la misma sesión, después de investigar el código fuente real de AIOMetadata
(`github.com/cedya77/aiometadata`, `addon/utils/catalogFilters.ts` +
`configure/src/components/sections/FiltersSettings.tsx`) en vez de intentar reconstruirlo a mano
con parámetros de TMDB Discover:

**Hallazgo clave**: el addon ya trae un flag **global y nativo** `config.ageRating` (valores
válidos: `None`, `G`, `PG`, `PG-13`, `R`, `NC-17`) que se aplica automáticamente a **todos los
catálogos** (post-filtro sobre los resultados, no un parámetro de discover por catálogo). Jerarquía
real del código: pelis `[G, PG, PG-13, R, NC-17]`, series `[TV-Y, TV-Y7, TV-G, TV-PG, TV-14,
TV-MA]`, con mapeo automático interno `PG-13 → TV-14`. Con `ageRating: "PG-13"` se obtiene
exactamente lo pedido: pelis hasta PG-13 (excluye R/NC-17), series hasta TV-14 (excluye TV-MA) — no
hizo falta tocar cada catálogo, ni construir nada nuevo, es una sola línea de config.

**Contenido sin certificación cargada en TMDB queda excluido, a propósito** (comportamiento del
propio addon, no una decisión nuestra): si un título no tiene rating registrado, se trata como
"no verificado" y se descarta bajo un cap restrictivo. Es el mismo espíritu conservador que ya pidió
Pablo para el audio ("si no está confirmado, no debe aparecer") — coherente, no un efecto secundario
raro.

**Por qué instancia separada, no la compartida**: `ageRating` es un flag de instancia completa, no
por catálogo — aplicarlo a la instancia que comparten `stremioeg`/`stremiojn` le habría capado el
catálogo a Pablo también. Se creó una instancia AIOMetadata nueva y exclusiva para este perfil
(mismos ~119 catálogos que la compartida, **sin** tokens de Trakt/Simkl de Pablo — coherente con no
tener Trakt conectado acá) vía `AIO_PASSWORD` + `/api/config/save`. UUID:
**`208327a4-f8de-48a5-b186-aeeffce9814c`**, registrado en
`cuentas/solotveg/aiometadata-instance.json` (no en `data/preset.json`, que sigue siendo solo de la
instancia compartida). Instalada reemplazando el AIOMetadata heredado del clon inicial.

**Verificado con evidencia real, no solo "quedó configurado"** — diff de títulos entre la instancia
compartida (sin cap) y esta (con cap), mismo catálogo, mismo momento:
- "En Cartelera" (películas): 20 → 11 resultados. Excluidos: *La Odisea, Posesión infernal: En
  llamas, La muerte de Robin Hood, Soulm8te, Scary Movie, Lucky Strike, Leviticus, The Debt
  Collector* (perfil de títulos de terror/acción/adultos, consistente con un cap PG-13).
- "Top 10 Netflix Series": 10 → 8. Excluidos: *Extinction, Nando Between Two Worlds*.
- Búsqueda general por título: `matrix` → **0 resultados** en esta cuenta (correcto: The Matrix es
  R, el cap la excluye también de la búsqueda, no solo de los catálogos de Descubrir). `moana` → 3
  resultados (Vaiana/Vaiana 2), `cars` → 5 resultados — confirma que la búsqueda sigue funcionando
  normal para contenido apto, no está rota en general.

**Caveat honesto, inherente a cómo funciona Stremio, no arreglable desde acá**: el cap frena el
**descubrimiento** (Descubrir/Buscar/Home) — no bloquea la reproducción si alguien ya tiene/conoce
el id de IMDb de un título puntual y lo abre directo (los addons de streams resuelven por id,
sin pasar por el catálogo de AIOMetadata). Ningún addon de Stremio puede implementar control de
acceso duro por contenido a ese nivel — es una limitación estructural del protocolo, la misma razón
por la que tampoco existe un PIN parental nativo en este stack.

**`keep-warm.yml` extendido** para pingear esta instancia además de la compartida (antes solo
pingeaba `data/preset.json → instanceId`) — lee cualquier `cuentas/*/aiometadata-instance.json` que
exista, así que futuras cuentas con instancia propia quedan cubiertas automáticamente sin tocar el
workflow de nuevo.

Backup pre-cambio: `.backups/backup-solotveg-pre-aio-teen-2026-08-14T00-58-29-813Z.json`.
`health-check.mjs` contra esta cuenta muestra `✗ Búsqueda por título no devuelve resultados` de
forma **esperada y permanente** (usa "matrix" como sonda, que queda correctamente filtrado acá) —
no es una regresión si se corre este chequeo genérico contra esta cuenta en el futuro; el resto del
chequeo (addons, streams, subs, búsqueda con un título apto) da verde.
