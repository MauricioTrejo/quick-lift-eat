/**
 * Importar un plan. **Solo servidor.**
 *
 * Este esquema zod ES el contrato público del formato: si valida, se puede
 * importar. Está documentado en docs/plan-schema.md, con docs/ejemplo-plan.json
 * como referencia ejecutable.
 *
 * El mismo esquema valida la salida del agente generador. Eso es deliberado: si
 * el modelo produce algo que un humano no habría podido escribir a mano, es que
 * el contrato es distinto para cada uno, y entonces no es un contrato.
 *
 * REGLA DEL CATÁLOGO: `exerciseId` debe existir en la tabla `exercise`. No se
 * aceptan ejercicios inventados — sin patrón, sin línea de progresión y sin rango
 * de reps, la mitad de las reglas deterministas dejan de aplicar y el ejercicio se
 * vuelve un nombre bonito que nada sabe analizar.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { atomico, getDb } from "../db/client";
import { usuarioActual } from "../auth";
import { agendaEvento, exercise, plan, planSession, prescription, profile } from "../db/schema";
import { hoyISO } from "./queries";

export const ejercicioPlanSchema = z.object({
  /** Debe existir en el catálogo. Ver seeds/exercises.json. */
  exerciseId: z.string().min(1),
  series: z.number().int().min(1).max(20),
  /** Reps, o segundos cuando unidad = "segundos". */
  reps: z.number().int().min(1).max(7200),
  carga: z.number().min(0).max(2000).default(0),
  /** El texto humano: "mochila 40 lb + mancuerna 25 lb al pecho". Opcional. */
  cargaTexto: z.string().max(200).nullable().optional(),
  unidad: z.enum(["lb", "kg", "reps", "segundos"]).default("lb"),
  porLado: z.boolean().default(false),
  semaforo: z.enum(["verde", "ambar", "terracota"]).default("verde"),
  nota: z.string().max(500).nullable().optional(),
});

export const sesionPlanSchema = z.object({
  /** 1 = lunes … 7 = domingo. */
  diaSemana: z.number().int().min(1).max(7),
  nombre: z.string().min(1).max(120),
  tipo: z.string().max(40).nullable().optional(),
  duracionMin: z.number().int().min(0).max(600).nullable().optional(),
  ejercicios: z.array(ejercicioPlanSchema).min(1).max(30),
});

export const planSchema = z.object({
  nombre: z.string().min(1).max(160),
  objetivos: z
    .object({
      proteinaG: z.number().min(0).max(500).optional(),
      fibraG: z.number().min(0).max(200).optional(),
      kcalEntreno: z.number().min(0).max(10000).optional(),
      kcalDescanso: z.number().min(0).max(10000).optional(),
    })
    .optional(),
  agenda: z
    .array(
      z.object({
        hora: z.string().regex(/^\d{2}:\d{2}$/),
        evento: z.string().min(1).max(160),
        tipo: z.string().max(40).nullable().optional(),
      }),
    )
    .max(20)
    .optional(),
  sesiones: z.array(sesionPlanSchema).min(1).max(7),
});

export type PlanImportado = z.infer<typeof planSchema>;

/**
 * Valida un plan SIN escribirlo. La usa la pantalla de alta para mostrar qué se
 * va a importar antes de confirmar — importar a ciegas y luego descubrir que
 * medio plan no cuadró sería peor que no importar.
 */
export const validarPlan = createServerFn({ method: "POST" })
  .inputValidator(z.object({ plan: planSchema }))
  .handler(async ({ data }) => {
    await usuarioActual();
    const db = await getDb();

    const ids = [
      ...new Set(data.plan.sesiones.flatMap((s) => s.ejercicios.map((e) => e.exerciseId))),
    ];
    const existentes = await db
      .select({ id: exercise.id, nombre: exercise.nombre })
      .from(exercise)
      .where(inArray(exercise.id, ids));

    const conocidos = new Set(existentes.map((e) => e.id));
    const desconocidos = ids.filter((i) => !conocidos.has(i));

    return {
      valido: desconocidos.length === 0,
      desconocidos,
      resumen: data.plan.sesiones.map((s) => ({
        diaSemana: s.diaSemana,
        nombre: s.nombre,
        ejercicios: s.ejercicios.length,
        series: s.ejercicios.reduce((t, e) => t + e.series, 0),
      })),
    };
  });

