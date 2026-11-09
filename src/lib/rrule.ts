// Construcción y descripción de reglas RRULE (RFC 5545) para la interfaz.
// El backend vuelve a validar cada regla antes de guardarla.

import { format } from "date-fns";
import { es } from "date-fns/locale";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

const DAY_NAMES: Record<WeekdayCode, string> = {
  SU: "domingo",
  MO: "lunes",
  TU: "martes",
  WE: "miércoles",
  TH: "jueves",
  FR: "viernes",
  SA: "sábado",
};
const ORDINALS: Record<string, string> = { "1": "primer", "2": "segundo", "3": "tercer", "4": "cuarto", "-1": "último" };

export interface RuleParts {
  freq: Freq;
  interval: number;
  byDay: string[];
  byMonthDay: number[];
  count?: number;
  /** "YYYYMMDDTHHMMSSZ" */
  until?: string;
}

export function parseRule(rule: string | null | undefined): RuleParts | null {
  if (!rule) return null;
  const map = new Map<string, string>();
  for (const part of rule.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) map.set(k.toUpperCase(), v.toUpperCase());
  }
  const freq = map.get("FREQ") as Freq | undefined;
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  return {
    freq,
    interval: Number(map.get("INTERVAL") ?? 1) || 1,
    byDay: map.get("BYDAY")?.split(",").filter(Boolean) ?? [],
    byMonthDay: map.get("BYMONTHDAY")?.split(",").map(Number).filter(Number.isFinite) ?? [],
    count: map.has("COUNT") ? Number(map.get("COUNT")) : undefined,
    until: map.get("UNTIL"),
  };
}

export function buildRule(p: RuleParts): string {
  const parts = [`FREQ=${p.freq}`];
  if (p.interval > 1) parts.push(`INTERVAL=${p.interval}`);
  if (p.byDay.length) parts.push(`BYDAY=${p.byDay.join(",")}`);
  if (p.byMonthDay.length) parts.push(`BYMONTHDAY=${p.byMonthDay.join(",")}`);
  if (p.count) parts.push(`COUNT=${p.count}`);
  else if (p.until) parts.push(`UNTIL=${p.until}`);
  return parts.join(";");
}

/** Fin del día local `d` en formato UNTIL (UTC). */
export function untilEndOfDay(d: Date, allDay: boolean): string {
  const end = allDay
    ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59))
    : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  return end.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** UNTIL → fecha local (el día que termina la serie). */
export function untilToDate(until: string, allDay: boolean): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(until);
  if (!m) return null;
  const utc = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  if (allDay) return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  return new Date(utc.getFullYear(), utc.getMonth(), utc.getDate());
}

export function weekdayCode(d: Date): WeekdayCode {
  return WEEKDAY_CODES[d.getDay()]!;
}

/** Posición del día de la semana en el mes: 1..4, o -1 si es el último. */
export function nthWeekdayOfMonth(d: Date): number {
  const n = Math.ceil(d.getDate() / 7);
  const nextWeek = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  return nextWeek.getMonth() !== d.getMonth() ? -1 : n;
}

export interface RulePreset {
  label: string;
  rule: string;
}

/** Opciones rápidas según la fecha del evento. */
export function presets(start: Date): RulePreset[] {
  const wd = weekdayCode(start);
  const nth = nthWeekdayOfMonth(start);
  return [
    { label: "Cada día", rule: "FREQ=DAILY" },
    { label: `Cada semana el ${DAY_NAMES[wd]}`, rule: `FREQ=WEEKLY;BYDAY=${wd}` },
    { label: "Cada día laborable (lun–vie)", rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    { label: `Cada mes el día ${start.getDate()}`, rule: `FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}` },
    { label: `Cada mes el ${ORDINALS[String(nth)]} ${DAY_NAMES[wd]}`, rule: `FREQ=MONTHLY;BYDAY=${nth}${wd}` },
    { label: `Cada año el ${format(start, "d 'de' LLLL", { locale: es })}`, rule: "FREQ=YEARLY" },
  ];
}

function joinDays(codes: string[]): string {
  const names = codes.map((c) => {
    const m = /^(-?\d)?([A-Z]{2})$/.exec(c);
    if (!m) return c;
    const name = DAY_NAMES[m[2] as WeekdayCode] ?? m[2]!;
    return m[1] ? `${ORDINALS[m[1]] ?? m[1]} ${name}` : name;
  });
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

/** Descripción legible: "Cada 2 semanas el lunes y miércoles, 10 veces". */
export function describeRule(rule: string | null | undefined, start: Date, allDay: boolean): string {
  const p = parseRule(rule);
  if (!p) return "No se repite";
  const n = p.interval;
  const unit = { DAILY: ["día", "días"], WEEKLY: ["semana", "semanas"], MONTHLY: ["mes", "meses"], YEARLY: ["año", "años"] }[p.freq];
  let text = n === 1 ? `Cada ${unit[0]}` : `Cada ${n} ${unit[1]}`;
  const weekdays = "MO,TU,WE,TH,FR";
  if (p.freq === "WEEKLY" && p.byDay.join(",") === weekdays && n === 1) text = "Cada día laborable";
  else if (p.byDay.length) text += ` el ${joinDays(p.byDay)}`;
  else if (p.byMonthDay.length) text += ` el día ${p.byMonthDay.join(", ")}`;
  else if (p.freq === "WEEKLY") text += ` el ${DAY_NAMES[weekdayCode(start)]}`;
  else if (p.freq === "YEARLY") text += ` el ${format(start, "d 'de' LLLL", { locale: es })}`;
  if (p.count) text += `, ${p.count} ${p.count === 1 ? "vez" : "veces"}`;
  else if (p.until) {
    const d = untilToDate(p.until, allDay);
    if (d) text += `, hasta el ${format(d, "d MMM yyyy", { locale: es })}`;
  }
  return text;
}

export const REMINDER_PRESETS_TIMED = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
export const REMINDER_PRESETS_ALL_DAY = [0, 900, 1440, 2880, 10080];

/** "30 minutos antes", "1 hora antes", "El día anterior a las 9:00"… */
export function describeReminder(minutes: number, allDay: boolean): string {
  if (allDay) {
    if (minutes === 0) return "El mismo día (00:00)";
    if (minutes === 900) return "El día anterior a las 9:00";
  }
  if (minutes === 0) return "Al empezar";
  if (minutes < 60) return `${minutes} minutos antes`;
  if (minutes < 1440) {
    const h = minutes / 60;
    return Number.isInteger(h) ? `${h} ${h === 1 ? "hora" : "horas"} antes` : `${Math.floor(h)} h ${minutes % 60} min antes`;
  }
  if (minutes % 10080 === 0) {
    const w = minutes / 10080;
    return `${w} ${w === 1 ? "semana" : "semanas"} antes`;
  }
  const d = Math.round(minutes / 1440);
  return `${d} ${d === 1 ? "día" : "días"} antes`;
}
