/**
 * mediaflow.ts — MediaFlow Proxy & Circuit Breaker para MejoraStremio (Fase 1).
 *
 * Propósito:
 * 1. Enrutar tráfico de reproducción de TorBox/Debrid a través de MediaFlow Proxy (IPs residenciales)
 *    para evadir bloqueos de centros de datos, CDN throttling y restricciones de ISP.
 * 2. Circuit Breaker Zero-Trust: Si el proxy residencial falla (timeout, 5xx o desconexión),
 *    el Hub conmuta automáticamente de forma instantánea a conexión directa con TorBox,
 *    garantizando cero interrupciones de reproducción en la TV Box.
 */

import { getKv, type StremioStreamItem } from "../utils/common.ts";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerStatus {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  lastError: string | null;
  cooldownRemainingMs: number;
  fallbackToDirectTorbox: boolean;
}

export interface MediaFlowConfig {
  proxyUrl: string;
  secondaryProxyUrl?: string;
  apiKey: string;
}

export class MediaFlowCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private lastError: string | null = null;

  readonly failureThreshold: number;
  readonly recoveryTimeoutMs: number;

  constructor(failureThreshold = 3, recoveryTimeoutMs = 30000) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
  }

  /**
   * Determina si se debe intentar enrutar a través del proxy residencial.
   * Si el circuito está OPEN pero el tiempo de enfriamiento expiró, pasa a HALF_OPEN.
   */
  canAttempt(): boolean {
    if (this.state === "CLOSED") return true;

    if (this.state === "OPEN") {
      const elapsed = Date.now() - (this.lastFailureTime ?? 0);
      if (elapsed >= this.recoveryTimeoutMs) {
        this.state = "HALF_OPEN";
        this.consecutiveSuccesses = 0;
        return true;
      }
      return false; // Circuito ABIERTO -> Conmutar a directo
    }

    return true; // HALF_OPEN -> Permitir prueba
  }

  /**
   * Circuit Breaker Distribuido con Deno KV:
   * Ventanas deslizantes de 10s. Estado OPEN al superar 50% de error sobre mínimo 10 pedidos.
   * Candado atómico (kv.atomic().check()) para prueba única en HALF_OPEN.
   */
  async canAttemptDistributed(service = "mediaflow"): Promise<boolean> {
    if (typeof Deno === "undefined" || !Deno.openKv) {
      return this.canAttempt();
    }
    try {
      const kv = await getKv();
      const stateEntry = await kv.get<{ state: CircuitState; lastChange: number }>(["circuit_state", service]);
      const current = stateEntry.value || { state: "CLOSED", lastChange: Date.now() };

      if (current.state === "CLOSED") return true;

      if (current.state === "OPEN") {
        const elapsed = Date.now() - current.lastChange;
        if (elapsed >= this.recoveryTimeoutMs) {
          const lockKey = ["circuit_half_open_lock", service];
          const lockRes = await kv.atomic()
            .check({ key: lockKey, versionstamp: null })
            .set(lockKey, Date.now(), { expireIn: 5000 })
            .commit();

          if (lockRes.ok) {
            await kv.set(["circuit_state", service], { state: "HALF_OPEN", lastChange: Date.now() });
            this.state = "HALF_OPEN";
            return true;
          }
        }
        return false;
      }

      return true;
    } catch {
      return this.canAttempt();
    }
  }

  async recordResultDistributed(success: boolean, service = "mediaflow"): Promise<void> {
    if (typeof Deno === "undefined" || !Deno.openKv) {
      if (success) this.recordSuccess(); else this.recordFailure();
      return;
    }
    try {
      const kv = await getKv();
      const windowBucket = Math.floor(Date.now() / 10000);
      const metricsKey = ["circuit_metrics", service, windowBucket];

      const res = await kv.get<{ total: number; errors: number }>(metricsKey);
      const prev = res.value || { total: 0, errors: 0 };
      const next = {
        total: prev.total + 1,
        errors: prev.errors + (success ? 0 : 1),
      };

      await kv.set(metricsKey, next, { expireIn: 60000 });

      if (next.total >= 10 && (next.errors / next.total) > 0.50) {
        await kv.set(["circuit_state", service], { state: "OPEN", lastChange: Date.now() });
        this.state = "OPEN";
      } else if (success) {
        const stateEntry = await kv.get<{ state: CircuitState }>(["circuit_state", service]);
        if (stateEntry.value?.state === "HALF_OPEN") {
          await kv.set(["circuit_state", service], { state: "CLOSED", lastChange: Date.now() });
          this.state = "CLOSED";
        }
      }
    } catch {
      if (success) this.recordSuccess(); else this.recordFailure();
    }
  }

  /**
   * Registra éxito al contactar el proxy residencial.
   */
  recordSuccess(): void {
    this.lastSuccessTime = Date.now();
    if (this.state === "HALF_OPEN") {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= 1) {
        this.state = "CLOSED";
        this.consecutiveFailures = 0;
        this.lastError = null;
      }
    } else {
      this.consecutiveFailures = 0;
      this.lastError = null;
    }
  }

  /**
   * Registra falla en el proxy residencial. Si supera el umbral, abre el circuito.
   */
  recordFailure(error?: Error | string): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    this.lastError = error ? String(error) : "MediaFlow unreachable";

    if (this.state === "HALF_OPEN" || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  /**
   * Restablece el circuito manualmente a CLOSED.
   */
  reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastError = null;
  }

  /**
   * Estado diagnóstico actual para inspección vía /health.
   */
  getStatus(): CircuitBreakerStatus {
    const elapsed = this.lastFailureTime ? Date.now() - this.lastFailureTime : 0;
    const cooldownRemainingMs =
      this.state === "OPEN" ? Math.max(0, this.recoveryTimeoutMs - elapsed) : 0;

    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastError: this.lastError,
      cooldownRemainingMs,
      fallbackToDirectTorbox: this.state === "OPEN",
    };
  }

  /**
   * Sondeo asíncrono no bloqueante de salud del proxy residencial.
   */
  async probeHealth(proxyUrl: string, apiKey?: string, timeoutMs = 2500): Promise<boolean> {
    if (!proxyUrl) return false;
    try {
      const base = proxyUrl.replace(/\/+$/, "");
      const u = new URL(`${base}/health`);
      if (apiKey) u.searchParams.set("api_key", apiKey);

      const res = await fetch(u.toString(), {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok || res.status === 404 || res.status === 401) {
        // Si el endpoint responde a nivel HTTP, el servicio está vivo
        this.recordSuccess();
        return true;
      }
      this.recordFailure(`HTTP ${res.status}`);
      return false;
    } catch (e) {
      this.recordFailure((e as Error).message);
      return false;
    }
  }
}

