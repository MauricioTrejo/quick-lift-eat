/**
 * Esquema de la base (SQLite/D1). Fuente de verdad de la forma de los datos:
 * los tipos de TypeScript se derivan de aquí, no se escriben a mano.
 *
 * Tres zonas, y la separación es lo que convierte esto en un producto en vez del
 * plan de una persona:
 *
 *   1. CATÁLOGO   — ejercicios, patrones y alimentos. Se siembra, es compartido.
 *   2. EL PLAN    — lo que deberías hacer. Versionado, porque el agente lo cambia.
 *   3. LA REALIDAD— lo que hiciste. Nunca se reescribe.
 *
 * Convención de propiedad: en las tablas de catálogo, `userId` nulo significa fila
 * global (viene de la semilla); `userId` presente significa alta propia de ese
 * usuario. Un solo patrón, sin tablas duplicadas.
 */
import { relations, sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const ahora = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/* ══════════════════════════════════════════════════════════════════════════
   USUARIO
   El deploy asume una persona (Cloudflare Access), pero la interfaz del
   servicio no: `userId` viaja en todo desde el día uno. Pasar a multi-usuario
   se vuelve configuración, no una migración de datos.
   ══════════════════════════════════════════════════════════════════════════ */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  /** Lo entrega Cloudflare Access; en desarrollo, la var DEV_USER_EMAIL. */
  email: text("email").notNull().unique(),
  nombre: text("nombre"),
  creadoEn: text("creado_en").notNull().default(ahora),
});

export const profile = sqliteTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  objetivoProteinaG: real("objetivo_proteina_g").notNull().default(140),
  objetivoFibraG: real("objetivo_fibra_g").notNull().default(30),
  kcalEntreno: real("kcal_entreno").notNull().default(2100),
  kcalDescanso: real("kcal_descanso").notNull().default(1850),
  /** "lb" o "kg". El catálogo es agnóstico; la preferencia es del usuario. */
  unidadPreferida: text("unidad_preferida").notNull().default("lb"),
  /** JSON serializado: SQLite no tiene arreglos ni JSONB nativos. */
  restricciones: text("restricciones"),
  /**
   * JSON con las porciones por defecto de cada slot, en unidades de mano:
   * { "comida": { "proteina": 2, "verdura": 2, "carbohidrato": 1, "grasa": 1 }, … }
   * Es del usuario, no del catálogo: quien coma distinto ajusta su plantilla sin
   * tocar el banco de alimentos, que es compartido.
   */
  plantillaPlato: text("plantilla_plato"),
  actualizadoEn: text("actualizado_en").notNull().default(ahora),
});

/* ══════════════════════════════════════════════════════════════════════════
   CATÁLOGO — se siembra desde seeds/, es genérico, no contiene datos de nadie
   ══════════════════════════════════════════════════════════════════════════ */

export const patron = sqliteTable("patron", {
  id: text("id").primaryKey(), // "bisagra", "rodilla", "pull_vertical"…
  nombre: text("nombre").notNull(),
});

export const exercise = sqliteTable(
  "exercise",
  {
    id: text("id").primaryKey(), // "sentadilla_copa"
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    patronId: text("patron_id").references(() => patron.id),
    categoria: text("categoria"), // compuesto | aislado | cardio | movilidad
    /** JSON: ["mancuerna","mochila"]. Filtra qué puede prescribir el agente. */
    equipo: text("equipo"),
    rangoReps: text("rango_reps"), // "6-12"
    intensidad: text("intensidad"), // "RIR 1-2"
    lineaProgresion: text("linea_progresion"),
    unilateral: integer("unilateral", { mode: "boolean" }).notNull().default(false),
    /** Unidad natural: "lb" (carga), "reps" (peso corporal) o "segundos". */
    unidad: text("unidad").notNull().default("lb"),
  },
  (t) => [index("ix_exercise_patron").on(t.patronId), index("ix_exercise_user").on(t.userId)],
);

