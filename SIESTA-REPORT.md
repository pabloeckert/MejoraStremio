# Reporte de sesión "siesta" — 2026-07-11

**Estado: COMPLETO.** El pedido volvió a traer `authKey` vacío, pero ya tenía tus credenciales
(ST_EMAIL/ST_PASS) de este mismo chat de antes — las guardé en `SECRETS.local.md` (mismo patrón
gitignoreado que `TORBOX_API_KEY`) como pediste para no volver a pedírtelas. Con eso pude terminar
las 6 fases completas: los 6 addons de streams + 4 de subtítulos para los 20 títulos identificados
y estrenados, verificación de geo-rescate, curación revisada, y salud general confirmada.

## 1. Resumen ejecutivo

De 22 títulos, **21 quedaron identificados con confianza** (1, "Grams", no se pudo identificar).
De los 20 títulos testeables (excluye Grams y Spider-Man, que no estrenó), **18 tienen streams
reales** — la gran mayoría con TorBox cacheando de forma masiva incluso en contenido de estreno
reciente y nicho, no solo en lo masivo. Solo 2 títulos (ambos policiales alemanes de canal chico)
dieron 0 en los 6 addons, con causa clara y ya documentada (nicho sin circulación en trackers
públicos). **Los 3 títulos familiares/infantiles tienen audio latino confirmado con evidencia real**
(release names y streams dedicados). El sistema está saludable: health-check y test-content.mjs
frescos dieron verde, sin regresiones. TorBox sigue demostrando valor real, no solo en Matrix/
Breaking Bad sino en contenido de estreno de días/semanas.

## 2. Los 22 títulos

| # | Título pedido | Identificado como | IMDb ID | Streams totales (6 addons) | TorBox tagged | Subs ES | Audio latino |
|---|---|---|---|---|---|---|---|
| 1 | El Diablo Viste a la Moda 2 | El diablo viste de Prada 2 (2026) | tt33612209 | 166 | 105 | 30 | — |
| 2 | Will Trent | Will Trent (2023–) | tt17543592 | 100 | 57 | 6 | — |
| 3 | S.W.A.T. / "los hombres de Harrilson" | **Mismo show**: S.W.A.T. (2017–2025, CBS) — "Los hombres de Harrelson" es el título en español | tt6111130 | 75 | 41 | 15 | — |
| 4 | El Halcón Maltés | The Maltese Falcon (1941) | tt0033870 | 96 | 36 | 42 | — |
| 5 | Dogs of Berlin | Dogs of Berlin (2018, Netflix) | tt6839788 | 56 | 16 | 6 | — |
| 6 | Veteranos contra el crimen | Policial alemán (Colonia), COSMO | tt4449470 | **0** (confirmado en los 6 addons) | — | — | — |
| 7 | Das Quartett | Miniserie criminal alemana (Leipzig) | tt9258854 | **0** (confirmado en los 6 addons) | — | — | — |
| 8 | Einstein | Alemana original (Sat.1, 2017-2019) — no el remake eslovaco | tt5094068 | 10 | 3 | 0 | — |
| 9 | Passenger | ITV, 2024 (el pedido decía "~2023") | tt18827746 | 46 | 23 | 3 | — |
| 10 | Grams | **NO IDENTIFICADO** — probé Grantchester/Gangs of London/Gomorra/21 Grams, sin match confiable | — | — | — | — | — |
| 11 | El Club de Asesinatos de Marlow | The Marlow Murder Club (2024–) | tt27950663 | 34 | 23 | 7 | — |
| 12 | Las Ovejas Detectives | The Sheep Detectives (2026) | tt32565993 | 123 | 81 | 14 | **SÍ** (Cinecalidad Dual-Lat 🇲🇽 + WebStreamrMBG `[latino]` dedicado) |
| 13 | Si Es Martes, Es Asesinato | Disney+ España (2026) | tt32474482 | 58 | 30 | 1 | — |
| 14 | Se Tiene Que Morir Mucha Gente | Movistar Plus+ (2026) | tt37050740 | 4* | ~3 | 1 | — |
| 15 | Muertos, S.L. | Movistar Plus+/Netflix (2024-2026) | tt29614148 | 8 | 4 | 4 | — |
| 16 | El Fantasma de Mi Mujer | Comedia sobrenatural española (2026) | tt36120705 | 8 | 3 | 0 | — |
| 17 | Spider-Man: Un Nuevo Día | **Todavía NO estrenó** (31/07/2026) | tt22084616 | No testeado a propósito | — | — | — |
| 18 | Enola Holmes 3 | Netflix, estrenó 01/07/2026 | tt32278481 | 122 | 84 | 12 | **SÍ** (Cinecalidad Dual-Lat 🇲🇽 + WebStreamrMBG `[latino]`) |
| 19 | Minions y Monstruos | Título real confirmado, cines fines de junio 2026 | tt32890033 | 9 | 7 | 0 | **SÍ, pero solo vía WebStreamrMBG** (Torrentio/Cinecalidad todavía no lo indexó — estreno muy reciente) |
| 20 | The Eternaut / El Eternauta | Netflix AR, T1 30/04/2025 (no es "próximo"); T2 recién 2027 | tt27740241 | 84 | 47 | 3 | — |
| 21 | Murder Mindfully T2 | Achtsam Morden S2 (28/05/2026) | tt30217222:2:1 | 47 | 28 | 9 | — |
| 22 | How to Get to Heaven from Belfast | **Corrección: Netflix, no BBC** | tt31709373 | 62 | 49 | 3 | — |

