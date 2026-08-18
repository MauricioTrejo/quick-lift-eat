#!/usr/bin/env node
/**
 * Borra la base LOCAL y la reconstruye vacía: migraciones + catálogo.
 *
 *   npm run db:reset
 *
 * Solo toca `.wrangler/state/`, que es el SQLite de desarrollo que mantiene
 * miniflare. No puede tocar Cloudflare: no acepta --remote a propósito. Reiniciar
 * la base de producción no debe ser algo que se logre por un flag de más.
 */
import { rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const estado = join(raiz, ".wrangler/state/v3/d1");

if (process.argv.includes("--remote")) {
  console.error("✗ db:reset solo trabaja en local. Para Cloudflare, usa la consola de D1.");
  process.exit(1);
}

if (existsSync(estado)) {
  rmSync(estado, { recursive: true, force: true });
  console.log("→ Base local borrada.");
} else {
  console.log("→ No había base local.");
}

const correr = (args) => execFileSync("npx", args, { cwd: raiz, stdio: "inherit" });

console.log("→ Aplicando migraciones…");
// Sin -y: `migrations apply` no acepta esa bandera y en contexto no interactivo
// wrangler ya responde que sí por su cuenta.
correr(["wrangler", "d1", "migrations", "apply", "quick-lift-eat", "--local"]);

console.log("→ Sembrando catálogo…");
execFileSync("node", [join(raiz, "scripts/seed-catalogo.mjs")], { cwd: raiz, stdio: "inherit" });

console.log("\n✓ Base local lista y vacía de datos de usuario.");