/** Los pasos ordenados de una línea de progresión (p. ej. hacia el pistol). */
export const progresionPaso = sqliteTable(
  "progresion_paso",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    linea: text("linea").notNull(),
    orden: integer("orden").notNull(),
    descripcion: text("descripcion").notNull(),
  },
  (t) => [uniqueIndex("ux_progresion_linea_orden").on(t.linea, t.orden)],
);

export const foodItem = sqliteTable(
  "food_item",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    categoria: text("categoria").notNull(), // proteina | verdura | carbohidrato | grasa
    /** Unidad de mano: "palma", "puño", "pulgar". */
    medida: text("medida").notNull(),
    proteinaG: real("proteina_g").notNull().default(0),
    fibraG: real("fibra_g").notNull().default(0),
    calorias: real("calorias").notNull().default(0),
  },
  (t) => [index("ix_food_categoria").on(t.categoria), index("ix_food_user").on(t.userId)],
);

/** Trozos de conocimiento para el agente semanal (RAG). */
export const knowledgeChunk = sqliteTable("knowledge_chunk", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  fuente: text("fuente"),
  seccion: text("seccion"),
  texto: text("texto").notNull(),
  /** JSON: ["progresion","carga"]. */
  tags: text("tags"),
});

/* ══════════════════════════════════════════════════════════════════════════
   EL PLAN — versionado
   `vigenteHasta` + `activo` es lo que deja al agente ajustar SIN destruir el
   histórico: se cierra la versión vigente y se abre otra. Sin esto, "el agente
   modificó mi plan" sería una sobrescritura y no habría con qué comparar.
   ══════════════════════════════════════════════════════════════════════════ */

export const plan = sqliteTable(
  "plan",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    /** agente | importado | manual */
    origen: text("origen").notNull(),
    vigenteDesde: text("vigente_desde").notNull(),
    vigenteHasta: text("vigente_hasta"),
    activo: integer("activo", { mode: "boolean" }).notNull().default(true),
    /** Si nació de una llamada al modelo, aquí queda el rastro. */
    llmCallId: integer("llm_call_id"),
    creadoEn: text("creado_en").notNull().default(ahora),
  },
  (t) => [index("ix_plan_user_activo").on(t.userId, t.activo)],
);

export const planSession = sqliteTable(
  "plan_session",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "cascade" }),
    /** 1 = lunes … 7 = domingo (ISO-8601). Nada de nombres de día en español
        codificados: el día de hoy se resuelve con getDay() y no con un string. */
    diaSemana: integer("dia_semana").notNull(),
    nombre: text("nombre").notNull(),
    tipo: text("tipo"), // pierna | pull | push | calistenia | hiit | descanso
    duracionMin: integer("duracion_min"),
    orden: integer("orden").notNull().default(0),
  },
  (t) => [index("ix_plansession_plan_dia").on(t.planId, t.diaSemana)],
);

export const prescription = sqliteTable(
  "prescription",
  {
    id: text("id").primaryKey(),
    planSessionId: text("plan_session_id")
      .notNull()
      .references(() => planSession.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercise.id),
    orden: integer("orden").notNull(),
    series: integer("series").notNull(),
    /**
     * PESO TOTAL EFECTIVO, y con eso se prellena el stepper.
     *
     * Nunca un desglose de dónde sale la carga: "mochila 40 + mancuerna 25" son
     * 65 y punto. Guardar las partes obligaría a sumarlas entre series, que es
     * justo el trabajo mental que esta app existe para quitar — y además haría
     * incomparables dos sesiones que movieron el mismo peso repartido distinto.
     */
    objetivoCargaNum: real("objetivo_carga_num").notNull().default(0),
    /**
     * Matiz que el número NO dice: "al pecho", "por mancuerna", "en escalón".
     * Si solo repite la cifra, va nulo.
     */
    objetivoCargaTexto: text("objetivo_carga_texto"),
    /** Reps, o segundos si unidad = "segundos". */
    objetivoReps: integer("objetivo_reps").notNull(),
    unidad: text("unidad").notNull().default("lb"),
    porLado: integer("por_lado", { mode: "boolean" }).notNull().default(false),
    semaforo: text("semaforo").notNull().default("verde"), // verde | ambar | terracota
    notaAgente: text("nota_agente"),
  },
  (t) => [index("ix_prescription_sesion").on(t.planSessionId, t.orden)],
);

