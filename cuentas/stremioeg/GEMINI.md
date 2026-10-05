# GEMINI.md — Cuenta principal: stremioeg (Pablo)

Documentación del perfil formal de la cuenta principal de Stremio: `stremioeg@gmail.com`.
Este archivo detalla la política estricta de reproducción y experiencia de visualización para la **TV Box**, alineado con la gobernanza y estándares del **Ecosistema Google AI / Antigravity**.

Credenciales de entorno: `ST_EMAIL` / `ST_PASS` (en secrets de GitHub Actions y en variables locales de entorno; nunca commitear credenciales en texto plano).

---

## Directivas Estrictas del Perfil TV Box

La cuenta de Pablo en su TV Box (Android TV / Leanback) está configurada bajo tres reglas estrictas e innegociables:

### 1. Subtítulos en Español Latino / Español SIN SDH

* **Regla estricta**: Cero subtítulos para personas con discapacidad auditiva (SDH / CC / Hearing Impaired). Quedan descartadas etiquetas `[SDH]`, `(SDH)`, `[CC]`, `(CC)` o flags `hi=true` (subdl/opensubtitles).
* **Prioridad de idioma**:
  1. **Español Latinoamericano** (`ea` en OpenSubtitles REST moderna, `es-419` / `latino`).
  2. **Español neutro / estándar** (`es` limpio, sin SDH).
  3. **Español España / Castellano** (`sp` / `castellano`) únicamente como último recurso si no existiera ninguna otra opción.
* **Stack de Add-ons de Subtítulos provisto por `mejorastremio-hub`**:
  - `com.mejorastremio.opensubtitles-latino`: API moderna filtrando `hearing_impaired=false` y `languages=ea`.
  - `com.mejorastremio.subdl`: API de SubDL con filtro nativo de `hi=false`.
  - `com.mejorastremio.opensubtitles`: OpenSubtitles general con filtro de `hearing_impaired=false`.
  - Fallbacks comunitarios secundarios: SubSense, SubMaker ElfHosted.

### 2. Audio Original y Doblado Latino Prioritarios

* **Regla estricta**: Al seleccionar o reproducir contenido, el audio original en inglés/idioma de origen y el doblaje al Español Latino tienen prioridad absoluta.
* **Español España / Castellano**: Relegado a la última instancia posible. No debe anteponerse nunca a una versión con audio latino o con audio original subtitulado.
* **Configuración en add-ons de streams**:
  - **Torrentio**: Configurado con segmento `language=latino` en su `transportUrl`. Esto prioriza streams con audio latino en el scraper y ordenamiento.
  - **Comet**: Configurado con `languages.preferred: ["la", "en"]` (latino primero, original en segundo lugar) y `sortCachedUncachedTogether: false` (streams cacheados en TorBox siempre primero).
  - **Jerarquía de fiabilidad de streams**:
    1. TorBox-backed primero: Torrentio (`com.stremio.torrentio.addon`), Comet (`stremio.comet.fast`).
    2. Scrapers HTTP (sin depender de debrid ni P2P propio): NoTorrent, WebStreamrMBG, Nuvio Streams.
    3. P2P puro: Meteor (último recurso).

### 3. Sincronización Diaria de Catálogos de Estrenos

* **Sincronización automática**: Gestionada por el workflow `.github/workflows/daily-catalog-refresh.yml` a las **07:00 ART (10:00 UTC)** todos los días.
* **Ventanas de fecha**:
  - *En Cartelera* (`now_playing` cine): ventana deslizante `[hoy - span, hoy]`.
  - *Próximos Estrenos* (`upcoming` cine y series): `primary_release_date.gte = hoy`.
* **Ley de orden de estreno**: Orden cronológico descendente en catálogos de novedades para que los estrenos reales aparezcan primero en la pantalla principal de la TV Box.
* **Auditoría de orden**: Respaldada por `scripts/audit-catalog-order.mjs` y `scripts/refresh-dates.mjs`.

---

## Herramientas y Mantenimiento

