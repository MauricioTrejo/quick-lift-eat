/**
 * Lecturas. **Solo servidor** — se exponen al cliente como server functions, que
 * es la única puerta entre el navegador y la base.
 *
 * Ninguna de estas funciones recibe `userId`: lo deriva `usuarioActual()` de la
 * petición. Ver src/lib/auth.ts para por qué eso importa más que la inyección.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { consultaVista, getDb } from "../db/client";
import { usuarioActual } from "../auth";
import {
  agendaEvento,
  dailyMetric,
  exercise,
  foodItem,
  mealLog,
  mealPreset,
  plan,
  planSession,
  prescription,
  profile,
  session,
  setLog,
} from "../db/schema";

/** YYYY-MM-DD en la zona del servidor. */
export const hoyISO = () => new Date().toISOString().slice(0, 10);

/** 1 = lunes … 7 = domingo. getDay() da 0 = domingo, de ahí el ajuste. */
export const diaSemanaISO = (d = new Date()) => d.getDay() || 7;

const slotSchema = z.enum(["desayuno", "comida", "snack", "cena"]);

/* ══════════════════════════════════════════════════════════════════════════
   PANTALLA "HOY"
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * PATRÓN DE ESTE ARCHIVO: la lógica vive en funciones planas (`…Logic`) y la
 * server function es una envoltura delgada que valida y expone por RPC.
 *
 * No es ceremonia. Una server function NO puede llamar a otra —el registro de
 * RPC no la encuentra y falla en tiempo de ejecución— y el agente semanal correrá
 * desde un Cron Trigger, sin petición HTTP de la que colgarse. Con la lógica
 * separada, el cron, los scripts y otras server functions llaman a la función
 * plana; el navegador llama a la envoltura.
 */
export async function obtenerHoyLogic() {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const fecha = hoyISO();

  const [perfil] = await db.select().from(profile).where(eq(profile.userId, userId)).limit(1);

  // El plan vigente. Si hay varios, gana el activo más reciente.
  const [planActivo] = await db
    .select()
    .from(plan)
    .where(and(eq(plan.userId, userId), eq(plan.activo, true)))
    .orderBy(desc(plan.vigenteDesde))
    .limit(1);

  let sesionPlan: typeof planSession.$inferSelect | undefined;
  let ejercicios = 0;
  let series = 0;

  if (planActivo) {
    // La sesión de hoy sale del día de la semana, no de una fecha codificada.
    [sesionPlan] = await db
      .select()
      .from(planSession)
      .where(and(eq(planSession.planId, planActivo.id), eq(planSession.diaSemana, diaSemanaISO())))
      .limit(1);

    if (sesionPlan) {
      const [agg] = await db
        .select({
          ejercicios: sql<number>`COUNT(*)`,
          series: sql<number>`COALESCE(SUM(${prescription.series}), 0)`,
        })
        .from(prescription)
        .where(eq(prescription.planSessionId, sesionPlan.id));
      ejercicios = agg?.ejercicios ?? 0;
      series = agg?.series ?? 0;
    }
  }

  // La sesión real de hoy, si ya se empezó.
  const [sesionReal] = await db
    .select()
    .from(session)
    .where(and(eq(session.userId, userId), eq(session.fecha, fecha)))
    .limit(1);

  let seriesHechas = 0;
  if (sesionReal) {
    const [c] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(setLog)
      .where(eq(setLog.sessionId, sesionReal.id));
    seriesHechas = c?.n ?? 0;
  }

  const [totales] = await db
    .select({
      proteinaG: sql<number>`COALESCE(SUM(${mealLog.proteinaG}), 0)`,
      fibraG: sql<number>`COALESCE(SUM(${mealLog.fibraG}), 0)`,
      calorias: sql<number>`COALESCE(SUM(${mealLog.calorias}), 0)`,
      comidas: sql<number>`COUNT(*)`,
    })
    .from(mealLog)
    .where(and(eq(mealLog.userId, userId), eq(mealLog.fecha, fecha)));

  const [huboSnack] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(mealLog)
    .where(and(eq(mealLog.userId, userId), eq(mealLog.fecha, fecha), eq(mealLog.slot, "snack")));

  const [metrica] = await db
    .select()
    .from(dailyMetric)
    .where(and(eq(dailyMetric.userId, userId), eq(dailyMetric.fecha, fecha)))
    .limit(1);

  const agenda = await db
    .select()
    .from(agendaEvento)
    .where(eq(agendaEvento.userId, userId))
    .orderBy(agendaEvento.hora);

  return {
    fecha,
    diaSemana: diaSemanaISO(),
    tienePlan: Boolean(planActivo),
    sesion: sesionPlan
      ? {
          id: sesionPlan.id,
          nombre: sesionPlan.nombre,
          tipo: sesionPlan.tipo,
          duracionMin: sesionPlan.duracionMin,
          ejercicios,
          series,
        }
      : null,
    sesionReal: sesionReal
      ? {
          id: sesionReal.id,
          estado: sesionReal.estado,
          rpe: sesionReal.rpe,
          duracionS: sesionReal.duracionS,
          seriesHechas,
        }
      : null,
    totales: {
      proteinaG: Math.round(totales?.proteinaG ?? 0),
      fibraG: Math.round(totales?.fibraG ?? 0),
      calorias: Math.round(totales?.calorias ?? 0),
      comidas: totales?.comidas ?? 0,
    },
    objetivos: {
      proteinaG: perfil?.objetivoProteinaG ?? 140,
      fibraG: perfil?.objetivoFibraG ?? 30,
      // La meta calórica depende de si hoy toca entrenar. Antes estaba fija.
      calorias: sesionPlan ? (perfil?.kcalEntreno ?? 2100) : (perfil?.kcalDescanso ?? 1850),
      esDiaEntreno: Boolean(sesionPlan),
    },
    noNegociables: {
      snack: (huboSnack?.n ?? 0) > 0,
      bascula: metrica?.peso != null,
    },
    peso: metrica?.peso ?? null,
    agenda: agenda.map((e) => ({ hora: e.hora, evento: e.evento })),
  };
}

