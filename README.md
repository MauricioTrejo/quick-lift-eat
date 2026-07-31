# Taps & Macros

Construye una PWA mobile-first en español para registrar entrenamiento de fuerza y comidas. Es un PROTOTIPO DE DISEÑO: sin backend, sin login, sin base de datos, sin llamadas a IA, sin variables de entorno. Todo el estado vive en memoria + localStorage, sembrado desde un JSON estático.

## La única hipótesis que este prototipo debe validar

Que registrar un entreno completo son ~20 taps y una comida son ~4, SIN ABRIR EL TECLADO NUNCA en el camino principal. Cada decisión de diseño se subordina a eso. Si algo obliga a escribir, está mal.

## Stack
React + TypeScript + Tailwind + shadcn/ui. Mobile-first, diseñado para 390×844; en escritorio basta con que no se rompa. PWA instalable (manifest + icono + display standalone).

## Datos semilla
Crea `src/data/seed.json` con EXACTAMENTE este contenido (no lo modifiques, no lo resumas, no inventes datos adicionales), y tipos TypeScript en `src/data/types.ts` derivados de él:

```json
PAYLOAD_PLACEHOLDER
```

## Lenguaje visual

Tema oscuro por defecto (se usa en el gimnasio y de noche). Fondo tinta profundo, superficies elevadas apenas más claras.

El sistema de color completo son TRES estados semánticos, nada más — no inventes una paleta decorativa aparte:
- `verde` = progresa / hecho
- `ambar` = mantén o afina
- `terracota` = techo de equipo, progresa por otra vía

Cada prescripción trae su campo `semaforo` con uno de esos tres valores; úsalo como chip de color junto al nombre del ejercicio.

Numerales tabulares y GRANDES: el peso y las reps deben leerse de reojo, de pie, a un metro. Objetivos táctiles de 56px mínimo — se toca entre series, con prisa. Movimiento mínimo: una transición al completar una serie y nada más. Sin confeti, sin parallax.

NO copies la identidad visual de Strava ni de Runna. Nada de feed social, kudos, likes ni perfiles de otros usuarios.

## Pantalla 1 · Hoy (home)

Hoy es viernes 31 de julio de 2026, sesión "Pull + brazos" (sesión `s5`, estado pendiente).

- **Tarjeta de sesión**: día + nombre, número de ejercicios, duración estimada, y UN botón primario a ancho completo: "Empezar". Si la sesión ya se completó, colapsa a resumen con palomita y récords.
- **Macros del día**: tres barras horizontales — Proteína / Fibra / Calorías — calculadas desde `demo.meal_logs` del día contra `food_bank.objetivos_diarios`. Muestra el FALTANTE en grande, no el acumulado. El objetivo de calorías cambia según si hoy hay entreno (2100) o descanso (1850); indica cuál aplica. Debajo, botón "＋ Comida" a ancho completo.
- **Los cuatro no-negociables**: cuatro chips en fila — Proteína 140g · Fibra 30g · Snack 16:30 · Báscula. Verdes si se cumplieron, grises si no. El de báscula abre un stepper numérico rápido (nunca teclado).
- **Chip de agenda**: una línea discreta con el siguiente evento de `meal_presets.protocolo_tarde` según la hora actual.
- **Racha**: discreta, arriba a la derecha (`demo.perfil_demo.racha_dias`).

## Pantalla 2 · Entreno en curso — LA MÁS IMPORTANTE

Lista vertical de ejercicios del día en el orden de `prescriptions.prescriptions` filtrado por `dia`. El ejercicio activo expandido; los demás colapsados a una línea.

Cada ejercicio expandido muestra: nombre, chip de semáforo, y `nota_agente` en una línea de tipografía chica.

Cada fila de serie viene YA PRELLENADA con `objetivo` (carga y reps):

```
Serie 2    [ − ] 25 lb [ + ]    [ − ] 8 reps [ + ]    [ ✓ ]
```

