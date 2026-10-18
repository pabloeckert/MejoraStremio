/**
 * gemini.ts — Conectores para LLMs (Google Gemini Flash & OpenRouter) y generación de prompts de traducción.
 * Preserva las directivas estrictas de traducción cinematográfica, nombres propios y anti-SDH.
 */

export const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash-001";
export const OPENROUTER_MODEL = (Deno.env.get("OPENROUTER_MODEL") && Deno.env.get("OPENROUTER_MODEL") !== "openrouter/free")
  ? Deno.env.get("OPENROUTER_MODEL")!
  : "google/gemini-2.5-flash";
export const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
export const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

export const NL = "§Z"; // Sentinel para saltos de línea internos al mandar a la IA
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GEMINI_SAFETY_OFF = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

export async function callGemini(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const cleanKey = apiKey.trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "");

  // Si la clave provista es formato OpenRouter/OpenAI (sk-...), redirigir de inmediato a OpenRouter
  if (cleanKey.startsWith("sk-")) {
    return await callOpenRouter(prompt, cleanKey, signal);
  }

  // Si la clave no es de Google AI Studio (las claves de Google comienzan con AIza),
  // y tenemos OPENROUTER_API_KEY, redirigir inmediatamente a OpenRouter para evitar
  // reintentos fallidos 401 que agoten el presupuesto síncrono de Fast-Window (<4s).
  if (!cleanKey.startsWith("AIza") && OPENROUTER_API_KEY) {
    return await callOpenRouter(prompt, OPENROUTER_API_KEY, signal);
  }

  const modelsToTry = [
    GEMINI_MODEL || "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
  ];
  const candidates = [...new Set(modelsToTry.filter(Boolean))];

  let lastError: Error | null = null;
  if (cleanKey) {
    for (const model of candidates) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`;
        const generationConfig: Record<string, unknown> = {
          temperature: 0.2,
          maxOutputTokens: 8192,
        };
        // Para modelos 2.0 y 2.5, forzar thinkingBudget: 0 para garantizar respuestas en <1.5s
        if (/2\.0|2\.5|thinking/i.test(model)) {
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
        }
        let r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": cleanKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            safetySettings: GEMINI_SAFETY_OFF,
            generationConfig,
          }),
          signal,
        });

        // Si falló por thinkingConfig no soportado (HTTP 400), reintentar sin thinkingConfig
        if (r.status === 400 && generationConfig.thinkingConfig) {
          delete generationConfig.thinkingConfig;
          r = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": cleanKey,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              safetySettings: GEMINI_SAFETY_OFF,
              generationConfig,
            }),
            signal,
          });
        }

        if (r.ok) {
          const d = await r.json();
          const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return String(text).trim();
          lastError = new Error(`Gemini (${model}): sin texto (${d?.candidates?.[0]?.finishReason || "empty"})`);
        } else {
          const errTxt = await r.text().catch(() => "");
          lastError = new Error(`Gemini (${model}) respondió ${r.status}: ${errTxt.slice(0, 100)}`);
        }
      } catch (e) {
        lastError = e as Error;
        if (signal.aborted) throw e;
      }
    }
  }

  // Fallback a OpenRouter si todos los modelos de Gemini fallaron o no hay key válida
  if (OPENROUTER_API_KEY && !signal.aborted) {
    try {
      return await callOpenRouter(prompt, OPENROUTER_API_KEY, signal);
    } catch (e) {
      if (!lastError) lastError = e as Error;
    }
  }

  throw lastError || new Error("Gemini/OpenRouter: todos los proveedores fallaron");
}

export async function callOpenRouter(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const cleanKey = apiKey.trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "");

  // Si la clave provista es formato Google (AIza...), redirigir a callGemini
  if (cleanKey.startsWith("AIza")) {
    return await callGemini(prompt, cleanKey, signal);
  }

  const models = [
    OPENROUTER_MODEL,
    "google/gemini-2.5-flash",
    "google/gemini-2.0-flash-001",
    "google/gemini-flash-1.5",
    "meta-llama/llama-3.3-70b-instruct",
  ].filter(Boolean);

  let lastErr: Error | null = null;
  for (const model of [...new Set(models)]) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cleanKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 8192,
          reasoning: { effort: "none" },
        }),
        signal,
      });
      if (!r.ok) {
        const errTxt = await r.text().catch(() => "");
        lastErr = new Error(`OpenRouter (${model}) respondió ${r.status}: ${errTxt.slice(0, 100)}`);
        continue;
      }
      const d = await r.json();
      const text = d?.choices?.[0]?.message?.content;
      if (!text) continue;
      const trimmed = String(text).trim();
      // Descartar respuestas de clasificadores de seguridad como Nemotron
      if (/^user\s*safety:\s*safe$/i.test(trimmed)) {
        continue;
      }
      return trimmed;
    } catch (e) {
      lastErr = e as Error;
      if (signal.aborted) throw e;
    }
  }
  throw lastErr || new Error("OpenRouter: sin respuesta válida de ninguno de los modelos");
}

const SOUND_CUES_STANDALONE = /^(?:m[uú]sica|musique|music|sonido|sound|audio|disparos?|shots?|gritos?|screams?|aplausos?|applause|risas?|laughter|suspiros?|sighs?|suspira|soupire|llanto|crying|silbidos?|whistle|pasos|footsteps|jadeos?|gasps?|canción|song|tose|coughs?|canta|sings?|viento|wind|trueno|thunder|motor|engine|timbre|bell|teléfono|phone|golpes?|thuds?|knocks?|quejidos?|groans?|sollozos?|sobs?|murmullos?|murmurs?|ininteligible|inaudible|alarma|alarm|resopla|explosión|explosion|silencio|silence|jadea|bosteza|yawns?)\b/i;

export function cleanCueForTranslation(text: string): string {
  if (!text) return "";
  let t = text;
  // 1. Eliminar etiquetas HTML y estilos
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\{[^}]+\}/g, "");
  // 2. Eliminar acotaciones sonoras entre corchetes siempre; y entre paréntesis solo si está en MAYÚSCULAS o ruidos ambientales
  t = t.replace(/\[[\s\S]*?\]/g, "");
  t = t.replace(/\(([^)]*)\)/g, (fullMatch, inner) => {
    const trimmed = inner.trim();
    if (!trimmed) return "";
    const hasUpper = /[A-ZÁÉÍÓÚÑÀÂÇÉÈÊËÎÏÔÙÛÜŸ]/.test(trimmed);
    const hasLower = /[a-záéíóúñàâçéèêëîïôùûüÿ]/.test(trimmed);
    if (hasUpper && !hasLower) return "";
    if (/\b(?:m[uú]sica|music|gritos?|screams?|risas?|laughs?|suspiros?|sighs?|llanto|crying|pasos|footsteps|aplausos?|applause|disparos?|shots?|alarma|alarm|sonnerie)\b/i.test(trimmed)) {
      return "";
    }
    return fullMatch;
  });
  // 3. Eliminar prefijos de hablante en mayúsculas o mixtas seguidos de dos puntos (MORGANE:, Morgane:, etc.)
  t = t.replace(/^[-–—•]?\s*[A-Za-zÁÉÍÓÚÑÀÂÇÉÈÊËÎÏÔÙÛÜŸáéíóúñàâçèêëîïôùûüÿ0-9\s._-]{2,30}:\s*/gm, "");
  // 4. Eliminar símbolos musicales y ruidos
  t = t.replace(/[♪♫#*]+/g, "");
  return t
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !SOUND_CUES_STANDALONE.test(l))
    .join("\n");
}

export interface AiProbeResult {
  gemini: {
    configured: boolean;
    keyPrefix?: string;
    keyLength?: number;
    status?: number;
    latencyMs?: number;
    model?: string;
    reply?: string;
    error?: string;
  };
  openrouter: {
    configured: boolean;
    keyPrefix?: string;
    keyLength?: number;
    status?: number;
    latencyMs?: number;
    model?: string;
    reply?: string;
    error?: string;
    attempts?: Array<{ model: string; status: number; message: string }>;
  };
}

export async function runAiProbeTest(): Promise<AiProbeResult> {
  const result: AiProbeResult = {
    gemini: { configured: !!GEMINI_API_KEY },
    openrouter: { configured: !!OPENROUTER_API_KEY },
  };

  const testPrompt = "1▸ Hola";

  if (GEMINI_API_KEY) {
    const cleanKey = GEMINI_API_KEY.trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "");
    result.gemini.keyPrefix = cleanKey.slice(0, 6) + "...";
    result.gemini.keyLength = cleanKey.length;
    const t0 = Date.now();
    try {
      const reply = await callGemini(testPrompt, cleanKey, AbortSignal.timeout(5000));
      result.gemini.latencyMs = Date.now() - t0;
      result.gemini.status = 200;
      result.gemini.model = GEMINI_MODEL;
      result.gemini.reply = reply.slice(0, 100);
    } catch (e) {
      result.gemini.latencyMs = Date.now() - t0;
      result.gemini.error = (e as Error).message;
      const m = (e as Error).message.match(/respondió\s*(\d{3})/);
      if (m) result.gemini.status = parseInt(m[1], 10);
    }
  }

  if (OPENROUTER_API_KEY) {
    const cleanKey = OPENROUTER_API_KEY.trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "");
    result.openrouter.keyPrefix = cleanKey.slice(0, 6) + "...";
    result.openrouter.keyLength = cleanKey.length;
    result.openrouter.attempts = [];

    const modelsToProbe = [
      OPENROUTER_MODEL,
      "google/gemini-2.0-flash-001",
      "google/gemini-2.5-flash",
      "google/gemini-2.0-flash-lite-001",
      "google/gemini-2.0-flash-lite-preview-02-05:free",
      "meta-llama/llama-3.2-3b-instruct:free",
    ];

    const t0 = Date.now();
    for (const m of [...new Set(modelsToProbe)]) {
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cleanKey}` },
          body: JSON.stringify({
            model: m,
            messages: [{ role: "user", content: testPrompt }],
            max_tokens: 30,
          }),
          signal: AbortSignal.timeout(4000),
        });
        const txt = await r.text().catch(() => "");
        result.openrouter.attempts.push({
          model: m,
          status: r.status,
          message: txt.slice(0, 120),
        });
        if (r.ok && !result.openrouter.reply) {
          result.openrouter.status = 200;
          result.openrouter.model = m;
          result.openrouter.latencyMs = Date.now() - t0;
          try {
            const d = JSON.parse(txt);
            result.openrouter.reply = d?.choices?.[0]?.message?.content?.slice(0, 100);
          } catch {
            result.openrouter.reply = txt.slice(0, 100);
          }
        }
      } catch (e) {
        result.openrouter.attempts.push({
          model: m,
          status: 0,
          message: (e as Error).message.slice(0, 120),
        });
      }
    }
    if (!result.openrouter.reply && result.openrouter.attempts.length > 0) {
      result.openrouter.status = result.openrouter.attempts[0].status;
      result.openrouter.error = result.openrouter.attempts[0].message;
    }
  }

  return result;
}

