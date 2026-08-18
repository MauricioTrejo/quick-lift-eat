/**
 * Agente 2 — ajusta el plan tras cerrar una sesión. **Solo servidor.**
 *
 * REPARTO DE TRABAJO, y es lo importante de este archivo:
 *
 *   `reglaProgresion()` (TypeScript, determinista) decide el número.
 *   El modelo decide si ese número aplica, y escribe la nota.
 *
 * ARQUITECTURA.md lo dice sin rodeos: gastar tokens en aritmética sería el error
 * más caro del proyecto. Sumar series, comparar contra el objetivo y aplicar
 * "+5 lb cuando sobraron reps" son `if/else` — baratos, auditables y siempre
 * iguales. Lo que un `if/else` NO puede hacer es notar que fallaste el hip
 * thrust tres semanas seguidas mientras subías en sentadilla, y decidir que ahí
 * el problema no es la carga. Para eso está el modelo.
 *
 * El resultado no es un mensaje que interpretas: es el estado que la app te
 * muestra precargado la próxima vez. Y cada cambio deja una fila en
 * `plan_change` con su motivo, así que "¿por qué subió mi objetivo?" tiene
 * respuesta en vez de un encogimiento de hombros.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { atomico, consultaVista, getDb } from "../db/client";
import { usuarioActual } from "../auth";
import { plan, planChange, planSession, prescription } from "../db/schema";
import { llamarModelo } from "./anthropic";
import { hoyISO, type FilaPlanVsReal } from "./queries";

/**
 * La regla determinista. Devuelve la sugerencia de carga/reps para la próxima
 * vez, o null si no hay nada que cambiar.
 *
 * Traduce §08 del plan original: si completaste todas las series al objetivo y
 * ninguna fue al fallo, la última rep se quedó fácil → sube. Si te faltaron
 * series o no llegaste a las reps, no toques nada: repetir hasta consolidar.
 */
export function reglaProgresion(f: FilaPlanVsReal): {
  carga?: number;
  reps?: number;
  motivo: string;
} | null {
  const completo = f.series_hechas >= f.series_prescritas;
  const repsObjetivo = f.series_prescritas * f.objetivo_reps;

  if (!completo) return null; // faltaron series: consolidar antes de progresar
  if (f.reps_totales < repsObjetivo) return null; // no llegó a las reps
  if (f.series_al_fallo > 0) return null; // llegó al fallo: no fue fácil

  // Peso corporal o tiempo: progresa en repeticiones/segundos, no en carga.
  if (f.unidad !== "lb" && f.unidad !== "kg") {
    const paso = f.unidad === "segundos" ? 5 : 1;
    return {
      reps: f.objetivo_reps + paso,
      motivo: `Completaste ${f.series_prescritas}×${f.objetivo_reps} sin llegar al fallo.`,
    };
  }

  // Con carga: +5 y bajar un par de reps, para volver a construir el rango.
  return {
    carga: f.carga_max + 5,
    reps: Math.max(1, f.objetivo_reps - 1),
    motivo: `Completaste ${f.series_prescritas}×${f.objetivo_reps} a ${f.carga_max} ${f.unidad} sin fallar.`,
  };
}

const SYSTEM = `Eres un entrenador que revisa una sesión recién terminada y decide
qué ajustar en el plan para la próxima vez.

Recibes, por ejercicio: lo prescrito, lo que realmente se hizo, y una SUGERENCIA
ya calculada por una regla determinista.

TU TRABAJO
- Aceptar, modificar o descartar cada sugerencia. La regla ve un ejercicio
  aislado; tú ves la sesión entera y el RPE.
- Escribir la nota que la persona leerá en el gimnasio: una línea, accionable.
- Ajustar el semáforo: "verde" si toca progresar, "ambar" si toca consolidar,
  "terracota" si ya está en el techo del equipo disponible.

CRITERIO
- No inventes números: si aceptas la sugerencia, usa su valor tal cual.
- Si el RPE fue "duro" o la sensación "rojo", sé conservador aunque la regla
  diga que suba. Un mal día no es una señal de progreso.
- Un ejercicio con series faltantes NO progresa. Averigua por qué en la nota.
- Es correcto no cambiar nada. Devuelve una lista vacía si la sesión no da
  información suficiente. Cambiar por cambiar erosiona la confianza en el plan.
- Nunca subas más de un escalón por ejercicio y por sesión.`;

const salidaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ajustes", "resumen"],
  properties: {
    resumen: { type: "string" },
    ajustes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prescriptionId", "motivo"],
        properties: {
          prescriptionId: { type: "string" },
          objetivoCargaNum: { type: "number" },
          objetivoReps: { type: "integer" },
          semaforo: { type: "string", enum: ["verde", "ambar", "terracota"] },
          nota: { type: "string" },
          motivo: { type: "string" },
        },
      },
    },
  },
};

type Ajuste = {
  prescriptionId: string;
  objetivoCargaNum?: number;
  objetivoReps?: number;
  semaforo?: string;
  nota?: string;
  motivo: string;
};

export async function ajustarPlanLogic(): Promise<{
  aplicados: number;
  resumen: string;
  llmCallId: number;
}> {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const hoy = hoyISO();

  // La vista ya trae prescrito contra hecho. El modelo nunca ve historial crudo.
  const filas = await consultaVista<FilaPlanVsReal>(
    `SELECT fecha, sesion_nombre, ejercicio, patron_id, orden, prescription_id,
            series_prescritas, series_hechas, series_faltantes,
            objetivo_reps, objetivo_carga_num, carga_max, dif_carga,
            reps_totales, volumen, series_al_fallo, unidad, semaforo, rpe
     FROM v_plan_vs_real
     WHERE user_id = ? AND fecha = ?
     ORDER BY orden ASC`,
    [userId, hoy],
  );

  if (!filas.length) {
    throw new Error("No hay una sesión de hoy que revisar.");
  }

  // Aquí es donde se ahorra el dinero: los números salen de TypeScript.
  const conSugerencia = filas.map((f) => ({ fila: f, sug: reglaProgresion(f) }));

  const mensaje = [
    `SESIÓN: ${filas[0]?.sesion_nombre ?? "?"} · ${hoy}`,
    `RPE: ${filas[0]?.rpe ?? "no registrado"}`,
    ``,
    `EJERCICIOS:`,
    ...conSugerencia.map(({ fila: f, sug }) =>
      [
        `- ${f.ejercicio} [${f.prescription_id}]`,
        `  prescrito: ${f.series_prescritas}×${f.objetivo_reps} @ ${f.objetivo_carga_num} ${f.unidad}`,
        `  hecho: ${f.series_hechas} series, ${f.reps_totales} reps, máx ${f.carga_max} ${f.unidad}` +
          `${f.series_al_fallo ? `, ${f.series_al_fallo} al fallo` : ""}`,
        `  semáforo actual: ${f.semaforo}`,
        sug
          ? `  SUGERENCIA: ${sug.carga !== undefined ? `carga ${sug.carga}` : ""}` +
            `${sug.reps !== undefined ? ` reps ${sug.reps}` : ""} — ${sug.motivo}`
          : `  SUGERENCIA: ninguna (no se cumplieron las condiciones para progresar)`,
      ].join("\n"),
    ),
  ].join("\n");

  const { salida, llmCallId } = await llamarModelo<{ ajustes: Ajuste[]; resumen: string }>({
    agente: "session-coach",
    userId,
    system: SYSTEM,
    mensaje,
    esquema: salidaSchema,
    maxTokens: 8000,
    esfuerzo: "high",
  });

  const validos = new Set(filas.map((f) => f.prescription_id));
  const ajustes = salida.ajustes.filter((a) => validos.has(a.prescriptionId));

  if (!ajustes.length) {
    return { aplicados: 0, resumen: salida.resumen, llmCallId };
  }

  const aplicados = await aplicarAjustes(userId, ajustes, llmCallId);
  return { aplicados, resumen: salida.resumen, llmCallId };
}

/**
 * Aplica los ajustes abriendo una versión NUEVA del plan.
 *
 * No se edita el plan vigente: se clona con los cambios y el anterior queda
 * archivado con su fecha. Así "¿qué decía mi plan la semana pasada?" tiene
 * respuesta, y un ajuste malo se revierte volviendo a activar la versión previa
 * en vez de reconstruirla de memoria.
 */
