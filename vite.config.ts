// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },

    /**
     * Protección de imports: distinta en dev y en build, a propósito.
     *
     * El plugin impide que código de servidor entre al grafo del cliente. En el
     * BUILD queremos que eso sea un error duro — es la garantía de que la llave
     * de Anthropic y el acceso a D1 nunca viajan al navegador, y ya está
     * comprobado que funciona (el bundle de producción no contiene ni el SDK ni
     * ninguna query).
     *
     * En DEV el analizador recorre el módulo crudo, antes de que se extraigan
     * los cuerpos de las server functions, así que ve `src/lib/auth.ts`
     * alcanzable desde una ruta y se niega a arrancar — aunque en producción
     * ese código sí se elimine. Con "mock", dev sustituye esos módulos en el
     * cliente en vez de romper, y `npm run dev` funciona.
     *
     * Lo que NO se hace es desactivar la protección: `build: "error"` sigue
     * fallando la compilación si algo de servidor se filtra de verdad.
     */
    importProtection: {
      behavior: { dev: "mock", build: "error" },
    },
  },
});
