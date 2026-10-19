# GEMINI.md — Cuenta Secundaria: solotveg (Perfil Juvenil / Adolescente)

Documentación del perfil formal de la cuenta secundaria de Stremio: `solotveg@gmail.com`.
Este archivo detalla la política estricta de curaduría, filtro familiar (PG-13 / TV-14) y monopolio de 2 addons canónicos en la **TV Box** (Android TV Leanback).

Credenciales de entorno: `ST_EMAIL_TEEN` / `ST_PASS_TEEN` (en secrets de GitHub Actions como `STREMIO_EMAIL_TEEN` / `STREMIO_PASS_TEEN`).

---

## 1. Directivas de Gobernanza y Curaduría Juvenil

1. **Monopolio Canónico de 2 Addons**:
   - `[0] com.mejorastremio.hub` (v1.4.2): TorBox Debrid con audio latino y subtítulos IA compartidos.
   - `[1] com.linvo.cinemeta` (v3.0.14): Metadatos oficiales de Stremio.
2. **Subtítulos y Audio**:
   - Prioridad absoluta a Español Latinoamericano (`spl` / `spa`) sin marcas auditivas SDH (`hearing_impaired=false`).
   - Relegación de doblajes peninsulares.
3. **Caché Global de IA**:
   - Reutilización instantánea de traducciones de subtítulos generadas por Gemini Flash en Deno KV para evitar consumo redundante de tokens.