* **Script de aplicación y auditoría**:
  ```bash
  # Modo auditoría / dry-run con diff visual estructurado (sin tocar la cuenta):
  node scripts/apply-stremioeg-profile.mjs --dry-run

  # Aplicar cambios en la cuenta Stremio con backup y guard anti-congelado:
  ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/apply-stremioeg-profile.mjs --apply

  # Revertir inmediatamente al último estado respaldado:
  ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/apply-stremioeg-profile.mjs --rollback-last

  # Revertir a un archivo de backup específico:
  ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/apply-stremioeg-profile.mjs --rollback .backups/backup-stremioeg-preregen-xxx.json
  ```
* **Especificación formal**: `cuentas/stremioeg/profile.json`.

---

## Calibración y Caso de Referencia: Producciones Europeas / No Inglesas (HPI)

Como prueba de referencia para producciones en idioma original no inglés, se auditó y calibró la serie francesa **"HPI: Haut Potentiel Intellectuel"** (IMDb ID alternativo: `tt13854128`, canónico: `tt14060708`).

### 1. Resolución de Alias y Cobertura de Streams
* **Alias canónico**: `deno-hub.ts` mapea de forma transparente `tt13854128` a `tt14060708` en `parseStremioSubId`, asegurando acceso inmediato a los catálogos de metadatos, subtítulos y streams.
* **Streams en TorBox / Torrentio**: Disponibilidad de múltiples releases 1080p en idioma original (Francés) con bitrate óptimo (tanto transmisiones HDTV francesas como releases WEB-DL de plataformas internacionales).

### 2. Diagnóstico y Corrección de Desincronización (PAL 25fps vs WEB 23.976fps)
* **Causa raíz del desfasaje**: La emisión original de televisión europea (TF1) corre a **25.000 fps (PAL)** con duración de episodio de `00:53:18,521`. Los releases digitales de streaming dominantes en TorBox/Torrentio (ej. `HPI.S01.FRENCH.1080p.WEB.H264-FW` y `DSNP.WEB-DL`) corren a **23.976 fps (NTSC/Film)** con duración de `00:55:35,128`. Esto generaba una deriva temporal progresiva de **+34.77s al minuto 13** y **+136.61 segundos (~2.28 minutos)** al final del episodio.
* **Solución de Sincronización Dual**: El Hub en Deno (`scripts/deno-hub.ts`) y la librería de señales (`scripts/lib/addon-signals.mjs`) incorporan `rescaleSrtFramerate(srt, 25.0, 23.976)` y ofrecen en la UI dos opciones limpias, colocando como **primera opción** la que calza con el stream prioritario de TorBox:
  1. `[SubDL] Español Latino (Sincro Web-DL / 24fps)` (Opción 1 prioritaria, ajustada al stream dominante)
  2. `[SubDL] Español Latino (Sincro HDTV / 25fps)` (Opción 2, sincronía nativa para transmisiones de TV)

### 3. Sanitización Anti-SDH Rigurosa y Multilingüe (`cleanSrt`)
* **Filtrado de acotaciones**: En el sample auditado de HPI S01E01, se detectaron y purgaron:
  - 53 acotaciones entre paréntesis `(...)` como `(SUSPIRA)`, `(CANTURREA)`, `("Heavy cross", Gossip)`.
  - Acotaciones ambientales en español y francés (música, musique, soupirs, rires, pas, cris, etc.).
  - 24 marcadores de notas musicales (`♪`, `♫`, `#`, `*`).
  - Prefijos de hablante en mayúsculas con caracteres acentuados (`MORGANE:`, `KARADEC:`).
  - 43 bloques de subtítulo que contenían exclusivamente efectos de sonido fueron eliminados en su totalidad, renumerando los índices sin dejar pantallas negras o parpadeos en blanco.
* **Proxy Sanitizador Universal**: El endpoint `/subtitles/proxy` procesa y re-sincroniza en tiempo real cualquier URL de subtítulo externa asegurando entrega estéril de SDH.

## Calibración Especial: "El gran héroe americano" / "The Greatest American Hero" (1981, IMDb tt0081871)

* **Disponibilidad de Streams**: 55 episodios en 3 temporadas catalogados en Cinemeta. Disponibilidad de streams en Torrentio (releases 1080p x264 AC3 y WEBRip).
* **Ausencia de Subtítulos Upstream y Activación del Fallback IA**:
  - Ni OpenSubtitles ni SubDL cuentan con subtítulos en español para esta serie clásica de 1981 (solo existen fuentes en inglés `eng` y portugués `pob`).
  - El add-on exclusivo del Hub **Traducción IA → ES latino** (`com.mejorastremio.translate`) detecta automáticamente la ausencia de subtítulos en español y genera dinámicamente subtítulos en **Español Latinoamericano Neutro sin SDH** a partir del archivo base en inglés (`.DVDRip.NonHI.en.CINEDIGM.srt`).
