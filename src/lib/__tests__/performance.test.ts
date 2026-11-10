// Rendimiento de la disposición de eventos en pantalla (Fase 6): una semana
// muy cargada debe colocarse en pocos milisegundos para no bloquear la interfaz.

import { describe, expect, it } from "vitest";
import { addDays } from "date-fns";
import { localToAllDay } from "../dates";
import { layoutSpans, layoutTimedEvents } from "../layout";
import type { CalendarEvent } from "@/types/domain";

function ev(i: number, start: number, end: number, isAllDay = false): CalendarEvent {
  return {
    id: `e${i}`,
    calendarId: "c",
    title: `Evento ${i}`,
    description: "",
    location: "",
    links: [],
    color: null,
    startAt: start,
    endAt: end,
    timezone: "UTC",
    isAllDay,
    visibility: "default",
    availability: "busy",
    status: "confirmed",
    isRecurring: false,
    recurrenceMasterId: null,
    originalStartAt: null,
    recurrence: null,
    reminders: [],
    labels: [],
    attendees: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("rendimiento de la disposición", () => {
  const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 9 + i));

  it("2 000 eventos con hora en una semana", () => {
    const events = Array.from({ length: 2000 }, (_, i) => {
      const day = days[i % 7]!;
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 6 + (i % 14), (i * 7) % 60).getTime();
      return ev(i, start, start + (15 + (i % 6) * 15) * 60_000);
    });
    const t = performance.now();
    const segs = layoutTimedEvents(events, days);
    const ms = performance.now() - t;
    expect(segs).toHaveLength(2000);
    // Sin solapes dentro de cada columna asignada.
    for (const s of segs) expect(s.column).toBeLessThan(s.columns);
    expect(ms).toBeLessThan(500);
  });

  it("500 eventos de varios días en la franja superior", () => {
    const events = Array.from({ length: 500 }, (_, i) => {
      const s = localToAllDay(addDays(days[0]!, (i % 10) - 2));
      return ev(i, s, s + (1 + (i % 4)) * 86_400_000, true);
    });
    const t = performance.now();
    const spans = layoutSpans(events, days, () => true);
    const ms = performance.now() - t;
    expect(spans.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  });
});
