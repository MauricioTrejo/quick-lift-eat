import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { obtenerComida } from "@/lib/api/queries";
import { registrarComida } from "@/lib/api/mutations";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/comida")({
  head: () => ({
    meta: [
      { title: "Registrar comida · Fuerza y Plato" },
      {
        name: "description",
        content:
          "Un tap para «lo de siempre» o arma el plato con la mano: palmas, puños y pulgares. Sin teclado.",
      },
      { property: "og:title", content: "Registrar comida · Fuerza y Plato" },
      {
        property: "og:description",
        content: "Registra una comida en cuatro taps con porciones por mano.",
      },
    ],
  }),
  component: Comida,
});

type Slot = "desayuno" | "comida" | "snack" | "cena";
type Categoria = "proteina" | "verdura" | "carbohidrato" | "grasa";

const slots: Slot[] = ["desayuno", "comida", "snack", "cena"];

const cats: { key: Categoria; etiqueta: string; medida: string; icono: string }[] = [
  { key: "proteina", etiqueta: "Proteína", medida: "palmas", icono: "🖐" },
  { key: "verdura", etiqueta: "Verdura", medida: "puños", icono: "✊" },
  { key: "carbohidrato", etiqueta: "Carbohidrato", medida: "puños", icono: "✊" },
  { key: "grasa", etiqueta: "Grasa", medida: "pulgares", icono: "👍" },
];

/** El slot se infiere de la hora; el selector solo existe para corregirlo. */
function slotPorHora(h: number): Slot {
  if (h < 11) return "desayuno";
  if (h < 16) return "comida";
  if (h < 18.5) return "snack";
  return "cena";
}

