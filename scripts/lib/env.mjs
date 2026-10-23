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
}

autoLoadEnv();
