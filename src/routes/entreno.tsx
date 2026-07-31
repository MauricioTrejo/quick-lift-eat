import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Play, Timer } from "lucide-react";
import type { Prescription, SetLog } from "@/data/types";
import {
  actions,
  ejerciciosHoy,
  etiquetaCarga,
  fmtDuracion,
  mejorPrevio,
  objetivoCargaNum,
  sesionHoy,
  sesionPreviaMismoTipo,
  setKey,
  useStore,
} from "@/lib/store";
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
  const navigate = useNavigate();
  const setLogs = useStore((s) => s.setLogs);
  const cierre = useStore((s) => s.sesiones[sesionHoy.id]);
  const [activo, setActivo] = useState(0);
  const [serieActiva, setSerieActiva] = useState(1);
  const [resumen, setResumen] = useState(false);
  const segundos = useCrono(!cierre && !resumen);

  const hechas = Object.keys(setLogs).length;
  const ejerciciosListos = ejerciciosHoy.filter((e) =>
    Array.from({ length: e.series }, (_, i) => i + 1).every((n) => setLogs[setKey(e.id, n)]),
  ).length;

  function avanzar(idx: number, serie: number, ejercicio: Prescription) {
    if (serie < ejercicio.series) {
      setSerieActiva(serie + 1);
      return;
    }
    if (idx + 1 < ejerciciosHoy.length) {
      setActivo(idx + 1);
      setSerieActiva(1);
    }
  }

  if (resumen || cierre) {
    return <Resumen segundos={segundos} yaCerrada={!!cierre} onVolver={() => navigate({ to: "/" })} />;
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-32 pt-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">{sesionHoy.nombre}</h1>
        <span className="num text-sm text-muted-foreground">{hechas} series</span>
      </header>

      <div className="mt-4 space-y-2">
        {ejerciciosHoy.map((e, idx) => {
          const completo = Array.from({ length: e.series }, (_, i) => i + 1).every(
            (n) => setLogs[setKey(e.id, n)],
          );
          const abierto = idx === activo;
          if (!abierto) {
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
                  <span className="truncate text-sm font-medium">{e.ejercicio}</span>
                </span>
                {completo ? (
                  <Check className="h-5 w-5 shrink-0 text-verde" />
                ) : (
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {e.series}×{e.objetivo.reps}
                  </span>
                )}
              </button>
            );
          }
          return (
            <Ejercicio
              key={e.id}
              ejercicio={e}
              serieActiva={serieActiva}
              onSerie={setSerieActiva}
              onHecho={(serie) => avanzar(idx, serie, e)}
            />
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-[76px] z-30 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-2">
          <span className="num text-sm">
            {ejerciciosListos}/{ejerciciosHoy.length} ejercicios
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

function Ejercicio({
  ejercicio,
  serieActiva,
  onSerie,
  onHecho,
}: {
  ejercicio: Prescription;
  serieActiva: number;
  onSerie: (n: number) => void;
  onHecho: (serie: number) => void;
}) {
  const setLogs = useStore((s) => s.setLogs);
  const esTiempo = ejercicio.unidad === "segundos";
  const etiqueta = etiquetaCarga(ejercicio);
  const series = Array.from({ length: ejercicio.series }, (_, i) => i + 1);

  return (
    <section className="rounded-2xl bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold leading-tight">{ejercicio.ejercicio}</h2>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            chip[ejercicio.semaforo],
          )}
        >
          {chipTexto[ejercicio.semaforo]}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{ejercicio.nota_agente}</p>
      {etiqueta && (
        <p className="num mt-2 rounded-lg bg-elevated px-2 py-1 text-[11px] text-muted-foreground">
          {etiqueta}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {series.map((n) => (
          <Serie
            key={n}
            ejercicio={ejercicio}
            serie={n}
            log={setLogs[setKey(ejercicio.id, n)]}
            expandida={n === serieActiva}
            esTiempo={esTiempo}
            onExpandir={() => onSerie(n)}
            onHecho={() => onHecho(n)}
          />
        ))}
      </div>
    </section>
  );
}

function Serie({
  ejercicio,
  serie,
  log,
  expandida,
  esTiempo,
  onExpandir,
  onHecho,
}: {
  ejercicio: Prescription;
  serie: number;
  log?: SetLog | undefined;
  expandida: boolean;
  esTiempo: boolean;
  onExpandir: () => void;
  onHecho: () => void;
}) {
  const objetivoCarga = objetivoCargaNum(ejercicio);
  const [carga, setCarga] = useState(log?.carga ?? objetivoCarga);
  const [reps, setReps] = useState(log?.reps ?? ejercicio.objetivo.reps);
  const [avanzado, setAvanzado] = useState(false);
  const [crono, setCrono] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lado = ejercicio.por_lado ? " /lado" : "";

  useEffect(() => {
    if (crono === null) return;
    const id = setInterval(() => setCrono((v) => (v ?? 0) + 1), 1000);
    return () => clearInterval(id);
  }, [crono === null]);

  const pressStart = () => {
    timer.current = setTimeout(() => setAvanzado(true), 550);
  };
  const pressEnd = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  function guardar() {
    actions.logSet({
      prescription_id: ejercicio.id,
      serie,
      carga,
      reps,
      unidad: ejercicio.unidad,
      al_fallo: log?.al_fallo,
      rir: log?.rir,
      nota: log?.nota,
    });
    setCrono(null);
    onHecho();
  }

  if (log && !expandida) {
    return (
      <button
        onClick={() => {
          actions.unlogSet(ejercicio.id, serie);
          onExpandir();
        }}
        className="flex w-full items-center justify-between rounded-xl bg-verde-soft/50 px-3 py-2 text-left transition-colors"
      >
        <span className="text-xs font-medium text-muted-foreground">Serie {serie}</span>
        <span className="num text-sm font-semibold text-verde">
          {esTiempo ? `${log.reps} s` : `${log.carga} lb · ${log.reps} reps${lado}`}
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
          {esTiempo ? `${ejercicio.objetivo.reps} s` : `${objetivoCarga} lb · ${ejercicio.objetivo.reps}`}
        </span>
      </button>
    );
  }

  return (
    <div
      className="rounded-xl bg-elevated/70 p-2"
      onPointerDown={pressStart}
      onPointerUp={pressEnd}
      onPointerLeave={pressEnd}
    >
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Serie {serie}
        </span>
        {esTiempo ? (
          <Stepper value={reps} onChange={setReps} step={5} suffix="seg" />
        ) : (
          <>
            <Stepper value={carga} onChange={setCarga} step={5} suffix="lb" />
            <Stepper value={reps} onChange={setReps} step={1} suffix={`reps${lado}`} size="md" />
          </>
        )}
        <button
          onClick={guardar}
          aria-label={`Completar serie ${serie}`}
          className="tap ml-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground active:opacity-90"
        >
          <Check className="h-7 w-7" strokeWidth={3} />
        </button>
      </div>

      {esTiempo && (
        <button
          onClick={() => setCrono((v) => (v === null ? 0 : null))}
          className="num mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-card py-2 text-xs text-muted-foreground"
        >
          <Play className="h-3.5 w-3.5" />
          {crono === null ? "Cronómetro" : `${crono} s corriendo`}
        </button>
      )}

      {avanzado && (
        <div className="mt-2 space-y-2 rounded-lg bg-card p-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Ajustes (raro)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() =>
                actions.logSet({
                  prescription_id: ejercicio.id,
                  serie,
                  carga,
                  reps,
                  unidad: ejercicio.unidad,
                  al_fallo: true,
                })
              }
              className="flex-1 rounded-lg bg-terracota-soft py-2 text-xs text-terracota"
            >
              Al fallo
            </button>
            {[0, 1, 2].map((r) => (
              <button
                key={r}
                onClick={() =>
                  actions.logSet({
                    prescription_id: ejercicio.id,
                    serie,
                    carga,
                    reps,
                    unidad: ejercicio.unidad,
                    rir: r,
                  })
                }
                className="num flex-1 rounded-lg bg-elevated py-2 text-xs"
              >
                RIR {r}
              </button>
            ))}
          </div>
          <textarea
            placeholder="Nota (opcional)"
            onBlur={(ev) =>
              actions.logSet({
                prescription_id: ejercicio.id,
                serie,
                carga,
                reps,
                unidad: ejercicio.unidad,
                nota: ev.target.value,
              })
            }
            className="w-full rounded-lg bg-elevated p-2 text-xs outline-none"
            rows={2}
          />
          <button
            onClick={() => setAvanzado(false)}
            className="w-full text-[10px] text-muted-foreground underline"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}

function Resumen({
  segundos,
  yaCerrada,
  onVolver,
}: {
  segundos: number;
  yaCerrada: boolean;
  onVolver: () => void;
}) {
  const setLogs = useStore((s) => s.setLogs);
  const cierre = useStore((s) => s.sesiones[sesionHoy.id]);
  const [rpe, setRpe] = useState<string | undefined>(cierre?.rpe);
  const [sensacion, setSensacion] = useState<string | undefined>(cierre?.sensacion);

  const filas = useMemo(
    () =>
      ejerciciosHoy.map((e) => {
        const hechas = Object.values(setLogs).filter((l) => l.prescription_id === e.id);
        const mejor = hechas.length
          ? hechas.reduce((b, s) => (s.carga * 1000 + s.reps > b.carga * 1000 + b.reps ? s : b))
          : null;
        const previo = mejorPrevio(e.id);
        const record =
          mejor && previo ? mejor.carga * 1000 + mejor.reps > previo.carga * 1000 + previo.reps : false;
        return { e, mejor, previo, record, series: hechas.length };
      }),
    [setLogs],
  );

  return (
    <div className="mx-auto max-w-md px-4 pb-32 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sesión terminada</h1>
      <p className="num mt-1 text-sm text-muted-foreground">
        {sesionHoy.nombre} · {fmtDuracion(cierre?.duracion_s ?? segundos)} ·{" "}
        {Object.keys(setLogs).length} series
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Comparado contra {sesionPreviaMismoTipo?.fecha ?? "sin referencia"}
      </p>

      <div className="mt-4 space-y-2 rounded-2xl bg-card p-4">
        {filas.map(({ e, mejor, previo, record, series }) => (
          <div key={e.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{e.ejercicio}</p>
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
            {["fácil", "bien", "duro"].map((op) => (
              <button
                key={op}
                onClick={() => setRpe(op)}
                className={cn(
                  "tap flex-1 rounded-xl text-sm font-medium",
                  rpe === op ? "bg-primary text-primary-foreground" : "bg-elevated",
                )}
              >
                {op}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Cómo te sentiste</p>
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

      <button
        onClick={() => {
          actions.cerrarSesion(sesionHoy.id, {
            rpe,
            sensacion,
            duracion_s: cierre?.duracion_s ?? segundos,
            at: new Date().toISOString(),
          });
          onVolver();
        }}
        className="tap mt-4 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground"
      >
        {yaCerrada ? "Actualizar" : "Guardar"}
      </button>
    </div>
  );
}
