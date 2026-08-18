/**
 * Cliente de Anthropic e instrumentación. **Solo servidor.**
 *
 * TODA llamada a un modelo pasa por `llamarModelo()`, y esa función escribe una
 * fila en `llm_call` — tokens, latencia, costo, aciertos de caché — pase lo que
 * pase, incluso si la llamada falla.
 *
 * Eso no es contabilidad decorativa: sin esos datos no se puede AFIRMAR nada
 * sobre lo que cuesta o tarda un agente, solo intuirlo. Es la misma regla que
 * PLAN_LUNES aplica a los taps — si afirmas algo, mídelo.
 *
 * La llave nunca toca el navegador: vive en `wrangler secret put ANTHROPIC_API_KEY`
 * (o en .dev.vars para desarrollo) y solo se lee aquí dentro.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "../db/client";
import { envCloudflare } from "../db/env";
import { llmCall } from "../db/schema";

/**
 * Modelo por agente. ARQUITECTURA.md propuso repartir por costo (Haiku para
 * parsear comidas, Sonnet para el coach, Opus para la revisión semanal). Aquí
 * arrancan todos en Opus porque las dos tareas construidas —generar un plan y
 * ajustar objetivos— deciden lo que vas a levantar, y ahí la inteligencia vale
 * más que el ahorro. Bajar un agente de tier es cambiar una línea, y `llm_call`
 * te dará los números para decidirlo con datos en vez de a ojo.
 */
export const MODELOS = {
  "generar-plan": "claude-opus-5",
  "session-coach": "claude-opus-5",
  "weekly-review": "claude-opus-5",
  "parse-meal": "claude-haiku-4-5",
} as const;

export type Agente = keyof typeof MODELOS;

/** USD por millón de tokens. Solo para estimar el costo que guardamos. */
const PRECIOS: Record<string, { entrada: number; salida: number }> = {
  "claude-opus-5": { entrada: 5, salida: 25 },
  "claude-sonnet-5": { entrada: 3, salida: 15 },
  "claude-haiku-4-5": { entrada: 1, salida: 5 },
};

export class SinLlaveApi extends Error {
  constructor() {
    super(
      "Falta ANTHROPIC_API_KEY. En local va en .dev.vars; en Cloudflare, " +
        "con `wrangler secret put ANTHROPIC_API_KEY`. Mientras tanto puedes " +
        "importar un plan en JSON, que no necesita llave.",
    );
    this.name = "SinLlaveApi";
  }
}

export class ModeloRechazo extends Error {
  constructor(public categoria: string | null) {
    super(
      `El modelo declinó la petición${categoria ? ` (${categoria})` : ""}. ` +
        `Si el plan que pediste es legítimo, reformúlalo o impórtalo en JSON.`,
    );
    this.name = "ModeloRechazo";
  }
}

function cliente(): Anthropic {
  const env = envCloudflare();
  const key = env?.ANTHROPIC_API_KEY ?? process.env["ANTHROPIC_API_KEY"];
  if (!key) throw new SinLlaveApi();
  return new Anthropic({ apiKey: key });
}

type Peticion = {
  agente: Agente;
  userId: string | null;
  /** Estable entre llamadas: se cachea para no re-cobrar el prefijo. */
  system: string;
  mensaje: string;
  /** Esquema JSON de la respuesta. El modelo queda obligado a cumplirlo. */
  esquema: Record<string, unknown>;
  maxTokens?: number;
  esfuerzo?: "low" | "medium" | "high" | "xhigh" | "max";
};

/**
 * Llama al modelo con salida estructurada y registra la llamada.
 *
 * Devuelve el JSON ya parseado; el esquema garantiza su forma, pero quien llama
 * debe validarlo igual con zod — el esquema fija la estructura, no las reglas
 * de negocio (que el ejercicio exista en el catálogo, por ejemplo).
 */
