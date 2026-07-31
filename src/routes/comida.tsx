import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { seed, type Categoria, type Slot } from "@/data/types";
import {
  actions,
  objetivos,
  promedioCategoria,
  slotPorHora,
  totalesDelDia,
  useHoraDecimal,
  useStore,
} from "@/lib/store";
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

const slots: Slot[] = ["desayuno", "comida", "snack", "cena"];

const cats: { key: Categoria; etiqueta: string; medida: string; icono: string }[] = [
  { key: "proteina", etiqueta: "Proteína", medida: "palmas", icono: "🖐" },
  { key: "verdura", etiqueta: "Verdura", medida: "puños", icono: "✊" },
  { key: "carbohidrato", etiqueta: "Carbohidrato", medida: "puños", icono: "✊" },
  { key: "grasa", etiqueta: "Grasa", medida: "pulgares", icono: "👍" },
];

function Comida() {
  const navigate = useNavigate();
  const hora = useHoraDecimal();
  const mealLogs = useStore((s) => s.mealLogs);
  const [slot, setSlot] = useState<Slot | null>(null);
  const slotActual = slot ?? slotPorHora(hora);

  const plantilla = seed.food_bank.plantilla_plato[slotActual];
  const [porciones, setPorciones] = useState<Record<Categoria, number> | null>(null);
  const [abierta, setAbierta] = useState<Categoria | null>(null);
  const [elegidos, setElegidos] = useState<Partial<Record<Categoria, string>>>({});
  const [texto, setTexto] = useState("");
  const [mostrarTexto, setMostrarTexto] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const cantidades = porciones ?? plantilla;
  const presets = seed.meal_presets.presets.filter((p) => p.slot === slotActual);

  function setCantidad(cat: Categoria, v: number) {
    setPorciones({ ...cantidades, [cat]: Math.max(0, v) });
  }

  function registrar(nombre: string, macros: { proteina_g: number; fibra_g: number; calorias: number }, sinAnalizar = false) {
    actions.addMeal({
      slot: slotActual,
      nombre,
      hora: `${String(Math.floor(hora)).padStart(2, "0")}:${String(
        Math.round((hora % 1) * 60),
      ).padStart(2, "0")}`,
      sin_analizar: sinAnalizar,
      ...macros,
    });
    const total = totalesDelDia([
      ...mealLogs,
      {
        id: "tmp",
        fecha: "2026-07-31",
        slot: slotActual,
        nombre,
        hora: "",
        sin_analizar: sinAnalizar,
        ...macros,
      },
    ]);
    const faltaP = Math.max(0, objetivos.proteina_g - total.proteina_g);
    const faltaF = Math.max(0, objetivos.fibra_g - total.fibra_g);
    const sugerencia =
      seed.demo.recomendaciones_demo[
        Math.floor(Math.random() * seed.demo.recomendaciones_demo.length)
      ];
    setFeedback(
      `Vas en ${total.proteina_g} g de proteína. Te faltan ${faltaP} g y ${faltaF} g de fibra. ${sugerencia}`,
    );
    setTimeout(() => navigate({ to: "/" }), 1600);
  }

  function registrarPlato() {
    const macros = cats.reduce(
      (acc, c) => {
        const n = cantidades[c.key];
        const elegido = seed.food_bank.food_items.find((f) => f.id === elegidos[c.key]);
        const base = elegido ?? promedioCategoria(c.key);
        return {
          proteina_g: acc.proteina_g + base.proteina_g * n,
          fibra_g: acc.fibra_g + base.fibra_g * n,
          calorias: acc.calorias + base.calorias * n,
        };
      },
      { proteina_g: 0, fibra_g: 0, calorias: 0 },
    );
    registrar(`Plato de ${slotActual}`, macros);
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

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Comida</h1>

      {/* Slot */}
      <div className="mt-3 flex gap-1.5">
        {slots.map((s) => (
          <button
            key={s}
            onClick={() => {
              setSlot(s);
              setPorciones(null);
            }}
            className={cn(
              "min-h-[44px] flex-1 rounded-xl text-xs font-medium capitalize",
              s === slotActual ? "bg-primary text-primary-foreground" : "bg-elevated text-muted-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Lo de siempre */}
      <section className="mt-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Lo de siempre</p>
        <div className="-mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-2">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() =>
                registrar(p.nombre, {
                  proteina_g: p.proteina_g,
                  fibra_g: p.fibra_g,
                  calorias: p.calorias,
                })
              }
              className="min-h-[104px] w-40 shrink-0 rounded-2xl bg-verde-soft p-3 text-left active:opacity-90"
            >
              <p className="text-sm font-semibold leading-tight text-foreground">{p.nombre}</p>
              <p className="num mt-2 text-xs text-verde">
                {p.proteina_g} g P · {p.fibra_g} g F
              </p>
              <p className="num mt-0.5 text-[11px] text-muted-foreground">{p.calorias} kcal</p>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Un tap registra y cierra.</p>
      </section>

      {/* Plato con la mano */}
      <section className="mt-5 rounded-2xl bg-card p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Armar el plato con la mano
        </p>
        <div className="mt-3 space-y-2">
          {cats.map((c) => {
            const n = cantidades[c.key];
            const elegido = seed.food_bank.food_items.find((f) => f.id === elegidos[c.key]);
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
                    onClick={() => setCantidad(c.key, n - 1)}
                    aria-label={`Menos ${c.medida}`}
                    className="tap flex h-14 w-12 items-center justify-center rounded-l-xl bg-card text-2xl text-muted-foreground"
                  >
                    −
                  </button>
                  <span className="num w-10 text-center text-3xl font-semibold">{n}</span>
                  <button
                    onClick={() => setCantidad(c.key, n + 1)}
                    aria-label={`Más ${c.medida}`}
                    className="tap flex h-14 w-12 items-center justify-center rounded-r-xl bg-card text-2xl text-muted-foreground"
                  >
                    +
                  </button>
                </div>
                {abierta === c.key && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {seed.food_bank.food_items
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
                            elegidos[c.key] === f.id ? "bg-primary text-primary-foreground" : "bg-card",
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
          onClick={registrarPlato}
          className="tap mt-3 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground"
        >
          Registrar plato
        </button>
      </section>

      {/* Fallback de texto */}
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
                registrar(texto || "Comida sin describir", { proteina_g: 0, fibra_g: 0, calorias: 0 }, true)
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