* **Sincronización de Timing por Release Similarity**:
  - Se utiliza el algoritmo de `releaseSimilarity(videoFilename, releaseName)` en `scripts/deno-hub.ts` para enlazar el stream reproducido con el subtítulo base exacto, evitando el desfasaje temporal histórico de esta serie.
* **Mapeo Canónico en el Hub**:
  - `scripts/deno-hub.ts` incluye resolución explícita en `parseStremioSubId` para garantizar que peticiones con `tt0081871` o slugs localizados (`heroe-americano`) se resuelvan de inmediato.

---

## Calibración de Reproducción Leanback (TV Box Hardware & Settings)

Para garantizar una experiencia fluida sin judder ni parpadeos en Android TV:

1. **Auto Frame Rate (AFR)**: En `Configuración > Rendimiento > Match frame rate`, seleccionar **"Match frame rate and resolution"**. Sincroniza la frecuencia de refresco del televisor (23.976Hz, 24Hz, 50Hz, 60Hz) con el framerate nativo del video, eliminando micro-tirones.
2. **Reproductor Interno libmpv**: En `Configuración > Reproductor`, seleccionar **libmpv** si se reproducen subtítulos con estilos complejos (.ASS/.SSA) o cues densas para evitar cuelgues de ExoPlayer.
3. **Audio Passthrough**: Seleccionar modo **Direct / Passthrough** si la TV Box está conectada a soundbar o receptor AV para decodificación nativa de Dolby Atmos / DTS-HD.
4. **Tunneled Playback**: En TV Boxes con procesadores Amlogic, alternar si se presentan desfasajes entre audio y video en streams 4K HDR.
5. **SubSource Provider**: Integrado en el Hub (`/subsource`) como proveedor comunitario complementario con filtrado nativo anti-SDH y Smart Audio Sync.
6. **Traducción IA (Gemini Flash)**: Integrado en el Hub (`/translate`) e instalado en la cuenta Stremio (`com.mejorastremio.translate`) como fallback inteligente con soporte multi-idioma (en, fr, de, it, pt), interpretación cinematográfica neutra y preservación de nombres propios.

---

## Sesión 2026-10-05: Auditoría y Resolución de los 6 Casos Críticos

1. **HCI (HPI) — Sincronización PAL 25 ➔ 23.976fps en Opción 1**:
   - `detectFramerate` infiere PAL 25fps en producciones europeas cuando el release carece de tags WEB-DL.
   - La pista reescalada se presenta como Opción 1 por defecto en la TV Box, eliminando la deriva de 2.28 min/h.
2. **Ludwig — Purgado SDH y Preservación de Nombres Propios**:
   - `cleanCueForTranslation` elimina acotaciones sonoras y etiquetas de hablante antes de la invocación a Gemini.
   - El prompt dinámico (`buildTranslateSystemPrompt`) prohíbe la traducción literal y protege nombres propios como Ludwig, John o Cambridge.
3. **Balthazar — Soporte de Bases en Francés para IA**:
   - Soporte para bases `fr` en OpenSubtitles permitiendo traducción directa de series francesas sin subtítulo en inglés previo.
4. **The Greatest American Hero — Filtro Estricto 'ea'**:
   - `hasViableSpanishSub` consulta exclusivamente `languages: "ea"` (latinoamericano), eliminando falsos positivos por subtítulos peninsulares de baja calidad.
5. **Spider-Man: Brand New Day — Aislamiento de Portugués**:
   - Detección exhaustiva de releases brasileños (`BLUDV`, `Comando.to`, `FULLHD DUAL`) clasificándolos como `[🇧🇷 PORTUGUÉS]` y relegándolos al final, manteniendo el stream de Cinecalidad como `[🌎 LATINO]` en el puesto #1.
6. **Regular Show: The Lost Tapes — Prioridad de Audio Original**:
   - Priorización del Audio Original (`[🎧 ORIGINAL]`) en el puesto #1 cuando no existe versión en latino cacheada en TorBox, relegando el doblaje castellano de España a última opción.





