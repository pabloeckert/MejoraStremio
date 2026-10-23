/**
 * telemetry.ts — Módulo de Telemetría, Latencias y Seguridad para MejoraStremio v3.0.1.
 *
 * Funcionalidad:
 * 1. Registro de latencias por scraper y API de TorBox con cálculo de percentiles p50 y p95.
 * 2. Cálculo de edad del último refresh de catálogo.
 * 3. Verificación de seguridad mediante Token simple y Firma HMAC (Web Crypto API).
 * 4. Garantía Zero-Secrets: jamás expone tokens de TorBox, claves de APIs ni URLs internas.
 */

import { timingSafeEqualString } from "./utils/crypto_security.ts";
import { BoundedLruCache } from "./utils/lru-cache.ts";
import { safeEnv } from "./utils/common.ts";
export { getTorboxTokenStatus } from "./utils/torbox_telemetry.ts";

export interface LatencyPercentiles {
  p50Ms: number;
  p95Ms: number;
  sampleCount: number;
}

export interface ScraperTelemetry {
  [scraperName: string]: LatencyPercentiles & { timeouts: number };
}

export interface TorboxTelemetry {
  p50Ms: number;
  p95Ms: number;
  lastLatencyMs: number;
  sampleCount: number;
}

export interface CatalogRefreshInfo {
  lastRefreshDate: string;
  ageMs: number;
  ageDays: number;
}

export interface SystemTelemetry {
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  catalog: CatalogRefreshInfo;
}

// Búferes circulares de latencias acotados con BoundedLruCache (anti-OOM en Deno Deploy)
const MAX_SAMPLES = 100;
const scraperLatencies = new BoundedLruCache<string, number[]>(50, 24 * 60 * 60 * 1000);
const scraperTimeoutCounts = new BoundedLruCache<string, number>(50, 24 * 60 * 60 * 1000);
const torboxLatencies: number[] = [];
let lastTorboxLatencyMs = 0;
const startTime = Date.now();

// Fecha de referencia del último refresh de catálogo (preset.json)
let catalogRefreshTimestamp: number = Date.parse("2026-10-10T10:00:00Z");

export function setCatalogRefreshTimestamp(ts: number | string): void {
  catalogRefreshTimestamp = typeof ts === "number" ? ts : Date.parse(ts);
}

export function recordScraperLatency(scraperName: string, durationMs: number, isTimeout = false): void {
  const norm = scraperName.toLowerCase().trim();
  let samples = scraperLatencies.get(norm);
  if (!samples) {
    samples = [];
    scraperLatencies.set(norm, samples);
    scraperTimeoutCounts.set(norm, 0);
  }
  samples.push(Math.round(durationMs));
  if (samples.length > MAX_SAMPLES) {
    samples.shift();
  }
  scraperLatencies.set(norm, samples);
  if (isTimeout) {
    const currentCount = scraperTimeoutCounts.get(norm) || 0;
    scraperTimeoutCounts.set(norm, currentCount + 1);
  }
}

export function recordTorboxLatency(durationMs: number): void {
  const rounded = Math.round(durationMs);
  lastTorboxLatencyMs = rounded;
  torboxLatencies.push(rounded);
  if (torboxLatencies.length > MAX_SAMPLES) {
    torboxLatencies.shift();
  }
}

export function calculatePercentiles(samples: number[]): LatencyPercentiles {
  if (!samples.length) {
    return { p50Ms: 0, p95Ms: 0, sampleCount: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p50Idx = Math.floor(sorted.length * 0.5);
  const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));

  return {
    p50Ms: sorted[p50Idx],
    p95Ms: sorted[p95Idx],
    sampleCount: sorted.length,
  };
}