function Comida() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [slotElegido, setSlotElegido] = useState<Slot | null>(null);
  const slot = slotElegido ?? slotPorHora(new Date().getHours() + new Date().getMinutes() / 60);

  const { data, isPending } = useQuery({
    queryKey: ["comida", slot],
    queryFn: () => obtenerComida({ data: { slot } }),
  });

  const [porciones, setPorciones] = useState<Record<Categoria, number> | null>(null);
  const [abierta, setAbierta] = useState<Categoria | null>(null);
  const [elegidos, setElegidos] = useState<Partial<Record<Categoria, string>>>({});
  const [texto, setTexto] = useState("");
  const [mostrarTexto, setMostrarTexto] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const mRegistrar = useMutation({
    mutationFn: (v: Parameters<typeof registrarComida>[0]) => registrarComida(v),
    onSuccess: async () => {
      await qc.invalidateQueries();
      setTimeout(() => navigate({ to: "/" }), 1600);
    },
  });

  if (isPending || !data) return <Cargando />;

  const plantillaSlot = (data.plantilla?.[slot] ?? {}) as Partial<Record<Categoria, number>>;
  const cantidades: Record<Categoria, number> =
    porciones ??
    ({
      proteina: plantillaSlot.proteina ?? 0,
      verdura: plantillaSlot.verdura ?? 0,
      carbohidrato: plantillaSlot.carbohidrato ?? 0,
      grasa: plantillaSlot.grasa ?? 0,
    } as Record<Categoria, number>);

  /**
   * El texto de cierre. Antes decía "Te faltan 44 g y 6 g de fibra", que se lee
   * como si los 44 también fueran fibra. Y la sugerencia salía al azar: ahora se
   * elige por contexto — si vas peor de fibra que de proteína en proporción a tu
   * objetivo, te habla de fibra.
   */
  function construirFeedback(p: number, f: number) {
    const faltaP = Math.max(0, data!.objetivos.proteinaG - p);
    const faltaF = Math.max(0, data!.objetivos.fibraG - f);
    const huecoP = faltaP / data!.objetivos.proteinaG;
    const huecoF = faltaF / data!.objetivos.fibraG;

    const partes: string[] = [];
    if (faltaP > 0) partes.push(`${Math.round(faltaP)} g de proteína`);
    if (faltaF > 0) partes.push(`${Math.round(faltaF)} g de fibra`);

    const base = `Vas en ${Math.round(p)} g de proteína.`;
    if (!partes.length) return `${base} Ya cerraste tus dos objetivos del día.`;

    const sugerencia =
      huecoF > huecoP
        ? "Un puño de frijol son 15 g de fibra de un golpe."
        : "Una palma más de proteína en la cena cierra el hueco.";
    return `${base} Te faltan ${partes.join(" y ")}. ${sugerencia}`;
  }

  function registrar(
    nombre: string,
    items: { foodItemId: string | null; categoria: Categoria; cantidad: number }[],
    origen: "preset" | "plato" | "texto",
    extra?: { textoOriginal?: string; sinAnalizar?: boolean },
  ) {
    mRegistrar.mutate(
      {
        data: {
          slot,
          nombre,
          origen,
          items,
          sinAnalizar: extra?.sinAnalizar ?? false,
          ...(extra?.textoOriginal && { textoOriginal: extra.textoOriginal }),
        },
      },
      {
        onSuccess: (r) => {
          const t = data!.delDia.reduce(
            (acc, m) => ({ p: acc.p + m.proteinaG, f: acc.f + m.fibraG }),
            { p: 0, f: 0 },
          );
          setFeedback(construirFeedback(t.p + r.total.proteinaG, t.f + r.total.fibraG));
        },
      },
    );
  }

  if (feedback) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-16">
        <div className="rounded-2xl bg-verde-soft p-5">
          <p className="text-base font-semibold leading-snug text-verde">{feedback}</p>
        </div>
      </div>
    );
  }

  const puedeDerivar = data.historial >= data.minimoParaDerivar;

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Comida</h1>

      <div className="mt-3 flex gap-1.5">
        {slots.map((s) => (
          <button
            key={s}
            onClick={() => {
              setSlotElegido(s);
              setPorciones(null);
            }}
            className={cn(
              "min-h-[44px] flex-1 rounded-xl text-xs font-medium capitalize",
              s === slot
                ? "bg-primary text-primary-foreground"
                : "bg-elevated text-muted-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* LO DE SIEMPRE — derivado de lo que realmente comes, en cuanto haya
          historial suficiente. Antes de eso, presets semilla; fingir un ranking
          con dos registros sería inventarse una preferencia. */}
      <section className="mt-5">
        <div className="flex items-baseline justify-between">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Lo de siempre</p>
          {puedeDerivar && (
            <span className="flex items-center gap-1 text-[10px] text-verde">
              <Sparkles className="h-3 w-3" />
              tuyo
            </span>
          )}
        </div>

        <div className="-mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-2">
          {puedeDerivar
            ? data.frecuentes.map((f) => (
                <button
                  key={f.food_item_id}
                  onClick={() =>
                    registrar(
                      f.nombre,
                      [
                        {
                          foodItemId: f.food_item_id,
                          categoria: f.categoria as Categoria,
                          cantidad: Math.max(1, Math.round(f.cantidad_promedio)),
                        },
                      ],
                      "preset",
                    )
                  }
                  className="min-h-[104px] w-40 shrink-0 rounded-2xl bg-verde-soft p-3 text-left active:opacity-90"
                >
                  <p className="text-sm font-semibold leading-tight text-foreground">{f.nombre}</p>
                  <p className="num mt-2 text-xs text-verde">
                    {Math.round(f.proteina_unidad)} g P · {Math.round(f.fibra_unidad)} g F
                  </p>
                  <p className="num mt-0.5 text-[11px] text-muted-foreground">
                    {f.veces} {f.veces === 1 ? "vez" : "veces"} · {f.medida}
                  </p>
                </button>
              ))
            : data.presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => registrar(p.nombre, [], "preset")}
                  className="min-h-[104px] w-40 shrink-0 rounded-2xl bg-verde-soft p-3 text-left active:opacity-90"
                >
                  <p className="text-sm font-semibold leading-tight text-foreground">{p.nombre}</p>
                  <p className="num mt-2 text-xs text-verde">
                    {Math.round(p.proteinaG)} g P · {Math.round(p.fibraG)} g F
                  </p>
                  <p className="num mt-0.5 text-[11px] text-muted-foreground">
                    {Math.round(p.calorias)} kcal
                  </p>
                </button>
              ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {puedeDerivar
            ? "Ordenado por lo que más comes en este horario."
            : `Sugerencias de arranque. Tras ${data.minimoParaDerivar} comidas registradas, aquí sale lo tuyo.`}
        </p>
      </section>

      {/* Armar el plato con la mano */}
      <section className="mt-5 rounded-2xl bg-card p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Armar el plato con la mano
        </p>
        <div className="mt-3 space-y-2">
          {cats.map((c) => {
            const n = cantidades[c.key];
            const elegido = data.alimentos.find((f) => f.id === elegidos[c.key]);
            return (
              <div key={c.key} className="rounded-xl bg-elevated/60 p-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAbierta(abierta === c.key ? null : c.key)}
                    className="min-h-[56px] flex-1 text-left"
                  >
                    <p className="text-sm font-medium">
                      {c.etiqueta} <span className="text-base">{c.icono}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {elegido ? elegido.nombre : `promedio de ${c.etiqueta.toLowerCase()}`}
                    </p>
                  </button>
                  <button
                    onClick={() => setPorciones({ ...cantidades, [c.key]: Math.max(0, n - 1) })}
                    aria-label={`Menos ${c.medida}`}
                    className="tap flex h-14 w-12 items-center justify-center rounded-l-xl bg-card text-2xl text-muted-foreground"
                  >
                    −
                  </button>
                  <span className="num w-10 text-center text-3xl font-semibold">{n}</span>
                  <button
                    onClick={() => setPorciones({ ...cantidades, [c.key]: n + 1 })}
                    aria-label={`Más ${c.medida}`}
                    className="tap flex h-14 w-12 items-center justify-center rounded-r-xl bg-card text-2xl text-muted-foreground"
                  >
                    +
                  </button>
                </div>
                {abierta === c.key && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {data.alimentos
                      .filter((f) => f.categoria === c.key)
                      .map((f) => (
                        <button
                          key={f.id}
                          onClick={() => {
                            setElegidos((e) => ({ ...e, [c.key]: f.id }));
                            setAbierta(null);
                          }}
                          className={cn(
                            "min-h-[44px] rounded-lg px-3 text-xs",
                            elegidos[c.key] === f.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-card",
                          )}
                        >
                          {f.nombre}
                        </button>
                      ))}
                    <p className="w-full pt-1 text-[10px] text-muted-foreground">
                      Elegir alimento es opcional.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={() =>
            registrar(
              `Plato de ${slot}`,
              cats
                .filter((c) => cantidades[c.key] > 0)
                .map((c) => ({
                  foodItemId: elegidos[c.key] ?? null,
                  categoria: c.key,
                  cantidad: cantidades[c.key],
                })),
              "plato",
            )
          }
          disabled={mRegistrar.isPending}
          className="tap mt-3 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
        >
          {mRegistrar.isPending ? "Guardando…" : "Registrar plato"}
        </button>
      </section>

      {/* HOY — antes no existía. Sin esta lista, la etiqueta "sin analizar" se
          guardaba en la base y no se veía en ninguna parte. */}
      {data.delDia.length > 0 && (
        <section className="mt-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Hoy</p>
          <div className="mt-2 space-y-1.5">
            {data.delDia.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-xl bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.nombre}
                    {m.sinAnalizar && (
                      <span className="ml-2 rounded-full bg-ambar-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ambar">
                        sin analizar
                      </span>
                    )}
                  </p>
                  <p className="num text-[11px] text-muted-foreground">
                    {m.hora} · {m.slot}
                  </p>
                </div>
                <span className="num shrink-0 text-xs text-muted-foreground">
                  {Math.round(m.proteinaG)} g P · {Math.round(m.fibraG)} g F
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fallback de texto: el único sitio con teclado, y está colapsado a
          propósito para que no compita con el camino de taps. */}
      <section className="mt-4">
        <button
          onClick={() => setMostrarTexto((v) => !v)}
          className="w-full text-left text-xs text-muted-foreground underline"
        >
          o descríbelo
        </button>
        {mostrarTexto && (
          <div className="mt-2 rounded-2xl bg-card p-3">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={3}
              placeholder="Ej. dos tacos de canasta y un café"
              className="w-full rounded-xl bg-elevated p-3 text-sm outline-none"
            />
            <button
              onClick={() =>
                registrar(texto || "Comida sin describir", [], "texto", {
                  textoOriginal: texto,
                  sinAnalizar: true,
                })
              }
              className="tap mt-2 w-full rounded-xl bg-elevated text-sm font-medium"
            >
              Guardar sin analizar
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Cargando() {
  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="h-8 w-28 animate-pulse rounded bg-elevated" />
      <div className="mt-5 h-28 animate-pulse rounded-2xl bg-card" />
      <div className="mt-4 h-72 animate-pulse rounded-2xl bg-card" />
    </div>
  );
}
