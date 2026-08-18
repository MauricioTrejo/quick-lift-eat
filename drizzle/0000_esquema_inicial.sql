CREATE TABLE `agenda_evento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`hora` text NOT NULL,
	`evento` text NOT NULL,
	`tipo` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_agenda_user_hora` ON `agenda_evento` (`user_id`,`hora`);--> statement-breakpoint
CREATE TABLE `daily_metric` (
	`user_id` text NOT NULL,
	`fecha` text NOT NULL,
	`peso` real,
	`grasa_pct` real,
	`grasa_visceral` integer,
	`hambre_o_estres` text,
	`snack_1630` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_daily_user_fecha` ON `daily_metric` (`user_id`,`fecha`);--> statement-breakpoint
CREATE TABLE `exercise` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`nombre` text NOT NULL,
	`patron_id` text,
	`categoria` text,
	`equipo` text,
	`rango_reps` text,
	`intensidad` text,
	`linea_progresion` text,
	`unilateral` integer DEFAULT false NOT NULL,
	`unidad` text DEFAULT 'lb' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patron_id`) REFERENCES `patron`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_exercise_patron` ON `exercise` (`patron_id`);--> statement-breakpoint
CREATE INDEX `ix_exercise_user` ON `exercise` (`user_id`);--> statement-breakpoint
CREATE TABLE `food_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`nombre` text NOT NULL,
	`categoria` text NOT NULL,
	`medida` text NOT NULL,
	`proteina_g` real DEFAULT 0 NOT NULL,
	`fibra_g` real DEFAULT 0 NOT NULL,
	`calorias` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_food_categoria` ON `food_item` (`categoria`);--> statement-breakpoint
CREATE INDEX `ix_food_user` ON `food_item` (`user_id`);--> statement-breakpoint
CREATE TABLE `knowledge_chunk` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`fuente` text,
	`seccion` text,
	`texto` text NOT NULL,
	`tags` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `llm_call` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`agente` text NOT NULL,
	`modelo` text NOT NULL,
	`tokens_in` integer,
	`tokens_out` integer,
	`tokens_cache_read` integer,
	`latencia_ms` integer,
	`costo_usd` real,
	`exito` integer DEFAULT true NOT NULL,
	`error` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_llmcall_agente_fecha` ON `llm_call` (`agente`,`creado_en`);--> statement-breakpoint
CREATE TABLE `meal_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`fecha` text NOT NULL,
	`slot` text NOT NULL,
	`hora` text,
	`nombre` text NOT NULL,
	`origen` text DEFAULT 'plato' NOT NULL,
	`texto_original` text,
	`sin_analizar` integer DEFAULT false NOT NULL,
	`proteina_g` real DEFAULT 0 NOT NULL,
	`fibra_g` real DEFAULT 0 NOT NULL,
	`calorias` real DEFAULT 0 NOT NULL,
	`registrado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_meallog_user_fecha` ON `meal_log` (`user_id`,`fecha`);--> statement-breakpoint
CREATE TABLE `meal_log_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meal_log_id` text NOT NULL,
	`food_item_id` text,
	`categoria` text NOT NULL,
	`cantidad` real DEFAULT 1 NOT NULL,
	`unidad` text,
	`proteina_g` real DEFAULT 0 NOT NULL,
	`fibra_g` real DEFAULT 0 NOT NULL,
	`calorias` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`meal_log_id`) REFERENCES `meal_log`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_item_id`) REFERENCES `food_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_mealitem_log` ON `meal_log_item` (`meal_log_id`);--> statement-breakpoint
