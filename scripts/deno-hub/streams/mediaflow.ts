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
  halfOpenSuccessThreshold?: number;
  errorRate10s?: number;
  totalRequests10s?: number;
  errors10s?: number;
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
  private window10s = { bucket: 0, total: 0, errors: 0 };

  readonly failureThreshold: number;
  readonly recoveryTimeoutMs: number;
  readonly halfOpenSuccessThreshold: number;

  constructor(failureThreshold = 3, recoveryTimeoutMs = 30000, halfOpenSuccessThreshold = 3) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.halfOpenSuccessThreshold = halfOpenSuccessThreshold;
  }

  /**
   * Discrimina si un error es exclusivo del Proxy MediaFlow (5xx, conexión caída, timeout de proxy)
   * o si corresponde a un timeout/falla normal de scrapers de terceros (que NO deben abrir el circuito).
   */
  isProxyError(errOrStatus: unknown): boolean {
    if (typeof errOrStatus === "number") {
      return errOrStatus >= 500;
    }
    const msg = String(errOrStatus || "").toLowerCase();
    if (msg.includes("scraper timeout") || msg.includes("subdl") || msg.includes("opensubtitles") || msg.includes("wyzie")) {
      return false; // Error de scraper aislado
    }
    return msg.includes("mediaflow") || msg.includes("proxy") || msg.includes("econnrefused") || msg.includes("failed to fetch");
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
   * Candado atómico (kv.atomic().check()) para prueba controlada en HALF_OPEN.
   */
  async canAttemptDistributed(service = "mediaflow"): Promise<boolean> {
    if (typeof Deno === "undefined" || typeof Deno.openKv !== "function") {
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
            .set(lockKey, Date.now(), { expireIn: 10000 })
            .commit();

          if (lockRes.ok) {
            await kv.set(["circuit_state", service], { state: "HALF_OPEN", lastChange: Date.now() });
            await kv.set(["circuit_half_open_successes", service], 0, { expireIn: 30000 });
            this.state = "HALF_OPEN";
            this.consecutiveSuccesses = 0;
            return true;
          }
        }
        return false;
      }

      return true; // HALF_OPEN -> Permitir tráfico de sondeo
    } catch {
      return this.canAttempt();
    }
  }

  /**
   * Registra resultado en Deno KV con:
   * 1. Aislamiento estricto de timeouts de scrapers (no alteran tasa de error del proxy).
   * 2. Reintentos con backoff exponencial + jitter ante contención en kv.atomic().
   * 3. Histéresis en HALF_OPEN: exige N éxitos consecutivos para volver a CLOSED, o revierte a OPEN ante 1 falla.
   */
  async recordResultDistributed(success: boolean, service = "mediaflow", isScraperTimeout = false): Promise<void> {
    if (isScraperTimeout) {
      // Regla inviolable: los timeouts de scrapers (450ms) NO computan como fallo del Proxy
      return;
    }

    if (typeof Deno === "undefined" || typeof Deno.openKv !== "function") {
      if (success) this.recordSuccess(); else this.recordFailure();
      return;
    }

    try {
      const kv = await getKv();
      const windowBucket = Math.floor(Date.now() / 10000);
      const metricsKey = ["circuit_metrics", service, windowBucket];

      // Reintentos con backoff exponencial + jitter para resolver contención en kv.atomic()
      const maxRetries = 15;
      const baseDelayMs = 5;
      let committed = false;
      let nextMetrics = { total: 0, errors: 0 };

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const res = await kv.get<{ total: number; errors: number }>(metricsKey);
        const prev = res.value || { total: 0, errors: 0 };
        nextMetrics = {
          total: prev.total + 1,
          errors: prev.errors + (success ? 0 : 1),
        };

        const commitRes = await kv.atomic()
          .check(res)
          .set(metricsKey, nextMetrics, { expireIn: 60000 })
          .commit();

        if (commitRes.ok) {
          committed = true;
          break;
        }

        // Backoff exponencial + jitter: min(250, (2^min(attempt, 6) * 5ms) + random)
        const jitter = Math.random() * 25;
        const delay = Math.min(250, Math.pow(2, Math.min(attempt, 6)) * baseDelayMs + jitter);
        await new Promise((r) => setTimeout(r, delay));
      }

      // Evaluar estado actual
      const stateEntry = await kv.get<{ state: CircuitState; lastChange: number }>(["circuit_state", service]);
      const currentState = stateEntry.value?.state || "CLOSED";

      if (currentState === "HALF_OPEN") {
        if (success) {
          // Histéresis: N éxitos consecutivos requeridos para volver a CLOSED
          const successesKey = ["circuit_half_open_successes", service];
          let currentSuccesses = 0;

          for (let attempt = 0; attempt < 5; attempt++) {
            const scRes = await kv.get<number>(successesKey);
            currentSuccesses = (scRes.value || 0) + 1;
            const cRes = await kv.atomic().check(scRes).set(successesKey, currentSuccesses, { expireIn: 30000 }).commit();
            if (cRes.ok) break;
            await new Promise((r) => setTimeout(r, 5 + Math.random() * 10));
          }

          if (currentSuccesses >= this.halfOpenSuccessThreshold) {
            await kv.atomic()
              .set(["circuit_state", service], { state: "CLOSED", lastChange: Date.now() })
              .delete(successesKey)
              .delete(["circuit_half_open_lock", service])
              .commit();
            this.state = "CLOSED";
            this.consecutiveFailures = 0;
            this.consecutiveSuccesses = currentSuccesses;
          }
        } else {
          // En HALF_OPEN, una sola falla revierte de inmediato a OPEN (anti-flapping)
          await kv.atomic()
            .set(["circuit_state", service], { state: "OPEN", lastChange: Date.now() })
            .delete(["circuit_half_open_successes", service])
            .delete(["circuit_half_open_lock", service])
            .commit();
          this.state = "OPEN";
          this.consecutiveFailures++;
          this.consecutiveSuccesses = 0;
          this.lastFailureTime = Date.now();
        }
      } else if (currentState === "CLOSED") {
        // En CLOSED: si supera 50% de error sobre mínimo 10 pedidos, abrir el circuito
        if (nextMetrics.total >= 10 && nextMetrics.errors / nextMetrics.total > 0.50) {
          await kv.set(["circuit_state", service], { state: "OPEN", lastChange: Date.now() });
          this.state = "OPEN";
          this.lastFailureTime = Date.now();
        }
      }
    } catch {
      if (success) this.recordSuccess(); else this.recordFailure();
    }
  }

  /**
   * Obtiene la tasa de error y total de peticiones en la ventana deslizante de 10s.
   */
  async getErrorRate10s(service = "mediaflow"): Promise<{ total: number; errors: number; rate: number }> {
    if (typeof Deno !== "undefined" && typeof Deno.openKv === "function") {
      try {
        const kv = await getKv();
        const windowBucket = Math.floor(Date.now() / 10000);
        const metricsKey = ["circuit_metrics", service, windowBucket];
        const res = await kv.get<{ total: number; errors: number }>(metricsKey);
        const data = res.value || { total: 0, errors: 0 };
        const rate = data.total > 0 ? Math.round((data.errors / data.total) * 1000) / 1000 : 0;
        return { total: data.total, errors: data.errors, rate };
      } catch {
        // Fallback a memoria
      }
    }
    const currentBucket = Math.floor(Date.now() / 10000);
    if (this.window10s.bucket !== currentBucket) {
      return { total: 0, errors: 0, rate: 0 };
    }
    const rate = this.window10s.total > 0
      ? Math.round((this.window10s.errors / this.window10s.total) * 1000) / 1000
      : 0;
    return { total: this.window10s.total, errors: this.window10s.errors, rate };
  }

  /**
   * Registra éxito en memoria. Respeta histéresis de N éxitos en HALF_OPEN.
   */
  recordSuccess(): void {
    this.lastSuccessTime = Date.now();
    const currentBucket = Math.floor(Date.now() / 10000);
    if (this.window10s.bucket !== currentBucket) {
      this.window10s = { bucket: currentBucket, total: 1, errors: 0 };
    } else {
      this.window10s.total++;
    }

    if (this.state === "HALF_OPEN") {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.halfOpenSuccessThreshold) {
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
   * Registra falla en memoria. Si es timeout de scraper, NO afecta al proxy.
   */
  recordFailure(error?: Error | string, isScraperTimeout = false): void {
    if (isScraperTimeout) {
      return; // Aislamiento de scrapers
    }
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    this.lastError = error ? String(error) : "MediaFlow unreachable";

    const currentBucket = Math.floor(Date.now() / 10000);
    if (this.window10s.bucket !== currentBucket) {
      this.window10s = { bucket: currentBucket, total: 1, errors: 1 };
    } else {
      this.window10s.total++;
      this.window10s.errors++;
    }

    if (this.state === "HALF_OPEN" || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
      this.consecutiveSuccesses = 0;
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

    const currentBucket = Math.floor(Date.now() / 10000);
    const hasBucket = this.window10s.bucket === currentBucket;
    const total10s = hasBucket ? this.window10s.total : 0;
    const errors10s = hasBucket ? this.window10s.errors : 0;
    const errorRate10s = total10s > 0 ? Math.round((errors10s / total10s) * 1000) / 1000 : 0;

    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastError: this.lastError,
      cooldownRemainingMs,
      fallbackToDirectTorbox: this.state === "OPEN",
      halfOpenSuccessThreshold: this.halfOpenSuccessThreshold,
      errorRate10s,
      totalRequests10s: total10s,
      errors10s,
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

export {
  getOrSetSwrCache,
  TTL_SEGMENTS,
  verifyTorboxInstantStreams,
  queryTorboxApiCheckCached,
  type SwrOptions,
  type TorboxCacheChecker,
} from "../utils/swr_cache.ts";

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
