import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Play, Sparkles, Timer } from "lucide-react";
import { obtenerEntreno, obtenerPrevios } from "@/lib/api/queries";
import { borrarSerie, cerrarSesion, registrarSerie } from "@/lib/api/mutations";
import { ajustarPlan } from "@/lib/api/agente-coach";
import { Stepper } from "@/components/Stepper";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/entreno")({
  head: () => ({
    meta: [
      { title: "Entreno en curso · Fuerza y Plato" },
      {
        name: "description",
        content:
          "Series prellenadas con tu objetivo: toca la palomita y avanza. Steppers de ±5 lb y ±1 rep, sin teclado.",
      },
      { property: "og:title", content: "Entreno en curso · Fuerza y Plato" },
      {
        property: "og:description",
        content: "Registrar una sesión completa de fuerza en ~20 taps.",
      },
    ],
  }),
  component: Entreno,
});

type Ejercicio = Awaited<ReturnType<typeof obtenerEntreno>>["ejercicios"][number];
type Serie = Awaited<ReturnType<typeof obtenerEntreno>>["sets"][number];

const chip: Record<string, string> = {
  verde: "bg-verde-soft text-verde",
  ambar: "bg-ambar-soft text-ambar",
  terracota: "bg-terracota-soft text-terracota",
};
const punto: Record<string, string> = {
  verde: "bg-verde",
  ambar: "bg-ambar",
  terracota: "bg-terracota",
};
const chipTexto: Record<string, string> = {
  verde: "progresa",
  ambar: "mantén",
  terracota: "techo equipo",
};

const clave = (prescriptionId: string, serie: number) => `${prescriptionId}#${serie}`;

/**
 * Un objetivo de tiempo largo se lee en minutos, no en cientos de segundos:
 * "20 min" es legible de reojo, "1200 seg" no. El dato guardado sigue siendo
 * segundos; esto es solo presentación y el stepper avanza de minuto en minuto.
 */
const ES_LARGO = (unidad: string, objetivo: number) => unidad === "segundos" && objetivo > 300;

