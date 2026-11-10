// Utilidades de fechas. Convenciones (ver docs/DATA_MODEL.md):
//  * Eventos con hora: instantes UTC (ms) que se muestran en la hora local.
//  * Día completo: fechas "flotantes" guardadas como medianoche UTC; se
//    muestran en la misma fecha sea cual sea la zona horaria.

import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getISOWeek,
  getWeek,
  isSameMonth,
  isSameYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { CalendarEvent } from "@/types/domain";
import { dateLocale, getLanguage, intlLocale, t, tp } from "@/i18n";

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;
export const SNAP_MINUTES = 15;

/** "days" = vista personalizada de N días (ver `customDays` en las preferencias). */
export type ViewKind = "day" | "days" | "week" | "month" | "agenda";
export const CUSTOM_DAY_OPTIONS = [2, 3, 4, 5, 6, 7, 10, 14, 15, 21] as const;
export type WeekStart = 0 | 1;

export const AGENDA_DAYS = 60;

/** Zona horaria IANA del sistema. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Medianoche UTC (día completo) → fecha local con el mismo día. */
export function allDayToLocal(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Fecha local → medianoche UTC del mismo día (día completo). */
export function localToAllDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function eventStart(e: Pick<CalendarEvent, "isAllDay" | "startAt">): Date {
  return e.isAllDay ? allDayToLocal(e.startAt) : new Date(e.startAt);
}

/** Fin exclusivo. */
export function eventEnd(e: Pick<CalendarEvent, "isAllDay" | "endAt">): Date {
  return e.isAllDay ? allDayToLocal(e.endAt) : new Date(e.endAt);
}

/** ¿Se dibuja en la franja de día completo? (día completo o ≥ 24 h) */
export function isAllDayLike(e: CalendarEvent): boolean {
  return e.isAllDay || e.endAt - e.startAt >= DAY_MS;
}

/** ¿El evento ocupa parte del día local `day`? */
export function coversDay(e: CalendarEvent, day: Date): boolean {
  const s = eventStart(e).getTime();
  const en = eventEnd(e).getTime();
  const ds = startOfDay(day).getTime();
  const de = addDays(startOfDay(day), 1).getTime();
  if (en === s) return s >= ds && s < de;
  return s < de && en > ds;
}

export interface VisibleRange {
  start: Date;
  /** exclusivo */
  end: Date;
  days: Date[];
}

export function visibleRange(view: ViewKind, anchor: Date, weekStartsOn: WeekStart, customDays = 3): VisibleRange {
  const a = startOfDay(anchor);
  let start: Date;
  let count: number;
  switch (view) {
    case "day":
      start = a;
      count = 1;
      break;
    case "days":
      // Rangos de una semana o más empiezan en el inicio de semana; los cortos, en el día de referencia.
      count = Math.max(2, Math.min(31, customDays));
      start = count >= 7 ? startOfWeek(a, { weekStartsOn }) : a;
      break;
    case "week":
      start = startOfWeek(a, { weekStartsOn });
      count = 7;
      break;
    case "month":
      start = startOfWeek(startOfMonth(a), { weekStartsOn });
      count = 42;
      break;
    case "agenda":
      start = a;
      count = AGENDA_DAYS;
      break;
  }
  const days = Array.from({ length: count }, (_, i) => addDays(start, i));
  return { start, end: addDays(start, count), days };
}

export function shiftAnchor(view: ViewKind, anchor: Date, dir: 1 | -1, customDays = 3): Date {
  switch (view) {
    case "day":
      return addDays(anchor, dir);
    case "days":
      return addDays(anchor, Math.max(2, Math.min(31, customDays)) * dir);
    case "week":
      return addDays(anchor, 7 * dir);
    case "month":
      return addMonths(anchor, dir);
    case "agenda":
      return addDays(anchor, 30 * dir);
  }
}

function cap(s: string): string {
  return s.charAt(0).toLocaleUpperCase(intlLocale()) + s.slice(1);
}

/** Chino, japonés y coreano ordenan año-mes-día: se usa `Intl` en lugar de patrones fijos. */
const cjk = () => ["zh-CN", "ja", "ko"].includes(intlLocale());

/** "Noviembre 2026", "November 2026", "2026年11月". */
export function monthYear(d: Date, short = false): string {
  if (cjk()) return new Intl.DateTimeFormat(intlLocale(), { year: "numeric", month: short ? "short" : "long" }).format(d);
  return cap(format(d, short ? "LLL yyyy" : "LLLL yyyy", { locale: dateLocale() }).replace(".", ""));
}

/** "6 nov", "6 Nov", "11月6日". */
export function dayMonthShort(d: Date): string {
  if (getLanguage() === "es") return format(d, "d MMM", { locale: dateLocale() });
  return new Intl.DateTimeFormat(intlLocale(), { month: "short", day: "numeric" }).format(d);
}

/** Título principal ("Noviembre 2026") según los días visibles. */
export function rangeTitle(view: ViewKind, anchor: Date, range: VisibleRange): string {
  if (view === "month") return monthYear(anchor);
  const first = range.days[0]!;
  const last = range.days[range.days.length - 1]!;
  if (isSameMonth(first, last)) return monthYear(first);
  if (isSameYear(first, last) && !cjk()) {
    return `${cap(format(first, "LLL", { locale: dateLocale() }).replace(".", ""))} – ${monthYear(last, true)}`;
  }
  return `${monthYear(first, true)} – ${monthYear(last, true)}`;
}

/** Número de semana: ISO si la semana empieza en lunes; norteamericano si empieza en domingo. */
export function weekNumber(d: Date, weekStartsOn: WeekStart): number {
  return weekStartsOn === 1 ? getISOWeek(d) : getWeek(d, { weekStartsOn: 0, firstWeekContainsDate: 1 });
}

// Formato horario global (12 h por defecto). Lo actualiza prefsStore.
let hour12 = true;
export function setHour12(v: boolean) {
  hour12 = v;
}
export function isHour12(): boolean {
  return hour12;
}

export function formatTime(d: Date): string {
  if (!hour12) return format(d, "H:mm");
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "AM" : "PM"}`;
}

/** Etiqueta de la rejilla: "5AM" o "5:00". */
export function formatHourLabel(h: number): string {
  if (!hour12) return `${h}:00`;
  if (h === 12) return "12PM";
  return `${h % 12 || 12}${h < 12 ? "AM" : "PM"}`;
}

/** Duración legible: "30 min", "1 h", "1 h 30 min", "2 días". */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / MINUTE_MS);
  if (min < 60) return t("{n} min", { n: min });
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const r = min % 60;
    return r ? t("{h} h {m} min", { h, m: r }) : t("{n} h", { n: h });
  }
  return tp(Math.round(min / (24 * 60)), "{n} día", "{n} días");
}

/** "Vie 6 nov" */
export function formatShortDate(d: Date): string {
  if (cjk()) return new Intl.DateTimeFormat(intlLocale(), { weekday: "short", month: "short", day: "numeric" }).format(d);
  return cap(format(d, "EEE d MMM", { locale: dateLocale() }).replace(/\./g, ""));
}

/** "9:00 – 10:30", o con fechas si cruza días. */
export function formatEventTime(e: CalendarEvent): string {
  const s = eventStart(e);
  const en = eventEnd(e);
  if (e.isAllDay) {
    const days = differenceInCalendarDays(en, s);
    if (days <= 1) return t("Todo el día");
    return `${dayMonthShort(s)} – ${dayMonthShort(addDays(en, -1))}`;
  }
  if (differenceInCalendarDays(en, s) === 0 || (en.getTime() === startOfDay(en).getTime() && differenceInCalendarDays(en, s) === 1)) {
    return `${formatTime(s)} – ${formatTime(en)}`;
  }
  return `${dayMonthShort(s)} ${formatTime(s)} – ${dayMonthShort(en)} ${formatTime(en)}`;
}

/** Redondea al múltiplo de `SNAP_MINUTES` más cercano (o hacia abajo/arriba). */
export function snap(date: Date, mode: "round" | "floor" | "ceil" = "round"): Date {
  const step = SNAP_MINUTES * MINUTE_MS;
  const t = date.getTime();
  const f = mode === "floor" ? Math.floor : mode === "ceil" ? Math.ceil : Math.round;
  // Se ajusta respecto a la medianoche local para que funcione con cualquier desfase horario.
  const dayStart = startOfDay(date).getTime();
  return new Date(dayStart + f((t - dayStart) / step) * step);
}

/** Minutos desde la medianoche local del día dado. */
export function minutesFromDayStart(date: Date, day: Date): number {
  return (date.getTime() - startOfDay(day).getTime()) / MINUTE_MS;
}

export function monthGridTitle(d: Date): string {
  return monthYear(d);
}

export { endOfMonth, startOfMonth };

/** Fecha local → "yyyy-MM-dd" para <input type="date">. */
export function toDateInput(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Fecha local → "HH:mm" para <input type="time">. */
export function toTimeInput(d: Date): string {
  return format(d, "HH:mm");
}

/** Combina valores de <input type=date/time> en una fecha local. */
export function fromInputs(date: string, time = "00:00"): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ¿El idioma escribe el día antes que el mes en fechas numéricas (15/12)? */
export function localeDayFirst(): boolean {
  const parts = new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "numeric" }).formatToParts(new Date(2000, 11, 31));
  return parts.findIndex((p) => p.type === "day") < parts.findIndex((p) => p.type === "month");
}

/** «martes, 15 de diciembre de 2026» en el idioma de la interfaz. */
export function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat(intlLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
}

/** «15 dic 2026» en el idioma de la interfaz. */
export function formatMediumDate(d: Date): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" }).format(d);
}
