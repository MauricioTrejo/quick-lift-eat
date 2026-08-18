import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Dos fronteras que no deben depender de que alguien se acuerde.
  // ───────────────────────────────────────────────────────────────────────────
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/lib/db/**", "src/lib/api/**", "src/lib/auth.ts", "scripts/**"],
    rules: {
      // 1. El código de cliente no importa la base. En producción esto ya es
      //    imposible —el binding D1 solo existe dentro del Worker, el navegador
      //    no tiene llave ni URL que usar— pero fallar aquí avisa al escribir el
      //    import y no al depurar un bundle roto.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/db/*", "@/lib/db/*", "drizzle-orm/*"],
              message:
                "La base solo se toca desde el servidor. Llama a una server function de @/lib/api/ en vez de importar el cliente de base de datos.",
            },
          ],
        },
      ],
    },
  },
  {
    // 2. Nada de SQL armado por concatenación. Drizzle parametriza todo lo que
    //    construye, así que la inyección solo puede entrar por la puerta de atrás:
    //    sql.raw() con un template literal interpolado. Se prohíbe esa forma.
    //    Para SQL dinámico legítimo existe sql`` con placeholders, que sí parametriza.
    files: ["src/lib/db/**/*.ts", "src/lib/api/**/*.ts", "scripts/**/*.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='raw'] > TemplateLiteral[expressions.length>0]",
          message:
            "sql.raw() con un template literal interpolado es una inyección de SQL esperando a pasar. Usa sql`...${valor}...`, que parametriza, o pasa el valor por .bind().",
        },
        {
          selector: "CallExpression[callee.name='raw'] > TemplateLiteral[expressions.length>0]",
          message:
            "raw() con un template literal interpolado es una inyección de SQL esperando a pasar. Usa sql`...${valor}...`, que parametriza.",
        },
      ],
    },
  },
  eslintPluginPrettier,
);