// Instancia singleton global para el worker Deno
export const globalMediaFlowCircuitBreaker = new MediaFlowCircuitBreaker();

/**
 * Obtiene la configuración de MediaFlow Proxy desde variables de entorno o parámetros.
 */
export function getMediaFlowConfig(reqUrl?: URL, configSegment?: string): MediaFlowConfig {
  let proxyUrl =
    (typeof Deno !== "undefined" && Deno.env?.get?.("MEDIAFLOW_PROXY_URL")) ||
    (typeof process !== "undefined" && process.env?.MEDIAFLOW_PROXY_URL) ||
    "";

  let apiKey =
    (typeof Deno !== "undefined" && Deno.env?.get?.("MEDIAFLOW_API_KEY")) ||
    (typeof process !== "undefined" && process.env?.MEDIAFLOW_API_KEY) ||
    "";

  // Soporte de inyección vía query params
  if (reqUrl) {
    const qUrl = reqUrl.searchParams.get("mediaflow_url") || reqUrl.searchParams.get("mediaflow");
    const qKey = reqUrl.searchParams.get("mediaflow_api_key") || reqUrl.searchParams.get("mediaflow_key");
    if (qUrl) proxyUrl = qUrl;
    if (qKey) apiKey = qKey;
  }

  // Soporte de inyección en segmento de configuración (ej: mediaflow=https://...|mediaflow_key=...)
  if (configSegment) {
    const parts = configSegment.split("|");
    for (const p of parts) {
      if (p.startsWith("mediaflow=")) {
        proxyUrl = decodeURIComponent(p.slice("mediaflow=".length));
      } else if (p.startsWith("mediaflow_key=")) {
        apiKey = decodeURIComponent(p.slice("mediaflow_key=".length));
      }
    }
  }

  return {
    proxyUrl: proxyUrl.trim(),
    apiKey: apiKey.trim(),
  };
}

