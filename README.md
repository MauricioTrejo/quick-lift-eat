# Quick Lift & Eat

Una PWA para registrar entrenamiento de fuerza y comidas **sin escribir**.

---

## La idea

Casi todas las apps de tracking fallan en lo mismo: registrar cuesta más que entrenar. Entre series, de pie y con prisa, nadie quiere abrir un teclado numérico. A la hora de comer, nadie quiere pesar en gramos.

Todo se construyó alrededor de una hipótesis medible:

> Registrar un entreno completo son ~20 taps y una comida son ~4, **sin abrir el teclado ni una vez** en el camino principal.

Cada decisión de diseño se subordina a eso. Si algo obliga a escribir, está mal.

### Las tres apuestas

**La prescripción viene precargada.** Cada serie aparece con el peso y las reps que te tocan hoy. El caso común es tocar una palomita. Solo escribes cuando te desvías del plan.

**Se mide con la mano, no en gramos.** Palmas de proteína, puños de verdura, pulgares de grasa. Y una fila de "lo de siempre" que —en cuanto tienes historial— se ordena por lo que realmente comes en ese horario, no por lo que alguien supuso.

**El agente escribe el plan; la app lo lee.** Al cerrar una sesión puedes pedir que se revise lo hecho contra lo prescrito y se ajusten los objetivos. La salida no es un consejo que interpretas: es el número que verás precargado la próxima vez.

---

## Correrlo en local

Necesitas Node 22+ y nada más. No hace falta cuenta de Cloudflare ni llave de API para ver la app funcionando.

```bash
npm install
cp .dev.vars.example .dev.vars     # identidad local
npm run db:migrate                 # crea la base local
npm run db:seed                    # 56 ejercicios, 36 alimentos
npm run dev
```

Abre la app, ve a **Progreso → Cargar o cambiar plan → Importar JSON → Usar el plan de ejemplo**, e impórtalo.

El ejemplo entrena lunes, miércoles y viernes; los demás días verás la pantalla de descanso, con la meta calórica más baja. Para probar el registro de series hoy mismo, cambia el `diaSemana` de una sesión al día actual (1 = lunes … 7 = domingo) antes de importar.

### Con los agentes

Añade tu llave a `.dev.vars` y reinicia:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Entonces **Crear plan → Con un agente** genera un programa desde tus metas, y el botón _Ajustar mi plan_ aparece al cerrar una sesión. Sin llave, ambos caminos fallan con un mensaje que lo explica; el resto de la app sigue funcionando.

### Comandos

| Comando                  | Qué hace                                                                |
| ------------------------ | ----------------------------------------------------------------------- |
| `npm run dev`            | Vite en Node, con `.dev.vars` cargado. El día a día.                    |
| `npm run preview:worker` | La app dentro de workerd, como en producción. Úsalo antes de desplegar. |
| `npm run db:migrate`     | Aplica migraciones a la base local                                      |
| `npm run db:seed`        | Siembra el catálogo (idempotente)                                       |
| `npm run db:reset`       | Borra la base local y la reconstruye vacía                              |
| `npm run build`          | Compila para Cloudflare Workers                                         |

**Dos motores, un solo dialecto.** En producción la base es D1; en `npm run dev` es el mismo archivo SQLite que crea wrangler, leído con el `node:sqlite` integrado de Node. Mismo esquema, mismas queries, cero módulos nativos.

---

## Desplegar

Guía completa paso a paso, con cómo verificar cada paso y qué hacer cuando algo falla: **[`docs/despliegue.md`](docs/despliegue.md)**. Unos 30 minutos y $0 — todo cabe en el free tier.

El resumen:

```bash
npm run db:create                      # devuelve un database_id → pégalo en wrangler.jsonc
npm run db:migrate:remote
npm run db:seed -- --remote
npm run build
npx wrangler deploy -c .output/server/wrangler.json
npx wrangler secret put ANTHROPIC_API_KEY   # solo si usas los agentes
```

Después, **Cloudflare Access** delante del Worker con tu correo. No es opcional: sin identidad la app se niega a abrirse (falla cerrada), y sin Access la URL sería pública.

---

## Cómo está armado

```
Cloudflare Access ──▶ Worker (PWA + server functions) ──▶ D1
                                    └──▶ Anthropic (solo desde el servidor)
```

**El navegador no puede hablar con la base.** El binding de D1 solo existe dentro del Worker: no hay URL, no hay llave pública, no hay endpoint que exponer. Todo pasa por server functions que validan la entrada con zod y derivan tu identidad de la petición — el `userId` nunca se acepta del cliente. El build lo hace cumplir: TanStack Start rompe la compilación si código de servidor entra al grafo del navegador.

### Las tres zonas de datos

- **Catálogo** — ejercicios, patrones y alimentos. Compartido, sembrado, genérico.
- **El plan** — lo que deberías hacer. **Versionado**: cuando el agente ajusta, abre una versión nueva y archiva la anterior con su fecha. El histórico sigue comparable.
- **La realidad** — lo que hiciste. Nunca se reescribe.

Esa separación es lo que permite preguntar _"¿esto lo hice o solo lo tenía planeado?"_, y es lo que hace que esto sea un producto en vez del plan de una persona.

### Lo que un modelo NO hace

Las vistas SQL hacen el trabajo determinista: `v_plan_vs_real` compara prescrito contra hecho, `v_alimentos_frecuentes` rankea por lo que comes. Y `reglaProgresion()` decide en TypeScript cuándo subir la carga — sumar series y aplicar "+5 lb si sobraron reps" son `if/else`, y gastar tokens en aritmética sería el error más caro del proyecto.

El modelo recibe esas conclusiones ya calculadas y decide lo que un `if/else` no puede: si el número aplica dado el RPE de hoy, y qué nota escribir.

**Toda llamada a un modelo se registra en `llm_call`** — tokens, latencia, costo estimado, aciertos de caché — incluso cuando falla. Sin eso no se puede afirmar nada sobre lo que cuesta un agente, solo intuirlo.

### Auditoría de cambios

Cada ajuste del agente deja una fila en `plan_change` por campo modificado, con su motivo y la llamada que lo produjo. _"¿Por qué subió mi objetivo de sentadilla?"_ tiene respuesta.

---

## Formato de plan

Documentado en [`docs/plan-schema.md`](docs/plan-schema.md), con [`docs/ejemplo-plan.json`](docs/ejemplo-plan.json) como referencia ejecutable. Dos reglas que sorprenden:

- **La carga es el peso TOTAL efectivo.** Mochila de 40 lb más mancuerna de 25 son `65`, nunca el desglose: guardarlo por partes te obligaría a sumarlas entre series.
- **El tiempo siempre en segundos.** Veinte minutos son `1200`. La pantalla decide mostrarlo en minutos; el dato no cambia.

`exerciseId` debe existir en el catálogo. Un ejercicio inventado llega sin patrón ni línea de progresión, y con eso deja de funcionar media analítica.

---

## Stack

React · TypeScript · Tailwind · TanStack Start (SSR) · Drizzle · Cloudflare Workers + D1 · Anthropic API
