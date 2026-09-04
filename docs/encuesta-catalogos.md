# Encuesta de gustos — curaduría de catálogos de `stremioeg`

**Fuente de verdad del *por qué*** están organizados los catálogos. `data/preset.json` es el *qué*.
Respondida por Pablo en una charla el **2026-09-03/04**. Cuando cambie el gusto, se actualiza acá
primero y después se toca el preset.

---

## Respuestas de Pablo (2026-09-04)

### Perfil
- **Adultos:** crimen / policial / misterio **europeo** (alemán, británico, español, francés,
  nórdico) — Tatort, Babylon Berlin, Der Pass, Slow Horses. Audio original + subtítulo español.
- **Familia (toda la familia comparte la cuenta, mismos gustos):** contenido familiar, **Cartoon
  Network**, **Nickelodeon** — con o sin doblaje latino (aparece igual). Comedia infantil/juvenil
  **con actores reales** (importante: *The Really Loud House*, Nick 2022, NO el dibujo).
- **Humor negro** (Fargo, Parásitos, El Método) — pelis y series.
- Le gusta **todo**, incluido el cine/serie **clásico** (pre-1980).

### Inicio (Home)
- **Opción B: inicio largo**, casi todo a mano, el scroll no molesta.
- **Orden de secciones:**
  1. Continuar viendo / Recomendados / Watchlist (de Trakt — MyTrakt Sync)
  2. **Policiales / crimen / misterio** (el cluster)
  3. **Humor Negro** (+ Comedias Cortas acá)
  4. **Familia** (Familia pelis+series → Comedia infantil actores reales → Cartoon Network →
     Nickelodeon → Animación pelis → Animación series)
  5. **Géneros generales** → NINGUNO en el inicio, todos a Descubrir ("no uso ese filtro para nada").
     En el inicio quedan solo Crimen/Misterio/Suspenso (sección 2) y Familia/Animación (sección 4).
  6. **Países**
  7. **Próximos Estrenos + En Cartelera** (las 4 filas)
- **Top 10 por plataforma** (Netflix/Disney/HBO/…) → a **Descubrir**, fuera del inicio.
- MyTrakt Sync: mover el addon adelante para que "Continuar viendo" quede arriba de todo. Probar y
  revertir si la metadata se ve en inglés.

### Cluster policial (sección 2)
- **Se sacan por redundantes:** "Crimen y Misterio Británico" (lo cubre "Crimen Reino Unido") y
  "Crimen y Misterio Europeo" (lo cubre "Europe Noir").
- **Quedan:** Crimen (pelis/series), Misterio (pelis/series), Suspenso (pelis), Policial Clásico,
  Europe Noir (Cine/Series), Crimen Alemán (Cine/Series), Crimen Reino Unido (Cine/Series).
- **Se suman (nuevos):** Crimen Nórdico (SE/DK/NO/IS), Crimen Francés, Crimen Español, Crimen
  Italiano, Cine Negro Clásico (film noir 1940-1965), Thriller Psicológico.

### Familia (sección 4)
- Familia (pelis) + Familia (series) — todos los países.
- Comedia infantil/juvenil **con actores reales** — NUEVO.
- Cartoon Network (fila), Nickelodeon (fila). **Disney Channel: NO.**
- Animación (pelis) — Pixar/DreamWorks/Illumination. Animación (series).

### Países (sección 6)
- **Inicio (Cine + Series c/u):** Argentina, España, Francia, Alemania, Italia, Reino Unido,
  México, EE.UU. + **Nórdicos nuevos:** Suecia, Dinamarca, Noruega, Islandia.
- **Descubrir:** Portugal, Colombia, Chile, Brasil, Perú, Canadá, Australia, Nueva Zelanda.
- **Latinoamérica (Cine) + Latinoamérica (Series)** → quedan en el inicio.
- 2 filas por país (Cine + Series) — Stremio no deja mezclar tipos en una fila.

### Estrenos (sección 7)
- Las 4 filas quedan: Próximos Estrenos (pelis + series) + En Cartelera (pelis + series).