function fmtDuracion(segundos: number) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useCrono(activo: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!activo) return;
    const id = setInterval(() => setS((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [activo]);
  return s;
}

function Entreno() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isPending, error } = useQuery({
    queryKey: ["entreno"],
    queryFn: () => obtenerEntreno(),
  });

  const [activo, setActivo] = useState(0);
  const [serieActiva, setSerieActiva] = useState(1);
  const [resumen, setResumen] = useState(false);
  const cerrada = data?.sesionReal?.estado === "completada";
  const segundos = useCrono(!cerrada && !resumen && !isPending);

  const hechas = useMemo(() => {
    const m = new Map<string, Serie>();
    for (const s of data?.sets ?? []) {
      if (s.prescriptionId) m.set(clave(s.prescriptionId, s.serie), s);
    }
    return m;
  }, [data?.sets]);

  /* Actualización optimista: la fila se marca al instante y la petición viaja
     detrás. Sin esto, cada ✓ esperaría un viaje de red a media serie — que es
     justo la fricción que esta pantalla existe para evitar. */
  const mRegistrar = useMutation({
    mutationFn: (v: { prescriptionId: string; serie: number; carga: number; reps: number }) =>
      registrarSerie({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["entreno"] });
      const previo = qc.getQueryData(["entreno"]);
      qc.setQueryData(["entreno"], (d: typeof data) =>
        d
          ? {
              ...d,
              sets: [
                ...d.sets.filter(
                  (s) => !(s.prescriptionId === v.prescriptionId && s.serie === v.serie),
                ),
                { ...v, id: -Date.now(), optimista: true } as unknown as Serie,
              ],
            }
          : d,
      );
      return { previo };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(["entreno"], ctx?.previo),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["entreno"] }),
  });

  const mBorrar = useMutation({
    mutationFn: (v: { prescriptionId: string; serie: number }) => borrarSerie({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["entreno"] });
      const previo = qc.getQueryData(["entreno"]);
      qc.setQueryData(["entreno"], (d: typeof data) =>
        d
          ? {
              ...d,
              sets: d.sets.filter(
                (s) => !(s.prescriptionId === v.prescriptionId && s.serie === v.serie),
              ),
            }
          : d,
      );
      return { previo };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(["entreno"], ctx?.previo),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["entreno"] }),
  });

  if (isPending) return <Cargando />;
  if (error) return <Aviso titulo="No se pudo cargar el entreno" cuerpo={String(error)} />;
  if (!data?.sesion) {
    return (
      <Aviso
        titulo="Hoy no toca entrenar"
        cuerpo="Tu plan no tiene sesión para hoy."
        accion={{ a: "/", texto: "Volver a Hoy" }}
      />
    );
  }

  if (resumen || cerrada) {
    return (
      <Resumen
        ejercicios={data.ejercicios}
        hechas={hechas}
        segundos={data.sesionReal?.duracionS ?? segundos}
        yaCerrada={Boolean(cerrada)}
        onVolver={() => navigate({ to: "/" })}
      />
    );
  }

  const ejerciciosListos = data.ejercicios.filter((e) =>
    Array.from({ length: e.series }, (_, i) => i + 1).every((n) => hechas.has(clave(e.id, n))),
  ).length;

  function avanzar(idx: number, serie: number, ejercicio: Ejercicio) {
    if (serie < ejercicio.series) {
      setSerieActiva(serie + 1);
      return;
    }
    if (idx + 1 < data!.ejercicios.length) {
      setActivo(idx + 1);
      setSerieActiva(1);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-32 pt-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">{data.sesion.nombre}</h1>
        <span className="num text-sm text-muted-foreground">{hechas.size} series</span>
      </header>

      <div className="mt-4 space-y-2">
        {data.ejercicios.map((e, idx) => {
          const completo = Array.from({ length: e.series }, (_, i) => i + 1).every((n) =>
            hechas.has(clave(e.id, n)),
          );
          if (idx !== activo) {
            return (
              <button
                key={e.id}
                onClick={() => {
                  setActivo(idx);
                  setSerieActiva(1);
                }}
                className="tap flex w-full items-center justify-between rounded-xl bg-card px-4 text-left"
              >
                <span className="flex items-center gap-2 truncate">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", punto[e.semaforo])} />
                  <span className="truncate text-sm font-medium">{e.nombre}</span>
                </span>
                {completo ? (
                  <Check className="h-5 w-5 shrink-0 text-verde" />
                ) : (
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {e.series}×
                    {ES_LARGO(e.unidad, e.objetivoReps) ? e.objetivoReps / 60 : e.objetivoReps}
                  </span>
                )}
              </button>
            );
          }
          return (
            <BloqueEjercicio
              key={e.id}
              ejercicio={e}
              hechas={hechas}
              serieActiva={serieActiva}
              onSerie={setSerieActiva}
              onRegistrar={(v) => {
                mRegistrar.mutate(v);
                avanzar(idx, v.serie, e);
              }}
              onBorrar={(serie) => {
                mBorrar.mutate({ prescriptionId: e.id, serie });
                setSerieActiva(serie);
              }}
            />
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-[76px] z-30 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-2">
          <span className="num text-sm">
            {ejerciciosListos}/{data.ejercicios.length} ejercicios
          </span>
          <span className="num ml-auto flex items-center gap-1 text-sm text-muted-foreground">
            <Timer className="h-4 w-4" />
            {fmtDuracion(segundos)}
          </span>
          <button
            onClick={() => setResumen(true)}
            className="tap rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Terminar
          </button>
        </div>
      </div>
    </div>
  );
}

function BloqueEjercicio({
  ejercicio,
  hechas,
  serieActiva,
  onSerie,
  onRegistrar,
  onBorrar,
}: {
  ejercicio: Ejercicio;
  hechas: Map<string, Serie>;
  serieActiva: number;
  onSerie: (n: number) => void;
  onRegistrar: (v: { prescriptionId: string; serie: number; carga: number; reps: number }) => void;
  onBorrar: (serie: number) => void;
}) {
  const series = Array.from({ length: ejercicio.series }, (_, i) => i + 1);
  return (
    <section className="rounded-2xl bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold leading-tight">{ejercicio.nombre}</h2>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            chip[ejercicio.semaforo],
          )}
        >
          {chipTexto[ejercicio.semaforo]}
        </span>
      </div>
      {ejercicio.notaAgente && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {ejercicio.notaAgente}
        </p>
      )}
      {ejercicio.objetivoCargaTexto && (
        <p className="num mt-2 rounded-lg bg-elevated px-2 py-1 text-[11px] text-muted-foreground">
          {ejercicio.objetivoCargaTexto}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {series.map((n) => (
          <FilaSerie
            key={n}
            ejercicio={ejercicio}
            serie={n}
            log={hechas.get(clave(ejercicio.id, n))}
            expandida={n === serieActiva}
            onExpandir={() => onSerie(n)}
            onRegistrar={onRegistrar}
            onBorrar={onBorrar}
          />
        ))}
      </div>
    </section>
  );
}

function FilaSerie({
  ejercicio,
  serie,
  log,
  expandida,
  onExpandir,
  onRegistrar,
  onBorrar,
}: {
  ejercicio: Ejercicio;
  serie: number;
  log?: Serie | undefined;
  expandida: boolean;
  onExpandir: () => void;
  onRegistrar: (v: { prescriptionId: string; serie: number; carga: number; reps: number }) => void;
  onBorrar: (serie: number) => void;
}) {
  const esTiempo = ejercicio.unidad === "segundos";
  const enMinutos = ES_LARGO(ejercicio.unidad, ejercicio.objetivoReps);
  const lado = ejercicio.porLado ? " /lado" : "";

  const [carga, setCarga] = useState(log?.carga ?? ejercicio.objetivoCargaNum);
  const [reps, setReps] = useState(log?.reps ?? ejercicio.objetivoReps);
  const [crono, setCrono] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const corriendo = crono !== null;
  useEffect(() => {
    if (!corriendo) return;
    const id = setInterval(() => setCrono((v) => (v ?? 0) + 1), 1000);
    return () => clearInterval(id);
  }, [corriendo]);

  if (log && !expandida) {
    return (
      <button
        onClick={() => onBorrar(serie)}
        className="flex w-full items-center justify-between rounded-xl bg-verde-soft/50 px-3 py-2 text-left transition-colors"
      >
        <span className="text-xs font-medium text-muted-foreground">Serie {serie}</span>
        <span className="num text-sm font-semibold text-verde">
          {esTiempo
            ? enMinutos
              ? `${Math.round(log.reps / 60)} min`
              : `${log.reps} s`
            : `${log.carga} lb · ${log.reps} reps${lado}`}
        </span>
        <Check className="h-4 w-4 text-verde" />
      </button>
    );
  }

  if (!expandida) {
    return (
      <button
        onClick={onExpandir}
        className="flex w-full items-center justify-between rounded-xl bg-elevated/60 px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-muted-foreground">Serie {serie}</span>
        <span className="num text-xs text-muted-foreground">
          {esTiempo
            ? enMinutos
              ? `${ejercicio.objetivoReps / 60} min`
              : `${ejercicio.objetivoReps} s`
            : `${ejercicio.objetivoCargaNum} lb · ${ejercicio.objetivoReps}`}
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-xl bg-elevated/70 p-2">
      <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Serie {serie}
      </p>
      <div className="flex items-center gap-1">
        {esTiempo ? (
          enMinutos ? (
            /* Objetivos largos (remo Z2, intervalos): minutos, no segundos. */
            <Stepper
              value={Math.round(reps / 60)}
              onChange={(v) => setReps(v * 60)}
              step={1}
              min={1}
              suffix="min"
            />
          ) : (
            <Stepper value={reps} onChange={setReps} step={5} suffix="seg" />
          )
        ) : (
          <>
            <Stepper value={carga} onChange={setCarga} step={5} suffix="lb" />
            <Stepper value={reps} onChange={setReps} step={1} suffix={`reps${lado}`} size="md" />
          </>
        )}
        <button
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            setCrono(null);
            onRegistrar({ prescriptionId: ejercicio.id, serie, carga, reps });
          }}
          aria-label={`Completar serie ${serie}`}
          className="ml-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground active:opacity-90"
        >
          <Check className="h-7 w-7" strokeWidth={3} />
        </button>
      </div>

      {esTiempo && !enMinutos && (
        <button
          onClick={() => setCrono((v) => (v === null ? 0 : null))}
          className="num mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-card py-2 text-xs text-muted-foreground"
        >
          <Play className="h-3.5 w-3.5" />
          {crono === null ? "Cronómetro" : `${crono} s corriendo`}
        </button>
      )}
    </div>
  );
}

function Resumen({
  ejercicios,
  hechas,
  segundos,
  yaCerrada,
  onVolver,
}: {
  ejercicios: Ejercicio[];
  hechas: Map<string, Serie>;
  segundos: number;
  yaCerrada: boolean;
  onVolver: () => void;
}) {
  const qc = useQueryClient();
  const [rpe, setRpe] = useState<"facil" | "bien" | "duro" | undefined>();
  const [sensacion, setSensacion] = useState<"verde" | "ambar" | "rojo" | undefined>();

  const { data: previos } = useQuery({
    queryKey: ["previos"],
    queryFn: () => obtenerPrevios(),
  });

  const [guardada, setGuardada] = useState(false);

  const mCerrar = useMutation({
    mutationFn: () =>
      cerrarSesion({
        data: { ...(rpe && { rpe }), ...(sensacion && { sensacion }), duracionS: segundos },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      setGuardada(true);
    },
  });

  /* El ajuste NO se dispara solo al cerrar. Cuesta dinero y cambia tus objetivos;
     que lo pidas explícitamente es la diferencia entre una herramienta y algo
     que decide por ti mientras guardas la sesión. */
  const mAjustar = useMutation({
    mutationFn: () => ajustarPlan(),
    onSuccess: () => qc.invalidateQueries(),
  });

  const filas = ejercicios.map((e) => {
    const suyas = Array.from({ length: e.series }, (_, i) => hechas.get(clave(e.id, i + 1))).filter(
      Boolean,
    ) as Serie[];
    const mejor = suyas.length
      ? suyas.reduce((b, s) => (s.carga * 1000 + s.reps > b.carga * 1000 + b.reps ? s : b))
      : null;
    const previo = previos?.find((p) => p.exerciseId === e.exerciseId) ?? null;
    const record =
      mejor && previo ? mejor.carga * 1000 + mejor.reps > previo.carga * 1000 + previo.reps : false;
    return { e, mejor, previo, record, series: suyas.length };
  });

  return (
    <div className="mx-auto max-w-md px-4 pb-32 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sesión terminada</h1>
      <p className="num mt-1 text-sm text-muted-foreground">
        {fmtDuracion(segundos)} · {hechas.size} series
      </p>

      <div className="mt-4 space-y-2 rounded-2xl bg-card p-4">
        {filas.map(({ e, mejor, previo, record, series }) => (
          <div
            key={e.id}
            className="flex items-center justify-between border-b border-border/60 py-2 last:border-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{e.nombre}</p>
              <p className="num text-[11px] text-muted-foreground">
                {previo
                  ? `antes ${previo.carga ? `${previo.carga} lb · ` : ""}${previo.reps}`
                  : "primera vez"}
              </p>
            </div>
            <div className="ml-3 shrink-0 text-right">
              <p className="num text-lg font-semibold">
                {mejor
                  ? `${mejor.carga ? `${mejor.carga} lb · ` : ""}${mejor.reps}${
                      e.unidad === "segundos" ? " s" : ""
                    }`
                  : "—"}
              </p>
              <p className="num text-[10px] text-muted-foreground">
                {series}/{e.series} series {record ? "· récord" : ""}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-3 rounded-2xl bg-card p-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">RPE</p>
          <div className="mt-2 flex gap-2">
            {(["facil", "bien", "duro"] as const).map((op) => (
              <button
                key={op}
                onClick={() => setRpe(op)}
                className={cn(
                  "tap flex-1 rounded-xl text-sm font-medium",
                  rpe === op ? "bg-primary text-primary-foreground" : "bg-elevated",
                )}
              >
                {op === "facil" ? "fácil" : op}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Cómo te sentiste
          </p>
          <div className="mt-2 flex gap-2">
            {(["verde", "ambar", "rojo"] as const).map((op) => (
              <button
                key={op}
                onClick={() => setSensacion(op)}
                className={cn(
                  "tap flex-1 rounded-xl text-sm font-medium",
                  sensacion === op
                    ? op === "verde"
                      ? "bg-verde-soft text-verde"
                      : op === "ambar"
                        ? "bg-ambar-soft text-ambar"
                        : "bg-terracota-soft text-terracota"
                    : "bg-elevated",
                )}
              >
                {op}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!guardada ? (
        <button
          onClick={() => mCerrar.mutate()}
          disabled={mCerrar.isPending}
          className="tap mt-4 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
        >
          {mCerrar.isPending ? "Guardando…" : yaCerrada ? "Actualizar" : "Guardar"}
        </button>
      ) : (
        <section className="mt-4 rounded-2xl bg-card p-4">
          <p className="text-sm font-semibold">Sesión guardada</p>

          {mAjustar.data ? (
            <>
              <p className="mt-2 text-sm leading-snug text-muted-foreground">
                {mAjustar.data.resumen}
              </p>
              <p className="num mt-2 text-[11px] text-verde">
                {mAjustar.data.aplicados} ajuste(s) aplicados a tu plan.
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                Un agente puede revisar lo que hiciste contra lo que tocaba y ajustar los objetivos
                de la próxima vez. Tu plan actual se archiva, no se pierde.
              </p>
              <button
                onClick={() => mAjustar.mutate()}
                disabled={mAjustar.isPending}
                className="tap mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-elevated text-sm font-semibold disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" />
                {mAjustar.isPending ? "Revisando la sesión…" : "Ajustar mi plan"}
              </button>
            </>
          )}

          {mAjustar.error && (
            <p className="mt-3 break-words text-[11px] text-terracota">{String(mAjustar.error)}</p>
          )}

          <button
            onClick={onVolver}
            className="tap mt-3 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground"
          >
            Listo
          </button>
        </section>
      )}
    </div>
  );
}

function Cargando() {
  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="h-6 w-40 animate-pulse rounded bg-elevated" />
      <div className="mt-4 h-64 animate-pulse rounded-2xl bg-card" />
    </div>
  );
}

function Aviso({
  titulo,
  cuerpo,
  accion,
}: {
  titulo: string;
  cuerpo: string;
  accion?: { a: "/"; texto: string };
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-8 pb-28 text-center">
      <h1 className="text-lg font-semibold">{titulo}</h1>
      <p className="mt-2 break-words text-sm text-muted-foreground">{cuerpo}</p>
      {accion && (
        <Link
          to={accion.a}
          className="tap mt-6 flex w-full items-center justify-center rounded-xl bg-elevated text-sm font-semibold"
        >
          {accion.texto}
        </Link>
      )}
    </div>
  );
}