/* ══════════════════════════════════════════════════════════════════════════
   LA REALIDAD — lo que efectivamente pasó
   ══════════════════════════════════════════════════════════════════════════ */

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fecha: text("fecha").notNull(), // YYYY-MM-DD
    /** Nulo si entrenaste algo que no estaba en el plan. Ese hueco es señal. */
    planSessionId: text("plan_session_id").references(() => planSession.id, {
      onDelete: "set null",
    }),
    estado: text("estado").notNull().default("en_curso"), // en_curso | completada
    rpe: text("rpe"), // facil | bien | duro
    sensacion: text("sensacion"), // verde | ambar | rojo
    duracionS: integer("duracion_s"),
    iniciadaEn: text("iniciada_en").notNull().default(ahora),
    cerradaEn: text("cerrada_en"),
  },
  (t) => [index("ix_session_user_fecha").on(t.userId, t.fecha)],
);

export const setLog = sqliteTable(
  "set_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    /** Nulo cuando la serie no corresponde a ninguna prescripción. */
    prescriptionId: text("prescription_id").references(() => prescription.id, {
      onDelete: "set null",
    }),
    /** Va ADEMÁS de prescriptionId a propósito: un ejercicio fuera de plan sigue
        siendo registrable y analizable, y v_plan_vs_real necesita el ejercicio
        aunque la prescripción se haya borrado en una versión posterior del plan. */
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercise.id),
    serie: integer("serie").notNull(),
    carga: real("carga").notNull().default(0),
    reps: integer("reps").notNull(),
    unidad: text("unidad").notNull().default("lb"),
    alFallo: integer("al_fallo", { mode: "boolean" }).notNull().default(false),
    rir: integer("rir"),
    nota: text("nota"),
    registradoEn: text("registrado_en").notNull().default(ahora),
  },
  (t) => [
    uniqueIndex("ux_setlog_sesion_presc_serie").on(t.sessionId, t.prescriptionId, t.serie),
    index("ix_setlog_ejercicio").on(t.exerciseId),
  ],
);

/* ══════════════════════════════════════════════════════════════════════════
   COMIDA
   `mealLogItem` es la pieza que hoy no existe. Sin ella, "¿qué como más
   seguido?" es incontestable: el registro actual guarda macros agregados y un
   nombre para mostrar, y tira el detalle por alimento. Ese dato no se puede
   reconstruir después, ni con el mejor agente.
   ══════════════════════════════════════════════════════════════════════════ */

export const mealLog = sqliteTable(
  "meal_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fecha: text("fecha").notNull(), // YYYY-MM-DD
    slot: text("slot").notNull(), // desayuno | comida | snack | cena
    hora: text("hora"), // HH:MM
    nombre: text("nombre").notNull(),
    /** preset | plato | texto | agente */
    origen: text("origen").notNull().default("plato"),
    textoOriginal: text("texto_original"),
    sinAnalizar: integer("sin_analizar", { mode: "boolean" }).notNull().default(false),
    /** Totales desnormalizados: la pantalla "Hoy" los suma en cada carga y no
        vale la pena recorrer los renglones para eso. Los escribe la misma
        transacción que inserta los items, así que no pueden desalinearse. */
    proteinaG: real("proteina_g").notNull().default(0),
    fibraG: real("fibra_g").notNull().default(0),
    calorias: real("calorias").notNull().default(0),
    registradoEn: text("registrado_en").notNull().default(ahora),
  },
  (t) => [index("ix_meallog_user_fecha").on(t.userId, t.fecha)],
);