export function getScrapersTelemetry(): ScraperTelemetry {
  const result: ScraperTelemetry = {};
  // Aseguramos scrapers estándar aunque no tengan muestras aún
  const defaultScrapers = ["subdl", "opensubtitles", "subsource", "wyziesubs", "cinemeta", "torrentio"];
  for (const name of defaultScrapers) {
    if (!scraperLatencies.has(name)) {
      result[name] = { p50Ms: 0, p95Ms: 0, sampleCount: 0, timeouts: 0 };
    }
  }

  for (const [name, samples] of scraperLatencies.entries()) {
    const stats = calculatePercentiles(samples);
    result[name] = {
      ...stats,
      timeouts: scraperTimeoutCounts.get(name) || 0,
    };
  }
  return result;
}

export function getTorboxTelemetry(): TorboxTelemetry {
  const stats = calculatePercentiles(torboxLatencies);
  return {
    ...stats,
    lastLatencyMs: lastTorboxLatencyMs,
  };
}

export function getCatalogRefreshInfo(): CatalogRefreshInfo {
  const now = Date.now();
  const ageMs = Math.max(0, now - catalogRefreshTimestamp);
  const ageDays = Math.round((ageMs / 86400000) * 10) / 10;
  return {
    lastRefreshDate: new Date(catalogRefreshTimestamp).toISOString().slice(0, 10),
    ageMs,
    ageDays,
  };
}

export function getSystemTelemetry(): SystemTelemetry {
  return {
    version: "3.1.0",
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    catalog: getCatalogRefreshInfo(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Seguridad: Firma HMAC y Token de Telemetría
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera la firma HMAC-SHA256 para un timestamp dado y una clave secreta.
 */
export async function generateHmacSignature(timestamp: number | string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = encoder.encode(`/health:${timestamp}`);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Valida la autenticación de la petición a /health:
 * 1. Si no hay TELEMETRY_TOKEN ni HMAC_TELEMETRY_SECRET configurados en env -> Permite acceso público seguro (redactado).
 * 2. Si TELEMETRY_TOKEN está configurado: valida contra query param `token` o cabecera `x-telemetry-token`.
 * 3. Si HMAC_TELEMETRY_SECRET está configurado: valida query params `sig` y `timestamp` (ventana de 5 minutos).
 */
export async function verifyTelemetryAuth(url: URL, headers?: Headers): Promise<boolean> {
  const envToken = safeEnv("TELEMETRY_TOKEN");
  const envHmacSecret = safeEnv("HMAC_TELEMETRY_SECRET");
  const prevHmacSecret = safeEnv("HMAC_TELEMETRY_PREVIOUS_SECRET");

  // Si no se han establecido secretos de protección en el entorno, el acceso es libre (solo-lectura seguro)
  if (!envToken && !envHmacSecret) {
    return true;
  }

  // 1. Verificación por Token Simple (en tiempo constante)
  if (envToken) {
    const queryToken = url.searchParams.get("token");
    const headerToken = headers?.get("x-telemetry-token") || headers?.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (queryToken && timingSafeEqualString(queryToken, envToken)) {
      return true;
    }
    if (headerToken && timingSafeEqualString(headerToken, envToken)) {
      return true;
    }
  }

  // 2. Verificación por Firma HMAC (tiempo constante + soporte de clave previa)
  if (envHmacSecret) {
    const sig = url.searchParams.get("sig") || headers?.get("x-telemetry-signature");
    const timestampStr = url.searchParams.get("timestamp") || headers?.get("x-telemetry-timestamp");

    if (sig && timestampStr) {
      const ts = parseInt(timestampStr, 10);
      const now = Date.now();
      // Ventana de tolerancia: 5 minutos (300.000 ms)
      if (!isNaN(ts) && Math.abs(now - ts) <= 300000) {
        const expectedSig = await generateHmacSignature(timestampStr, envHmacSecret);
        if (timingSafeEqualString(sig.toLowerCase(), expectedSig.toLowerCase())) {
          return true;
        }
        // Soporte de clave previa durante ventana de rotación
        if (prevHmacSecret && prevHmacSecret !== envHmacSecret) {
          const expectedPrev = await generateHmacSignature(timestampStr, prevHmacSecret);
          if (timingSafeEqualString(sig.toLowerCase(), expectedPrev.toLowerCase())) {
            return true;
          }
        }
      }
    }
  }

  return false;
}