export async function llamarModelo<T>(p: Peticion): Promise<{ salida: T; llmCallId: number }> {
  const modelo = MODELOS[p.agente];
  const inicio = Date.now();

  let uso: Anthropic.Usage | null = null;
  let error: string | null = null;
  let texto = "";
  let llmCallId = 0;

  try {
    // `cliente()` va DENTRO del try a propósito. Estuvo fuera y era un agujero:
    // el fallo más probable de todos —falta la llave— se lanzaba antes del
    // finally, así que no dejaba fila y el registro aparecía vacío justo cuando
    // más falta hacía para diagnosticar. Un intento que no despegó sigue siendo
    // un intento, y cuesta 0 USD: eso también es un dato.
    const anthropic = cliente();

    const respuesta = await anthropic.messages.create({
      model: modelo,
      max_tokens: p.maxTokens ?? 8000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: p.esfuerzo ?? "high",
        format: { type: "json_schema", schema: p.esquema },
      },
      // El system prompt es idéntico entre llamadas del mismo agente, así que
      // se cachea: a partir de la segunda llamada ese prefijo cuesta ~10%.
      system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: p.mensaje }],
    });

    uso = respuesta.usage;

    // El rechazo llega como 200 con content vacío, no como excepción. Leer
    // content[0] sin comprobar esto revienta con un error que no explica nada.
    if (respuesta.stop_reason === "refusal") {
      throw new ModeloRechazo(respuesta.stop_details?.category ?? null);
    }
    if (respuesta.stop_reason === "max_tokens") {
      throw new Error("La respuesta se cortó por longitud. Sube maxTokens y reintenta.");
    }

    const bloque = respuesta.content.find((b) => b.type === "text");
    if (!bloque || bloque.type !== "text") throw new Error("El modelo no devolvió texto.");
    texto = bloque.text;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    // Se registra también cuando falla: una llamada cara que reventó sigue
    // siendo una llamada cara, y esconderla falsearía el costo real.
    llmCallId = await registrar({
      agente: p.agente,
      userId: p.userId,
      modelo,
      uso,
      latenciaMs: Date.now() - inicio,
      error,
    });
  }

  return { salida: JSON.parse(texto) as T, llmCallId };
}

/** Devuelve el id de la fila escrita — nunca por una variable de módulo, que
    se pisaría entre peticiones concurrentes del mismo isolate. */
async function registrar(d: {
  agente: Agente;
  userId: string | null;
  modelo: string;
  uso: Anthropic.Usage | null;
  latenciaMs: number;
  error: string | null;
}): Promise<number> {
  try {
    const db = await getDb();
    const precio = PRECIOS[d.modelo] ?? { entrada: 0, salida: 0 };
    const entrada = d.uso?.input_tokens ?? 0;
    const cacheRead = d.uso?.cache_read_input_tokens ?? 0;
    const cacheWrite = d.uso?.cache_creation_input_tokens ?? 0;
    const salida = d.uso?.output_tokens ?? 0;

    // Lectura de caché ~0.1× y escritura ~1.25× del precio de entrada.
    const costo =
      ((entrada + cacheRead * 0.1 + cacheWrite * 1.25) * precio.entrada) / 1_000_000 +
      (salida * precio.salida) / 1_000_000;

    const fila = await db
      .insert(llmCall)
      .values({
        userId: d.userId,
        agente: d.agente,
        modelo: d.modelo,
        tokensIn: entrada + cacheRead + cacheWrite,
        tokensOut: salida,
        tokensCacheRead: cacheRead,
        latenciaMs: d.latenciaMs,
        costoUsd: Math.round(costo * 1_000_000) / 1_000_000,
        exito: d.error === null,
        error: d.error,
      })
      .returning({ id: llmCall.id });
    return fila[0]?.id ?? 0;
  } catch (e) {
    /* Que falle la instrumentación no debe tumbar la petición del usuario —
       pero tampoco puede ser invisible. Tragarse esto en silencio convierte
       "no hay filas" en un dato ambiguo: no sabrías si es que no se llamó al
       modelo o si es que el registro se rompió. Se avisa y se sigue. */
    console.error("[llm_call] no se pudo registrar la llamada:", e);
    return 0;
  }
}
