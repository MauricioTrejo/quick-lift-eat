/**
 * Escrituras. **Solo servidor.**
 *
 * TODAS las escrituras de la app pasan por este módulo, a propósito. Dos razones:
 *
 *   1. Cada entrada se valida con zod antes de tocar nada. Drizzle ya parametriza
 *      las queries, así que la inyección de SQL no es el riesgo; el riesgo es
 *      escribir basura bien formada. Aquí es donde se detiene.
 *   2. Si algún día hace falta que la app funcione sin señal en el gimnasio,
 *      reintroducir una cola local es cambiar este archivo, no las pantallas.
 *
 * Ninguna función recibe `userId`: lo deriva `usuarioActual()` de la petición.
 * Aunque el cliente mande uno, se ignora. Ver src/lib/auth.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { atomico, getDb } from "../db/client";
import { usuarioActual } from "../auth";
import {
  dailyMetric,
  foodItem,
  mealLog,
  mealLogItem,
  plan,
  planSession,
  prescription,
  session,
  setLog,
} from "../db/schema";
import { diaSemanaISO, hoyISO } from "./queries";

const slotSchema = z.enum(["desayuno", "comida", "snack", "cena"]);
const categoriaSchema = z.enum(["proteina", "verdura", "carbohidrato", "grasa", "fruta", "extra"]);

/** Devuelve la sesión de hoy, creándola si es el primer registro del día. */
async function sesionDeHoy(userId: string) {
  const db = await getDb();
  const fecha = hoyISO();

  const [existente] = await db
    .select()
    .from(session)
    .where(and(eq(session.userId, userId), eq(session.fecha, fecha)))
    .limit(1);
  if (existente) return existente;

  // Se enlaza con la sesión del plan que toca hoy, si existe. Si entrenas algo
  // fuera de plan, planSessionId queda nulo y eso es información, no un error:
  // v_plan_vs_real lo refleja.
  const [ps] = await db
    .select({ id: planSession.id })
    .from(planSession)
    .innerJoin(plan, eq(plan.id, planSession.planId))
    .where(
      and(
        eq(plan.userId, userId),
        eq(plan.activo, true),
        eq(planSession.diaSemana, diaSemanaISO()),
      ),
    )
    .limit(1);

  const nueva = {
    id: crypto.randomUUID(),
    userId,
    fecha,
    planSessionId: ps?.id ?? null,
    estado: "en_curso" as const,
  };
  await db.insert(session).values(nueva);
  const [creada] = await db.select().from(session).where(eq(session.id, nueva.id)).limit(1);
  return creada!;
}

/* ══════════════════════════════════════════════════════════════════════════
   ENTRENO
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * PATRÓN DE ESTE ARCHIVO: la lógica vive en funciones planas (`…Logic`) y la
 * server function es una envoltura delgada. Una server function no puede llamar
 * a otra, y el agente semanal correrá desde un Cron Trigger sin petición HTTP.
 * Ver la nota extensa en queries.ts.
 */
export const registrarSerieSchema = z.object({
  prescriptionId: z.string().min(1),
  serie: z.number().int().min(1).max(50),
  carga: z.number().min(0).max(2000),
  reps: z.number().int().min(0).max(10000),
  alFallo: z.boolean().optional(),
  rir: z.number().int().min(0).max(10).optional(),
  nota: z.string().max(500).optional(),
});

