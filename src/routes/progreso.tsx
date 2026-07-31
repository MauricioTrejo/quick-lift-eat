import { createFileRoute } from "@tanstack/react-router";
import { LineChart } from "lucide-react";

export const Route = createFileRoute("/progreso")({
  head: () => ({
    meta: [
      { title: "Progreso · Fuerza y Plato" },
      {
        name: "description",
        content: "El progreso aparecerá aquí cuando existan datos reales de entrenos y comidas.",
      },
      { property: "og:title", content: "Progreso · Fuerza y Plato" },
      { property: "og:description", content: "Estado vacío honesto: sin gráficas inventadas." },
    ],
  }),
  component: Progreso,
});

function Progreso() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-8 pb-28 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-elevated">
        <LineChart className="h-6 w-6 text-muted-foreground" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">Progreso</h1>
      <p className="mt-2 text-sm text-muted-foreground">Disponible cuando haya datos reales.</p>
    </div>
  );
}
