import seedJson from "./seed.json";

export type Semaforo = "verde" | "ambar" | "terracota";
export type Unidad = "lb" | "reps" | "segundos";
export type Slot = "desayuno" | "comida" | "snack" | "cena";
export type Categoria = "proteina" | "verdura" | "carbohidrato" | "grasa";

export type Objetivo = {
  carga: number | string;
  carga_num?: number;
  reps: number;
  unidad: Unidad;
};

export type Prescription = {
  id: string;
  dia: string;
  orden: number;
  ejercicio: string;
  series: number;
  objetivo: Objetivo;
  unidad: Unidad;
  por_lado: boolean;
  semaforo: Semaforo;
  nota_agente: string;
};

export type SesionPlan = {
  id: string;
  dia: string;
  fecha: string;
  nombre: string;
  estado: string;
  duracion_min: number;
  tipo: string;
};

export type FoodItem = {
  id: string;
  nombre: string;
  categoria: Categoria;
  medida: string;
  proteina_g: number;
  fibra_g: number;
  calorias: number;
};

export type Preset = {
  id: string;
  slot: Slot;
  nombre: string;
  proteina_g: number;
  fibra_g: number;
  calorias: number;
};

export type MealLog = {
  id: string;
  fecha: string;
  slot: Slot;
  nombre: string;
  proteina_g: number;
  fibra_g: number;
  calorias: number;
  hora: string;
  sin_analizar: boolean;
};

export type SetLog = {
  prescription_id: string;
  serie: number;
  carga: number;
  reps: number;
  unidad: Unidad;
  al_fallo?: boolean | undefined;
  rir?: number | undefined;
  nota?: string | undefined;
};

export type DemoSession = {
  id: string;
  fecha: string;
  dia: string;
  nombre: string;
  tipo: string;
  estado: string;
  rpe?: string | undefined;
  sensacion?: string | undefined;
  sets: SetLog[];
};

export type Seed = {
  prescriptions: { generado: string; prescriptions: Prescription[] };
  plan: { sesiones: SesionPlan[] };
  food_bank: {
    objetivos_diarios: {
      proteina_g: number;
      fibra_g: number;
      calorias_entreno: number;
      calorias_descanso: number;
    };
    plantilla_plato: Record<Slot, Record<Categoria, number>>;
    food_items: FoodItem[];
  };
  meal_presets: {
    protocolo_tarde: { hora: string; evento: string }[];
    presets: Preset[];
  };
  demo: {
    perfil_demo: { nombre: string; racha_dias: number; peso_kg: number };
    sessions: DemoSession[];
    meal_logs: MealLog[];
    recomendaciones_demo: string[];
    no_negociables: { id: string; etiqueta: string }[];
  };
};

export const seed = seedJson as unknown as Seed;
