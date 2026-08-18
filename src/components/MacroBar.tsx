import { cn } from "@/lib/utils";

type Props = {
  etiqueta: string;
  consumido: number;
  objetivo: number;
  unidad: string;
  tono: "verde" | "ambar" | "terracota";
  nota?: string;
};

const barra = {
  verde: "bg-verde",
  ambar: "bg-ambar",
  terracota: "bg-terracota",
};

export function MacroBar({ etiqueta, consumido, objetivo, unidad, tono, nota }: Props) {
  const faltante = Math.max(0, objetivo - consumido);
  const pct = Math.min(100, Math.round((consumido / objetivo) * 100));
  const listo = faltante === 0;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{etiqueta}</p>
          <p className="flex items-baseline gap-1">
            <span
              className={cn("num text-3xl font-semibold", listo ? "text-verde" : "text-foreground")}
            >
              {listo ? "listo" : faltante}
            </span>
            {!listo && <span className="num text-sm text-muted-foreground">{unidad} faltan</span>}
          </p>
        </div>
        <p className="num text-xs text-muted-foreground">
          {consumido}/{objetivo}
          {nota ? ` · ${nota}` : ""}
        </p>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-elevated">
        <div className={cn("h-full rounded-full", barra[tono])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
