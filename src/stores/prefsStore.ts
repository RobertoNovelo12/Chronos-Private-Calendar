import { create } from "zustand";
import { setHour12, type ViewKind, type WeekStart } from "@/lib/dates";

export const MAX_CUSTOM_DAYS = 31;

/** Horario de un día en minutos desde medianoche (fin exclusivo); null = día libre. */
export type WorkDay = { start: number; end: number } | null;
/** Índice = día de la semana (0 = domingo). */
export type WorkHours = WorkDay[];

const workDay = (startH: number, endH: number): WorkDay => ({ start: startH * 60, end: endH * 60 });
/** Lunes a viernes de 9:00 a 18:00. */
export const DEFAULT_WORK_HOURS: WorkHours = [null, workDay(9, 18), workDay(9, 18), workDay(9, 18), workDay(9, 18), workDay(9, 18), null];

function validWorkHours(v: unknown): v is WorkHours {
  return (
    Array.isArray(v) &&
    v.length === 7 &&
    v.every(
      (d) =>
        d === null ||
        (typeof d === "object" &&
          Number.isInteger(d.start) &&
          Number.isInteger(d.end) &&
          d.start >= 0 &&
          d.end <= 1440 &&
          d.start < d.end),
    )
  );
}

/** Hora de inicio del horario laboral de ese día (o del primer día laborable; 9:00 si no hay). */
export function workStartMinutes(hours: WorkHours, date: Date): number {
  return hours[date.getDay()]?.start ?? hours.find((d) => d)?.start ?? 9 * 60;
}

/**
 * Preferencias de presentación (no contienen datos del calendario). Se
 * guardan en el almacenamiento local del WebView para aplicarse antes de
 * desbloquear la bóveda.
 */
export interface Prefs {
  weekStartsOn: WeekStart;
  /** Horario laboral de cada día de la semana. */
  workHours: WorkHours;
  /** Duración predeterminada de un evento nuevo, en minutos. */
  defaultDurationMin: number;
  lastView: ViewKind;
  /** Días de la vista personalizada. */
  customDays: number;
  /** Minutos de inactividad antes del bloqueo automático (0 = desactivado). */
  autoLockMinutes: number;
  timeFormat: "12h" | "24h";
  showWeekNumbers: boolean;
  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  /** Segunda columna de horas en la rejilla (zona IANA) o null. */
  secondaryTimeZone: string | null;
  /** Buscar actualizaciones una vez al día al abrir (desactivado por defecto: es una conexión de red). */
  autoUpdateCheck: boolean;
}

const KEY = "chronos.prefs";

const DEFAULTS: Prefs = {
  weekStartsOn: 0,
  workHours: DEFAULT_WORK_HOURS,
  defaultDurationMin: 30,
  lastView: "week",
  customDays: 3,
  autoLockMinutes: 0,
  timeFormat: "12h",
  showWeekNumbers: true,
  leftSidebarOpen: true,
  rightPanelOpen: true,
  secondaryTimeZone: null,
  autoUpdateCheck: false,
};

function load(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULTS;
  }
}

/** Preferencias guardadas → valores válidos (con migraciones de versiones anteriores). */
export function parsePrefs(raw: string | null): Prefs {
  try {
    if (!raw) return DEFAULTS;
    const stored = JSON.parse(raw) as Omit<Partial<Prefs>, "lastView"> & {
      lastView?: string;
      workStartHour?: number;
      workEndHour?: number;
    };
    // Migración (1.2): el horario único de antes se aplica a todos los días, como se veía.
    if (stored.workHours === undefined && typeof stored.workStartHour === "number" && typeof stored.workEndHour === "number") {
      const a = stored.workStartHour;
      const b = stored.workEndHour;
      if (a >= 0 && a < b && b <= 24) stored.workHours = Array.from({ length: 7 }, () => workDay(a, b));
    }
    delete stored.workStartHour;
    delete stored.workEndHour;
    // Migración: la antigua vista "3day" pasa a ser la vista personalizada de 3 días.
    if (stored.lastView === "3day") {
      stored.lastView = "days";
      stored.customDays = 3;
    }
    const p = { ...DEFAULTS, ...stored } as Prefs;
    if (p.weekStartsOn !== 0 && p.weekStartsOn !== 1) p.weekStartsOn = DEFAULTS.weekStartsOn;
    if (!validWorkHours(p.workHours)) p.workHours = DEFAULTS.workHours;
    if (![15, 30, 45, 60, 90, 120].includes(p.defaultDurationMin)) p.defaultDurationMin = DEFAULTS.defaultDurationMin;
    if (!["day", "days", "week", "month", "agenda"].includes(p.lastView)) p.lastView = "week";
    if (!Number.isInteger(p.customDays) || p.customDays < 2 || p.customDays > MAX_CUSTOM_DAYS) p.customDays = 3;
    if (p.secondaryTimeZone !== null && typeof p.secondaryTimeZone !== "string") p.secondaryTimeZone = null;
    if (p.timeFormat !== "12h" && p.timeFormat !== "24h") p.timeFormat = "12h";
    if (typeof p.autoUpdateCheck !== "boolean") p.autoUpdateCheck = false;
    return p;
  } catch {
    return DEFAULTS;
  }
}

interface PrefsState extends Prefs {
  set: (patch: Partial<Prefs>) => void;
}

const initial = load();
setHour12(initial.timeFormat === "12h");

export const usePrefsStore = create<PrefsState>((set, get) => ({
  ...initial,
  set: (patch) => {
    if (patch.timeFormat) setHour12(patch.timeFormat === "12h");
    set(patch);
    const { set: _ignored, ...prefs } = { ...get(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* almacenamiento no disponible */
    }
  },
}));