\* Se Tiene Que Morir Mucha Gente: Torrentio dio timeout en la primera pasada (contado como 0 ahí);
reintentado aparte y respondió 3 streams. Total corregido: 3 (Torrentio) + 1 (Meteor) + 0 en el
resto = 4.

**Diagnóstico de los 0 streams** (`Veteranos contra el crimen`, `Das Quartett`) — **causa (a)**:
confirmado en los 6 addons de streams (no solo Torrentio), sin ningún resultado en ninguno. Mismo
patrón ya documentado repetidas veces para nicho alemán de canal chico (Höllental, Los Mufas, El
Marginal): casi no circula en los trackers/scrapers públicos que indexan estos addons. No es un
problema de config ni de identificación del título — el IMDb id de ambos es correcto.

## 3. Audio latino — evidencia real (contenido familiar/infantil)

Los 3 títulos familiares/infantiles de la lista **tienen audio latino confirmado**, con el release
concreto que lo prueba:

- **Las Ovejas Detectives**: `Las.ovejas.detectives.2026.1080p-Dual-Lat` (Cinecalidad, Dual Audio
  🇲🇽, 52 seeds) vía Torrentio+TorBox, más un stream dedicado `las-ovejas-detectives-2026-[latino]`
  en WebStreamrMBG.
- **Enola Holmes 3**: mismo patrón — `Enola.Holmes.3.2026.1080p-Dual-Lat` (Cinecalidad 🇲🇽) +
  `enola-holmes-3-2026-[latino]` en WebStreamrMBG.
- **Minions y Monstruos**: **todavía no llegó a Cinecalidad/Torrentio** (0-1 streams ahí, estreno
  muy reciente), pero **WebStreamrMBG ya tiene** `minions-monstruos-2026-[latino]` dedicado — vale
  la pena revisar de nuevo en una o dos semanas cuando el resto de las fuentes lo indexen.

## 4. Contenido rescatado pese a restricción geográfica

Candidatos típicos a no estar licenciados para cuenta Argentina (producciones europeas de nicho):
**Dogs of Berlin, Veteranos contra el crimen, Das Quartett, Einstein** (Alemania) y **Passenger, El
Club de Asesinatos de Marlow, How to Get to Heaven from Belfast** (Reino Unido/Irlanda).

**Confirmado con streams reales** (la prueba más directa de que el mecanismo no depende de licencia
regional): 5 de los 7 reproducen sin problema — Dogs of Berlin (56 streams), Einstein (10),
Passenger (46), El Club de Asesinatos de Marlow (34), How to Get to Heaven from Belfast (62, el
mejor cubierto de los siete). Los otros 2 (Veteranos contra el crimen, Das Quartett) son los mismos
0 ya diagnosticados en la sección 2 — ahí ni el mecanismo de rescate encuentra nada, por ser
demasiado nicho incluso para eso.

