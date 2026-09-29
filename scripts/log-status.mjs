#!/usr/bin/env node
/**
 * log-status.mjs â€” Registra el resultado de una corrida automatizada (health-monitor,
 * daily-catalog-refresh, anti-frustration-review, premiere-radar) en un log interno
 * (data/internal-log.jsonl) que NO se manda por mail a Pablo â€” pensado para que Gemini lo lea
 * en sesiones futuras: cÃ³mo viene funcionando la cuenta dÃ­a a dÃ­a, y material crudo para inferir
 * gustos/uso con el tiempo (a pedido explÃ­cito de Pablo, ver GEMINI.md).
 *
 * Uso: node scripts/log-status.mjs <source> <status> < output.txt
 *   <status> = ok | warn | error   (libre, no se valida â€” cada workflow decide su propio criterio)
 *
 * Filtra del output las lÃ­neas de chequeo rutinario ("  âœ“ ...") para no acumular ruido â€” conserva
 * encabezados, advertencias (âš ), errores (âœ—), resÃºmenes finales y cualquier lÃ­nea con otro formato
 * (âœ…/â³/LISTO_NUEVO/etc., que ya vienen usando otros scripts del repo).
 *
 * Poda entradas de mÃ¡s de RETENTION_DAYS para no crecer sin lÃ­mite.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, '..', 'data', 'internal-log.jsonl');
const RETENTION_DAYS = 90;

const [, , source, status] = process.argv;
if (!source || !status) {
  console.error('Uso: node scripts/log-status.mjs <source> <status> < output.txt');
  process.exit(1);
}

const raw = readFileSync(0, 'utf8');
const summary = raw
  .split('\n')
  .filter((l) => !/^\s*âœ“/.test(l))
  .join('\n')
  .trim();

const entries = existsSync(LOG_PATH)
  ? readFileSync(LOG_PATH, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];

const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
const kept = entries.filter((e) => new Date(e.date).getTime() >= cutoff);
kept.push({ date: new Date().toISOString(), source, status, summary });

mkdirSync(dirname(LOG_PATH), { recursive: true });
writeFileSync(LOG_PATH, kept.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log(`âœ“ Log interno actualizado (${kept.length} entradas, retenciÃ³n ${RETENTION_DAYS}d).`);
