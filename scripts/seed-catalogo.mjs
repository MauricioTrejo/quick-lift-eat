#!/usr/bin/env node
/**
 * Siembra el CATÁLOGO: patrones, ejercicios, líneas de progresión, banco de
 * alimentos y presets de ejemplo. Es contenido genérico y compartido — no
 * contiene el plan ni los datos de nadie. Los datos de una persona entran por
 * la pantalla de alta (importar un plan o generarlo), nunca por aquí.
 *
 *   npm run db:seed              → base local
 *   npm run db:seed -- --remote  → la D1 de Cloudflare
 *
 * Genera un .sql y lo aplica con `wrangler d1 execute`, que es lo que sabe
 * hablar con D1 en ambos destinos. Usa INSERT OR REPLACE, así que correrlo dos
 * veces deja el mismo resultado: se puede re-sembrar tras actualizar un seed.
 *
 * NOTA sobre knowledge_chunks.json: existe en el proyecto pero NO se siembra ni
 * se versiona aquí. Contiene contexto clínico real (lesiones, rehabilitación) y
 * este repo es público. La tabla knowledge_chunk viaja vacía; cada quien carga
 * su propio conocimiento en su instancia.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const semilla = (n) => JSON.parse(readFileSync(join(raiz, "seeds", n), "utf8"));

/** Literal SQL. Escapa comillas simples duplicándolas, que es como lo hace SQLite. */
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

const fila = (tabla, obj) => {
  const cols = Object.keys(obj);
  return `INSERT OR REPLACE INTO ${tabla} (${cols.join(", ")}) VALUES (${cols
    .map((c) => lit(obj[c]))
    .join(", ")});`;
};

/* ── Equipo que admite carga externa. Decide si un ejercicio se mide en libras
      o en repeticiones cuando el seed no trae unidad explícita. ── */
const CARGABLE = new Set([
  "mancuerna",
  "mochila",
  "barra",
  "barras",
  "botellas",
  "ajustables",
  "banda",
]);

function unidadDe(ej) {
  // "minutos" se normaliza a segundos: el resto del sistema mide tiempo en
  // segundos y la UI decide mostrar minutos cuando el objetivo pasa de 300 s.
  if (ej.unidad === "minutos") return "segundos";
  if (ej.unidad) return ej.unidad;
  const equipo = ej.equipo ?? [];
  return equipo.some((e) => CARGABLE.has(e)) ? "lb" : "reps";
}

const sql = [];
sql.push("-- Generado por scripts/seed-catalogo.mjs. No editar a mano.");
sql.push("PRAGMA foreign_keys = ON;");

/* ── Patrones y ejercicios ── */
const ejercicios = semilla("exercises.json");

for (const p of ejercicios.patrones) {
  sql.push(fila("patron", { id: p.id, nombre: p.nombre }));
}

for (const e of ejercicios.exercises) {
  sql.push(
    fila("exercise", {
      id: e.id,
      user_id: null, // null = fila global de catálogo
      nombre: e.nombre,
      patron_id: e.patron ?? null,
      categoria: e.categoria ?? null,
      equipo: e.equipo ? JSON.stringify(e.equipo) : null,
      rango_reps: e.rango_reps ?? null,
      intensidad: e.intensidad ?? null,
      linea_progresion: e.linea_progresion ?? null,
      unilateral: e.unilateral === true,
      unidad: unidadDe(e),
    }),
  );
}

for (const [linea, pasos] of Object.entries(ejercicios.lineas_progresion ?? {})) {
  pasos.forEach((descripcion, i) => {
    // Sin id: es autoincremental. El índice único (linea, orden) es lo que hace
    // idempotente el re-sembrado, así que primero se limpia la línea.
    sql.push(`DELETE FROM progresion_paso WHERE linea = ${lit(linea)} AND orden = ${i + 1};`);
    sql.push(fila("progresion_paso", { linea, orden: i + 1, descripcion }));
  });
}

/* ── Banco de alimentos ── */
const banco = semilla("food_bank.json");

for (const a of banco.food_items) {
  sql.push(
    fila("food_item", {
      id: a.id,
      user_id: null,
      nombre: a.nombre,
      categoria: a.categoria,
      medida: a.unidad, // el seed lo llama "unidad"; aquí es la medida de mano
      proteina_g: a.proteina ?? 0,
      fibra_g: a.fibra ?? 0,
      calorias: a.kcal ?? 0,
    }),
  );
}

/* ── Presets de ejemplo. Globales (user_id NULL) y marcados como "semilla":
      son el arranque en frío mientras no hay historial del que derivar los
      frecuentes de verdad. Ver v_alimentos_frecuentes. ── */
const presets = semilla("meal_presets.json");

for (const p of presets.presets) {
  sql.push(
    fila("meal_preset", {
      id: p.id,
      user_id: null,
      nombre: p.nombre,
      slot: p.slot,
      origen: "semilla",
      proteina_g: p.macros?.proteina ?? 0,
      fibra_g: p.macros?.fibra ?? 0,
      calorias: p.macros?.kcal ?? 0,
    }),
  );
  sql.push(`DELETE FROM meal_preset_item WHERE meal_preset_id = ${lit(p.id)};`);
  for (const it of p.items ?? []) {
    sql.push(
      fila("meal_preset_item", {
        meal_preset_id: p.id,
        food_item_id: it.id,
        cantidad: it.cant ?? 1,
      }),
    );
  }
}

/* ── Aplicar ── */
const remoto = process.argv.includes("--remote");
const archivo = join(mkdtempSync(join(tmpdir(), "seed-")), "catalogo.sql");
writeFileSync(archivo, sql.join("\n") + "\n");

const args = [
  "wrangler",
  "d1",
  "execute",
  "quick-lift-eat",
  remoto ? "--remote" : "--local",
  "--file",
  archivo,
  "-y",
];

console.log(`→ Sembrando catálogo en ${remoto ? "Cloudflare" : "la base local"}…`);
console.log(
  `  ${ejercicios.patrones.length} patrones · ${ejercicios.exercises.length} ejercicios · ` +
    `${banco.food_items.length} alimentos · ${presets.presets.length} presets`,
);

try {
  execFileSync("npx", args, { cwd: raiz, stdio: ["ignore", "pipe", "inherit"] });
  console.log("✓ Catálogo sembrado.");
} catch {
  console.error("\n✗ Falló el sembrado. El SQL generado quedó en:");
  console.error(`  ${archivo}`);
  process.exit(1);
}
