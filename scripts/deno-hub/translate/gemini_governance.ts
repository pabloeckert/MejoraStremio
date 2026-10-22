/**
 * gemini_governance.ts — Gobernanza y Resiliencia para Gemini Flash (P7).
 *
 * Implementa:
 * 1. Control de cuota diaria de peticiones/costo con fallback transparente.
 * 2. Circuito dedicado para errores HTTP 429 (Too Many Requests) con backoff exponencial.
 *
 * Alcance exclusivo: Android TV ZTE ZXV10 B866V2.
 */

import { getKv, safeEnv } from "../utils/common.ts";

export const DEFAULT_GEMINI_DAILY_LIMIT = Number(safeEnv("GEMINI_DAILY_LIMIT")) || 1500;
export const INITIAL_429_COOLDOWN_MS = 30_000; // 30 segundos
export const MAX_429_COOLDOWN_MS = 300_000;    // 5 minutos

export type GeminiCircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface GeminiCircuitData {
  state: GeminiCircuitState;
  consecutive429: number;
  cooldownUntil: number;
  lastFailureTime: number;
  lastSuccessTime: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  date: string;
}

export interface CircuitCheckResult {
  state: GeminiCircuitState;
  allowed: boolean;
  cooldownRemainingMs: number;
  consecutive429: number;
}

