/**
 * test-mediaflow-proxy.ts — Suite de Certificación de MediaFlow Proxy & Circuit Breaker (Fase 1).
 *
 * Valida de forma estricta:
 * 1. Formateo y encapsulado de URLs según la especificación de MediaFlow Proxy (/proxy/stream?url=...&api_key=...).
 * 2. Autómata finito del Circuit Breaker (CLOSED -> OPEN tras 3 fallos -> HALF_OPEN tras cooldown -> CLOSED tras recuperación).
 * 3. Conmutación automática a conexión directa con TorBox ante estado OPEN o desconexión del proxy.
 * 4. Preservación intacta de enlaces no-media (trailers de YouTube, etc.).
 * 5. Inyección de diagnósticos en /health.
 */

import {
  MediaFlowCircuitBreaker,
  buildMediaFlowStreamUrl,
  shouldProxyMediaStream,
  applyMediaFlowToStreams,
  getMediaFlowConfig,
} from "./deno-hub/streams/mediaflow.ts";
import { handleHealth } from "./deno-hub/health.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${msg}`);
    failed++;
  }
}

console.log("\n══════════════════════════════════════════════════════════════════════");
console.log(" 🧪 SUITE DE MEDIAFLOW PROXY & CIRCUIT BREAKER (FASE 1 RESIDENCIAL)");
console.log("══════════════════════════════════════════════════════════════════════\n");

// 1. Especificación de URLs de MediaFlow Proxy
console.log("1. Construcción Canónica de URLs de MediaFlow Proxy:");
const testProxyUrl = "https://mediaflow.proxy.internal:8888";
const testApiKey = "mf-sec-test-key-999";
const directTorboxUrl = "https://api.torbox.app/v1/api/torrents/download?token=tb_tok_123&file=movie.mkv";

const proxied = buildMediaFlowStreamUrl(testProxyUrl, testApiKey, directTorboxUrl);
const pUrl = new URL(proxied);
assert(pUrl.origin === "https://mediaflow.proxy.internal:8888", "Origen coincide con MEDIAFLOW_PROXY_URL");
assert(pUrl.pathname === "/proxy/stream", "Ruta de streaming es /proxy/stream");
assert(pUrl.searchParams.get("url") === directTorboxUrl, "Parámetro 'url' contiene la URL directa exacta");
assert(pUrl.searchParams.get("api_key") === testApiKey, "Parámetro 'api_key' inyectado correctamente");

// 2. Discriminador de calificación de streams
console.log("\n2. Calificación de Streams para Proxy Residencial (shouldProxyMediaStream):");
assert(shouldProxyMediaStream(directTorboxUrl), "URL directa de TorBox califica para proxy");
assert(!shouldProxyMediaStream(proxied), "URL ya proxied por MediaFlow NO se re-encapsula");
assert(!shouldProxyMediaStream(undefined), "Stream indefinido descartado");
assert(!shouldProxyMediaStream("magnet:?xt=urn:btih:abc"), "Magnet link puro descartado");

// 3. Autómata de Estados del Circuit Breaker
console.log("\n3. Autómata de Estados del Circuit Breaker (Zero-Trust Resilience):");
const breaker = new MediaFlowCircuitBreaker(3, 500); // 3 fallos umbral, 500ms cooldown para test rápido

assert(breaker.getStatus().state === "CLOSED", "Estado inicial es CLOSED (proxy activo)");
assert(breaker.canAttempt() === true, "canAttempt permite tráfico hacia el proxy en CLOSED");

// Registrar 2 fallos (por debajo del umbral)
breaker.recordFailure("Timeout 1");
breaker.recordFailure("HTTP 502 Bad Gateway");
assert(breaker.getStatus().state === "CLOSED", "Permanece en CLOSED con 2 fallos (< umbral de 3)");
assert(breaker.getStatus().consecutiveFailures === 2, "Contador de fallos consecutivos es 2");

// Registrar 3er fallo: El circuito debe dispararse (TRIP) a OPEN
breaker.recordFailure("Connection refused");
assert(breaker.getStatus().state === "OPEN", "Circuito conmuta a OPEN tras 3 fallos consecutivos");
assert(breaker.canAttempt() === false, "canAttempt deniega proxy en estado OPEN");
assert(breaker.getStatus().fallbackToDirectTorbox === true, "Diagnóstico marca fallback directo activo");

