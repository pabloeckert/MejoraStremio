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

import type { StremioStreamItem } from "../utils/common.ts";

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

/**
 * Aplica MediaFlow Proxy a la lista de streams con protección del Circuit Breaker.
 * Si MediaFlow Proxy no está configurado o si el Circuit Breaker está en estado OPEN,
 * devuelve los streams con las URLs directas de TorBox sin modificación ("conmutación automática").
 */
export function applyMediaFlowToStreams<T extends StremioStreamItem>(
  streams: T[],
  config: MediaFlowConfig,
  circuitBreaker: MediaFlowCircuitBreaker = globalMediaFlowCircuitBreaker,
): T[] {
  if (!Array.isArray(streams) || streams.length === 0) return [];
  if (!config.proxyUrl) return streams;

  // Verificación del Circuit Breaker
  if (!circuitBreaker.canAttempt()) {
    // CIRCUITO ABIERTO: Conmutar 100% a conexión directa con TorBox
    return streams;
  }

  return streams.map((stream) => {
    if (!stream.url || !shouldProxyMediaStream(stream.url)) {
      return stream;
    }

    try {
      const proxiedUrl = buildMediaFlowStreamUrl(config.proxyUrl, config.apiKey, stream.url);
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