export const mealLogItem = sqliteTable(
  "meal_log_item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mealLogId: text("meal_log_id")
      .notNull()
      .references(() => mealLog.id, { onDelete: "cascade" }),
    /** Nulo cuando se registró por categoría sin elegir alimento — el flujo de
        "2 palmas de proteína" sin especificar cuál. Elegir sigue siendo opcional. */
    foodItemId: text("food_item_id").references(() => foodItem.id),
    categoria: text("categoria").notNull(),
    cantidad: real("cantidad").notNull().default(1),
    unidad: text("unidad"), // palma | puño | pulgar
    proteinaG: real("proteina_g").notNull().default(0),
    fibraG: real("fibra_g").notNull().default(0),
    calorias: real("calorias").notNull().default(0),
  },
  (t) => [
    index("ix_mealitem_log").on(t.mealLogId),
    // El índice que sostiene el ranking de frecuentes.
    index("ix_mealitem_food").on(t.foodItemId),
  ],
);

export const mealPreset = sqliteTable(
  "meal_preset",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    slot: text("slot").notNull(),
    /** semilla | derivado | manual. Los "derivado" los genera el historial. */
    origen: text("origen").notNull().default("manual"),
    proteinaG: real("proteina_g").notNull().default(0),
    fibraG: real("fibra_g").notNull().default(0),
    calorias: real("calorias").notNull().default(0),
  },
  (t) => [index("ix_preset_user_slot").on(t.userId, t.slot)],
);

export const mealPresetItem = sqliteTable("meal_preset_item", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mealPresetId: text("meal_preset_id")
    .notNull()
    .references(() => mealPreset.id, { onDelete: "cascade" }),
  foodItemId: text("food_item_id").references(() => foodItem.id),
  cantidad: real("cantidad").notNull().default(1),
});

/** Eventos del protocolo de la tarde: "16:30 · snack", "15:00 · 500 ml de agua". */
export const agendaEvento = sqliteTable(
  "agenda_evento",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    hora: text("hora").notNull(), // HH:MM
    evento: text("evento").notNull(),
    tipo: text("tipo"),
  },
  (t) => [index("ix_agenda_user_hora").on(t.userId, t.hora)],
);

/* ══════════════════════════════════════════════════════════════════════════
   MÉTRICAS Y AGENTE
   ══════════════════════════════════════════════════════════════════════════ */

export const dailyMetric = sqliteTable(
  "daily_metric",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fecha: text("fecha").notNull(),
    peso: real("peso"),
    grasaPct: real("grasa_pct"),
    grasaVisceral: integer("grasa_visceral"),
    hambreOEstres: text("hambre_o_estres"),
    snack1630: integer("snack_1630", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("ux_daily_user_fecha").on(t.userId, t.fecha)],
);

export const weeklyReview = sqliteTable(
  "weekly_review",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    semana: text("semana").notNull(), // ISO: 2026-W33
    fecha: text("fecha").notNull(),
    pesoPromedio: real("peso_promedio"),
    adherencia: text("adherencia"),
    salidaAgente: text("salida_agente"),
    ajusteAplicado: text("ajuste_aplicado"),
    llmCallId: integer("llm_call_id"),
  },
  (t) => [uniqueIndex("ux_weekly_user_semana").on(t.userId, t.semana)],
);

/**
 * Cada llamada a un modelo. Sin esta tabla no se puede AFIRMAR nada sobre costo,
 * latencia ni tamaño de contexto — solo intuirlo. Es lo que vuelve esto un
 * ejercicio de AI Engineering y no una app con un botón de IA.
 */
export const llmCall = sqliteTable(
  "llm_call",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    agente: text("agente").notNull(), // parse-meal | recommend | session-coach | weekly-review | generar-plan
    modelo: text("modelo").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    tokensCacheRead: integer("tokens_cache_read"),
    latenciaMs: integer("latencia_ms"),
    costoUsd: real("costo_usd"),
    exito: integer("exito", { mode: "boolean" }).notNull().default(true),
    error: text("error"),
    creadoEn: text("creado_en").notNull().default(ahora),
  },
  (t) => [index("ix_llmcall_agente_fecha").on(t.agente, t.creadoEn)],
);

