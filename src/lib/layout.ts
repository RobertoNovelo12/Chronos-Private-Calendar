// Algoritmos de disposición de eventos en la rejilla.

import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import type { CalendarEvent } from "@/types/domain";
import { eventEnd, eventStart, isAllDayLike, minutesFromDayStart } from "./dates";

/** Altura mínima visual (en minutos) de un evento corto o de duración cero. */
export const MIN_VISUAL_MINUTES = 20;

export interface TimedSegment {
  event: CalendarEvent;
  dayIndex: number;
  /** minutos desde medianoche */
  top: number;
  bottom: number;
  /** El segmento contiene el inicio / el fin real del evento. */
  isStart: boolean;
  isEnd: boolean;
  /** Columna y número de columnas del grupo de solapamiento. */
  column: number;
  columns: number;
}

/**
 * Divide los eventos con hora en segmentos por día y calcula columnas para
 * los que se solapan (eventos simultáneos lado a lado).
 */
export function layoutTimedEvents(events: CalendarEvent[], days: Date[]): TimedSegment[] {
  const out: TimedSegment[] = [];
  days.forEach((day, dayIndex) => {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const daySegs: TimedSegment[] = [];
    for (const e of events) {
      if (isAllDayLike(e)) continue;
      const s = eventStart(e);
      const en = eventEnd(e);
      const zero = s.getTime() === en.getTime();
      const overlaps = zero ? s >= dayStart && s < dayEnd : s < dayEnd && en > dayStart;
      if (!overlaps) continue;
      const top = Math.max(0, minutesFromDayStart(s, day));
      const bottom = Math.min(24 * 60, minutesFromDayStart(en, day));
      daySegs.push({
        event: e,
        dayIndex,
        top,
        bottom: Math.max(bottom, top),
        isStart: s >= dayStart,
        isEnd: en <= dayEnd,
        column: 0,
        columns: 1,
      });
    }
    assignColumns(daySegs);
    out.push(...daySegs);
  });
  return out;
}

function assignColumns(segs: TimedSegment[]) {
  segs.sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.event.id.localeCompare(b.event.id));
  let cluster: TimedSegment[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const s of cluster) s.columns = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const s of segs) {
    const visualBottom = Math.max(s.bottom, s.top + MIN_VISUAL_MINUTES);
    if (cluster.length > 0 && s.top >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= s.top);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(visualBottom);
    } else {
      colEnds[col] = visualBottom;
    }
    s.column = col;
    cluster.push(s);
    clusterEnd = cluster.length === 1 ? visualBottom : Math.max(clusterEnd, visualBottom);
  }
  flush();
}

export interface SpanItem {
  event: CalendarEvent;
  startIndex: number;
  /** inclusivo */
  endIndex: number;
  row: number;
  /** Continúa antes / después del rango visible. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Coloca eventos de día completo (y de ≥ 24 h) como barras que abarcan días,
 * asignando filas sin solapes. Sirve para la franja superior y para cada semana del mes.
 */
export function layoutSpans(events: CalendarEvent[], days: Date[], filter: (e: CalendarEvent) => boolean): SpanItem[] {
  if (days.length === 0) return [];
  const first = days[0]!;
  const n = days.length;
  const items: SpanItem[] = [];
  for (const e of events) {
    if (!filter(e)) continue;
    const s = eventStart(e);
    const en = eventEnd(e);
    let startIndex = differenceInCalendarDays(s, first);
    // Fin exclusivo: si termina justo a medianoche, el último día es el anterior.
    const lastDay = en.getTime() === startOfDay(en).getTime() && en > s ? addDays(en, -1) : en;
    let endIndex = differenceInCalendarDays(lastDay, first);
    if (endIndex < 0 || startIndex > n - 1) continue;
    const clippedStart = startIndex < 0;
    const clippedEnd = endIndex > n - 1;
    startIndex = Math.max(0, startIndex);
    endIndex = Math.min(n - 1, endIndex);
    items.push({ event: e, startIndex, endIndex, row: 0, clippedStart, clippedEnd });
  }
  items.sort(
    (a, b) =>
      a.startIndex - b.startIndex ||
      b.endIndex - b.startIndex - (a.endIndex - a.startIndex) ||
      Number(b.event.isAllDay) - Number(a.event.isAllDay) ||
      a.event.startAt - b.event.startAt,
  );
  const rowEnds: number[] = [];
  for (const it of items) {
    let row = rowEnds.findIndex((end) => end < it.startIndex);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(it.endIndex);
    } else {
      rowEnds[row] = it.endIndex;
    }
    it.row = row;
  }
  return items;
}

/** Color efectivo del evento. */
export function eventColor(e: CalendarEvent, calendarColor: string | undefined): string {
  return e.color ?? calendarColor ?? "#6b7280";
}
