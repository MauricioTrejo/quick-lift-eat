import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, FileJson, Sparkles } from "lucide-react";
import { importarPlan, validarPlan } from "@/lib/api/plan-import";
import { generarPlan, guardarPlanGenerado } from "@/lib/api/agente-plan";
import { cn } from "@/lib/utils";
import ejemplo from "../../docs/ejemplo-plan.json";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "Crear plan · Fuerza y Plato" },
      {
        name: "description",
        content: "Describe tus metas y deja que un agente arme el plan, o importa el tuyo en JSON.",
      },
    ],
  }),
  component: CrearPlan,
});

type Resumen = { diaSemana: number; nombre: string; ejercicios: number; series: number };
const DIAS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const EQUIPO = ["corporal", "mancuerna", "mochila", "barra", "banda", "remadora", "ajustables"];

function CrearPlan() {
  const [modo, setModo] = useState<"generar" | "importar">("generar");

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Crear plan</h1>

      <div className="mt-4 flex gap-1.5">
        {(["generar", "importar"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setModo(m)}
            className={cn(
              "min-h-[44px] flex-1 rounded-xl text-sm font-medium capitalize",
              m === modo
                ? "bg-primary text-primary-foreground"
                : "bg-elevated text-muted-foreground",
            )}
          >
            {m === "generar" ? "Con un agente" : "Importar JSON"}
          </button>
        ))}
      </div>

      {modo === "generar" ? <Generar /> : <Importar />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   GENERAR — metas → agente → borrador editable
   ══════════════════════════════════════════════════════════════════════════ */

function Generar() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [objetivo, setObjetivo] = useState("");
  const [dias, setDias] = useState(4);
  const [minutos, setMinutos] = useState(45);
  const [equipo, setEquipo] = useState<string[]>(["corporal", "mancuerna"]);
  const [restricciones, setRestricciones] = useState("");
  const [experiencia, setExperiencia] = useState<"principiante" | "intermedio" | "avanzado">(
    "intermedio",
  );
  const [problema, setProblema] = useState<string | null>(null);

  const mGenerar = useMutation({
    mutationFn: () =>
      generarPlan({
        data: {
          objetivo,
          diasPorSemana: dias,
          minutosPorSesion: minutos,
          equipo,
          experiencia,
          unidad: "lb" as const,
          ...(restricciones.trim() && { restricciones }),
        },
      }),
    onMutate: () => setProblema(null),
    onError: (e) => setProblema(e instanceof Error ? e.message : String(e)),
  });

  const mGuardar = useMutation({
    mutationFn: (plan: unknown) => guardarPlanGenerado({ data: { plan } as never }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      void navigate({ to: "/" });
    },
    onError: (e) => setProblema(e instanceof Error ? e.message : String(e)),
  });

  const borrador = mGenerar.data;

  return (
    <div className="mt-5 space-y-4">
      <section className="rounded-2xl bg-card p-4">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">
          ¿Qué quieres lograr?
        </label>
        <textarea
          value={objetivo}
          onChange={(e) => setObjetivo(e.target.value)}
          rows={3}
          placeholder="Ej. ganar fuerza en tren inferior sin cargar la espalda baja, entrenando en casa"
          className="mt-2 w-full rounded-xl bg-elevated p-3 text-sm outline-none"
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Numero etiqueta="Días/semana" valor={dias} min={1} max={7} onChange={setDias} />
          <Numero
            etiqueta="Min/sesión"
            valor={minutos}
            min={15}
            max={120}
            paso={5}
            onChange={setMinutos}
          />
        </div>

        <p className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">Experiencia</p>
        <div className="mt-2 flex gap-2">
          {(["principiante", "intermedio", "avanzado"] as const).map((n) => (
            <button
              key={n}
              onClick={() => setExperiencia(n)}
              className={cn(
                "min-h-[44px] flex-1 rounded-xl text-xs font-medium",
                experiencia === n ? "bg-primary text-primary-foreground" : "bg-elevated",
              )}
            >
              {n}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">
          Equipo disponible
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EQUIPO.map((e) => (
            <button
              key={e}
              onClick={() =>
                setEquipo((v) => (v.includes(e) ? v.filter((x) => x !== e) : [...v, e]))
              }
              className={cn(
                "min-h-[44px] rounded-lg px-3 text-xs capitalize",
                equipo.includes(e) ? "bg-primary text-primary-foreground" : "bg-elevated",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          El agente solo puede elegir ejercicios que se hagan con esto.
        </p>

        <label className="mt-4 block text-xs uppercase tracking-widest text-muted-foreground">
          Restricciones (opcional)
        </label>
        <textarea
          value={restricciones}
          onChange={(e) => setRestricciones(e.target.value)}
          rows={2}
          placeholder="Ej. nada de impacto en el tobillo derecho"
          className="mt-2 w-full rounded-xl bg-elevated p-3 text-sm outline-none"
        />

        <button
          onClick={() => mGenerar.mutate()}
          disabled={objetivo.trim().length < 3 || mGenerar.isPending}
          className="tap mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {mGenerar.isPending ? "Diseñando…" : "Generar plan"}
        </button>
        {mGenerar.isPending && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Puede tardar cerca de un minuto. Está razonando sobre todo el catálogo.
          </p>
        )}
      </section>

      {problema && <Problema texto={problema} />}

      {borrador && (
        <section className="rounded-2xl bg-card p-4">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-verde" />
            <p className="text-sm font-semibold">{borrador.plan.nombre}</p>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Eligió entre {borrador.ejerciciosConsiderados} ejercicios del catálogo.
          </p>

          <div className="mt-3 space-y-3">
            {borrador.plan.sesiones.map((s) => (
              <div key={s.diaSemana}>
                <p className="text-sm font-medium">
                  <span className="num text-muted-foreground">{DIAS[s.diaSemana]}</span> {s.nombre}
                </p>
                <div className="mt-1 space-y-0.5">
                  {s.ejercicios.map((e, i) => (
                    <p key={i} className="num text-[11px] text-muted-foreground">
                      {e.series}×{e.unidad === "segundos" ? `${e.reps} s` : e.reps}
                      {e.carga ? ` · ${e.carga} ${e.unidad}` : ""}
                      {e.porLado ? " /lado" : ""} — {e.exerciseId}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Revísalo antes de guardar. Un agente propone; tú eres quien va a levantar el peso.
          </p>
          <button
            onClick={() => mGuardar.mutate(borrador.plan)}
            disabled={mGuardar.isPending}
            className="tap mt-3 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
          >
            {mGuardar.isPending ? "Guardando…" : "Usar este plan"}
          </button>
        </section>
      )}
    </div>
  );
}

function Numero({
  etiqueta,
  valor,
  min,
  max,
  paso = 1,
  onChange,
}: {
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  paso?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{etiqueta}</p>
      <div className="mt-2 flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(min, valor - paso))}
          className="tap flex h-12 w-10 items-center justify-center rounded-l-xl bg-elevated text-xl"
        >
          −
        </button>
        <span className="num flex-1 text-center text-2xl font-semibold">{valor}</span>
        <button
          onClick={() => onChange(Math.min(max, valor + paso))}
          className="tap flex h-12 w-10 items-center justify-center rounded-r-xl bg-elevated text-xl"
        >
          +
        </button>
      </div>
    </div>
  );
}

function Problema({ texto }: { texto: string }) {
  return (
    <div className="flex gap-2 rounded-2xl bg-terracota-soft p-4">
      <AlertTriangle className="h-4 w-4 shrink-0 text-terracota" />
      <p className="text-xs leading-snug text-terracota">{texto}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   IMPORTAR — JSON pegado o el plan de ejemplo
   ══════════════════════════════════════════════════════════════════════════ */

function Importar() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [problema, setProblema] = useState<string | null>(null);
  const [resumen, setResumen] = useState<Resumen[] | null>(null);
  const [planValidado, setPlanValidado] = useState<unknown>(null);

  const mValidar = useMutation({
    mutationFn: (plan: unknown) => validarPlan({ data: { plan } as never }),
    onSuccess: (r) => {
      if (!r.valido) {
        setProblema(
          `Estos ejercicios no están en el catálogo: ${r.desconocidos.join(", ")}. ` +
            `Usa ids de seeds/exercises.json.`,
        );
        setResumen(null);
        return;
      }
      setProblema(null);
      setResumen(r.resumen);
    },
    onError: (e) => {
      setProblema(mensajeLegible(e));
      setResumen(null);
    },
  });

  const mImportar = useMutation({
    mutationFn: (plan: unknown) => importarPlan({ data: { plan, origen: "importado" } as never }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      void navigate({ to: "/" });
    },
    onError: (e) => setProblema(mensajeLegible(e)),
  });

  function revisar(fuente: unknown) {
    setPlanValidado(fuente);
    mValidar.mutate(fuente);
  }

  return (
    <div className="mt-5">
      <p className="text-sm text-muted-foreground">
        Pega tu plan en JSON. El formato está en{" "}
        <span className="num text-foreground">docs/plan-schema.md</span>.
      </p>

      <button
        onClick={() => revisar(ejemplo)}
        className="tap mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-elevated text-sm font-semibold active:bg-accent"
      >
        <FileJson className="h-4 w-4" />
        Usar el plan de ejemplo
      </button>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={8}
        placeholder='{ "nombre": "Mi programa", "sesiones": [ … ] }'
        className="mt-4 w-full rounded-2xl bg-card p-3 font-mono text-xs outline-none"
      />
      <button
        onClick={() => {
          try {
            revisar(JSON.parse(texto));
          } catch {
            setProblema("Eso no es JSON válido. Revisa comas y llaves.");
            setResumen(null);
          }
        }}
        disabled={!texto.trim() || mValidar.isPending}
        className="tap mt-2 w-full rounded-xl bg-elevated text-sm font-semibold disabled:opacity-50"
      >
        {mValidar.isPending ? "Revisando…" : "Revisar"}
      </button>

      {problema && (
        <div className="mt-4">
          <Problema texto={problema} />
        </div>
      )}

      {resumen && (
        <div className="mt-4 rounded-2xl bg-card p-4">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-verde" />
            <p className="text-sm font-semibold">Listo para importar</p>
          </div>
          <div className="mt-3 space-y-1.5">
            {resumen.map((s) => (
              <div key={s.diaSemana} className="flex items-baseline justify-between">
                <span className="text-sm">
                  <span className="num text-muted-foreground">{DIAS[s.diaSemana]}</span> {s.nombre}
                </span>
                <span className="num shrink-0 text-xs text-muted-foreground">
                  {s.ejercicios} ej · {s.series} series
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Tu plan anterior no se borra: se archiva con la fecha de hoy y queda consultable.
          </p>
          <button
            onClick={() => mImportar.mutate(planValidado)}
            disabled={mImportar.isPending}
            className="tap mt-3 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
          >
            {mImportar.isPending ? "Importando…" : "Importar"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Los errores de zod llegan como un JSON largo; se extrae algo legible. */
function mensajeLegible(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  try {
    const parsed = JSON.parse(texto) as { path?: string[]; message?: string }[];
    if (Array.isArray(parsed) && parsed[0]?.message) {
      return parsed
        .slice(0, 3)
        .map((p) => `${p.path?.join(".") ?? "?"}: ${p.message}`)
        .join(" · ");
    }
  } catch {
    /* no era JSON de zod */
  }
  return texto;
}