// 4. Conmutación Automática en Streams
console.log("\n4. Conmutación Automática a TorBox Directo en Streams:");
const sampleStreams = [
  {
    name: "[⚡ INSTANTÁNEO] [🌎 LATINO] TorBox",
    title: "The Walk 1080p",
    url: directTorboxUrl,
  },
  {
    name: "[⚡ INSTANTÁNEO] [🎬 TRAILER HD] YouTube",
    title: "Trailer",
    ytId: "dQw4w9WgXcQ",
  },
];

// Prueba con circuito OPEN: debe conmutar automáticamente a conexión directa con TorBox
const streamsWhenOpen = applyMediaFlowToStreams(
  sampleStreams,
  { proxyUrl: testProxyUrl, apiKey: testApiKey },
  breaker,
);
assert(streamsWhenOpen[0].url === directTorboxUrl, "Circuito OPEN -> URL permanece 100% DIRECTA con TorBox (cero buffering stop)");

// Prueba con circuito CLOSED: debe enrutar vía MediaFlow y guardar fallback
breaker.reset();
assert(breaker.getStatus().state === "CLOSED", "Circuito restablecido a CLOSED");
const streamsWhenClosed = applyMediaFlowToStreams(
  sampleStreams,
  { proxyUrl: testProxyUrl, apiKey: testApiKey },
  breaker,
);
assert(Boolean(streamsWhenClosed[0].url?.startsWith("https://mediaflow.proxy.internal:8888/proxy/stream")), "Circuito CLOSED -> URL enrutada por MediaFlow Proxy");
assert(streamsWhenClosed[1].url === undefined, "Trailers de YouTube preservados sin tocar");

// 5. Recuperación Half-Open y Closed
console.log("\n5. Transición Temporal HALF_OPEN y Recuperación Automática:");
breaker.recordFailure("Fallo 1");
breaker.recordFailure("Fallo 2");
breaker.recordFailure("Fallo 3");
assert(breaker.getStatus().state === "OPEN", "Circuito re-abierto tras fallos");

// Simular expiración de cooldown
await new Promise((r) => setTimeout(r, 600)); // 600ms > 500ms cooldown
assert(breaker.canAttempt() === true, "canAttempt permite intento tras expirar tiempo de recuperación");
assert(breaker.getStatus().state === "HALF_OPEN", "Estado transicionó a HALF_OPEN");

// Registrar éxito durante HALF_OPEN
breaker.recordSuccess();
assert(breaker.getStatus().state === "CLOSED", "Éxito en HALF_OPEN sana el circuito y lo devuelve a CLOSED");
assert(breaker.getStatus().consecutiveFailures === 0, "Contador de fallos reiniciado a 0");

// 6. Configuración e Inyección vía URL
console.log("\n6. Detección de Configuración y Diagnóstico en /health:");
const cfgFromUrl = getMediaFlowConfig(new URL("http://hub.local/stream?mediaflow=https://proxy.test&mediaflow_key=k123"));
assert(cfgFromUrl.proxyUrl === "https://proxy.test", "Configuración detectada desde query params");
assert(cfgFromUrl.apiKey === "k123", "API key detectada desde query params");

const cfgFromSeg = getMediaFlowConfig(undefined, "providers=yts|mediaflow=https%3A%2F%2Fseg.proxy|mediaflow_key=segk");
assert(cfgFromSeg.proxyUrl === "https://seg.proxy", "Configuración detectada desde segmento de configuración");
assert(cfgFromSeg.apiKey === "segk", "API key detectada desde segmento de configuración");

// Verificación en /health
const healthRes = await handleHealth(new URL("http://localhost/health"));
const healthData = await healthRes.json();
assert(healthData.mediaflow !== undefined, "Bloque mediaflow presente en /health");
assert(typeof healthData.mediaflow.configured === "boolean", "Campo configured presente en mediaflow");
assert(healthData.mediaflow.circuitBreaker.state !== undefined, "Estado de circuit breaker expuesto en /health");

console.log("\n══════════════════════════════════════════════════════════════════════");
console.log(` RESULTADO: ${passed} verificaciones superadas, ${failed} fallidas`);
console.log("══════════════════════════════════════════════════════════════════════\n");

if (failed > 0) Deno.exit(1);
