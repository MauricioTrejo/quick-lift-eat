/**
 * Cliente de base de datos. **Solo servidor.**
 *
 * Este módulo nunca debe importarse desde un componente ni desde nada que acabe
 * en el bundle del navegador. La regla no depende de disciplina: en producción el
 * binding D1 solo existe dentro del Worker — no hay URL, no hay llave pública, no
 * hay endpoint que exponer — así que el navegador es incapaz de hablar con la base
 * aunque el código se filtrara. Toda lectura y escritura pasa por las server
 * functions de src/lib/server/.
 *
 * Dos motores, un solo dialecto (SQLite), el mismo esquema y las mismas queries:
 *
 *   - **Producción / `wrangler dev`**: D1 vía el binding, con drizzle-orm/d1.
 *   - **`npm run dev`**: Vite corre en Node, donde no existe `env.DB`. Caemos al
 *     archivo SQLite que wrangler ya crea bajo .wrangler/state/, leído con el
 *     `node:sqlite` integrado de Node 22+. Cero módulos nativos, cero cuenta de
 *     Cloudflare: quien clone el repo puede desarrollar sin registrarse en nada.
 *
 * Drizzle parametriza todas las queries que construye, así que la inyección de SQL
 * no es un riesgo por construcción, no por cuidado. Ver eslint.config.js, que
 * además prohíbe pasar template literals a sql.raw().
 */
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzleProxy } from "drizzle-orm/sqlite-proxy";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { envCloudflare } from "./env";
import * as schema from "./schema";

/**
 * Supertipo común de los dos motores. NO es una unión a propósito: una unión de
 * `DrizzleD1Database | SqliteRemoteDatabase` rompe la resolución de sobrecargas
 * —`.select({...})` deja de aceptar una proyección— porque TypeScript no puede
 * elegir firma sobre una unión de tipos genéricos distintos. Ambos extienden
 * BaseSQLiteDatabase con el mismo dialecto asíncrono; solo difieren en el tipo
 * del resultado crudo, que no usamos porque siempre leemos a través de drizzle.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = BaseSQLiteDatabase<"async", any, typeof schema>;

let devDb: Db | undefined;

/**
 * Localiza el SQLite que miniflare mantiene para la D1 local. wrangler nombra el
 * archivo con un hash, así que se busca en vez de codificarlo; `metadata.sqlite`
 * es interno de miniflare y se descarta.
 */
async function rutaSqliteLocal(): Promise<string> {
  const { readdirSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");

  const dir = join(process.cwd(), ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  if (!existsSync(dir)) {
    throw new Error("No existe la base local. Corre `npm run db:migrate` antes de `npm run dev`.");
  }
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  if (archivos.length === 0) {
    throw new Error("No hay base local todavía. Corre `npm run db:migrate`.");
  }
  return join(dir, archivos[0]!);
}

/** La misma conexión que usa el cliente de dev, para las consultas a vistas. */
let sqliteDev: import("node:sqlite").DatabaseSync | undefined;

async function clienteDev(): Promise<Db> {
  if (devDb) return devDb;

  // Import dinámico a propósito: `node:sqlite` no existe en workerd, y un import
  // estático lo metería en el bundle del Worker y reventaría al evaluarse.
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(await rutaSqliteLocal());
  sqliteDev = sqlite;

  const ejecutar = (sql: string, params: unknown[], method: string) => {
    const stmt = sqlite.prepare(sql);
    if (method === "run") {
      stmt.run(...(params as never[]));
      return { rows: [] as unknown[] };
    }
    // drizzle espera arreglos de valores crudos, no objetos por columna.
    stmt.setReturnArrays(true);
    const filas = stmt.all(...(params as never[])) as unknown as unknown[][];
    return { rows: method === "get" ? (filas[0] ?? []) : filas };
  };

  devDb = drizzleProxy<typeof schema>(
    async (sql, params, method) => ejecutar(sql, params, method),
    // Callback de batch. Sin esto, `db.batch()` truena en desarrollo y funciona
    // en producción — la peor clase de diferencia entre entornos. D1 ejecuta el
    // batch como una transacción implícita; aquí se replica con BEGIN/COMMIT
    // para que la atomicidad sea real en los dos lados y no solo en uno.
    async (lote) => {
      sqlite.exec("BEGIN");
      try {
        const salida = lote.map((q) => ejecutar(q.sql, q.params, q.method));
        sqlite.exec("COMMIT");
        return salida;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    { schema },
  );

  return devDb;
}

/**
 * Devuelve el cliente de base de datos para la petición en curso.
 * Llamar solo desde server functions o scripts de servidor.
 */
export async function getDb(): Promise<Db> {
  const env = envCloudflare();
  if (env?.DB) return drizzleD1(env.DB, { schema });
  return clienteDev();
}

/**
 * Consulta SQL cruda que devuelve OBJETOS por columna en los dos motores.
 *
 * Existe por una divergencia real que costó un bug silencioso: `db.all()` de
 * drizzle devuelve objetos sobre D1, pero sobre el cliente de desarrollo
 * devuelve ARREGLOS de valores. La razón es que el contrato de sqlite-proxy
 * exige arreglos crudos —de ahí el `setReturnArrays(true)` de arriba— y drizzle
 * sabe re-mapearlos solo cuando él mismo construyó la consulta. Con SQL escrita
 * a mano no tiene los nombres de columna, así que la pasa tal cual.
 *
 * Resultado: las consultas a vistas funcionaban en producción y en dev llegaban
 * a la pantalla como `undefined` —tarjetas con "NaN g P"— sin ningún error.
 * Úsala para TODA consulta a una vista; para tablas del esquema, usa drizzle.
 *
 * Los parámetros van por `?`, nunca interpolados: parametrizado en ambos lados.
 */
export async function consultaVista<T>(sqlTexto: string, params: unknown[] = []): Promise<T[]> {
  const env = envCloudflare();
  if (env?.DB) {
    const r = await env.DB.prepare(sqlTexto)
      .bind(...(params as never[]))
      .all();
    return (r.results ?? []) as T[];
  }
  if (!sqliteDev) await clienteDev();
  // Sin setReturnArrays: aquí SÍ queremos objetos, que es lo que da D1.
  return sqliteDev!.prepare(sqlTexto).all(...(params as never[])) as unknown as T[];
}

/**
 * Ejecuta varias sentencias de forma atómica: entran todas o no entra ninguna.
 *
 * `batch()` existe en los dos motores (D1 lo corre como transacción implícita;
 * el cliente de desarrollo lo envuelve en BEGIN/COMMIT arriba) pero no en el
 * supertipo `BaseSQLiteDatabase`, así que el cast vive aquí, una sola vez y
 * comentado, en vez de repartido por cada sitio que necesite atomicidad.
 */
export async function atomico(db: Db, sentencias: readonly unknown[]): Promise<void> {
  if (sentencias.length === 0) return;
  const conBatch = db as unknown as {
    batch: (s: readonly unknown[]) => Promise<unknown>;
  };
  await conBatch.batch(sentencias);
}