/**
 * El rastro auditable de cada modificación al plan. Responde "¿por qué mi
 * objetivo de sentadilla subió?" con un renglón concreto en vez de un encogimiento
 * de hombros. Es también el freno: si el agente empieza a cambiar cosas raras,
 * aquí se ve antes de que se note en el gimnasio.
 */
export const planChange = sqliteTable(
  "plan_change",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => plan.id, { onDelete: "cascade" }),
    prescriptionId: text("prescription_id"),
    campo: text("campo").notNull(), // objetivo_carga_num | objetivo_reps | series | semaforo
    valorAntes: text("valor_antes"),
    valorDespues: text("valor_despues"),
    motivo: text("motivo"),
    /** agente | usuario */
    origen: text("origen").notNull(),
    llmCallId: integer("llm_call_id").references(() => llmCall.id, { onDelete: "set null" }),
    creadoEn: text("creado_en").notNull().default(ahora),
  },
  (t) => [index("ix_planchange_user_fecha").on(t.userId, t.creadoEn)],
);

/* ══════════════════════════════════════════════════════════════════════════
   RELACIONES — para las queries anidadas de drizzle
   ══════════════════════════════════════════════════════════════════════════ */

export const planRelations = relations(plan, ({ many, one }) => ({
  sesiones: many(planSession),
  usuario: one(user, { fields: [plan.userId], references: [user.id] }),
}));

export const planSessionRelations = relations(planSession, ({ one, many }) => ({
  plan: one(plan, { fields: [planSession.planId], references: [plan.id] }),
  prescripciones: many(prescription),
}));

export const prescriptionRelations = relations(prescription, ({ one, many }) => ({
  planSession: one(planSession, {
    fields: [prescription.planSessionId],
    references: [planSession.id],
  }),
  ejercicio: one(exercise, { fields: [prescription.exerciseId], references: [exercise.id] }),
  series: many(setLog),
}));

export const sessionRelations = relations(session, ({ one, many }) => ({
  planSession: one(planSession, {
    fields: [session.planSessionId],
    references: [planSession.id],
  }),
  sets: many(setLog),
}));

export const setLogRelations = relations(setLog, ({ one }) => ({
  sesion: one(session, { fields: [setLog.sessionId], references: [session.id] }),
  prescripcion: one(prescription, {
    fields: [setLog.prescriptionId],
    references: [prescription.id],
  }),
  ejercicio: one(exercise, { fields: [setLog.exerciseId], references: [exercise.id] }),
}));

export const mealLogRelations = relations(mealLog, ({ many }) => ({
  items: many(mealLogItem),
}));

export const mealLogItemRelations = relations(mealLogItem, ({ one }) => ({
  comida: one(mealLog, { fields: [mealLogItem.mealLogId], references: [mealLog.id] }),
  alimento: one(foodItem, { fields: [mealLogItem.foodItemId], references: [foodItem.id] }),
}));

export const exerciseRelations = relations(exercise, ({ one }) => ({
  patron: one(patron, { fields: [exercise.patronId], references: [patron.id] }),
}));

/* ── Tipos derivados. Nada de escribir formas a mano en otro archivo. ── */
export type User = typeof user.$inferSelect;
export type Profile = typeof profile.$inferSelect;
export type Exercise = typeof exercise.$inferSelect;
export type FoodItem = typeof foodItem.$inferSelect;
export type Plan = typeof plan.$inferSelect;
export type PlanSession = typeof planSession.$inferSelect;
export type Prescription = typeof prescription.$inferSelect;
export type Session = typeof session.$inferSelect;
export type SetLog = typeof setLog.$inferSelect;
export type NuevoSetLog = typeof setLog.$inferInsert;
export type MealLog = typeof mealLog.$inferSelect;
export type MealLogItem = typeof mealLogItem.$inferSelect;
export type MealPreset = typeof mealPreset.$inferSelect;