/**
 * Importa un plan y lo deja como el vigente.
 *
 * El plan anterior NO se borra: se cierra con `vigenteHasta` y `activo = false`.
 * Así el histórico sigue siendo comparable y "¿qué decía mi plan en julio?" tiene
 * respuesta. Es la misma mecánica que usará el agente al ajustar.
 */
export const importarPlanSchema = z.object({
  plan: planSchema,
  origen: z.enum(["importado", "manual", "agente"]).default("importado"),
});

/**
 * Lógica plana: la llama tanto la server function de abajo como el agente
 * generador, que corre sin petición HTTP. Ver la nota de patrón en queries.ts.
 */
export async function importarPlanLogic(data: z.infer<typeof importarPlanSchema>) {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const hoy = hoyISO();

  // El catálogo manda: un exerciseId inventado detiene la importación entera
  // en vez de dejar un plan a medias.
  const ids = [
    ...new Set(data.plan.sesiones.flatMap((s) => s.ejercicios.map((e) => e.exerciseId))),
  ];
  const existentes = await db
    .select({ id: exercise.id })
    .from(exercise)
    .where(inArray(exercise.id, ids));
  const conocidos = new Set(existentes.map((e) => e.id));
  const desconocidos = ids.filter((i) => !conocidos.has(i));
  if (desconocidos.length) {
    throw new Error(
      `Estos ejercicios no están en el catálogo: ${desconocidos.join(", ")}. ` +
        `Añádelos primero o usa un id existente (ver seeds/exercises.json).`,
    );
  }

  // Cerrar el plan vigente en vez de borrarlo.
  await db
    .update(plan)
    .set({ activo: false, vigenteHasta: hoy })
    .where(and(eq(plan.userId, userId), eq(plan.activo, true)));

  const planId = crypto.randomUUID();
  const sentencias: unknown[] = [
    db.insert(plan).values({
      id: planId,
      userId,
      nombre: data.plan.nombre,
      origen: data.origen,
      vigenteDesde: hoy,
      activo: true,
    }),
  ];

  for (const s of data.plan.sesiones) {
    const sesionId = crypto.randomUUID();
    sentencias.push(
      db.insert(planSession).values({
        id: sesionId,
        planId,
        diaSemana: s.diaSemana,
        nombre: s.nombre,
        tipo: s.tipo ?? null,
        duracionMin: s.duracionMin ?? null,
        orden: s.diaSemana,
      }),
    );
    s.ejercicios.forEach((e, i) => {
      sentencias.push(
        db.insert(prescription).values({
          id: crypto.randomUUID(),
          planSessionId: sesionId,
          exerciseId: e.exerciseId,
          orden: i + 1,
          series: e.series,
          objetivoCargaNum: e.carga,
          objetivoCargaTexto: e.cargaTexto ?? null,
          objetivoReps: e.reps,
          unidad: e.unidad,
          porLado: e.porLado,
          semaforo: e.semaforo,
          notaAgente: e.nota ?? null,
        }),
      );
    });
  }

  // Todo el plan entra o no entra nada. Un plan a medias es peor que ninguno:
  // la app abriría con sesiones incompletas y parecería un bug del entreno.
  await atomico(db, sentencias);

  if (data.plan.objetivos) {
    const o = data.plan.objetivos;
    await db
      .update(profile)
      .set({
        ...(o.proteinaG !== undefined && { objetivoProteinaG: o.proteinaG }),
        ...(o.fibraG !== undefined && { objetivoFibraG: o.fibraG }),
        ...(o.kcalEntreno !== undefined && { kcalEntreno: o.kcalEntreno }),
        ...(o.kcalDescanso !== undefined && { kcalDescanso: o.kcalDescanso }),
      })
      .where(eq(profile.userId, userId));
  }

  if (data.plan.agenda?.length) {
    await db.delete(agendaEvento).where(eq(agendaEvento.userId, userId));
    await atomico(
      db,
      data.plan.agenda.map((a) =>
        db
          .insert(agendaEvento)
          .values({ userId, hora: a.hora, evento: a.evento, tipo: a.tipo ?? null }),
      ),
    );
  }

  return {
    ok: true,
    planId,
    sesiones: data.plan.sesiones.length,
    prescripciones: data.plan.sesiones.reduce((t, s) => t + s.ejercicios.length, 0),
  };
}

export const importarPlan = createServerFn({ method: "POST" })
  .inputValidator(importarPlanSchema)
  .handler(({ data }) => importarPlanLogic(data));
