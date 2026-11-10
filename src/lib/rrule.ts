// Construcción y descripción de reglas RRULE (RFC 5545) para la interfaz.
// El backend vuelve a validar cada regla antes de guardarla.

import { format } from "date-fns";
import { dateLocale, intlLocale, t, tp } from "@/i18n";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** Nombre del día de la semana en el idioma activo ("lunes", "Monday"…). */
export function dayName(code: WeekdayCode): string {
  // 4 de enero de 1970 fue domingo.
  return format(new Date(1970, 0, 4 + WEEKDAY_CODES.indexOf(code)), "EEEE", { locale: dateLocale() });
}

/** Fecha sin año ("15 de marzo", "March 15"…). */
export function dayMonth(d: Date): string {
  return new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "long" }).format(d);
}

/** Ordinal de un día de la semana en el mes: "primer lunes", "último viernes". */
export function nthWeekday(nth: number, code: WeekdayCode): string {
  const day = dayName(code);
  switch (nth) {
    case 1:
      return t("primer {day}", { day });
    case 2:
      return t("segundo {day}", { day });
    case 3:
      return t("tercer {day}", { day });
    case 4:
      return t("cuarto {day}", { day });
    default:
      return t("último {day}", { day });
  }
}

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
    { label: t("Cada día"), rule: "FREQ=DAILY" },
    { label: t("Cada semana el {day}", { day: dayName(wd) }), rule: `FREQ=WEEKLY;BYDAY=${wd}` },
    { label: t("Cada día laborable (lun–vie)"), rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    { label: t("Cada mes el día {n}", { n: start.getDate() }), rule: `FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}` },
    { label: t("Cada mes el {nth}", { nth: nthWeekday(nth, wd) }), rule: `FREQ=MONTHLY;BYDAY=${nth}${wd}` },
    { label: t("Cada año el {date}", { date: dayMonth(start) }), rule: "FREQ=YEARLY" },
  ];
}

function joinDays(codes: string[]): string {
  const names = codes.map((c) => {
    const m = /^(-?\d)?([A-Z]{2})$/.exec(c);
    if (!m || !WEEKDAY_CODES.includes(m[2] as WeekdayCode)) return c;
    return m[1] ? nthWeekday(Number(m[1]), m[2] as WeekdayCode) : dayName(m[2] as WeekdayCode);
  });
  return new Intl.ListFormat(intlLocale(), { style: "long", type: "conjunction" }).format(names);
}

/** Descripción legible: "Cada 2 semanas el lunes y miércoles, 10 veces". */
export function describeRule(rule: string | null | undefined, start: Date, allDay: boolean): string {
  const p = parseRule(rule);
  if (!p) return t("No se repite");
  const n = p.interval;
  let text = {
    DAILY: () => tp(n, "Cada día", "Cada {n} días"),
    WEEKLY: () => tp(n, "Cada semana", "Cada {n} semanas"),
    MONTHLY: () => tp(n, "Cada mes", "Cada {n} meses"),
    YEARLY: () => tp(n, "Cada año", "Cada {n} años"),
  }[p.freq]();
  const weekdays = "MO,TU,WE,TH,FR";
  if (p.freq === "WEEKLY" && p.byDay.join(",") === weekdays && n === 1) text = t("Cada día laborable");
  else if (p.byDay.length) text = t("{base} el {days}", { base: text, days: joinDays(p.byDay) });
  else if (p.byMonthDay.length) text = t("{base} el día {days}", { base: text, days: p.byMonthDay.join(", ") });
  else if (p.freq === "WEEKLY") text = t("{base} el {days}", { base: text, days: dayName(weekdayCode(start)) });
  else if (p.freq === "YEARLY") text = t("{base} el {date}", { base: text, date: dayMonth(start) });
  if (p.count) text = tp(p.count, "{base}, {n} vez", "{base}, {n} veces", { base: text });
  else if (p.until) {
    const d = untilToDate(p.until, allDay);
    if (d)
      text = t("{base}, hasta el {date}", {
        base: text,
        date: new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "short", year: "numeric" }).format(d),
      });
  }
  return text;
}

export const REMINDER_PRESETS_TIMED = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
export const REMINDER_PRESETS_ALL_DAY = [0, 900, 1440, 2880, 10080];

/** "30 minutos antes", "1 hora antes", "El día anterior a las 9:00"… */
export function describeReminder(minutes: number, allDay: boolean): string {
  if (allDay) {
    if (minutes === 0) return t("El mismo día (00:00)");
    if (minutes === 900) return t("El día anterior a las 9:00");
  }
  if (minutes === 0) return t("Al empezar");
  if (minutes < 60) return tp(minutes, "{n} minuto antes", "{n} minutos antes");
  if (minutes < 1440) {
    const h = minutes / 60;
    return Number.isInteger(h)
      ? tp(h, "{n} hora antes", "{n} horas antes")
      : t("{h} h {m} min antes", { h: Math.floor(h), m: minutes % 60 });
  }
  if (minutes % 10080 === 0) return tp(minutes / 10080, "{n} semana antes", "{n} semanas antes");
  return tp(Math.round(minutes / 1440), "{n} día antes", "{n} días antes");
}
