import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  suffix: string;
  size?: "lg" | "md";
  disabled?: boolean;
  children?: ReactNode;
};

export function Stepper({
  value,
  onChange,
  step,
  min = 0,
  suffix,
  size = "lg",
  disabled,
}: Props) {
  return (
    <div className="flex flex-1 items-center gap-0.5">
      <button
        type="button"
        aria-label={`Menos ${step} ${suffix}`}
        disabled={disabled}
        onClick={() => onChange(Math.max(min, value - step))}
        className="flex h-14 w-9 items-center justify-center rounded-l-xl bg-elevated text-2xl font-medium text-muted-foreground active:bg-accent disabled:opacity-40"
      >
        −
      </button>
      <div className="flex min-w-[52px] flex-col items-center justify-center px-0.5">
        <span
          className={cn(
            "num font-semibold leading-none text-foreground",
            size === "lg" ? "text-3xl" : "text-3xl",
          )}
        >
          {value}
        </span>
        <span className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
          {suffix}
        </span>
      </div>
      <button
        type="button"
        aria-label={`Más ${step} ${suffix}`}
        disabled={disabled}
        onClick={() => onChange(value + step)}
        className="flex h-14 w-9 items-center justify-center rounded-r-xl bg-elevated text-2xl font-medium text-muted-foreground active:bg-accent disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
