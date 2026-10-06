# GEMINI.md — Arquitectura y Gobernanza Técnica de MejoraStremio

Guía de referencia y gobernanza técnica para **Google Antigravity / Gemini** en el repositorio **MejoraStremio**.
Este documento constituye la fuente de verdad unificada sobre la arquitectura de addons, catálogos, sincronización cloud y perfiles de cuenta.

---

## 1. Naturaleza y Propósito del Repositorio

**MejoraStremio** es una caja de herramientas automatizada para la gestión, curaduría y mantenimiento de perfiles de Stremio operada por terminal y mediante flujos serverless (GitHub Actions y Deno Deploy) contra las APIs de Stremio, TorBox, OpenSubtitles y catálogos de metadatos (AIOMetadata / TMDB).

### Cuentas Gestionadas:
- **`stremioeg@gmail.com`** (Principal / TV Box / Pablo): Documentada formalmente en `cuentas/stremioeg/GEMINI.md` y `cuentas/stremioeg/profile.json`. Configurada con subtítulos estrictos sin SDH, prioridad audio latino/original y orden cronológico de estrenos.
- **`stremiojn@gmail.com`** ("Joaquín"): Curaduría de catálogos y perfiles independientes.
- **`solotveg@gmail.com`**: Perfil juvenil/adolescente (hasta 17 años) con filtros estrictos de clasificación.

---

## 2. Arquitectura de Datos y Catálogos

- `data/preset.json`: Fuente de verdad de la configuración de catálogos de AIOMetadata. Reconstruye la configuración de instancias de metadata.
- `data/test-content.json`: Lista curada de títulos de prueba con IDs de IMDb para testing automatizado de streams.
- `data/anti-frustration-log.json`: Registro de títulos con baja disponibilidad o problemas de cobertura para seguimiento preventivo.
- `data/premiere-radar-state.json`: Estado del radar de estrenos y sincronización de nuevos episodios.
- `data/iptv-channels.json`: Mapeo y estado de listas de canales IPTV en vivo.

---

## 3. Reglas Técnicas y Patrones Críticos

### 3.1 Guard Anti-Manifest-Congelado (`collection-guard.mjs`)
- **Problema de raíz**: Históricamente, ciertos add-ons perdían la propiedad `catalogs` (`catalogs: []` indiscriminado) durante actualizaciones o escrituras concurrentes, rompiendo la interfaz de Stremio.
- **Regla estricta**: Todo script de reordenamiento o actualización (`reorder-addons.mjs`, `install-addon.mjs`, `update-addon-url.mjs`, `repair-frozen-catalogs.mjs`) debe validar contra `collection-guard.mjs` que ningún add-on pierda sus catálogos antes de confirmar cambios en la API.

### 3.2 Sort "Friction-Zero" y TorBox Debrid
- En cuentas con debrid activo (TorBox), los streams cacheados en debrid tienen prioridad absoluta para garantizar reproducción instantánea sin esperas de descarga P2P ni throttling por CGNAT.
- `apply-friction-zero-sort.mjs` orquesta la jerarquía de scrapers (Torrentio + TorBox, Comet + TorBox) sobre HTTP y P2P nativo.

### 3.3 Subtítulos y Preferencias Regionales
- Se prioriza **Español Latinoamericano (`ea`, `es-419`)** sin marcas de accesibilidad auditiva (`hearing_impaired=false`).
- Se descartan marcas SDH / CC en OpenSubtitles y SubDL.
- Español de España / Peninsular (`sp`, `es-ES`) opera estrictamente como último recurso de fallback.

### 3.4 Sincronización Diaria y Ventanas Deslizantes
- El flujo `daily-catalog-refresh.yml` corre a las 07:00 ART (10:00 UTC) ejecutando `refresh-dates.mjs` y `regenerate-aiometadata.mjs`.
- Mantiene dinámicas las ventanas de "En Cartelera" (`now_playing`) y "Próximos Estrenos" (`upcoming`) con la fecha del día actual.

---

## 4. Infraestructura Cloud-Only y Monitoreo

