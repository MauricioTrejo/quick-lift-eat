# Formato de plan

Este es el contrato para importar un plan de entrenamiento. Si tu JSON valida contra este esquema, la app lo puede cargar.

La fuente de verdad no es este documento sino [`planSchema`](../src/lib/api/plan-import.ts) — un esquema de zod. Este archivo lo explica; el código lo hace cumplir. Si los dos se contradicen, gana el código y este archivo tiene un bug.

[`ejemplo-plan.json`](ejemplo-plan.json) es un plan completo y válido de 5 días: úsalo como punto de partida.

## Forma

Los `//` son comentarios explicativos: quítalos en tu archivo real, porque `.json` no los admite.

<!-- prettier-ignore -->
```jsonc
{
  "nombre": "Mi programa",

  // Opcional. Si lo omites, se conservan los objetivos que ya tengas.
  "objetivos": {
    "proteinaG": 140,
    "fibraG": 30,
    "kcalEntreno": 2100,
    "kcalDescanso": 1850
  },

  // Opcional. Recordatorios del día: agua, snack, lo que sea.
  "agenda": [{ "hora": "16:30", "evento": "Snack", "tipo": "comida" }],

  "sesiones": [
    {
      "diaSemana": 1, // 1 = lunes … 7 = domingo
      "nombre": "Tren inferior + core",
      "tipo": "pierna", // libre; sirve para comparar sesiones parecidas
      "duracionMin": 48,
      "ejercicios": [
        {
          "exerciseId": "sentadilla_copa", // DEBE existir en el catálogo
          "series": 4,
          "reps": 10, // o segundos, si unidad = "segundos"
          "carga": 65, // con lo que se prellena el stepper
          "cargaTexto": "mochila 40 lb + mancuerna 25 lb", // opcional, para leer
          "unidad": "lb", // lb | kg | reps | segundos
          "porLado": false,
          "semaforo": "terracota", // verde | ambar | terracota
          "nota": "Si salen 4x10 limpias, sube reps antes que carga."
        }
      ]
    }
  ]
}
```

## La regla del catálogo

**`exerciseId` tiene que existir en la tabla `exercise`.** Los ids disponibles están en [`seeds/exercises.json`](../seeds/exercises.json) — 56 ejercicios sembrados con `npm run db:seed`.

No es burocracia. Un ejercicio inventado llega sin patrón de movimiento, sin línea de progresión y sin rango de reps, y con eso dejan de funcionar la detección de patrones faltantes, la regla de progresión y media analítica. Si te falta un ejercicio, añádelo al catálogo primero — así entra con esos campos y todo lo demás sigue aplicando.

Si importas un plan con un id desconocido, la importación **falla entera** y te dice cuáles no encontró. Es deliberado: un plan a medias abriría la app con sesiones incompletas y parecería un bug del entreno en vez de un problema de importación.

## Unidades

- **`carga` es el peso TOTAL efectivo.** Si cargas una mochila de 40 lb más una mancuerna de 25, son `65`. Nunca el desglose: guardar las partes te obligaría a sumarlas entre series —el trabajo mental que la app existe para quitar— y haría incomparables dos sesiones que movieron el mismo peso repartido distinto.
- **`cargaTexto` solo para lo que el número no dice**: "al pecho", "por mancuerna". Si únicamente repite la cifra, déjalo fuera.
- **Tiempo siempre en segundos.** Un plancha de 20 minutos es `"reps": 1200, "unidad": "segundos"`. La pantalla decide mostrarlo en minutos cuando pasa de 300 s; el dato guardado no cambia.
- **`porLado: true`** registra un solo valor con etiqueta "/lado", no dos filas.
- **`carga: 0`** es correcto para ejercicios de peso corporal.

## Versionado

Importar **no borra** tu plan anterior: lo cierra con fecha (`vigenteHasta`) y lo marca inactivo. El histórico sigue comparable, y "¿qué decía mi plan en julio?" tiene respuesta. Es la misma mecánica que usa el agente cuando ajusta tus objetivos.