CREATE INDEX `ix_mealitem_food` ON `meal_log_item` (`food_item_id`);--> statement-breakpoint
CREATE TABLE `meal_preset` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`nombre` text NOT NULL,
	`slot` text NOT NULL,
	`origen` text DEFAULT 'manual' NOT NULL,
	`proteina_g` real DEFAULT 0 NOT NULL,
	`fibra_g` real DEFAULT 0 NOT NULL,
	`calorias` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_preset_user_slot` ON `meal_preset` (`user_id`,`slot`);--> statement-breakpoint
CREATE TABLE `meal_preset_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meal_preset_id` text NOT NULL,
	`food_item_id` text,
	`cantidad` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`meal_preset_id`) REFERENCES `meal_preset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_item_id`) REFERENCES `food_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `patron` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`nombre` text NOT NULL,
	`origen` text NOT NULL,
	`vigente_desde` text NOT NULL,
	`vigente_hasta` text,
	`activo` integer DEFAULT true NOT NULL,
	`llm_call_id` integer,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_plan_user_activo` ON `plan` (`user_id`,`activo`);--> statement-breakpoint
CREATE TABLE `plan_change` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text,
	`prescription_id` text,
	`campo` text NOT NULL,
	`valor_antes` text,
	`valor_despues` text,
	`motivo` text,
	`origen` text NOT NULL,
	`llm_call_id` integer,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`llm_call_id`) REFERENCES `llm_call`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_planchange_user_fecha` ON `plan_change` (`user_id`,`creado_en`);--> statement-breakpoint
CREATE TABLE `plan_session` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`dia_semana` integer NOT NULL,
	`nombre` text NOT NULL,
	`tipo` text,
	`duracion_min` integer,
	`orden` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_plansession_plan_dia` ON `plan_session` (`plan_id`,`dia_semana`);--> statement-breakpoint
CREATE TABLE `prescription` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`orden` integer NOT NULL,
	`series` integer NOT NULL,
	`objetivo_carga_num` real DEFAULT 0 NOT NULL,
	`objetivo_carga_texto` text,
	`objetivo_reps` integer NOT NULL,
	`unidad` text DEFAULT 'lb' NOT NULL,
	`por_lado` integer DEFAULT false NOT NULL,
	`semaforo` text DEFAULT 'verde' NOT NULL,
	`nota_agente` text,
	FOREIGN KEY (`plan_session_id`) REFERENCES `plan_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_prescription_sesion` ON `prescription` (`plan_session_id`,`orden`);--> statement-breakpoint
CREATE TABLE `profile` (
	`user_id` text PRIMARY KEY NOT NULL,
	`objetivo_proteina_g` real DEFAULT 140 NOT NULL,
	`objetivo_fibra_g` real DEFAULT 30 NOT NULL,
	`kcal_entreno` real DEFAULT 2100 NOT NULL,
	`kcal_descanso` real DEFAULT 1850 NOT NULL,
	`unidad_preferida` text DEFAULT 'lb' NOT NULL,
	`restricciones` text,
	`actualizado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `progresion_paso` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`linea` text NOT NULL,
	`orden` integer NOT NULL,
	`descripcion` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_progresion_linea_orden` ON `progresion_paso` (`linea`,`orden`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`fecha` text NOT NULL,
	`plan_session_id` text,
	`estado` text DEFAULT 'en_curso' NOT NULL,
	`rpe` text,
	`sensacion` text,
	`duracion_s` integer,
	`iniciada_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`cerrada_en` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_session_id`) REFERENCES `plan_session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_session_user_fecha` ON `session` (`user_id`,`fecha`);--> statement-breakpoint
CREATE TABLE `set_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`prescription_id` text,
	`exercise_id` text NOT NULL,
	`serie` integer NOT NULL,
	`carga` real DEFAULT 0 NOT NULL,
	`reps` integer NOT NULL,
	`unidad` text DEFAULT 'lb' NOT NULL,
	`al_fallo` integer DEFAULT false NOT NULL,
	`rir` integer,
	`nota` text,
	`registrado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prescription_id`) REFERENCES `prescription`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_setlog_sesion_presc_serie` ON `set_log` (`session_id`,`prescription_id`,`serie`);--> statement-breakpoint
CREATE INDEX `ix_setlog_ejercicio` ON `set_log` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`nombre` text,
	`creado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `weekly_review` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`semana` text NOT NULL,
	`fecha` text NOT NULL,
	`peso_promedio` real,
	`adherencia` text,
	`salida_agente` text,
	`ajuste_aplicado` text,
	`llm_call_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_weekly_user_semana` ON `weekly_review` (`user_id`,`semana`);