export const obtenerHoy = createServerFn().handler(obtenerHoyLogic);

/* ══════════════════════════════════════════════════════════════════════════
   PANTALLA "ENTRENO"
   ══════════════════════════════════════════════════════════════════════════ */

export async function obtenerEntrenoLogic() {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const fecha = hoyISO();

  const [planActivo] = await db
    .select()
    .from(plan)
    .where(and(eq(plan.userId, userId), eq(plan.activo, true)))
    .orderBy(desc(plan.vigenteDesde))
    .limit(1);
  if (!planActivo) return { sesion: null, ejercicios: [], sets: [], sesionReal: null };

  const [sesionPlan] = await db
    .select()
    .from(planSession)
    .where(and(eq(planSession.planId, planActivo.id), eq(planSession.diaSemana, diaSemanaISO())))
    .limit(1);
  if (!sesionPlan) return { sesion: null, ejercicios: [], sets: [], sesionReal: null };

  const ejercicios = await db
    .select({
      id: prescription.id,
      exerciseId: prescription.exerciseId,
      nombre: exercise.nombre,
      orden: prescription.orden,
      series: prescription.series,
      objetivoCargaNum: prescription.objetivoCargaNum,
      objetivoCargaTexto: prescription.objetivoCargaTexto,
      objetivoReps: prescription.objetivoReps,
      unidad: prescription.unidad,
      porLado: prescription.porLado,
      semaforo: prescription.semaforo,
      notaAgente: prescription.notaAgente,
    })
    .from(prescription)
    .innerJoin(exercise, eq(exercise.id, prescription.exerciseId))
    .where(eq(prescription.planSessionId, sesionPlan.id))
    .orderBy(prescription.orden);

  const [sesionReal] = await db
    .select()
    .from(session)
    .where(and(eq(session.userId, userId), eq(session.fecha, fecha)))
    .limit(1);

  const sets = sesionReal
    ? await db.select().from(setLog).where(eq(setLog.sessionId, sesionReal.id))
    : [];

  return {
    sesion: { id: sesionPlan.id, nombre: sesionPlan.nombre, tipo: sesionPlan.tipo },
    ejercicios,
    sets,
    sesionReal: sesionReal ?? null,
  };
}

export const obtenerEntreno = createServerFn().handler(obtenerEntrenoLogic);

/** Mejor serie previa por prescripción, para marcar récords en el resumen. */
export const obtenerPrevios = createServerFn().handler(async () => {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const fecha = hoyISO();

  const filas = await db
    .select({
      exerciseId: setLog.exerciseId,
      carga: sql<number>`MAX(${setLog.carga})`,
      reps: sql<number>`MAX(${setLog.reps})`,
      fecha: sql<string>`MAX(${session.fecha})`,
    })
    .from(setLog)
    .innerJoin(session, eq(session.id, setLog.sessionId))
    .where(and(eq(session.userId, userId), sql`${session.fecha} < ${fecha}`))
    .groupBy(setLog.exerciseId);

  return filas;
});

/* ══════════════════════════════════════════════════════════════════════════
   PANTALLA "COMIDA"
   ══════════════════════════════════════════════════════════════════════════ */

/** Cuántas comidas hacen falta antes de fiarse del historial propio. */
const MINIMO_PARA_DERIVAR = 5;

export const obtenerComidaSchema = z.object({ slot: slotSchema });

