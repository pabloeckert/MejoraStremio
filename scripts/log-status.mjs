#!/usr/bin/env node
/**
 * log-status.mjs — Registra el resultado de una corrida automatizada (health-monitor,
 * daily-catalog-refresh, anti-frustration-review, premiere-radar) en un log interno
 * (data/internal-log.jsonl) que NO se manda por mail a Pablo — pensado para que Claude lo lea
 * en sesiones futuras: cómo viene funcionando la cuenta día a día, y material crudo para inferir
 * gustos/uso con el tiempo (a pedido explícito de Pablo, ver CLAUDE.md).
 *
 * Uso: node scripts/log-status.mjs <source> <status> < output.txt
 *   <status> = ok | warn | error   (libre, no se valida — cada workflow decide su propio criterio)
 *
 * Filtra del output las líneas de chequeo rutinario ("  ✓ ...") para no acumular ruido — conserva
 * encabezados, advertencias (⚠), errores (✗), resúmenes finales y cualquier línea con otro formato
 * (✅/⏳/LISTO_NUEVO/etc., que ya vienen usando otros scripts del repo).
 *
 * Poda entradas de más de RETENTION_DAYS para no crecer sin límite.
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
  .filter((l) => !/^\s*✓/.test(l))
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
console.log(`✓ Log interno actualizado (${kept.length} entradas, retención ${RETENTION_DAYS}d).`);