- **Deno Deploy (`mejorastremio-hub`)**: Microservicios HTTP en TypeScript (`scripts/deno-hub.ts`) para filtrado de subtítulos y proxy de metadatos.
- **GitHub Actions Workflows**:
  - `health-monitor.yml`: Monitoreo bicotidiano del estado de add-ons y endpoints.
  - `keep-warm.yml`: Mantiene activos los workers serverless cada 20 minutos.
  - `premiere-radar.yml`, `community-radar.yml`, `torbox-airlock.yml`, `iptv-refresh.yml`: Automatizaciones periódicas de curaduría.

---

## 5. Sesión 2026-10-02: Auditoría Integral y Blindaje E2E

### 5.1 Blindaje de Seguridad y Resiliencia en Deno Deploy (`deno-hub.ts`)
- **Protección Anti-SSRF (CWE-918)**: Se restringió la resolución del upstream de streams mediante `ALLOWED_TORRENTIO_HOSTS = new Set(["torrentio.strem.fun"])` en `sanitizeTorrentioBase` y `handleStreams`, eliminando la posibilidad de inyectar hosts arbitrarios vía query params.
- **Protección Anti-ZipBomb / OOM**: En `extractSrtFromZip`, se fijó un tope máximo de descompresión de 5 MB (`MAX_DECOMPRESSED_BYTES = 5 * 1024 * 1024`). Si un stream excede el límite, se cancela la lectura del `DecompressionStream` inmediatamente.
- **Manejo Seguro de Background Tasks**: En el pipeline de traducción IA, se agregó captura con `.catch()` para promesas asíncronas flotantes cuando no está disponible `EdgeRuntime.waitUntil`.

### 5.2 Estabilidad de Fechas y Testing E2E
- **Sincronización de Cartelera**: Se ejecutó `scripts/refresh-dates.mjs` actualizando las ventanas de "En Cartelera" y "Próximos Estrenos" en `data/preset.json` a la fecha actual (`2026-10-03`).
- **Resiliencia de Timezone en Tests**: En `scripts/test-stremioeg-tvbox.mjs`, se incorporó una ventana de tolerancia de 24 horas (`isDateFresh`) para contemplar el desfasaje horario entre UTC y ART (UTC-3) antes de la ejecución del cron diario de las 07:00 ART.
- **Certificación de la Suite**: 28 de 28 pruebas superadas exitosamente (100% OK en Estructura 9/9, Filtros 9/9 e Integración 10/10) y simulación de encendido de TV Box (`simulate-tv-boot.mjs`) 100% aprobada.

---

## 6. Sesión 2026-10-03: Activación Remota Real y Blindaje TV Box (`stremioeg@gmail.com`)

### 6.1 Corrección Crítica en Smart Stream Interceptor (`deno-hub.ts`)
- **Fuga de Separadores de Configuración**: Se corrigió un bug en `handleStreams` donde `replace(/[^a-zA-Z0-9_=-]/g, "")` y `encodeURIComponent` destruían las barras verticales (`|`) y comas (`,`) de la URL de configuración de Torrentio, invalidando el token de TorBox Debrid.
- **Deploy a Producción**: Se deployó la corrección a `mejorastremio-hub.pabloeckert.deno.net` mediante `deploy-deno-hub.yml`. Los streams ahora retornan con prioridad absoluta de TorBox cached + audio latino (`[⚡ INSTANTÁNEO] [🇪🇸 LATINO] [TB+]`).

