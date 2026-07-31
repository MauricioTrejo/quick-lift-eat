import { useEffect, useState, useSyncExternalStore } from "react";
import { seed, type Categoria, type MealLog, type SetLog, type Slot } from "@/data/types";

export const HOY = "2026-07-31";
export const SESION_HOY_ID = "s5";
const KEY = "fuerza-demo-v1";

export type SesionCierre = {
  rpe?: string;
  sensacion?: string;
  duracion_s: number;
  at: string;
};

export type AppState = {
  setLogs: Record<string, SetLog>;
  sesiones: Record<string, SesionCierre>;
  mealLogs: MealLog[];
  peso: number | null;
  snackHecho: boolean;
};

const initial: AppState = {
  setLogs: {},
  sesiones: {},
  mealLogs: seed.demo.meal_logs,
  peso: null,
  snackHecho: false,
};

let state: AppState = initial;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* almacenamiento no disponible */
  }
}

export function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      state = { ...initial, ...(JSON.parse(raw) as Partial<AppState>) };
      emit();
    }
  } catch {
    /* json inválido: seguimos con la semilla */
  }
}

function set(update: (s: AppState) => AppState) {
  state = update(state);
  persist();
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(select: (s: AppState) => T): T {
  useEffect(() => hydrate(), []);
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(initial),
  );
}

export const setKey = (prescriptionId: string, serie: number) => `${prescriptionId}#${serie}`;

export const actions = {
  logSet(log: SetLog) {
    set((s) => ({ ...s, setLogs: { ...s.setLogs, [setKey(log.prescription_id, log.serie)]: log } }));
  },
  unlogSet(prescriptionId: string, serie: number) {
    set((s) => {
      const next = { ...s.setLogs };
      delete next[setKey(prescriptionId, serie)];
      return { ...s, setLogs: next };
    });
  },
  cerrarSesion(id: string, cierre: SesionCierre) {
    set((s) => ({ ...s, sesiones: { ...s.sesiones, [id]: cierre } }));
  },
  reabrirSesion(id: string) {
    set((s) => {
      const sesiones = { ...s.sesiones };
      delete sesiones[id];
      return { ...s, setLogs: {}, sesiones };
    });
  },
  addMeal(meal: Omit<MealLog, "id" | "fecha">) {
    set((s) => ({
      ...s,
      mealLogs: [...s.mealLogs, { ...meal, id: `ml-${Date.now()}`, fecha: HOY }],
      snackHecho: meal.slot === "snack" ? true : s.snackHecho,
    }));
  },
  setPeso(peso: number) {
    set((s) => ({ ...s, peso }));
  },
};

/* ---------- helpers de dominio ---------- */

export const sesionHoy = seed.plan.sesiones.find((s) => s.id === SESION_HOY_ID)!;

export const ejerciciosHoy = seed.prescriptions.prescriptions
  .filter((p) => p.dia === sesionHoy.dia)
  .sort((a, b) => a.orden - b.orden);

export function objetivoCargaNum(p: (typeof ejerciciosHoy)[number]) {
  return typeof p.objetivo.carga === "number" ? p.objetivo.carga : (p.objetivo.carga_num ?? 0);
}

export function etiquetaCarga(p: (typeof ejerciciosHoy)[number]) {
  return typeof p.objetivo.carga === "string" ? p.objetivo.carga : null;
}

export const objetivos = seed.food_bank.objetivos_diarios;

export function slotPorHora(hora: number): Slot {
  if (hora < 11) return "desayuno";
  if (hora < 16) return "comida";
  if (hora < 18.5) return "snack";
  return "cena";
}

export function useHoraDecimal() {
  const [hora, setHora] = useState(13);
  useEffect(() => {
    const d = new Date();
    setHora(d.getHours() + d.getMinutes() / 60);
  }, []);
  return hora;
}

export function totalesDelDia(mealLogs: MealLog[]) {
  return mealLogs
    .filter((m) => m.fecha === HOY)
    .reduce(
      (acc, m) => ({
        proteina_g: acc.proteina_g + m.proteina_g,
        fibra_g: acc.fibra_g + m.fibra_g,
        calorias: acc.calorias + m.calorias,
      }),
      { proteina_g: 0, fibra_g: 0, calorias: 0 },
    );
}

export function promedioCategoria(categoria: Categoria) {
  const items = seed.food_bank.food_items.filter((f) => f.categoria === categoria);
  const n = items.length || 1;
  return {
    proteina_g: Math.round(items.reduce((a, f) => a + f.proteina_g, 0) / n),
    fibra_g: Math.round(items.reduce((a, f) => a + f.fibra_g, 0) / n),
    calorias: Math.round(items.reduce((a, f) => a + f.calorias, 0) / n),
  };
}

export function siguienteEvento(hora: number) {
  const lista = seed.meal_presets.protocolo_tarde;
  const decimal = (h: string) => {
    const partes = h.split(":").map(Number);
    return (partes[0] ?? 0) + (partes[1] ?? 0) / 60;
  };
  return lista.find((e) => decimal(e.hora) >= hora) ?? lista[0];
}

export const sesionPreviaMismoTipo = seed.demo.sessions.find(
  (s) => s.tipo === sesionHoy.tipo && s.estado === "completada",
);

export function mejorPrevio(prescriptionId: string) {
  const sets = sesionPreviaMismoTipo?.sets.filter((s) => s.prescription_id === prescriptionId) ?? [];
  if (!sets.length) return null;
  return sets.reduce((best, s) =>
    s.carga * 1000 + s.reps > best.carga * 1000 + best.reps ? s : best,
  );
}

export function fmtDuracion(segundos: number) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