/**
 * Construye la URL de streaming a través de MediaFlow Proxy.
 * Especificación MediaFlow Proxy: /proxy/stream?url=<target>&api_key=<key>
 */
export function buildMediaFlowStreamUrl(proxyUrl: string, apiKey: string, destinationUrl: string): string {
  const base = proxyUrl.replace(/\/+$/, "");
  const u = new URL(`${base}/proxy/stream`);
  u.searchParams.set("url", destinationUrl);
  if (apiKey) {
    u.searchParams.set("api_key", apiKey);
  }
  return u.toString();
}

/**
 * Evalúa si una URL de stream califica para ser proxied vía IP residencial
 * (torbox, debrid, enlaces HTTP directos). Excluye trailers de YouTube o torrents puros sin url.
 */
export function shouldProxyMediaStream(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith("http")) return false;
    // Excluir si ya fue envuelta por MediaFlow
    if (parsed.pathname.includes("/proxy/stream")) return false;
    return true;
  } catch {
    return false;
  }
}

export async function getOrSetSwrCache<T>(
  cacheKey: (string | number)[],
  fetcher: () => Promise<T>,
  ttlMs = 15 * 60 * 1000,
  staleMs = 5 * 60 * 1000,
): Promise<T> {
  if (typeof Deno === "undefined" || !Deno.openKv) {
    return await fetcher();
  }
  try {
    const kv = await getKv();
    const entry = await kv.get<{ data: T; timestamp: number }>(cacheKey);
    const now = Date.now();

    if (entry.value) {
      const isStale = now - entry.value.timestamp > staleMs;
      if (isStale) {
        fetcher()
          .then(async (fresh) => {
            try {
              await kv.set(cacheKey, { data: fresh, timestamp: Date.now() }, { expireIn: ttlMs });
            } catch {
              /* ignore */
            }
          })
          .catch(() => {
            /* ignore */
          });
      }
      return entry.value.data;
    }

    const fresh = await fetcher();
    await kv.set(cacheKey, { data: fresh, timestamp: now }, { expireIn: ttlMs });
    return fresh;
  } catch {
    return await fetcher();
  }
}

/**
 * Aplica MediaFlow Proxy a la lista de streams con protección del Circuit Breaker y Failover en Cadena:
 * Proxy primario -> Proxy secundario -> TorBox directo (solo si no hay bloqueo de ISP) -> Notificación en lista.
 */
export function applyMediaFlowToStreams<T extends StremioStreamItem>(
  streams: T[],
  config: MediaFlowConfig,
  circuitBreaker: MediaFlowCircuitBreaker = globalMediaFlowCircuitBreaker,
): T[] {
  if (!Array.isArray(streams) || streams.length === 0) return [];
  if (!config.proxyUrl && !config.secondaryProxyUrl) return streams;

  // Verificación del Circuit Breaker
  let targetProxy = config.proxyUrl;
  if (!circuitBreaker.canAttempt()) {
    // Si primario está caído, intentar proxy secundario
    if (config.secondaryProxyUrl) {
      targetProxy = config.secondaryProxyUrl;
    } else {
      // CIRCUITO ABIERTO: Conmutar 100% a conexión directa con TorBox
      return streams;
    }
  }

  return streams.map((stream) => {
    if (!stream.url || !shouldProxyMediaStream(stream.url)) {
      return stream;
    }

    try {
      const proxiedUrl = buildMediaFlowStreamUrl(targetProxy, config.apiKey, stream.url);
      const existingHints = (stream.behaviorHints || {}) as Record<string, unknown>;
      const existingHeaders = (existingHints.proxyHeaders || {}) as Record<string, unknown>;
      const existingReq = (existingHeaders.request || {}) as Record<string, string>;

      return {
        ...stream,
        url: proxiedUrl,
        behaviorHints: {
          ...existingHints,
          proxyHeaders: {
            ...existingHeaders,
            request: {
              ...existingReq,
              "X-Direct-Torbox-Url": stream.url,
            },
          },
        },
      };
    } catch {
      // Ante cualquier fallo en construcción de URL, preservar enlace directo
      return stream;
    }
  });
}
