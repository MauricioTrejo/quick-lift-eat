import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Flame, Scale } from "lucide-react";
import { seed } from "@/data/types";
import {
  actions,
  ejerciciosHoy,
  fmtDuracion,
  objetivos,
  sesionHoy,
  siguienteEvento,
  totalesDelDia,
  useHoraDecimal,
  useStore,
} from "@/lib/store";
import { MacroBar } from "@/components/MacroBar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hoy · Fuerza y Plato" },
      {
        name: "description",
        content:
          "Registra tu entreno de fuerza y tus comidas en pocos taps, sin abrir el teclado. Prototipo mobile-first en español.",
      },
      { property: "og:title", content: "Hoy · Fuerza y Plato" },
      {
        property: "og:description",
        content: "Sesión del día, macros faltantes y los cuatro no-negociables en una pantalla.",
      },
    ],
  }),
  component: Hoy,
});

function Hoy() {
  const hora = useHoraDecimal();
  const mealLogs = useStore((s) => s.mealLogs);
  const peso = useStore((s) => s.peso);
  const cierre = useStore((s) => s.sesiones[sesionHoy.id]);
  const setLogs = useStore((s) => s.setLogs);
  const [abrirBascula, setAbrirBascula] = useState(false);
  const [pesoTmp, setPesoTmp] = useState(Math.round((peso ?? seed.demo.perfil_demo.peso_kg) * 10));

  const total = totalesDelDia(mealLogs);
  const hayEntreno = true;
  const objCal = hayEntreno ? objetivos.calorias_entreno : objetivos.calorias_descanso;
  const evento = siguienteEvento(hora);

  const seriesHechas = Object.keys(setLogs).length;
  const seriesTotales = ejerciciosHoy.reduce((a, e) => a + e.series, 0);

  const noNegociables = [
    { etiqueta: "Proteína 140g", ok: total.proteina_g >= objetivos.proteina_g },
    { etiqueta: "Fibra 30g", ok: total.fibra_g >= objetivos.fibra_g },
    {
      etiqueta: "Snack 16:30",
      ok: mealLogs.some((m) => m.slot === "snack" && m.fecha === "2026-07-31"),
    },
    { etiqueta: "Báscula", ok: peso !== null, accion: () => setAbrirBascula((v) => !v) },
  ];

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Viernes 31 de julio
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Hoy</h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1.5">
          <Flame className="h-4 w-4 text-terracota" />
          <span className="num text-sm font-semibold">{seed.demo.perfil_demo.racha_dias}</span>
          <span className="text-xs text-muted-foreground">días</span>
        </div>
      </header>

      {/* Sesión */}
      <section className="mt-5 rounded-2xl bg-card p-4">
        {cierre ? (
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-verde-soft">
                <Check className="h-4 w-4 text-verde" />
              </span>
              <h2 className="text-lg font-semibold">{sesionHoy.nombre}</h2>
            </div>
            <p className="num mt-3 text-sm text-muted-foreground">
              {seriesHechas} series · {fmtDuracion(cierre.duracion_s)} · RPE {cierre.rpe ?? "—"}
            </p>
            <button
              onClick={() => actions.reabrirSesion(sesionHoy.id)}
              className="mt-3 text-xs text-muted-foreground underline"
            >
              Reabrir sesión
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {sesionHoy.dia}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{sesionHoy.nombre}</h2>
            <p className="num mt-1 text-sm text-muted-foreground">
              {ejerciciosHoy.length} ejercicios · {seriesTotales} series · ~{sesionHoy.duracion_min}{" "}
              min
            </p>
            <Link
              to="/entreno"
              className="tap mt-4 flex w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground active:opacity-90"
            >
              {seriesHechas > 0 ? "Continuar" : "Empezar"}
            </Link>
          </>
        )}
      </section>

      {/* Macros */}
      <section className="mt-4 space-y-5 rounded-2xl bg-card p-4">
        <MacroBar
          etiqueta="Proteína"
          consumido={total.proteina_g}
          objetivo={objetivos.proteina_g}
          unidad="g"
          tono="verde"
        />
        <MacroBar
          etiqueta="Fibra"
          consumido={total.fibra_g}
          objetivo={objetivos.fibra_g}
          unidad="g"
          tono="ambar"
        />
        <MacroBar
          etiqueta="Calorías"
          consumido={total.calorias}
          objetivo={objCal}
          unidad="kcal"
          tono="terracota"
          nota={hayEntreno ? "meta de entreno" : "meta de descanso"}
        />
        <Link
          to="/comida"
          className="tap flex w-full items-center justify-center rounded-xl bg-elevated text-base font-semibold active:bg-accent"
        >
          ＋ Comida
        </Link>
      </section>

      {/* No negociables */}
      <section className="mt-4">
        <div className="flex gap-2 overflow-x-hidden">
          {noNegociables.map((n) => (
            <button
              key={n.etiqueta}
              onClick={n.accion}
              className={cn(
                "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[11px] font-medium leading-tight",
                n.ok ? "bg-verde-soft text-verde" : "bg-elevated text-muted-foreground",
              )}
            >
              {n.etiqueta === "Báscula" ? <Scale className="h-4 w-4" /> : null}
              {n.etiqueta}
            </button>
          ))}
        </div>

        {abrirBascula && (
          <div className="mt-3 rounded-2xl bg-card p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Peso de hoy</p>
            <div className="mt-2 flex items-center justify-between">
              <button
                onClick={() => setPesoTmp((v) => v - 2)}
                aria-label="Menos 0.2 kg"
                className="tap flex items-center justify-center rounded-xl bg-elevated text-2xl"
              >
                −
              </button>
              <span className="num text-4xl font-semibold">
                {(pesoTmp / 10).toFixed(1)}
                <span className="ml-1 text-base text-muted-foreground">kg</span>
              </span>
              <button
                onClick={() => setPesoTmp((v) => v + 2)}
                aria-label="Más 0.2 kg"
                className="tap flex items-center justify-center rounded-xl bg-elevated text-2xl"
              >
                +
              </button>
            </div>
            <button
              onClick={() => {
                actions.setPeso(pesoTmp / 10);
                setAbrirBascula(false);
              }}
              className="tap mt-3 w-full rounded-xl bg-primary font-semibold text-primary-foreground"
            >
              Guardar peso
            </button>
          </div>
        )}
      </section>

      {/* Agenda */}
      <p className="num mt-5 text-center text-xs text-muted-foreground">
        {evento?.hora} · {evento?.evento}
      </p>
    </div>
  );
}
