import { create } from "zustand";
import { setHour12, type ViewKind, type WeekStart } from "@/lib/dates";

export const MAX_CUSTOM_DAYS = 31;

/**
 * Preferencias de presentación (no contienen datos del calendario). Se
 * guardan en el almacenamiento local del WebView para aplicarse antes de
 * desbloquear la bóveda.
 */
export interface Prefs {
  weekStartsOn: WeekStart;
  /** Hora de inicio y fin del horario laboral (0–24). */
  workStartHour: number;
  workEndHour: number;
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
}

const KEY = "chronos.prefs";

const DEFAULTS: Prefs = {
  weekStartsOn: 0,
  workStartHour: 9,
  workEndHour: 18,
  defaultDurationMin: 30,
  lastView: "week",
  customDays: 3,
  autoLockMinutes: 0,
  timeFormat: "12h",
  showWeekNumbers: true,
  leftSidebarOpen: true,
  rightPanelOpen: true,
  secondaryTimeZone: null,
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const stored = JSON.parse(raw) as Omit<Partial<Prefs>, "lastView"> & { lastView?: string };
    // Migración: la antigua vista "3day" pasa a ser la vista personalizada de 3 días.
    if (stored.lastView === "3day") {
      stored.lastView = "days";
      stored.customDays = 3;
    }
    const p = { ...DEFAULTS, ...stored } as Prefs;
    if (p.weekStartsOn !== 0 && p.weekStartsOn !== 1) p.weekStartsOn = DEFAULTS.weekStartsOn;
    if (!(p.workStartHour >= 0 && p.workStartHour < p.workEndHour && p.workEndHour <= 24)) {
      p.workStartHour = DEFAULTS.workStartHour;
      p.workEndHour = DEFAULTS.workEndHour;
    }
    if (![15, 30, 45, 60, 90, 120].includes(p.defaultDurationMin)) p.defaultDurationMin = DEFAULTS.defaultDurationMin;
    if (!["day", "days", "week", "month", "agenda"].includes(p.lastView)) p.lastView = "week";
    if (!Number.isInteger(p.customDays) || p.customDays < 2 || p.customDays > MAX_CUSTOM_DAYS) p.customDays = 3;
    if (p.secondaryTimeZone !== null && typeof p.secondaryTimeZone !== "string") p.secondaryTimeZone = null;
    if (p.timeFormat !== "12h" && p.timeFormat !== "24h") p.timeFormat = "12h";
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