export const LANG_NAMES: Record<string, string> = {
  fr: "idioma francés (fr)",
  en: "idioma inglés (en)",
  de: "idioma alemán (de)",
  it: "idioma italiano (it)",
  pt: "idioma portugués (pt)",
  es: "idioma español (es)",
};

export function buildTranslateSystemPrompt(titleName?: string, sourceLang = "inglés"): string {
  const langLabel = LANG_NAMES[sourceLang.toLowerCase()] || `idioma ${sourceLang}`;
  const showInfo = titleName
    ? `Estás traduciendo la serie/película "${titleName}".`
    : "Estás traduciendo una producción audiovisual de cine o televisión.";

  return (
    `Sos un traductor y adaptador profesional de subtítulos para cine y series de televisión. ` +
    `Tu tarea es traducir del ${langLabel} al ESPAÑOL LATINOAMERICANO NEUTRO (estilo doblaje profesional latinoamericano).\n\n` +
    `${showInfo}\n\n` +
    `DIRECTIVAS ESTRICTAS DE CALIDAD:\n` +
    `1. REGLA INVIOLABLE DE NOMBRES PROPIOS: NUNCA traduzcas nombres propios ni locaciones: NUNCA traduzcas, adaptes ni alteres nombres de personajes (ej: Ludwig, John, James, Holly, Lucy, etc.), apellidos, apodos, nombres de calles, marcas ni topónimos (ej: Cambridge). Deben permanecer EXACTAMENTE en su forma y grafía original.\n` +
    `2. INTERPRETACIÓN CINEMATOGRÁFICA Y SENTIDO DRAMÁTICO: Queda terminantemente prohibida la traducción literal palabra por palabra. Interpreta con naturalidad el humor, la ironía, los dobles sentidos y el registro conversacional, adaptándolo a un español neutro fluido, coloquial y elegante (sin modismos peninsulares como 'vosotros', ni 'coger' por agarrar, ni modismos regionales excesivos).\n` +
    `3. HIGIENE ANTI-SDH: NUNCA generes ni incluyas descripciones de sonido, ruidos entre corchetes o paréntesis ni etiquetas de hablantes (ej: NADA de [Música], (Risas) ni NOMBRE:). Traduce exclusivamente el diálogo humano hablado.\n` +
    `4. CONSERVACIÓN DE FORMATO: Recibís líneas numeradas '<n>▸ <texto>'. Devolvé EXACTAMENTE las mismas líneas numeradas '<n>▸ <traducción>', una por línea, mismo n, misma cantidad, sin texto introductorio ni explicaciones adicionales. El símbolo ${NL} es un salto de línea interno: conservalo en el lugar exacto donde corresponda en la traducción.`
  );
}