### 6.2 Sincronización Remota de la Cuenta Stremio Real
- **Instalación de Addons Faltantes**: Se incorporaron a la colección remota de Stremio de `stremioeg@gmail.com`:
  - `com.mejorastremio.subsource` (SubSource sin SDH).
  - `com.mejorastremio.streams` (Proxy inteligente de Torrentio posicionado en el orden #1 de streams).
- **Sincronización de Instancia AIOMetadata**: Se ejecutó la regeneración en ElfHosted vía `daily-catalog-refresh.yml` y `apply-stremioeg-profile.mjs`, actualizando la instancia a `d29d183a-be46-41ea-bb8a-dc572347e337` (105 catálogos sincronizados 1:1 entre `preset.json` y la API de Stremio).
- **Verificación Cruda en Vivo**: `verify-live-account.mjs` certificó paridad total (instanceId guardado = instanceId repo = manifest en vivo). Al encender la TV Box, los cambios ya están activos en la nube de Stremio.

---

## 7. Sesión 2026-10-03 (Fase 0): Modernización, Resiliencia y Leanback UX

### 7.1 Higiene Operativa y Mecanismo de Rollback (`apply-stremioeg-profile.mjs`)
- **Diff Visual Estructurado (`--dry-run`)**: Implementación de una tabla visual con codificación clara (`[+] AGREGADO`, `[-] REMOVIDO`, `[~] MODIFICADO`, `[^] REORDENADO`, `[=] SIN CAMBIO`) que permite inspeccionar con precisión cualquier mutación antes de persistirla en la API de Stremio.
- **Mecanismo de Reversión Inmediata (`--rollback-last` / `--rollback <file>`)**: Toda operación genera un snapshot atómico en `.backups/`. En caso de anomalía, la cuenta puede revertirse a su estado exacto anterior en 1 comando con validación previa de integridad contra `collection-guard.mjs`.

### 7.2 Motor de Doblaje Latino y Badge Semántico (`deno-hub.ts`)
- **Normalización de Releases (`cleanReleaseName`)**: Se eliminan acentos, emojis regionales, caracteres no alfanuméricos y delimitadores para procesar nombres no estándar de uploaders.
- **Diccionario Exhaustivo `LATIN_TOKENS`**: Soporte ampliado para `latino`, `latam`, `es-419`, `audio latino`, `doblaje latino`, `edla`, `multilatino`, etc.
- **Corrección de Badge Semántico**: Se reemplazó el badge confuso `[🇪🇸 LATINO]` por `[🌎 LATINO]`, alineando la iconografía visual con el continente latinoamericano a 3 metros de distancia en la TV Box.

### 7.3 Curaduría y Poda Leanback UX (`prune-home-catalogs.mjs` & `data/preset.json`)
- **Eliminación del Scroll Infinito en Android TV**: Reducción de 65 filas en Inicio a 10 filas esenciales curadas para navegación ágil con D-pad (En Cartelera, Próximos Estrenos, Para Ver en Familia, Policial Clásico, Cine/Series Argentina, Latinoamérica).
- **Preservación Total en Descubrir**: Los 173 catálogos restantes permanecen activos con `enabled: true` y `showInHome: false`, disponibles en la pestaña Descubrir sin sobrecargar el Home.
- **Calibración TMDB Discover**: Configuración de `with_release_type: "2|3"` (cines), `region: "AR"`, `sort_by: "popularity.desc"` y `vote_count.gte: 1` para asegurar estrenos frescos reales sin omisiones.

---

## 8. Sesión 2026-10-05: Formalización de Gobernanza Global y Protocolo Zero-Trust

### 8.1 Institucionalización de la Skill Global y Memoria Permanente
- **Skill Global de Ecosistema**: Creada en `~/.gemini/config/skills/zero-trust-principal-engineer/SKILL.md`, estableciendo el estándar operativo obligatorio para todos los proyectos del entorno de trabajo en Antigravity.
- **Regla Local Vinculante**: Establecida en `.agents/rules/zero-trust-principal-engineer.md` para garantizar la ejecución local estricta de las 6 políticas inviolables (verificación empírica, modelado canónico tipado, dry-run/rollback atómico, ergonomía Leanback, higiene de errores y protocolo quirúrgico en 5 puntos).
- **Retrospectiva y Metamorfosis**: Documentada exhaustivamente en el artefacto `informe_metamorfosis_criterio_antigravity.md`, cerrando la transición del modelo reactivo hacia la excelencia de ingeniería Zero-Trust SRE.

---

## 9. Sesión 2026-10-05 (Parte 2): Resolución Integral de los 6 Modos de Falla (HPI, Ludwig, Balthazar, TGAH, Spider-Man, Regular Show)

### 9.1 Series Europeas (HPI / HCI): Reescalado Automático PAL 25 ➔ 23.976fps en Opción 1
- **Causa Raíz**: Rips WEB-DL a 23.976 fps consumían subtítulos comunitarios extraídos de broadcast europeo a 25.0 fps sin tags explícitos en el release. `resolveSmartSync` los marcaba "Nativo", empujando el archivo a 25 fps como Opción 1 y causando un desfasaje acumulativo de +2.28 minutos por hora.
- **Solución Zero-Trust**: Detección contextual de producciones europeas (`isEuropeanShowOrContext` con IDs IMDb como `tt14060708`). Cuando se detecta discrepancia con WEB-DL, el track reescalado mediante time-stretch `25to23976` (+153.75s/h) se inyecta como **Opción 1 por omisión**, relegando el track crudo a Opción 2 ("📺 Original").

### 9.2 Ludwig: Purgado de SDH, Adaptación Cinematográfica y Blindaje de Nombres Propios
- **Causa Raíz**: Cues con descriptores sonoros y etiquetas de hablante (`LUDWIG:`, `[sighs]`) se enviaban crudos a Gemini, el prompt carecía del título dinámico y no prohibía la traducción literal ni la alteración de nombres propios.
- **Solución Zero-Trust**: Función `cleanCueForTranslation` que purga acotaciones sonoras `[...]`, `(...)` y prefijos de interlocutores en mayúsculas antes de la IA. `buildTranslateSystemPrompt` incorpora el título dinámico ("Ludwig"), directiva inviolable de preservación de nombres propios (Ludwig, John, Cambridge, etc.) y prohibición explícita de traducción literal. Pasada final de normalización con `cleanSrt`.

### 9.3 Balthazar & The Greatest American Hero: Bases Multilingües y Detonante Estricto
- **Causa Raíz**: Balthazar (serie francesa) solo contaba con subtítulos en francés (`fr`) en OpenSubtitles; el Hub solo buscaba bases en `en` y `de`. En *The Greatest American Hero*, un subtítulo de Google Translate de 2005 en `es` suprimía falsamente la traducción IA en la temporada 2.
- **Solución Zero-Trust**: Búsqueda jerárquica de subtítulos base en OpenSubtitles ampliada a `["fr", "de", "it", "pt"]` si falta inglés. `hasViableSpanishSub` consulta estrictamente `languages: "ea"` (latinoamericano genuino), evitando falsos positivos por subtítulos peninsulares o traducciones basura.

### 9.4 Spider-Man & Regular Show: Aislamiento Estricto de Audio Latino, Original y Relegación de Doblajes
- **Causa Raíz**: La regex de streams incluía `\bdual\b`, confundiendo releases brasileños (`FULLHD DUAL 5.1`, `BLUDV`, `Comando.to`) con audio latino y desplazando al stream genuino de Cinecalidad. En *Regular Show*, releases en castellano se etiquetaban como latino.
- **Solución Zero-Trust**: Clasificación canónica tipada `classifyStreamAudio` (`"latino" | "original" | "castellano" | "portuguese"`). Orden jerárquico estricto en `rankAndBadgeStreams`:
  1. `[⚡ INSTANTÁNEO] [🌎 LATINO]`
  2. `[⚡ INSTANTÁNEO] [🎧 ORIGINAL]`
  3. `[⏳ REQUIERE BUFFER] [🌎 LATINO]`
  4. `[⏳ REQUIERE BUFFER] [🎧 ORIGINAL]`
  5. `[⚡ INSTANTÁNEO] [🇪🇸 CASTELLANO]` y `[🇧🇷 PORTUGUÉS]` (relegados al final).

### 9.5 Sincronización del Add-on de Traducción IA en Stremio TV Box
- Incorporación formal de `com.mejorastremio.translate` a `cuentas/stremioeg/profile.json` y `scripts/apply-stremioeg-profile.mjs` con inmunidad ante el guard de catálogos congelados.

---

## 10. Sesión 2026-10-05 (Parte 3): Resolución Arquitectural del Conflicto de Códigos ISO (Audio y Subtítulos Stremio Core)

### 10.1 Causa Raíz en Stremio Core y nodejs-langs
- **Mapeo Disyuntivo**: Tras auditoría directa del código fuente abierto de Stremio (`Stremio/stremio-core`, `Stremio/stremio-web`, `Stremio/nodejs-langs`), se descubrió que Stremio bifurca el español en dos códigos independientes:
  - `spa`: "Español" (ISO-639-2 estándar / IETF `es-ES`).
  - `spl`: "Español (América Latina)" (IETF `es-419`).
  En `useAudio.ts` y `useSubtitles.ts`, `normalizeLanguage("spa") === normalizeLanguage("spl")` retorna `false`.
- **Fallo de Audio en Contenedores MKV/MP4**: Los releases torrent/debrid siguen el estándar audiovisual internacional donde el audio latino se etiqueta como `spa` o `es`. En contenedores multimedia, `spl` no existe. Si el usuario configura "Español (América Latina)" en los ajustes de audio de Stremio Android TV, el reproductor busca `spl`, no encuentra coincidencia y reproduce la pista 1 por omisión (Inglés).
- **Regla Mandatoria de Audio**: En la TV Box, el idioma de audio preferido debe ser configurado en **`Español`** (código `spa`), permitiendo que el reproductor enlace de inmediato con la pista `spa`/`es` del doblaje latino.

### 10.2 Blindaje Serverless de Subtítulos Duales (`spl` + `spa`) en Deno Hub
- Se creó e implementó la función canónica `pushDualSubtitles` en `scripts/deno-hub.ts`.
- Todos los servicios de subtítulos del Hub (`opensubtitles-latino`, `subdl`, `opensubtitles`, `subsource`, `translate`, `subtitles-proxy`) ahora emiten cada pista latina con compatibilidad dual:
  1. Variante `${id}-spl` (`lang: "spl"`): Enlace automático cuando el cliente busca "Español (América Latina)".
  2. Variante `${id}-spa` (`lang: "spa"`): Enlace automático cuando el cliente busca "Español".
- Verificado y deployado en vivo a producción en `mejorastremio-hub.pabloeckert.deno.net` mediante workflow `deploy-deno-hub.yml`.

---

## 11. Sesión 2026-10-06: Poda Leanback de Subtítulos y Blindaje Anti-Caché TV Box (Wild Cards & ExoPlayer UI)

### 11.1 Causa Raíz de Desincronización en Wild Cards (`tt29780951`)
- **Falla en Subtítulo Comunitario**: El único subtítulo en español en OpenSubtitles (`8552294`) terminaba prematuramente en el cue 585 (minuto 29:37), faltando 14 minutos para el final de 43:09.
- **Traducción IA Completa**: La base oficial en inglés (`8552293`) contiene los 835 cues completos sincronizados. La traducción de Gemini generada por el Hub cubre el 100% del episodio, pero quedaba inaccesible al fondo de una lista de más de 60 opciones duplicadas.

### 11.2 Poda Leanback de Subtítulos y Etiquetas Cortas (<20 Caracteres)
- **Limitación en UI de Android TV**: El selector lateral de ExoPlayer tiene ancho fijo (~25 caracteres). Las etiquetas que comenzaban con `[OpenSubtitles Latino (sin SDH)]...` se truncaban idénticas, impidiendo distinguir sincronizaciones y proveedores.
- **Poda Quirúrgica a 2 Opciones por Addon**:
  - `⚡ 1. Latino (Sincro) · ...` (con time-stretch automático si hay desfasaje)
  - `📺 Original · ...` (sin alterar, como resguardo)
  - `✅ 1. Latino (Nativo) · ...` (coincidencia nativa)
  - `🤖 1. IA Latino (Completo) · ...` (traducción generativa cuando la base en español es incompleta)
- **Eliminación de Redundancia en la Cuenta**: Se desinstaló `com.mejorastremio.opensubtitles` de la cuenta de Stremio, conservando exclusivamente `com.mejorastremio.opensubtitles-latino` para evitar duplicación 2x de consultas al mismo backend.

### 11.3 Blindaje Anti-Caché y Protocolo de Recarga Inmediata
- **Header HTTP Global**: Se inyectó `"Cache-Control": "no-cache, no-store, must-revalidate"` en las cabeceras `cors` de todas las respuestas JSON y SRT del Hub Deno.
- **Salto de Versión en Manifiestos**: Manifiestos elevados a versión `1.2.0` (`SUBDL_MANIFEST`, `SUBSOURCE_MANIFEST`, `OPENSUBTITLES_LATINO_MANIFEST`, `TRANSLATE_MANIFEST`, `STREAMS_MANIFEST`) para que el motor `stremio-core` detecte actualización de esquema y purgue la caché local de add-ons.
- **Ciclo de Vida de Android TV**: Al apagar la TV o presionar "Home", Android TV suspende la app en RAM sin destruirla. Para forzar la recarga de manifiestos y la nueva colección de add-ons en la nube, se debe hacer **"Forzar detención"** en Ajustes ➔ Aplicaciones ➔ Stremio o reiniciar la TV Box.

