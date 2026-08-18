import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flame, Scale, Upload } from "lucide-react";
import { obtenerHoy, obtenerRacha } from "@/lib/api/queries";
import { guardarPeso, reabrirSesion } from "@/lib/api/mutations";
import { MacroBar } from "@/components/MacroBar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hoy · Fuerza y Plato" },
      {
        name: "description",
        content:
          "Registra tu entreno de fuerza y tus comidas en pocos taps, sin abrir el teclado. Mobile-first, en español.",
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

const DIAS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function fechaLarga(iso: string, diaSemana: number) {
  const [, m, d] = iso.split("-").map(Number);
  const meses = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  return `${DIAS[diaSemana]} ${d} de ${meses[(m ?? 1) - 1]}`;
}

function Hoy() {
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ["hoy"], queryFn: () => obtenerHoy() });
  const { data: racha } = useQuery({ queryKey: ["racha"], queryFn: () => obtenerRacha() });
  const [abrirBascula, setAbrirBascula] = useState(false);
  const [pesoTmp, setPesoTmp] = useState<number | null>(null);

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["hoy"] });
    void qc.invalidateQueries({ queryKey: ["racha"] });
  };

  const mPeso = useMutation({
    mutationFn: (peso: number) => guardarPeso({ data: { peso } }),
    onSuccess: invalidar,
  });
  const mReabrir = useMutation({ mutationFn: () => reabrirSesion(), onSuccess: invalidar });

  if (isPending) return <Cargando />;
  if (error) return <Fallo mensaje={String(error)} />;
  if (!data) return null;

  // Sin plan cargado no hay nada que mostrar, y disimularlo con una pantalla
  // vacía sería peor: se dice qué falta y cómo resolverlo.
  if (!data.tienePlan) return <SinPlan />;

  const { totales, objetivos } = data;
  const decimas = pesoTmp ?? Math.round((data.peso ?? 80) * 10);

  const noNegociables = [
    { etiqueta: "Proteína", ok: totales.proteinaG >= objetivos.proteinaG },
    { etiqueta: "Fibra", ok: totales.fibraG >= objetivos.fibraG },
    { etiqueta: "Snack 16:30", ok: data.noNegociables.snack },
    {
      etiqueta: "Báscula",
      ok: data.noNegociables.bascula,
      accion: () => setAbrirBascula((v) => !v),
    },
  ];

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {fechaLarga(data.fecha, data.diaSemana)}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Hoy</h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1.5">
          <Flame className="h-4 w-4 text-terracota" />
          <span className="num text-sm font-semibold">{racha ?? 0}</span>
          <span className="text-xs text-muted-foreground">días</span>
        </div>
      </header>

      {/* Sesión */}
      <section className="mt-5 rounded-2xl bg-card p-4">
        {!data.sesion ? (
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {DIAS[data.diaSemana]}
            </p>
            <h2 className="mt-1 text-xl font-semibold">Día de descanso</h2>
            <p className="mt-1 text-sm text-muted-foreground">Tu plan no tiene sesión para hoy.</p>
          </div>
        ) : data.sesionReal?.estado === "completada" ? (
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-verde-soft">
                <Check className="h-4 w-4 text-verde" />
              </span>
              <h2 className="text-lg font-semibold">{data.sesion.nombre}</h2>
            </div>
            <p className="num mt-3 text-sm text-muted-foreground">
              {data.sesionReal.seriesHechas} series · RPE {data.sesionReal.rpe ?? "—"}
            </p>
            <button
              onClick={() => mReabrir.mutate()}
              className="mt-3 text-xs text-muted-foreground underline"
            >
              Reabrir sesión
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {DIAS[data.diaSemana]}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{data.sesion.nombre}</h2>
            <p className="num mt-1 text-sm text-muted-foreground">
              {data.sesion.ejercicios} ejercicios · {data.sesion.series} series
              {data.sesion.duracionMin ? ` · ~${data.sesion.duracionMin} min` : ""}
            </p>
            <Link
              to="/entreno"
              className="tap mt-4 flex w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground active:opacity-90"
            >
              {(data.sesionReal?.seriesHechas ?? 0) > 0 ? "Continuar" : "Empezar"}
            </Link>
          </>
        )}
      </section>

      {/* Macros */}
      <section className="mt-4 space-y-5 rounded-2xl bg-card p-4">
        <MacroBar
          etiqueta="Proteína"
          consumido={totales.proteinaG}
          objetivo={objetivos.proteinaG}
          unidad="g"
          tono="verde"
        />
        <MacroBar
          etiqueta="Fibra"
          consumido={totales.fibraG}
          objetivo={objetivos.fibraG}
          unidad="g"
          tono="ambar"
        />
        <MacroBar
          etiqueta="Calorías"
          consumido={totales.calorias}
          objetivo={objetivos.calorias}
          unidad="kcal"
          tono="terracota"
          nota={objetivos.esDiaEntreno ? "meta de entreno" : "meta de descanso"}
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
                onClick={() => setPesoTmp(decimas - 2)}
                aria-label="Menos 0.2 kg"
                className="tap flex items-center justify-center rounded-xl bg-elevated px-5 text-2xl"
              >
                −
              </button>
              <span className="num text-4xl font-semibold">
                {(decimas / 10).toFixed(1)}
                <span className="ml-1 text-base text-muted-foreground">kg</span>
              </span>
              <button
                onClick={() => setPesoTmp(decimas + 2)}
                aria-label="Más 0.2 kg"
                className="tap flex items-center justify-center rounded-xl bg-elevated px-5 text-2xl"
              >
                +
              </button>
            </div>
            <button
              onClick={() => {
                mPeso.mutate(decimas / 10);
                setAbrirBascula(false);
              }}
              disabled={mPeso.isPending}
              className="tap mt-3 w-full rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-60"
            >
              Guardar peso
            </button>
          </div>
        )}
      </section>

      {/* Agenda */}
      {data.agenda.length > 0 && (
        <p className="num mt-5 text-center text-xs text-muted-foreground">
          {data.agenda[0]?.hora} · {data.agenda[0]?.evento}
        </p>
      )}
    </div>
  );
}

function Cargando() {
  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="h-6 w-32 animate-pulse rounded bg-elevated" />
      <div className="mt-5 h-40 animate-pulse rounded-2xl bg-card" />
      <div className="mt-4 h-56 animate-pulse rounded-2xl bg-card" />
    </div>
  );
}

function Fallo({ mensaje }: { mensaje: string }) {
  return (
    <div className="mx-auto max-w-md px-4 pt-16">
      <div className="rounded-2xl bg-terracota-soft p-5">
        <p className="text-sm font-semibold text-terracota">No se pudo cargar tu día</p>
        <p className="mt-2 break-words text-xs text-muted-foreground">{mensaje}</p>
      </div>
    </div>
  );
}

function SinPlan() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-8 pb-28 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-elevated">
        <Upload className="h-6 w-6 text-muted-foreground" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">Todavía no tienes un plan</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Carga el tuyo o empieza con el de ejemplo para ver cómo funciona.
      </p>
      <Link
        to="/plan"
        className="tap mt-6 flex w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground"
      >
        Cargar un plan
      </Link>
    </div>
  );
}
