import { Link } from "@tanstack/react-router";
import { CalendarDays, Dumbbell, UtensilsCrossed, LineChart } from "lucide-react";

const items = [
  { to: "/", label: "Hoy", Icon: CalendarDays },
  { to: "/entreno", label: "Entreno", Icon: Dumbbell },
  { to: "/comida", label: "Comida", Icon: UtensilsCrossed },
  { to: "/progreso", label: "Progreso", Icon: LineChart },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-md">
        {items.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="tap flex flex-1 flex-col items-center justify-center gap-1 py-2 text-muted-foreground"
            activeProps={{ className: "text-primary" }}
          >
            <Icon className="h-6 w-6" strokeWidth={2} />
            <span className="text-[11px] font-medium">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
