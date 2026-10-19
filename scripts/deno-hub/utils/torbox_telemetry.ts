/**
 * torbox_telemetry.ts — Monitoreo Preventivo de Cuota y Caducidad de TorBox (P8).
 *
 * Implementa:
 * 1. Verificación periódica de la validez del token de TorBox, días de suscripción restantes y cuota.
 * 2. Exposición del estado de vigencia en telemetría interna garantizando Zero-Secrets (sin revelar la API key).
 * 3. Caché bounded de 1 hora para evitar saturar la API de TorBox en consultas sucesivas de /health.
 *
 * Alcance exclusivo: Android TV ZTE ZXV10 B866V2.
 */

export interface TorboxTokenStatus {
  valid: boolean;
  active: boolean;
  plan: string;
  planId?: number;
  daysRemaining: number;
  expiresAt: string | null;
  isExpired: boolean;
  isExpiringSoon: boolean; // true si quedan <= 7 días
  totalDownloadedBytes?: number;
  lastChecked: string;
  error?: string;
}

export type TorboxUserMeFetcher = (
  token: string,
) => Promise<{ success: boolean; data?: Record<string, unknown>; detail?: string; error?: string }>;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora de caché en memoria

let cachedStatus: TorboxTokenStatus | null = null;
let lastCheckTimestamp = 0;

/**
 * Consulta la API de TorBox (/v1/api/user/me) para verificar vigencia y plan de la cuenta.
 */
export async function defaultTorboxUserFetcher(
  token: string,
): Promise<{ success: boolean; data?: Record<string, unknown>; detail?: string; error?: string }> {
  try {
    const res = await fetch("https://api.torbox.app/v1/api/user/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      return {
        success: false,
        error: `HTTP ${res.status}: ${errTxt.slice(0, 100)}`,
      };
    }

    const json = await res.json();
    return json;
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
    };
  }
}

/**
 * Mapea el número o identificador de plan de TorBox a una descripción amigable.
 */
export function formatTorboxPlan(planId?: unknown): string {
  if (planId === 1) return "Essential (Debrid)";
  if (planId === 2) return "Pro (Debrid + Usenet)";
  if (planId === 3) return "Standard (Debrid)";
  if (typeof planId === "string" && planId.length > 0) return planId;
  return "Free / Desconocido";
}

/**
 * Obtiene el estado de vigencia, suscripción y cuota del token de TorBox.
 * Garantía Zero-Secrets: NUNCA expone el token en el resultado.
 */
export async function getTorboxTokenStatus(
  tokenOverride?: string,
  customFetcher?: TorboxUserMeFetcher,
  forceRefresh = false,
): Promise<TorboxTokenStatus> {
  const now = Date.now();

  // Si hay caché válida y no se fuerza refresco, devolver caché
  if (!forceRefresh && cachedStatus && (now - lastCheckTimestamp < CACHE_TTL_MS)) {
    return cachedStatus;
  }

  const token =
    tokenOverride ||
    (typeof Deno !== "undefined" && Deno.env?.get?.("TORBOX_API_KEY")) ||
    (typeof process !== "undefined" && process.env?.TORBOX_API_KEY) ||
    "";

  if (!token) {
    const unconfigured: TorboxTokenStatus = {
      valid: false,
      active: false,
      plan: "No configurado",
      daysRemaining: 0,
      expiresAt: null,
      isExpired: true,
      isExpiringSoon: true,
      lastChecked: new Date(now).toISOString(),
      error: "Token de TorBox no configurado en variables de entorno",
    };
    cachedStatus = unconfigured;
    lastCheckTimestamp = now;
    return unconfigured;
  }

  const fetcher = customFetcher || defaultTorboxUserFetcher;
  const result = await fetcher(token);

  if (!result.success || !result.data) {
    const failure: TorboxTokenStatus = {
      valid: false,
      active: false,
      plan: "Desconocido",
      daysRemaining: 0,
      expiresAt: null,
      isExpired: true,
      isExpiringSoon: true,
      lastChecked: new Date(now).toISOString(),
      error: result.error || result.detail || "Error al autenticar con TorBox API",
    };
    cachedStatus = failure;
    lastCheckTimestamp = now;
    return failure;
  }

  const d = result.data;
  const expiresAtStr = typeof d.expires_at === "string" ? d.expires_at : null;
  let daysRemaining = 999;
  let isExpired = false;

  if (expiresAtStr) {
    const expDate = new Date(expiresAtStr).getTime();
    if (!isNaN(expDate)) {
      daysRemaining = Math.max(0, Math.floor((expDate - now) / 86400000));
      isExpired = expDate <= now;
    }
  }

  const isExpiringSoon = !isExpired && daysRemaining <= 7;
  const planId = d.plan;
  const totalDownloaded = typeof d.total_downloaded === "number" ? d.total_downloaded : undefined;

  const status: TorboxTokenStatus = {
    valid: true,
    active: !isExpired,
    plan: formatTorboxPlan(planId),
    planId: typeof planId === "number" ? planId : undefined,
    daysRemaining,
    expiresAt: expiresAtStr,
    isExpired,
    isExpiringSoon,
    totalDownloadedBytes: totalDownloaded,
    lastChecked: new Date(now).toISOString(),
  };

  cachedStatus = status;
  lastCheckTimestamp = now;
  return status;
}

/**
 * Resetea la caché en memoria para pruebas unitarias.
 */
export function resetTorboxTelemetryCacheForTesting(): void {
  cachedStatus = null;
  lastCheckTimestamp = 0;
}