export async function obtenerComidaLogic(data: z.infer<typeof obtenerComidaSchema>) {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const fecha = hoyISO();

  const [perfil] = await db.select().from(profile).where(eq(profile.userId, userId)).limit(1);

  const [cuantas] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(mealLog)
    .where(eq(mealLog.userId, userId));
  const historial = cuantas?.n ?? 0;

  /* LO MÁS FRECUENTE. Sale de v_alimentos_frecuentes, que rankea por conteo
       ponderado por recencia y agrupado por slot. Con poco historial el ranking
       es ruido, así que por debajo del mínimo se muestran los presets semilla.
       Ver drizzle/9001_vistas_v1.sql. */
  const frecuentes =
    historial >= MINIMO_PARA_DERIVAR
      ? await consultaVista<{
          food_item_id: string;
          nombre: string;
          categoria: string;
          medida: string;
          proteina_unidad: number;
          fibra_unidad: number;
          calorias_unidad: number;
          veces: number;
          cantidad_promedio: number;
        }>(
          `SELECT food_item_id, nombre, categoria, medida,
                  proteina_unidad, fibra_unidad, calorias_unidad,
                  veces, cantidad_promedio
           FROM v_alimentos_frecuentes
           WHERE user_id = ? AND slot = ?
           ORDER BY puntaje DESC, veces DESC
           LIMIT 8`,
          [userId, data.slot],
        )
      : [];

  const presets = await db.select().from(mealPreset).where(eq(mealPreset.slot, data.slot)).limit(8);

  const alimentos = await db.select().from(foodItem).orderBy(foodItem.categoria, foodItem.nombre);

  const delDia = await db
    .select()
    .from(mealLog)
    .where(and(eq(mealLog.userId, userId), eq(mealLog.fecha, fecha)))
    .orderBy(mealLog.hora);

  return {
    slot: data.slot,
    frecuentes,
    presets,
    alimentos,
    delDia,
    historial,
    minimoParaDerivar: MINIMO_PARA_DERIVAR,
    plantilla: perfil?.plantillaPlato
      ? (JSON.parse(perfil.plantillaPlato) as Record<string, Record<string, number>>)
      : null,
    objetivos: {
      proteinaG: perfil?.objetivoProteinaG ?? 140,
      fibraG: perfil?.objetivoFibraG ?? 30,
    },
  };
}

export const obtenerComida = createServerFn()
  .inputValidator(obtenerComidaSchema)
  .handler(({ data }) => obtenerComidaLogic(data));

/* ══════════════════════════════════════════════════════════════════════════
   PLAN CONTRA REALIDAD — el contexto que consumirá el agente
   ══════════════════════════════════════════════════════════════════════════ */

/** Una fila de v_plan_vs_real. Es también el contexto que recibirá el agente. */
export type FilaPlanVsReal = {
  fecha: string;
  sesion_nombre: string;
  ejercicio: string;
  /** Identifica la prescripción a ajustar; sin esto el agente no sabría qué tocar. */
  prescription_id: string;
  patron_id: string | null;
  orden: number;
  series_prescritas: number;
  reps_totales: number;
  series_hechas: number;
  series_faltantes: number;
  objetivo_reps: number;
  objetivo_carga_num: number;
  carga_max: number;
  dif_carga: number;
  volumen: number;
  series_al_fallo: number;
  unidad: string;
  semaforo: string;
  rpe: string | null;
};

export const obtenerPlanVsReal = createServerFn()
  .inputValidator(z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
  .handler(async ({ data }): Promise<FilaPlanVsReal[]> => {
    const { id: userId } = await usuarioActual();
    return consultaVista<FilaPlanVsReal>(
      `SELECT fecha, sesion_nombre, ejercicio, prescription_id, patron_id, orden,
              series_prescritas, reps_totales, series_hechas, series_faltantes,
              objetivo_reps, objetivo_carga_num, carga_max, dif_carga,
              volumen, series_al_fallo, unidad, semaforo, rpe
       FROM v_plan_vs_real
       WHERE user_id = ? AND fecha >= ?
       ORDER BY fecha DESC, orden ASC`,
      [userId, data.desde],
    );
  });

/** Racha: días seguidos cumpliendo al menos 3 de los 4 no-negociables. */
export const obtenerRacha = createServerFn().handler(async () => {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const desde = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);

  const dias = await db.all<{ fecha: string; cumplidos: number }>(sql`
    SELECT d.fecha,
           (CASE WHEN COALESCE(t.proteina_g,0) >= COALESCE(p.objetivo_proteina_g,140) THEN 1 ELSE 0 END
          + CASE WHEN COALESCE(t.fibra_g,0)    >= COALESCE(p.objetivo_fibra_g,30)     THEN 1 ELSE 0 END
          + CASE WHEN d.snack_1630 = 1 THEN 1 ELSE 0 END
          + CASE WHEN d.peso IS NOT NULL THEN 1 ELSE 0 END) AS cumplidos
    FROM daily_metric d
    LEFT JOIN v_totales_dia t ON t.user_id = d.user_id AND t.fecha = d.fecha
    LEFT JOIN profile p       ON p.user_id = d.user_id
    WHERE d.user_id = ${userId} AND d.fecha >= ${desde}
    ORDER BY d.fecha DESC
  `);

  let racha = 0;
  for (const d of dias) {
    if (d.cumplidos >= 3) racha++;
    else break;
  }
  return racha;
});
