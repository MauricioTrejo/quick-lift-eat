# Quick Lift & Eat

Una PWA para registrar entrenamiento de fuerza y comidas **sin escribir**.

**App en vivo** → https://quick-lift-eat.lovable.app

---

## La idea

Casi todas las apps de tracking fallan en lo mismo: registrar cuesta más que entrenar. Entre series, de pie y con prisa, nadie quiere abrir un teclado numérico. A la hora de comer, nadie quiere pesar en gramos.

Este prototipo se construyó alrededor de una sola hipótesis medible:

> Registrar un entreno completo son ~20 taps y una comida son ~4, **sin abrir el teclado ni una vez** en el camino principal.

Cada decisión de diseño se subordina a eso. Si algo obliga a escribir, está mal.

### Las dos apuestas

**En entrenamiento, la prescripción viene precargada.** Cada serie aparece con el peso y las reps que te tocan hoy, calculados desde lo que hiciste la última vez. El caso común es tocar una palomita. Solo escribes cuando te desvías del plan.

**En comida, se mide con la mano, no en gramos.** Palmas de proteína, puños de verdura, pulgares de grasa. Cuatro taps. Y una fila de "lo de siempre" que repite una comida entera con uno.

## Estado: prototipo de diseño

Esta versión valida el flujo de interacción, nada más.

- Sin backend, sin login, sin base de datos
- Sin llamadas a modelos de IA
- Estado en memoria + `localStorage`, sembrado desde un JSON estático
- **Los datos son ficticios.** No hay información de salud real de nadie en este repositorio

La pantalla de Progreso existe pero muestra un estado vacío honesto en lugar de gráficas inventadas.

## Sistema de color

Tres estados semánticos y nada más — no hay paleta decorativa aparte:

| Estado | Significa |
|---|---|
| 🟢 verde | progresa / hecho |
| 🟡 ámbar | mantén o afina |
| 🟠 terracota | techo de equipo, progresa por otra vía |

Cada ejercicio lleva su chip. El color no decora: dice qué hacer.

Tema oscuro por defecto, porque esto se usa en el gimnasio y de noche. Numerales tabulares y grandes, legibles de reojo a un metro. Objetivos táctiles de 56 px, porque se toca con prisa.

## Stack

React · TypeScript · Tailwind · shadcn/ui · TanStack Router. Mobile-first para 390×844, instalable como PWA.

```
src/
  data/seed.json      datos semilla (ficticios)
  data/types.ts       tipos derivados del seed
  lib/store.ts        estado + persistencia en localStorage
  routes/             hoy · entreno · comida · progreso
  components/         Stepper, MacroBar, BottomNav
```

## Correr en local

Necesitas Node.js y npm.

```sh
git clone https://github.com/MauricioTrejo/quick-lift-eat.git
cd quick-lift-eat
npm install
npm run dev
```

## Sincronización con Lovable

Este repositorio está conectado a [Lovable](https://lovable.dev) con sync bidireccional: lo que se edita allá se commitea aquí, y lo que empujas a `main` se sincroniza de vuelta.

> [!IMPORTANT]
> No reescribas historia ya publicada — nada de force-push, rebase, amend o squash sobre commits empujados. Rompe el historial del lado de Lovable.

## Licencia

Proyecto personal, sin licencia de uso definida.
