#!/usr/bin/env node
/**
 * Arranca Vite cargando antes `.dev.vars`.
 *
 * POR QUÉ EXISTE. `.dev.vars` es la convención de wrangler y solo la lee
 * `wrangler dev`. Vite corre en Node y no sabe nada de ese archivo, así que sin
 * esto `npm run dev` levantaría la app con la llave de Anthropic ausente y el
 * agente fallaría con un "falta ANTHROPIC_API_KEY" que resulta desconcertante
 * cuando acabas de escribirla en `.dev.vars`.
 *
 * Con esto hay UN solo lugar para los secretos locales, lo arranques como lo
 * arranques. Las variables ya presentes en el entorno mandan sobre el archivo.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archivo = resolve(raiz, ".dev.vars");

if (existsSync(archivo)) {
  let cargadas = 0;
  for (const linea of readFileSync(archivo, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const i = limpia.indexOf("=");
    if (i < 1) continue;
    // Tolera `export CLAVE=valor`: es como viene pegado de casi cualquier guía,
    // y sin esto la variable se cargaría con el nombre "export CLAVE" y no la
    // encontraría nadie — un fallo silencioso y muy molesto de diagnosticar.
    const clave = limpia
      .slice(0, i)
      .trim()
      .replace(/^export\s+/, "");
    // Comillas opcionales alrededor del valor, como en un .env normal.
    const valor = limpia
      .slice(i + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[clave] === undefined) {
      process.env[clave] = valor;
      cargadas++;
    }
  }
  console.log(`→ .dev.vars: ${cargadas} variable(s) cargada(s)`);
} else {
  console.log("→ Sin .dev.vars (copia .dev.vars.example si quieres usar los agentes)");
}

if (!process.env["ANTHROPIC_API_KEY"]) {
  console.log("  ⚠ Sin ANTHROPIC_API_KEY: los agentes no funcionarán, el resto sí.");
}

const vite = spawn("npx", ["vite", "dev", ...process.argv.slice(2)], {
  cwd: raiz,
  stdio: "inherit",
  env: process.env,
});
vite.on("exit", (code) => process.exit(code ?? 0));