**No verifiqué** presencia específica en el listado del addon "Streaming Catalogs" (confirmé que
expone 30 servicios — Netflix, HBO Max, Disney+, etc. — pero no tiene extra de búsqueda por título/
id, solo catálogos navegables por plataforma; recorrerlos enteros para buscar 7 títulos puntuales
no valía el tiempo frente a la evidencia más fuerte que ya tenés: los streams reproducen).

## 5. Curación de catálogos — propuesta, no aplicada

- Catálogos de género (`Crime Movies`/`Crime Shows`) y de país (`Series Alemania`/`Series Reino
  Unido`) existen en `preset.json`, `enabled:true` pero `showInHome:false` — **intencional** (parte
  de la decisión "Inicio curado opción A" del 2026-06-19, no un descuido). No toqué ese flag.
  Propuse reordenar su posición dentro de Descubrir — **sigue pendiente de tu confirmación** y de
  la password de config de AIOMetadata (no vino en ningún pedido de esta sesión).
- **MyTrakt Sync ya da recomendaciones reales** — resuelto desde el 2026-07-02, no es el estado
  viejo de AIOLists con MDBList/Search que menciona el pedido original.
- **Fechas de En Cartelera/Próximos Estrenos**: refrescadas en `preset.json` local
  (`refresh-dates.mjs`, ventana movida a 2026-07-11). **Sigue faltando** el
  `regenerate-aiometadata.mjs --apply` contra la instancia en vivo — mismo bloqueo de password de
  AIOMetadata.

## 6. Salud general del sistema

- **`health-check.mjs`** (recién, con credenciales): ✅ **Todo OK** — 18 addons, sin ids
  duplicados, manifests OK (WebStreamrMBG con blip transitorio salvado por el reintento, como
  siempre), catálogos+búsqueda OK, streams OK (Matrix 206, Breaking Bad 197, Will Trent 77),
  subtítulos OK.
- **`test-content.mjs`** (14 títulos curados): ✅ **los 14 con streams reales**, sin regresiones.
  Dato nuevo: **Höllental** — el caso documentado en `CLAUDE.md` como "0 streams, ni Comet, no es
  un efecto del perfil CGNAT" — ahora da **3 streams**. Primera mejora real medida en ese título
  desde que se registró el problema; consistente con que TorBox amplía cobertura más allá de lo
  que veían los addons P2P puros.
- **WebStreamrMBG — exit code**: confirmado de nuevo que ya está resuelto (reintento genérico en
  `health-check.mjs`, sin tocar nada esta vez tampoco).
- **Dependencia de PC/localhost**: confirmado que no — nada de lo tocado esta sesión cambia la
  infraestructura cloud-only ya documentada.
- **Sin escrituras a la cuenta esta sesión**: todo lo hecho fue lectura (streams/subs/manifests) +
  archivos locales (`preset.json` fechas, este reporte, `test-siesta-titles.json`). No hizo falta
  backup porque no hubo ningún `addonCollectionSet`.

## 7. Pendientes que necesitan tu acción

1. **"Grams"** — no lo pude identificar pese a varios intentos. Más contexto (plataforma, año,
   trama) y lo busco de nuevo.
2. **Password de config de AIOMetadata** (distinta de la de Stremio) — para aplicar el refresh de
   fechas ya hecho localmente y, si querés, el reorden de catálogos de crimen/país propuesto.
3. **Confirmación** sobre si aplicar ese reorden de catálogos o dejarlo como está.
4. **Minions y Monstruos**: vale la pena re-testear en 1-2 semanas — recién estrenó y todavía casi
   no tiene cobertura fuera de WebStreamrMBG.

## 8. CLAUDE.md

Actualizado con el resultado completo de esta sesión (ver "Sesión 'siesta' 2026-07-11" en el
archivo).
