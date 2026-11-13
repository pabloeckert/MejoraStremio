import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

/**
 * Carga automáticamente variables de entorno desde archivos .env locales
 * protegidos por .gitignore (Zero-Secrets).
 */
export function autoLoadEnv() {
  if (typeof process.loadEnvFile === 'function') {
    const candidates = [
      join(ROOT, '.env'),
      join(ROOT, '.env.local'),
      join(ROOT, 'cuentas', 'stremiojn', '.env'),
      join(ROOT, 'cuentas', 'solotveg', '.env'),
      join(ROOT, 'cuentas', 'stremioeg', '.env'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        try {
          process.loadEnvFile(p);
        } catch {
          // Ignorar si hay problemas de parseo
        }
      }
    }
  }

  // Normalizar credenciales por defecto para scripts que leen ST_EMAIL/ST_PASS o STREMIO_EMAIL/STREMIO_PASS
  if (process.env.ST_EMAIL_EG && !process.env.ST_EMAIL) {
    process.env.ST_EMAIL = process.env.ST_EMAIL_EG;
  }
  if (process.env.ST_PASS_EG && !process.env.ST_PASS) {
    process.env.ST_PASS = process.env.ST_PASS_EG;
  }
  if (process.env.ST_EMAIL_EG && !process.env.STREMIO_EMAIL) {
    process.env.STREMIO_EMAIL = process.env.ST_EMAIL_EG;
  }
  if (process.env.ST_PASS_EG && !process.env.STREMIO_PASS) {
    process.env.STREMIO_PASS = process.env.ST_PASS_EG;
  }
}

autoLoadEnv();