export function getTodayDateString(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function checkGeminiDailyQuota(
  customKv?: Deno.Kv | null,
  limit = DEFAULT_GEMINI_DAILY_LIMIT,
): Promise<QuotaCheckResult> {
  const kv = customKv ?? (await getKv());
  const dateStr = getTodayDateString();
  const quotaKey = ["gemini_governance", "quota", dateStr];

  if (!kv) {
    return { allowed: true, used: 0, limit, remaining: limit, date: dateStr };
  }

  try {
    const res = await kv.get<number>(quotaKey);
    const used = typeof res.value === "number" ? res.value : 0;
    const allowed = used < limit;
    const remaining = Math.max(0, limit - used);
    return { allowed, used, limit, remaining, date: dateStr };
  } catch {
    return { allowed: true, used: 0, limit, remaining: limit, date: dateStr };
  }
}

export async function recordGeminiUsage(
  customKv?: Deno.Kv | null,
  increment = 1,
): Promise<{ used: number; remaining: number }> {
  const kv = customKv ?? (await getKv());
  const dateStr = getTodayDateString();
  const quotaKey = ["gemini_governance", "quota", dateStr];
  const limit = DEFAULT_GEMINI_DAILY_LIMIT;

  if (!kv) {
    return { used: increment, remaining: Math.max(0, limit - increment) };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await kv.get<number>(quotaKey);
    const prev = typeof res.value === "number" ? res.value : 0;
    const next = prev + increment;

    // TTL de 48 horas para limpieza automática de días anteriores
    const commit = await kv.atomic()
      .check(res)
      .set(quotaKey, next, { expireIn: 48 * 60 * 60 * 1000 })
      .commit();

    if (commit.ok) {
      return { used: next, remaining: Math.max(0, limit - next) };
    }
  }

  return { used: increment, remaining: limit };
}

export async function checkGemini429Circuit(
  customKv?: Deno.Kv | null,
): Promise<CircuitCheckResult> {
  const kv = customKv ?? (await getKv());
  const circuitKey = ["gemini_governance", "circuit_429"];

  if (!kv) {
    return { state: "CLOSED", allowed: true, cooldownRemainingMs: 0, consecutive429: 0 };
  }

  try {
    const res = await kv.get<GeminiCircuitData>(circuitKey);
    const now = Date.now();
    const data = res.value;

    if (!data || data.state === "CLOSED") {
      return { state: "CLOSED", allowed: true, cooldownRemainingMs: 0, consecutive429: 0 };
    }

    if (data.state === "OPEN") {
      if (now >= data.cooldownUntil) {
        // Cooldown expiró -> Transición a HALF_OPEN para admitir sonda de prueba
        const updated: GeminiCircuitData = {
          ...data,
          state: "HALF_OPEN",
        };
        await kv.set(circuitKey, updated, { expireIn: 24 * 60 * 60 * 1000 });
        return {
          state: "HALF_OPEN",
          allowed: true,
          cooldownRemainingMs: 0,
          consecutive429: data.consecutive429,
        };
      }

      // Sigue en cooldown
      const remainingMs = Math.max(0, data.cooldownUntil - now);
      return {
        state: "OPEN",
        allowed: false,
        cooldownRemainingMs: remainingMs,
        consecutive429: data.consecutive429,
      };
    }

    if (data.state === "HALF_OPEN") {
      return {
        state: "HALF_OPEN",
        allowed: true,
        cooldownRemainingMs: 0,
        consecutive429: data.consecutive429,
      };
    }

    return { state: "CLOSED", allowed: true, cooldownRemainingMs: 0, consecutive429: 0 };
  } catch {
    return { state: "CLOSED", allowed: true, cooldownRemainingMs: 0, consecutive429: 0 };
  }
}

export async function recordGemini429Error(
  customKv?: Deno.Kv | null,
): Promise<{ state: "OPEN"; cooldownMs: number; consecutive429: number }> {
  const kv = customKv ?? (await getKv());
  const circuitKey = ["gemini_governance", "circuit_429"];
  const now = Date.now();

  if (!kv) {
    return { state: "OPEN", cooldownMs: INITIAL_429_COOLDOWN_MS, consecutive429: 1 };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await kv.get<GeminiCircuitData>(circuitKey);
    const prev = res.value;
    const consecutive = (prev?.consecutive429 || 0) + 1;

    // Backoff exponencial: 30s * 2^(n-1), tope en 5 minutos
    const cooldownMs = Math.min(
      MAX_429_COOLDOWN_MS,
      INITIAL_429_COOLDOWN_MS * Math.pow(2, Math.min(consecutive - 1, 6)),
    );
    const cooldownUntil = now + cooldownMs;

    const nextData: GeminiCircuitData = {
      state: "OPEN",
      consecutive429: consecutive,
      cooldownUntil,
      lastFailureTime: now,
      lastSuccessTime: prev?.lastSuccessTime || 0,
    };

    const commit = await kv.atomic()
      .check(res)
      .set(circuitKey, nextData, { expireIn: 24 * 60 * 60 * 1000 })
      .commit();

    if (commit.ok) {
      return { state: "OPEN", cooldownMs, consecutive429: consecutive };
    }
  }

  return { state: "OPEN", cooldownMs: INITIAL_429_COOLDOWN_MS, consecutive429: 1 };
}

export async function recordGeminiSuccess(
  customKv?: Deno.Kv | null,
): Promise<void> {
  const kv = customKv ?? (await getKv());
  const circuitKey = ["gemini_governance", "circuit_429"];

  if (!kv) return;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await kv.get<GeminiCircuitData>(circuitKey);
    if (!res.value || res.value.state === "CLOSED") {
      return; // Ya está cerrado
    }

    const nextData: GeminiCircuitData = {
      state: "CLOSED",
      consecutive429: 0,
      cooldownUntil: 0,
      lastFailureTime: res.value.lastFailureTime || 0,
      lastSuccessTime: Date.now(),
    };

    const commit = await kv.atomic()
      .check(res)
      .set(circuitKey, nextData, { expireIn: 24 * 60 * 60 * 1000 })
      .commit();

    if (commit.ok) return;
  }
}

export async function resetGeminiGovernanceForTesting(
  customKv?: Deno.Kv | null,
): Promise<void> {
  const kv = customKv ?? (await getKv());
  if (!kv) return;
  const dateStr = getTodayDateString();
  await kv.delete(["gemini_governance", "quota", dateStr]);
  await kv.delete(["gemini_governance", "circuit_429"]);
}