export async function registrarSerieLogic(data: z.infer<typeof registrarSerieSchema>) {
  const { id: userId } = await usuarioActual();
  const db = await getDb();

  // La prescripción decide el ejercicio y la unidad. No se aceptan del cliente:
  // vienen de la base para que no puedan contradecir al plan.
  const [presc] = await db
    .select()
    .from(prescription)
    .where(eq(prescription.id, data.prescriptionId))
    .limit(1);
  if (!presc) throw new Error("La prescripción no existe.");

  const s = await sesionDeHoy(userId);

  await db
    .insert(setLog)
    .values({
      sessionId: s.id,
      prescriptionId: presc.id,
      exerciseId: presc.exerciseId,
      serie: data.serie,
      carga: data.carga,
      reps: data.reps,
      unidad: presc.unidad,
      alFallo: data.alFallo ?? false,
      rir: data.rir ?? null,
      nota: data.nota ?? null,
    })
    .onConflictDoUpdate({
      // El índice único (session, prescription, serie) convierte un re-registro
      // en corrección en vez de en duplicado.
      target: [setLog.sessionId, setLog.prescriptionId, setLog.serie],
      set: {
        carga: data.carga,
        reps: data.reps,
        alFallo: data.alFallo ?? false,
        rir: data.rir ?? null,
        nota: data.nota ?? null,
      },
    });

  return { ok: true, sessionId: s.id };
}

export const registrarSerie = createServerFn({ method: "POST" })
  .inputValidator(registrarSerieSchema)
  .handler(({ data }) => registrarSerieLogic(data));

export const borrarSerie = createServerFn({ method: "POST" })
  .inputValidator(z.object({ prescriptionId: z.string().min(1), serie: z.number().int().min(1) }))
  .handler(async ({ data }) => {
    const { id: userId } = await usuarioActual();
    const db = await getDb();
    const fecha = hoyISO();

    const [s] = await db
      .select()
      .from(session)
      .where(and(eq(session.userId, userId), eq(session.fecha, fecha)))
      .limit(1);
    if (!s) return { ok: true };

    await db
      .delete(setLog)
      .where(
        and(
          eq(setLog.sessionId, s.id),
          eq(setLog.prescriptionId, data.prescriptionId),
          eq(setLog.serie, data.serie),
        ),
      );
    return { ok: true };
  });

export const cerrarSesion = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      rpe: z.enum(["facil", "bien", "duro"]).optional(),
      sensacion: z.enum(["verde", "ambar", "rojo"]).optional(),
      duracionS: z.number().int().min(0).max(86400),
    }),
  )
  .handler(async ({ data }) => {
    const { id: userId } = await usuarioActual();
    const db = await getDb();
    const s = await sesionDeHoy(userId);

    await db
      .update(session)
      .set({
        estado: "completada",
        rpe: data.rpe ?? null,
        sensacion: data.sensacion ?? null,
        duracionS: data.duracionS,
        cerradaEn: new Date().toISOString(),
      })
      .where(and(eq(session.id, s.id), eq(session.userId, userId)));

    return { ok: true, sessionId: s.id };
  });

export const reabrirSesion = createServerFn({ method: "POST" }).handler(async () => {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const fecha = hoyISO();

  await db
    .update(session)
    .set({ estado: "en_curso", cerradaEn: null })
    .where(and(eq(session.userId, userId), eq(session.fecha, fecha)));
  return { ok: true };
});

/* ══════════════════════════════════════════════════════════════════════════
   COMIDA
   El corazón del asunto: `meal_log` guarda los totales para que la pantalla
   "Hoy" no tenga que sumar renglones, y `meal_log_item` guarda el detalle por
   alimento, que es lo único que permite responder "¿qué como más seguido?".
   Ambos se escriben en el MISMO batch: si no, los totales podrían quedar
   apuntando a un detalle que nunca se insertó.
   ══════════════════════════════════════════════════════════════════════════ */

const itemSchema = z.object({
  foodItemId: z.string().min(1).nullable(),
  categoria: categoriaSchema,
  cantidad: z.number().min(0).max(50),
});

export const registrarComidaSchema = z.object({
  slot: slotSchema,
  nombre: z.string().min(1).max(200),
  origen: z.enum(["preset", "plato", "texto"]).default("plato"),
  items: z.array(itemSchema).max(20).default([]),
  textoOriginal: z.string().max(1000).optional(),
  sinAnalizar: z.boolean().default(false),
});

