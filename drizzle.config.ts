import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit solo genera el SQL; aplicarlo es tarea de wrangler
 * (`npm run db:migrate` en local, `db:migrate:remote` contra Cloudflare), que es
 * quien sabe hablar con D1. Por eso aquí no hay credenciales de conexión.
 */
export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
});
