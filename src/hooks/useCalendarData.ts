import { useEffect, useMemo, useState } from "react";
import { useCalendarStore } from "@/stores/calendarStore";
import { useEventStore } from "@/stores/eventStore";
import type { Calendar, CalendarEvent } from "@/types/domain";

/** Eventos cargados que pertenecen a calendarios visibles, ordenados por inicio. */
export function useVisibleEvents(): CalendarEvent[] {
  const events = useEventStore((s) => s.events);
  const draft = useEventStore((s) => s.draft);
  const calendars = useCalendarStore((s) => s.calendars);
  return useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.isVisible).map((c) => c.id));
    const list = Object.values(events).filter((e) => visible.has(e.calendarId));
    // El borrador se muestra siempre, aunque su calendario esté oculto.
    if (draft) list.push(draft);
    return list.sort((a, b) => a.startAt - b.startAt || b.endAt - a.endAt);
  }, [events, draft, calendars]);
}

export function useCalendarMap(): Map<string, Calendar> {
  const calendars = useCalendarStore((s) => s.calendars);
  return useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
}

/** Fecha actual, actualizada cada `intervalMs`. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