export async function registrarComidaLogic(data: z.infer<typeof registrarComidaSchema>) {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const fecha = hoyISO();
  const ahora = new Date();
  const hora = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;

  // Los macros se calculan AQUÍ, desde el banco de alimentos, nunca se toman
  // del cliente: si vinieran del navegador, cualquiera podría inventarse un
  // día perfecto de proteína y el agente tomaría decisiones sobre datos falsos.
  const alimentos = await db.select().from(foodItem);
  const porId = new Map(alimentos.map((a) => [a.id, a]));
  const promedioDe = (categoria: string) => {
    const items = alimentos.filter((a) => a.categoria === categoria);
    if (!items.length) return { proteinaG: 0, fibraG: 0, calorias: 0 };
    const n = items.length;
    return {
      proteinaG: items.reduce((t, a) => t + a.proteinaG, 0) / n,
      fibraG: items.reduce((t, a) => t + a.fibraG, 0) / n,
      calorias: items.reduce((t, a) => t + a.calorias, 0) / n,
    };
  };

  const calculados = data.items.map((it) => {
    // Elegir el alimento es opcional: sin él se usa el promedio de la
    // categoría, que es lo que hace posible registrar "2 palmas de proteína"
    // sin decidir cuál. Es deliberado, no una carencia.
    const base = it.foodItemId ? porId.get(it.foodItemId) : undefined;
    const macro = base
      ? { proteinaG: base.proteinaG, fibraG: base.fibraG, calorias: base.calorias }
      : promedioDe(it.categoria);
    return {
      foodItemId: base?.id ?? null,
      categoria: it.categoria,
      cantidad: it.cantidad,
      unidad: base?.medida ?? null,
      proteinaG: macro.proteinaG * it.cantidad,
      fibraG: macro.fibraG * it.cantidad,
      calorias: macro.calorias * it.cantidad,
    };
  });

  const total = calculados.reduce(
    (t, i) => ({
      proteinaG: t.proteinaG + i.proteinaG,
      fibraG: t.fibraG + i.fibraG,
      calorias: t.calorias + i.calorias,
    }),
    { proteinaG: 0, fibraG: 0, calorias: 0 },
  );

  const id = crypto.randomUUID();
  const sentencias = [
    db.insert(mealLog).values({
      id,
      userId,
      fecha,
      slot: data.slot,
      hora,
      nombre: data.nombre,
      origen: data.origen,
      textoOriginal: data.textoOriginal ?? null,
      sinAnalizar: data.sinAnalizar,
      proteinaG: Math.round(total.proteinaG * 10) / 10,
      fibraG: Math.round(total.fibraG * 10) / 10,
      calorias: Math.round(total.calorias),
    }),
    ...calculados.map((i) => db.insert(mealLogItem).values({ mealLogId: id, ...i })),
  ];

  // Atómico: totales y detalle entran juntos o no entra ninguno.
  await atomico(db, sentencias);

  // Marca el no-negociable del snack sin que el usuario tenga que tocarlo.
  if (data.slot === "snack") {
    await db
      .insert(dailyMetric)
      .values({ userId, fecha, snack1630: true })
      .onConflictDoUpdate({
        target: [dailyMetric.userId, dailyMetric.fecha],
        set: { snack1630: true },
      });
  }

  return { ok: true, id, total };
}

export const registrarComida = createServerFn({ method: "POST" })
  .inputValidator(registrarComidaSchema)
  .handler(({ data }) => registrarComidaLogic(data));

/* ══════════════════════════════════════════════════════════════════════════
   MÉTRICAS
   ══════════════════════════════════════════════════════════════════════════ */

export const guardarPesoSchema = z.object({ peso: z.number().min(20).max(400) });

export async function guardarPesoLogic(data: z.infer<typeof guardarPesoSchema>) {
  const { id: userId } = await usuarioActual();
  const db = await getDb();
  const fecha = hoyISO();

  await db
    .insert(dailyMetric)
    .values({ userId, fecha, peso: data.peso })
    .onConflictDoUpdate({
      target: [dailyMetric.userId, dailyMetric.fecha],
      set: { peso: data.peso },
    });
  return { ok: true };
}

export const guardarPeso = createServerFn({ method: "POST" })
  .inputValidator(guardarPesoSchema)
  .handler(({ data }) => guardarPesoLogic(data));