async function aplicarAjustes(
  userId: string,
  ajustes: Ajuste[],
  llmCallId: number,
): Promise<number> {
  const db = await getDb();
  const hoy = hoyISO();

  const [vigente] = await db
    .select()
    .from(plan)
    .where(and(eq(plan.userId, userId), eq(plan.activo, true)))
    .limit(1);
  if (!vigente) throw new Error("No hay un plan vigente que ajustar.");

  const sesiones = await db.select().from(planSession).where(eq(planSession.planId, vigente.id));
  const prescripciones = await db
    .select()
    .from(prescription)
    .where(
      sql`${prescription.planSessionId} IN (${sql.join(
        sesiones.map((s) => sql`${s.id}`),
        sql`, `,
      )})`,
    );

  const porId = new Map(ajustes.map((a) => [a.prescriptionId, a]));
  const nuevoPlanId = crypto.randomUUID();
  const sentencias: unknown[] = [
    db.insert(plan).values({
      id: nuevoPlanId,
      userId,
      nombre: vigente.nombre,
      origen: "agente",
      vigenteDesde: hoy,
      activo: true,
      llmCallId,
    }),
  ];

  const cambios: (typeof planChange.$inferInsert)[] = [];

  for (const s of sesiones) {
    const nuevaSesionId = crypto.randomUUID();
    sentencias.push(
      db.insert(planSession).values({
        id: nuevaSesionId,
        planId: nuevoPlanId,
        diaSemana: s.diaSemana,
        nombre: s.nombre,
        tipo: s.tipo,
        duracionMin: s.duracionMin,
        orden: s.orden,
      }),
    );

    for (const p of prescripciones.filter((x) => x.planSessionId === s.id)) {
      const a = porId.get(p.id);
      const nueva = {
        ...p,
        id: crypto.randomUUID(),
        planSessionId: nuevaSesionId,
        objetivoCargaNum: a?.objetivoCargaNum ?? p.objetivoCargaNum,
        objetivoReps: a?.objetivoReps ?? p.objetivoReps,
        semaforo: a?.semaforo ?? p.semaforo,
        notaAgente: a?.nota ?? p.notaAgente,
      };
      sentencias.push(db.insert(prescription).values(nueva));

      // Una fila de auditoría por CAMPO que cambió, no por ajuste: así se puede
      // preguntar "¿cuándo empezó a subirme la carga?" campo por campo.
      if (a) {
        const campos: [string, unknown, unknown][] = [
          ["objetivo_carga_num", p.objetivoCargaNum, nueva.objetivoCargaNum],
          ["objetivo_reps", p.objetivoReps, nueva.objetivoReps],
          ["semaforo", p.semaforo, nueva.semaforo],
        ];
        for (const [campo, antes, despues] of campos) {
          if (String(antes) === String(despues)) continue;
          cambios.push({
            userId,
            planId: nuevoPlanId,
            prescriptionId: nueva.id,
            campo,
            valorAntes: String(antes),
            valorDespues: String(despues),
            motivo: a.motivo,
            origen: "agente",
            llmCallId,
          });
        }
      }
    }
  }

  // El plan viejo se cierra, no se borra.
  sentencias.push(
    db
      .update(plan)
      .set({ activo: false, vigenteHasta: hoy })
      .where(and(eq(plan.userId, userId), eq(plan.activo, true))),
  );
  for (const c of cambios) sentencias.push(db.insert(planChange).values(c));

  await atomico(db, sentencias);
  return cambios.length;
}

export const ajustarPlan = createServerFn({ method: "POST" }).handler(() => ajustarPlanLogic());

/** Historial de cambios: responde "¿por qué subió mi objetivo?". */
export const historialCambios = createServerFn()
  .inputValidator(z.object({ limite: z.number().int().min(1).max(100).default(30) }))
  .handler(async ({ data }) => {
    const { id: userId } = await usuarioActual();
    return consultaVista<{
      campo: string;
      valor_antes: string;
      valor_despues: string;
      motivo: string;
      creado_en: string;
      ejercicio: string;
    }>(
      `SELECT pc.campo, pc.valor_antes, pc.valor_despues, pc.motivo, pc.creado_en,
              COALESCE(e.nombre, '(ejercicio retirado)') AS ejercicio
       FROM plan_change pc
       LEFT JOIN prescription p ON p.id = pc.prescription_id
       LEFT JOIN exercise e ON e.id = p.exercise_id
       WHERE pc.user_id = ?
       ORDER BY pc.creado_en DESC
       LIMIT ?`,
      [userId, data.limite],
    );
  });
