-- Vistas deterministas.
--
-- Aquí vive el trabajo que un modelo NO debe hacer: contar series, sumar macros,
-- comparar contra el objetivo. Gastar tokens en aritmética sería el error más caro
-- del proyecto. El agente consume estas vistas ya agregadas en vez de historial
-- crudo, que es lo que mantiene el contexto en cientos de tokens y no en miles.
--
-- CONVENCIÓN DE NOMBRE: este archivo va numerado 9001 para que ordene DESPUÉS de
-- las migraciones de tablas que genera drizzle-kit (0000, 0001, …) — las vistas
-- dependen de las tablas — y para que no choque con la numeración de drizzle.
-- wrangler recuerda las migraciones aplicadas por nombre, así que EDITAR este
-- archivo no lo vuelve a ejecutar: para cambiar una vista, crea 9002_vistas_v2.sql.
-- Los DROP de abajo hacen que ese reemplazo sea seguro y repetible.

DROP VIEW IF EXISTS v_totales_dia;
DROP VIEW IF EXISTS v_plan_vs_real;
DROP VIEW IF EXISTS v_alimentos_frecuentes;
DROP VIEW IF EXISTS v_volumen_ejercicio;
DROP VIEW IF EXISTS v_patron_semana;

-- ─────────────────────────────────────────────────────────────────────────────
-- Totales del día. Lo que alimenta las tres barras de la pantalla "Hoy".
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW v_totales_dia AS
SELECT
  user_id,
  fecha,
  SUM(proteina_g) AS proteina_g,
  SUM(fibra_g)    AS fibra_g,
  SUM(calorias)   AS calorias,
  COUNT(*)        AS comidas
FROM meal_log
GROUP BY user_id, fecha;

-- ─────────────────────────────────────────────────────────────────────────────
-- PLAN CONTRA REALIDAD. El contexto que recibe el agente al cerrar una sesión.
--
-- Parte de `prescription` con LEFT JOIN a `set_log`, no al revés: así una serie
-- que NO hiciste aparece como fila con series_hechas = 0. Si se partiera de los
-- sets, lo que faltó sería invisible — y justo eso es lo que el agente necesita ver.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW v_plan_vs_real AS
SELECT
  s.user_id,
  s.id                                  AS session_id,
  s.fecha,
  s.estado,
  s.rpe,
  ps.nombre                             AS sesion_nombre,
  pr.id                                 AS prescription_id,
  e.id                                  AS exercise_id,
  e.nombre                              AS ejercicio,
  e.patron_id,
  pr.orden,
  pr.series                             AS series_prescritas,
  pr.objetivo_reps,
  pr.objetivo_carga_num,
  pr.unidad,
  pr.semaforo,
  COUNT(sl.id)                          AS series_hechas,
  pr.series - COUNT(sl.id)              AS series_faltantes,
  COALESCE(SUM(sl.reps), 0)             AS reps_totales,
  COALESCE(MAX(sl.carga), 0)            AS carga_max,
  COALESCE(SUM(sl.carga * sl.reps), 0)  AS volumen,
  COALESCE(MAX(sl.carga), 0) - pr.objetivo_carga_num AS dif_carga,
  SUM(CASE WHEN sl.al_fallo = 1 THEN 1 ELSE 0 END)   AS series_al_fallo
FROM session s
JOIN plan_session ps ON ps.id = s.plan_session_id
JOIN prescription pr ON pr.plan_session_id = ps.id
JOIN exercise e      ON e.id = pr.exercise_id
LEFT JOIN set_log sl ON sl.session_id = s.id AND sl.prescription_id = pr.id
GROUP BY s.id, pr.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- ALIMENTOS MÁS FRECUENTES. Alimenta la fila "Lo de siempre".
--
-- El puntaje pondera por recencia en tramos en vez de con una curva exponencial:
-- SQLite solo trae las funciones matemáticas si se compiló con ellas, y depender
-- de eso haría que la vista funcione en una máquina y truene en otra. Los tramos
-- usan julianday(), que es del núcleo y está siempre. De paso se leen mejor.
--
-- Se agrupa TAMBIÉN por slot: lo que desayunas no es lo que cenas, y un ranking
-- global ofrecería huevo a las 9 de la noche.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW v_alimentos_frecuentes AS
SELECT
  ml.user_id,
  ml.slot,
  mli.food_item_id,
  fi.nombre,
  fi.categoria,
  fi.medida,
  fi.proteina_g   AS proteina_unidad,
  fi.fibra_g      AS fibra_unidad,
  fi.calorias     AS calorias_unidad,
  COUNT(*)        AS veces,
  MAX(ml.fecha)   AS ultima_vez,
  AVG(mli.cantidad) AS cantidad_promedio,
  SUM(
    CASE
      WHEN julianday('now') - julianday(ml.fecha) <= 7  THEN 4.0
      WHEN julianday('now') - julianday(ml.fecha) <= 30 THEN 2.0
      WHEN julianday('now') - julianday(ml.fecha) <= 90 THEN 1.0
      ELSE 0.5
    END
  ) AS puntaje
FROM meal_log_item mli
JOIN meal_log  ml ON ml.id = mli.meal_log_id
JOIN food_item fi ON fi.id = mli.food_item_id
WHERE mli.food_item_id IS NOT NULL
GROUP BY ml.user_id, ml.slot, mli.food_item_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Volumen por ejercicio y semana. Detecta el techo: si el volumen deja de subir
-- tres semanas seguidas, el objetivo dejó de progresar.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW v_volumen_ejercicio AS
SELECT
  s.user_id,
  strftime('%Y-%W', s.fecha) AS semana,
  sl.exercise_id,
  e.nombre                   AS ejercicio,
  COUNT(sl.id)               AS series,
  SUM(sl.reps)               AS reps,
  SUM(sl.carga * sl.reps)    AS volumen,
  MAX(sl.carga)              AS carga_max
FROM set_log sl
JOIN session  s ON s.id = sl.session_id
JOIN exercise e ON e.id = sl.exercise_id
GROUP BY s.user_id, semana, sl.exercise_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Qué patrones de movimiento se trabajaron por semana. El agente compara contra
-- el catálogo de patrones para detectar el que falta (hoy: bisagra).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW v_patron_semana AS
SELECT
  s.user_id,
  strftime('%Y-%W', s.fecha) AS semana,
  e.patron_id,
  COUNT(sl.id)               AS series
FROM set_log sl
JOIN session  s ON s.id = sl.session_id
JOIN exercise e ON e.id = sl.exercise_id
WHERE e.patron_id IS NOT NULL
GROUP BY s.user_id, semana, e.patron_id;
