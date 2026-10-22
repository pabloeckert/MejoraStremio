/**
 * canary_governance.ts — Gestión y Gobernanza del Despliegue Canario v1.5.0-RC (P9).
 *
 * Controla la activación aislada y quirúrgica de v1.5.0 en la cuenta 'stremiojn' (Joaquín)
 * bajo la clave Deno KV ["flags", "rc_v150"].
 * Si se detectan anomalías o se apaga la bandera, conmuta instantáneamente al baseline v1.4.2
 * sin tocar ni degradar las cuentas en producción ('stremioeg' y 'solotveg').
 */

export interface CanaryFlagConfig {
  enabled: boolean;
  canaryAccounts: string[];
  rollbackBaseline: string;
  version: string;
  reason?: string;
  updatedAt: number;
}

export const CANARY_KV_KEY: Deno.KvKey = ["flags", "rc_v150"];

export const DEFAULT_CANARY_CONFIG: CanaryFlagConfig = {
  enabled: false,
  canaryAccounts: ["stremiojn", "stremiojn@gmail.com"],
  rollbackBaseline: "v1.4.2",
  version: "v1.5.0-rc",
  updatedAt: 0,
};

/**
 * Normaliza el identificador de perfil para comparación determinista.
 */
export function normalizeProfile(profile?: string | null): string {
  if (!profile) return "";
  return profile.trim().toLowerCase().replace(/@gmail\.com$/, "");
}

/**
 * Obtiene la configuración del flag canario desde Deno KV o fallback seguro.
 */
export async function getCanaryConfig(kv?: Deno.Kv | null): Promise<CanaryFlagConfig> {
  if (!kv) {
    return { ...DEFAULT_CANARY_CONFIG, updatedAt: Date.now() };
  }
  try {
    const entry = await kv.get<CanaryFlagConfig>(CANARY_KV_KEY);
    if (entry && entry.value) {
      return entry.value;
    }
  } catch {
    // Continuar con default ante error transitorio de KV
  }
  return { ...DEFAULT_CANARY_CONFIG, updatedAt: Date.now() };
}

/**
 * Persiste la configuración del flag canario en Deno KV.
 */
export async function setCanaryConfig(
  kv: Deno.Kv,
  updates: Partial<CanaryFlagConfig>,
): Promise<CanaryFlagConfig> {
  const current = await getCanaryConfig(kv);
  const next: CanaryFlagConfig = {
    ...current,
    ...updates,
    updatedAt: Date.now(),
  };
  await kv.set(CANARY_KV_KEY, next);
  return next;
}

/**
 * Evalúa si un perfil pertenece a la lista de cuentas autorizadas para el canario.
 */
export function isCanaryProfile(profile: string, config: CanaryFlagConfig): boolean {
  const norm = normalizeProfile(profile);
  if (!norm) return false;
  return config.canaryAccounts.some((acc) => normalizeProfile(acc) === norm);
}

/**
 * Determina si las características de v1.5.0-RC están activas para un perfil dado.
 * Garantía: Las cuentas 'stremioeg' y 'solotveg' SIEMPRE retornan false mientras
 * el canario esté restringido a 'stremiojn'.
 */
export async function isCanaryActiveForProfile(
  profile: string,
  kv?: Deno.Kv | null,
): Promise<{ active: boolean; version: string; baseline: string }> {
  const config = await getCanaryConfig(kv);
  if (!config.enabled) {
    return {
      active: false,
      version: config.rollbackBaseline,
      baseline: config.rollbackBaseline,
    };
  }

  const isCanary = isCanaryProfile(profile, config);
  if (isCanary) {
    return {
      active: true,
      version: config.version,
      baseline: config.rollbackBaseline,
    };
  }

  // Cuentas de producción no-canario reciben el baseline v1.4.2 intacto
  return {
    active: false,
    version: config.rollbackBaseline,
    baseline: config.rollbackBaseline,
  };
}

/**
 * Gatilla un Rollback Instantáneo al baseline v1.4.2 desactivando el flag canario.
 */
export async function triggerCanaryRollback(
  kv: Deno.Kv,
  reason = "Emergency rollback to baseline v1.4.2",
): Promise<CanaryFlagConfig> {
  return await setCanaryConfig(kv, {
    enabled: false,
    reason,
  });
}