- El caso común es tocar SOLO la ✓. Los steppers son ±5 lb y ±1 rep. NUNCA abras teclado numérico.
- Al tocar ✓: la fila se marca, colapsa, y la siguiente serie se expande sola. Al completar la última serie de un ejercicio, avanza automáticamente al siguiente.
- Ejercicios con `unidad: "segundos"` (hollow hold, dead hang, wall handstand, l-sit, pseudo planche): el stepper es de ±5s y aparece un cronómetro opcional.
- Ejercicios con `por_lado: true`: un solo registro con la etiqueta "/lado".
- Cuando `objetivo.carga` es texto descriptivo (ej. "mochila 40 lb + mancuerna 25 lb al pecho"), muéstralo como etiqueta y ofrece el stepper sobre el número principal.

**Long-press sobre una serie** abre lo que casi nunca se usa: marcar "al fallo", ajustar RIR, o nota de texto. Deliberadamente escondido — no debe competir con la ✓.

**Barra inferior fija**: progreso (`4/7 ejercicios`), cronómetro corriendo, botón "Terminar".

**Al terminar**: tarjeta de resumen con lo que se hizo comparado contra la sesión previa del mismo tipo en `demo.sessions`, con los récords marcados. Debajo, dos chips de tres opciones (un tap cada uno): RPE (fácil / bien / duro) y Cómo te sentiste (verde / ámbar / rojo). Luego "Guardar".

## Pantalla 3 · Registrar comida

- **Slot automático** por hora: <11:00 desayuno · 11:00–16:00 comida · 16:00–18:30 snack · >18:30 cena. Se muestra ya elegido, corregible.
- **Fila "Lo de siempre"** — lo PRIMERO que se ve: carrusel horizontal con los `meal_presets.presets` del slot actual. Cada tarjeta: nombre corto y macros (`46 g P · 15 g F`). UN TAP registra la comida completa y cierra la pantalla. Este es el camino feliz y debe verse como tal.
- **Debajo, armar el plato con la mano**: cuatro filas con steppers, precargadas desde `food_bank.plantilla_plato` según el slot:
  - Proteína 🖐 — palmas
  - Verdura ✊ — puños
  - Carbohidrato ✊ — puños
  - Grasa 👍 — pulgares
  
  Al tocar una categoría se despliega el banco filtrado de `food_bank.food_items` por `categoria` para elegir cuál fue — pero **elegir el alimento es OPCIONAL**: si no se especifica, usa el promedio de la categoría. Registrar sin elegir alimento tiene que ser posible.
- **Fallback de texto**: campo colapsado al fondo, "o descríbelo". No hay parser todavía: guarda el texto tal cual y marca la tarjeta como "sin analizar".
- **Al confirmar**: barra de feedback inmediata — "Vas en 96 g de proteína. Te faltan 44 g y 6 g de fibra." — más una sugerencia tomada de `demo.recomendaciones_demo`.

## Navegación
Barra inferior de cuatro: Hoy · Entreno · Comida · Progreso. "Progreso" existe pero muestra un estado vacío honesto ("Disponible cuando haya datos reales"). NO inventes gráficas falsas ahí.

## Criterios de aceptación
1. Se puede registrar la sesión completa sin abrir el teclado ni una vez.
2. Se pueden registrar las tres comidas de un día sin abrir el teclado ni una vez.
3. Todo lo registrado sobrevive a recargar la página (localStorage).
4. En 390×844 no hay scroll horizontal en ninguna pantalla.
5. Los números de peso y reps se leen a un metro de distancia.

## Fuera de alcance — NO lo construyas
Gráficas de progreso, revisión semanal, cualquier llamada a un modelo de IA, autenticación, base de datos, notificaciones push, exportación, edición del catálogo, Apple Health.

Sé eficiente con los créditos: entrega las tres pantallas funcionando en esta primera pasada, sin pedir aclaraciones.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://quick-lift-eat.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b0ab9d79-7d03-441a-99b7-2a9885a4fd6e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
