/**
 * Agente 1 — genera un plan de entrenamiento a partir de tus metas. **Solo servidor.**
 *
 * LA RESTRICCIÓN CENTRAL: el modelo elige de un catálogo, no inventa. El esquema
 * de salida declara `exerciseId` como un `enum` con los ids reales, así que la
 * API impide estructuralmente que devuelva un ejercicio que no existe — y por si
 * el esquema fallara, `importarPlanLogic` vuelve a comprobarlo contra la base.
 *
 * No es burocracia: un ejercicio inventado llega sin patrón de movimiento, sin
 * línea de progresión y sin rango de reps, y con eso dejan de funcionar la
 * detección de patrones faltantes, la regla de progresión y media analítica. El
 * agente sería creativo una vez y la app quedaría rota para siempre.
 *
 * El plan generado NO se guarda solo. Se devuelve como borrador para que lo
 * revises: el que va a levantar el peso decide, no el modelo.
 */
import { createServerFn } from "@tanstack/react-start";
import { inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { usuarioActual } from "../auth";
import { exercise, patron } from "../db/schema";
import { llamarModelo } from "./anthropic";
import { importarPlanLogic, planSchema, type PlanImportado } from "./plan-import";

export const metasSchema = z.object({
  /** Qué quieres lograr, en tus palabras. */
  objetivo: z.string().min(3).max(600),
  /** Días a la semana que puedes entrenar. */
  diasPorSemana: z.number().int().min(1).max(7),
  /** Minutos por sesión. */
  minutosPorSesion: z.number().int().min(10).max(180),
  /** Equipo disponible; filtra el catálogo que ve el modelo. */
  equipo: z.array(z.string().max(40)).max(20),
  /** Lesiones, molestias o límites. Texto libre. */
  restricciones: z.string().max(600).optional(),
  experiencia: z.enum(["principiante", "intermedio", "avanzado"]).default("intermedio"),
  unidad: z.enum(["lb", "kg"]).default("lb"),
});

export type Metas = z.infer<typeof metasSchema>;

/**
 * El system prompt es idéntico entre llamadas a propósito: así se cachea y a
 * partir de la segunda generación ese prefijo cuesta ~10%. Nada dinámico aquí
 * dentro — las metas y el catálogo van en el mensaje del usuario.
 */
const SYSTEM = `Eres un entrenador de fuerza que diseña programas semanales.

REGLAS DURAS
1. Solo puedes usar ejercicios del catálogo que se te entrega. No inventes ninguno.
2. El tiempo SIEMPRE va en segundos. Veinte minutos de remo son 1200, no 20.
3. La carga es el PESO TOTAL EFECTIVO en la unidad indicada. Si alguien carga una
   mochila de 40 lb más una mancuerna de 25, son 65 — nunca el desglose. Guardar
   las partes obliga a sumarlas entre series y hace incomparables dos sesiones
   que movieron el mismo peso repartido distinto.
4. Para ejercicios de peso corporal, carga = 0 y unidad = "reps".
5. "porLado" es true solo en unilaterales, y entonces reps es POR LADO.

CÓMO DISEÑAR
- Cubre patrones de movimiento variados a lo largo de la semana: empuje, jalón,
  rodilla, bisagra de cadera y core. Un patrón ausente es una debilidad futura.
- Ajusta el volumen a los minutos disponibles: cuenta ~3 min por serie con descanso.
- El semáforo comunica intención: "verde" cuando toca progresar, "ambar" cuando
  toca consolidar, "terracota" cuando ya se está en el tope del equipo disponible.
- "nota" es una línea corta y accionable para la persona en el gimnasio, no una
  explicación de fisiología. Ejemplo: "Si salen 4x10 limpias, sube reps antes que carga."
- Respeta las restricciones al pie de la letra. Ante la duda, elige la opción más
  conservadora y dilo en la nota.
- Si arrancas cargas para alguien sin historial, quédate por debajo de lo que
  crees que puede: es más barato subir la semana que viene que lesionarse hoy.`;

type BorradorPlan = PlanImportado;

/** Construye el esquema de salida con los ids reales como enum. */
function esquemaSalida(idsEjercicios: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["nombre", "sesiones"],
    properties: {
      nombre: { type: "string" },
      objetivos: {
        type: "object",
        additionalProperties: false,
        required: [],
        properties: {
          proteinaG: { type: "number" },
          fibraG: { type: "number" },
          kcalEntreno: { type: "number" },
          kcalDescanso: { type: "number" },
        },
      },
      sesiones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["diaSemana", "nombre", "ejercicios"],
          properties: {
            diaSemana: { type: "integer", enum: [1, 2, 3, 4, 5, 6, 7] },
            nombre: { type: "string" },
            tipo: { type: "string" },
            duracionMin: { type: "integer" },
            ejercicios: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "exerciseId",
                  "series",
                  "reps",
                  "carga",
                  "unidad",
                  "porLado",
                  "semaforo",
                ],
                properties: {
                  // El enum es la restricción: la API no deja que el modelo
                  // devuelva un id fuera del catálogo.
                  exerciseId: { type: "string", enum: idsEjercicios },
                  series: { type: "integer" },
                  reps: { type: "integer" },
                  carga: { type: "number" },
                  unidad: { type: "string", enum: ["lb", "kg", "reps", "segundos"] },
                  porLado: { type: "boolean" },
                  semaforo: { type: "string", enum: ["verde", "ambar", "terracota"] },
                  nota: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  };
}

async function catalogoPara(userId: string, equipo: string[]) {
  const db = await getDb();
  const patrones = await db.select().from(patron);
  const todos = await db
    .select()
    .from(exercise)
    .where(or(isNull(exercise.userId), inArray(exercise.userId, [userId])));

  // Sin equipo declarado, se ofrece el catálogo completo. Con equipo, se filtra
  // — y "corporal" siempre entra: nadie se queda sin poder hacer una plancha.
  const disponibles = equipo.length
    ? todos.filter((e) => {
        const req = JSON.parse(e.equipo ?? "[]") as string[];
        if (!req.length) return true;
        return req.some((r) => r === "corporal" || equipo.includes(r));
      })
    : todos;

  return { patrones, ejercicios: disponibles };
}

export async function generarPlanLogic(metas: Metas): Promise<{
  plan: BorradorPlan;
  llmCallId: number;
  ejerciciosConsiderados: number;
}> {
  const { id: userId } = await usuarioActual();
  const { patrones, ejercicios } = await catalogoPara(userId, metas.equipo);

  if (ejercicios.length < 5) {
    throw new Error(
      `Con ese equipo solo quedan ${ejercicios.length} ejercicios en el catálogo — ` +
        `no alcanza para un plan. Añade equipo o deja la lista vacía para usar todo.`,
    );
  }

  // Contexto compacto: una línea por ejercicio, no el objeto entero. El modelo
  // necesita saber qué existe y de qué tipo es, no los metadatos completos.
  const lineas = ejercicios.map(
    (e) =>
      `${e.id} | ${e.nombre} | patrón:${e.patronId ?? "?"} | ${e.unidad}` +
      `${e.unilateral ? " | unilateral" : ""}${e.rangoReps ? ` | reps ${e.rangoReps}` : ""}`,
  );

  const mensaje = [
    `META: ${metas.objetivo}`,
    `DÍAS POR SEMANA: ${metas.diasPorSemana}`,
    `MINUTOS POR SESIÓN: ${metas.minutosPorSesion}`,
    `EXPERIENCIA: ${metas.experiencia}`,
    `UNIDAD DE CARGA: ${metas.unidad}`,
    metas.equipo.length ? `EQUIPO: ${metas.equipo.join(", ")}` : `EQUIPO: sin restricción`,
    metas.restricciones ? `RESTRICCIONES: ${metas.restricciones}` : `RESTRICCIONES: ninguna`,
    ``,
    `PATRONES DE MOVIMIENTO: ${patrones.map((p) => `${p.id} (${p.nombre})`).join(", ")}`,
    ``,
    `CATÁLOGO (id | nombre | patrón | unidad):`,
    ...lineas,
    ``,
    `Diseña exactamente ${metas.diasPorSemana} sesiones, una por día de entrenamiento.`,
  ].join("\n");

  const { salida, llmCallId } = await llamarModelo<unknown>({
    agente: "generar-plan",
    userId,
    system: SYSTEM,
    mensaje,
    esquema: esquemaSalida(ejercicios.map((e) => e.id)),
    maxTokens: 16000,
    esfuerzo: "high",
  });

  // El esquema garantiza la forma; zod garantiza los rangos y valores por
  // defecto. Son comprobaciones distintas y las dos hacen falta.
  const plan = planSchema.parse(salida);
  return { plan, llmCallId, ejerciciosConsiderados: ejercicios.length };
}

/** Genera un borrador. NO lo guarda — eso lo decide la persona al confirmar. */
export const generarPlan = createServerFn({ method: "POST" })
  .inputValidator(metasSchema)
  .handler(({ data }) => generarPlanLogic(data));

/** Guarda un plan generado, dejando constancia de que lo produjo un agente. */
export const guardarPlanGenerado = createServerFn({ method: "POST" })
  .inputValidator(z.object({ plan: planSchema }))
  .handler(({ data }) => importarPlanLogic({ plan: data.plan, origen: "agente" }));
