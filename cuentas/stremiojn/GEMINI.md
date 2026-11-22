# GEMINI.md — Arquitectura y Gobernanza: Perfil stremiojn (Joaquín)

Guía de referencia y especificación técnica para la cuenta secundaria **`stremiojn@gmail.com`** ("Joaquín") en el ecosistema **MejoraStremio**.

---

## 1. Propósito y Perfil de Usuario (Edición UFC, Combate & Adrenalina · Base v3.4.0)

Desde el **2026-11-22**, la cuenta **`stremiojn@gmail.com`** ("Joaquín") combina **toda la infraestructura v3.4.0 verificada** (TorBox Friction-Zero anti-pantalla verde, prioridad `[🌎 LATINO]`, subtítulos sin SDH duales `spl`+`spa`, SmartSync, IA Gemini, Sagas/Universos y Plataformas + Tabla Argentina) con una **curaduría 100% orientada a UFC, MMA, Boxeo, Deportes de Combate, Acción y Thriller/Policial**:

- **Usuario**: Joaquín.
- **Dispositivo Principal**: PC (Stremio 5) & Android TV / TV Box (ZTE ZXV10 B866V2, Leanback UI).
- **Manifiesto Dedicado (`buildStremioJnManifest`, `?profile=stremiojn`, 42 catálogos)**:
  - **14 filas en Inicio** (cero infantil/familiar): *UFC Eventos & PPV (Últimas Veladas)*, *UFC, MMA & Combate (Series y Realities)*, *Cine de UFC, MMA & Boxeo*, *Para vos IA (UFC/Combate/Acción)*, *Acción y Artes Marciales*, *Thriller, Crimen y Policial*, *Estrenos Cine/Series/Streaming* y *Sagas/Universos*.
  - **28 secciones en Descubrir**: *Boxeo y Kickboxing*, *F1, Motor y Deportes*, *Plataformas Streaming (Netflix, HBO Max, Prime Video, Movistar+, BBC, Europa)*, *Sagas/Universos* y *Descubrir Avanzado* con Tabla Argentina (`ATP`, `+13`, `+16`, `+18`).
- **Exclusión Estricta**: Cero dibujos animados infantiles, cero contenido preescolar y cero telenovelas (`without_genres: 16,10751,10762,10766`).

---

## 2. Topología Canónica v3.4 (Monopolio Estricto de 4 Addons Autorizados)

Esta cuenta implementa la **topología canónica de 4 addons autorizados** (aislada de `stremioeg`):

| Posición | ID del Addon | Nombre | Rol Arquitectural |
| :---: | :--- | :--- | :--- |
| **#0** | `com.mejorastremio.hub` | **MejoraStremio Hub v3.4.0 · UFC & Combate** | Router unificado en Edge (Deno Deploy) con `?profile=stremiojn`. 42 catálogos orientados a UFC/Combate/Acción, Friction-Zero TorBox, `[🌎 LATINO]` y subtítulos sin SDH. |
| **#1** | `com.mejorastremio.livetv` | **TV en Vivo (v1.2.0)** | Señales deportivas/combate en vivo (`livetv-combate`, **17 canales** verificados con multi-señal: ESPN LatAm 1/2, Fox Sports AR, TyC Sports, ESPN USA, Fight Network, Bellator, PFL, Glory, MMA-TV, FightBox). |
| **#2** | `com.mejorastremio.trailers-latino` | **Tráilers Oficiales Latino (MejoraStremio)** | Tráilers oficiales doblados al español latino (1080p YouTube) con manifest completo (`resources: ["stream"]`). |
| **#3** | `com.linvo.cinemeta` | **Cinemeta** | Proveedor de metadatos oficial canónico de Stremio. |

> [!IMPORTANT]
> Todo addon secundario fuera de estos 4 autorizados queda purgado automáticamente por `apply-stremioeg-profile.mjs --account=stremiojn` y auditado por `health-check.mjs --account=stremiojn`.

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