### Descubrir / apagados
- **Asia** (Japón/Corea/China/Taiwán/India, 10 catálogos): **borrar del todo.**
- Décadas (80s/90s/2000s/2010s) y catálogos por estudio (Marvel/Pixar/A24/…): **NO**, quedan
  apagados.

### Addons propios
- **Descubrir Maestro** → queda (en Descubrir). Pablo pidió un mini-tutorial de cómo usarlo.
- **Miniseries** → inicio + Descubrir.
- **Comedias Cortas** → sección Humor del inicio.
- **Audio Latino (verificado)** → **SE SACA de la cuenta** (2 catálogos).

### Preferencias de contenido
- **Época:** todo, sin filtros que corten lo viejo.
- **Subtítulos:** prioridad **latino**; si no hay, cualquier español antes que nada. **SDH
  (subtítulos para sordos) = fuera siempre que se pueda** — molesta muchísimo.
- **Lista negra (sale de TODAS las filas):** reality, deportes, anime (dibujo japonés — Pixar/
  DreamWorks NO cuentan), telenovela, terror gore, documental de naturaleza/bichos, religioso.

### Ideas nuevas (todas SÍ)
- **"Para ver en familia"** (en Descubrir) — criterio: apto todo público (sin violencia fuerte, sin
  terror) + doblaje latino donde haya + géneros familia/animación/comedia/aventura.
- **Filas de director/actor** (en Descubrir, sección propia): Guy Ritchie, Tarantino, Coppola
  (directores) + DiCaprio, Gal Gadot, Robert Downey Jr (actores). Alemanes y mexicanos: Pablo los
  carga después (mecanismo simple pendiente de dejar).
- **Resumen mensual**: "esto se estrenó de tu gusto" + "estas filas no abriste nunca".

---

## Registro de aplicación

| Fecha | Cambio | Estado |
|---|---|---|
| 2026-09-04 | Encuesta respondida, plan armado | ✓ |
| 2026-09-04 | `scripts/apply-encuesta-catalogos.mjs` → `regenerate-aiometadata.mjs --apply --force` (instancia `ebc8f187`). Inicio 86→62 filas, 13 catálogos borrados, 30 nuevos, filtro global (lista negra), géneros generales desactivados. Audio Latino removido de la cuenta. 25 addons. | ✓ aplicado y verificado |
| 2026-09-04 | MyTrakt adelante para "Continuar viendo" arriba → **revertido**, rompía el español de la metadata. "Continuar viendo" nativo de Stremio ya está en fila 0. | revertido |
| — | Pendiente: extender `/mediathek` a Polizeiruf 110 (`tt0806901`) y SOKO Leipzig (`tt0274279`) — están en la Mediathek, Pablo los tiene en watchlist, pero usan season real + nombres "Episode N" mezclados con títulos de caso → necesita lógica de matching propia por show. Alto valor, pasada aparte. | pendiente |

### Verificación de "Seguir viendo" (2026-09-04, `scripts/verify-continue-watching.mjs`)
72 títulos con actividad en 30 días. **El rework de catálogos NO tocó streams/subs** — la
disponibilidad es idéntica a antes. 39/72 con stream + sub ES; el resto son huecos PREEXISTENTES:
- **Sin stream**: Ágata y Lola S01E09 (arg. reciente), Infiltrada S01E11 (id `tt29780951` = "Wild
  Cards" en Cinemeta, mapeo TMDB roto — re-agregado al log antifrustración), Soko Leipzig /
  Polizeiruf 110 (procedurales alemanes, mismo hueco que Tatort — ver pendiente `/mediathek`),
  varias pelis infantiles muy nuevas (Tadeo Jones, Matchbox…).
- **Sin sub ES**: mayoría contenido infantil de nicho (Karate Sheep, La Oveja Shaun, Ray Gunn…) —
  Pablo pidió que el contenido familiar aparezca igual sin doblaje.
Ninguno es regresión del rework.
