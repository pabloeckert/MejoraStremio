# GEMINI.md — Arquitectura y Gobernanza: Perfil stremiojn (Joaquín)

Guía de referencia y especificación técnica para la cuenta secundaria **`stremiojn@gmail.com`** ("Joaquín") en el ecosistema **MejoraStremio**.

---

## 1. Propósito y Perfil de Usuario (Clon 1:1 de `stremioeg@gmail.com`)

Desde el **2026-11-22**, la cuenta **`stremiojn@gmail.com`** ("Joaquín") opera como **clon técnico exacto (1:1)** de la cuenta principal `stremioeg@gmail.com` sobre Android TV / TV Box (ZTE ZXV10 B866V2, Amlogic S905X2, 2GB RAM, UI Leanback):

- **Usuario**: Joaquín.
- **Dispositivo Principal**: Android TV / TV Box (ZTE ZXV10 B866V2, Leanback UI).
- **Configuración Clonada**:
  - Mismos **39 catálogos v3.4.0** (15 filas Leanback en Inicio + 24 secciones en Descubrir: Sagas/Universos Marvel, DC Comics, Harry Potter, X-Men, Independientes + Plataformas Netflix, HBO Max, Prime Video, Movistar+, BBC, Producción Europea + Tabla de Calificaciones Argentina ATP/+13/+16/+18).
  - Mismo motor **TorBox Debrid + Friction-Zero SRE** (prioridad absoluta a streams cacheados `[⚡ INSTANTÁNEO]`, descarte de torrents muertos 0-seed y HCI en Castellano).
  - Mismos **subtítulos duales (`spl` + `spa`) sin SDH**, SmartSync 25↔23.976 fps y traducción IA Gemini Flash.
  - Recomendaciones **`Para vos` IA** sembradas en Deno KV (`profile=stremiojn`) espejo de `stremioeg`.
  - *(Nota: `/livetv` y `/ufc` siguen disponibles en Deno Deploy por si en algún momento se decide volver a sumarlos manualmente).*

---

## 2. Topología Canónica v3.4 (Monopolio Estricto de 3 Addons — Espejo `stremioeg`)

Esta cuenta implementa exactamente la misma **topología canónica de 3 addons autorizados** que `stremioeg@gmail.com`:

| Posición | ID del Addon | Nombre | Rol Arquitectural |
| :---: | :--- | :--- | :--- |
| **#0** | `com.mejorastremio.hub` | **MejoraStremio Hub v3.4.0 (Enterprise)** | Router unificado en Edge (Deno Deploy). Streams cacheados en TorBox Debrid (Friction-Zero), audio latino prioritario, subtítulos sin SDH, traducción IA y los 39 catálogos v3.4.0. |
| **#1** | `com.mejorastremio.trailers-latino` | **Tráilers Oficiales Latino (MejoraStremio)** | Tráilers oficiales doblados al español latino (1080p YouTube) con manifest completo (`resources: ["stream"]`, `types: ["movie","series"]`, `idPrefixes: ["tt"]`). |
| **#2** | `com.linvo.cinemeta` | **Cinemeta** | Proveedor de metadatos oficial canónico de Stremio. |

> [!IMPORTANT]
> Todo addon secundario fuera de estos 3 autorizados queda purgado automáticamente por `apply-stremioeg-profile.mjs --account=stremiojn` y auditado por `health-check.mjs --account=stremiojn`.

---

## 3. Gobernanza Leanback UX (TV Box)

Para garantizar 60 FPS fluidos y prevenir agotamiento de memoria (OOM) en el hardware con 2GB de RAM:

1. **Tope de Filas en Inicio (`maxHomeRows: 20`)**:
   - La pantalla de inicio no debe exceder bajo ninguna circunstancia 20 filas activas simultáneas.
   - Todo catálogo secundario o complementario permanece disponible en la sección *Descubrir*, pero con `showInHome: false`.
2. **Blindaje Anti-Portadas Vacías (`minVoteCountHome: 3`)**:
   - Cada fila de TMDB Discover debe requerir `vote_count.gte >= 3` para asegurar metadatos y pósters gráficos en alta resolución.
3. **Orden Dinámico por Fecha Reciente (`orderLaw: "release_date_desc"`)**:
   - Prohibidas listas de popularidad estáticas o congeladas en el tiempo (`sort_by: popularity.desc` sin ventana temporal).
   - Se priorizan fechas de estreno decrecientes (`primary_release_date.desc`) y carteleras sincronizadas al día.

---

## 4. Prioridad Innegociable de Audio y Subtítulos

- **Puesto #1 de Audio**:
  - Regla absoluta: Todo stream cacheado en TorBox con audio latino se clasifica en el puesto número 1 con el badge semántico visual `[⚡ INSTANTÁNEO] [🌎 LATINO]`.
  - Jerarquía: `1. latino` ➔ `2. original (eng)` ➔ Último recurso: `castellano (-80 puntos)`.
- **Subtítulos sin SDH**:
  - Modo `strict_no_sdh` activo.
  - Purgado de tags auditivos `[SDH]`, `(CC)`, `hi=true`, etc.
  - Subtítulos duales: Emisión sincronizada de etiquetas en `spl` (Español Latinoamericano) y `spa` (Español neutro).
- **Caché Global de IA Compartida**:
  - Acceso directo al almacén central en Deno KV. Subtítulos generados por traducción generativa Gemini Flash en cualquier perfil del hogar quedan instantáneamente disponibles para `stremiojn`.

---

## 5. Gestión Zero-Trust de Secretos e Integración CI/CD

Las operaciones automatizadas contra la API de Stremio para esta cuenta se ejecutan bajo estricto principio Zero-Trust:

- **Variables de Entorno**:
  - Email: `ST_EMAIL_JN` (fallback: `STREMIO_EMAIL_JN`).
  - Contraseña: `ST_PASS_JN` (fallback: `STREMIO_PASS_JN`).
- **Scripts Orquestadores**:
  - `apply-stremioeg-profile.mjs --account=stremiojn`: Aplica y audita la configuración contra el perfil `cuentas/stremiojn/profile.json`.
  - `purge-and-unify-account.mjs --account=stremiojn`: Ejecuta la purga atómica garantizando el monopolio de 2 addons.
  - `health-check.mjs --account=stremiojn`: Monitorea la salud del perfil y alerta ante cualquier deriva topológica.
  - `test-multi-account-p9.ts`: Suite E2E de certificación multi-perfil.
- **Prohibición**: Queda terminantemente prohibido quemar contraseñas o tokens en archivos del repositorio.
