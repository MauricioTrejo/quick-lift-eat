/**
 * Acceso al `env` de Cloudflare (donde vive el binding D1) desde código de servidor.
 *
 * POR QUÉ ASÍ. En Cloudflare, `env` solo llega como argumento del `fetch` del
 * Worker, y no viaja por las rutas que uno esperaría:
 *
 *   - `useRequest()` de nitro es experimental y exige `experimental.asyncContext:
 *     true`, flag que la config de Lovable no deja pasar (su superficie de
 *     opciones de nitro es preset/output/cloudflare y nada más).
 *   - `getRequest()` de TanStack Start sí funciona, y lo usamos para las cabeceras
 *     en src/lib/auth.ts, pero su H3Event se construye solo a partir del
 *     `Request`: `env` no está ahí.
 *   - El `fetch` de src/server.ts tampoco lo recibe. El entry generado lo invoca
 *     como `mod.fetch(req)`, con un solo argumento.
 *
 * La respuesta es que el preset cloudflare-module de nitro ya resuelve esto: hace
 * `globalThis.__env__ = env` antes de entregarle la petición a la app, y lo hace
 * para todos los tipos de handler (fetch, scheduled, queue, email...). Que cubra
 * `scheduled` importa: es como el agente semanal por Cron Trigger alcanzará D1.
 * Verificable en .output/server/index.mjs tras `npm run build`.
 *
 * Guardar bindings en un global es seguro: son idénticos para todas las peticiones
 * del isolate. Guardar ahí algo *de la petición* (identidad, cabeceras) sí sería un
 * bug de aislamiento entre usuarios; por eso la identidad se resuelve por petición
 * en src/lib/auth.ts y nunca se memoriza.
 */
import type { D1Database } from "@cloudflare/workers-types";

export type CloudflareEnv = {
  DB?: D1Database;
  /** Correo a usar cuando se corre sin Cloudflare Access enfrente (desarrollo). */
  DEV_USER_EMAIL?: string;
  ANTHROPIC_API_KEY?: string;
};

/**
 * Devuelve el env de Cloudflare, o undefined cuando no corremos sobre workerd
 * (el caso de `npm run dev`, que corre en Node bajo Vite). El cliente de base de
 * datos usa ese undefined para caer al SQLite local. Ver src/lib/db/client.ts.
 */
export function envCloudflare(): CloudflareEnv | undefined {
  return (globalThis as { __env__?: CloudflareEnv }).__env__;
}
