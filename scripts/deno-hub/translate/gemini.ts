/**
 * gemini.ts — Conectores para LLMs (Google Gemini Flash & OpenRouter) y generación de prompts de traducción.
 * Preserva las directivas estrictas de traducción cinematográfica, nombres propios y anti-SDH.
 */

export const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
export const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free";
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
  const modelsToTry = [
    GEMINI_MODEL || "gemini-2.5-flash",
    "gemini-2.0-flash",
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
        if (/2\.5|2\.0/.test(model)) {
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
  const models = [
    OPENROUTER_MODEL,
    "meta-llama/llama-3.3-70b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
    "google/gemini-2.0-flash-exp:free",
    "qwen/qwen-2.5-72b-instruct:free",
  ].filter(Boolean);

  let lastErr: Error | null = null;
  for (const model of [...new Set(models)]) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
        signal,
      });
      if (!r.ok) {
        lastErr = new Error(`OpenRouter (${model}) respondió ${r.status}`);
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

export function cleanCueForTranslation(text: string): string {
  if (!text) return "";
  let t = text;
  // 1. Eliminar etiquetas HTML y estilos
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\{[^}]+\}/g, "");
  // 2. Eliminar acotaciones sonoras entre corchetes o paréntesis
  t = t.replace(/\[[^\]\n]*\]/g, "");
  t = t.replace(/\([^)\n]*\)/g, "");
  // 3. Eliminar prefijos de hablante en mayúsculas
  t = t.replace(/^[A-ZÁÉÍÓÚÑÀÂÇÉÈÊËÎÏÔÙÛÜŸ0-9\s._-]{2,30}:\s*/gm, "");
  // 4. Eliminar símbolos musicales
  t = t.replace(/[♪♫#*]+/g, "");
  return t.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
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
