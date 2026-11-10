import { useEffect, useMemo, useState } from "react";
import { useCalendarStore } from "@/stores/calendarStore";
import { useEventStore } from "@/stores/eventStore";
import { useLabelStore } from "@/stores/labelStore";
import { useTaskStore } from "@/stores/taskStore";
import type { Calendar, CalendarEvent, Task } from "@/types/domain";

/** Eventos cargados de calendarios visibles (y con la etiqueta filtrada, si la hay), ordenados por inicio. */
export function useVisibleEvents(): CalendarEvent[] {
  const events = useEventStore((s) => s.events);
  const draft = useEventStore((s) => s.draft);
  const calendars = useCalendarStore((s) => s.calendars);
  const labelFilter = useLabelStore((s) => s.filterId);
  return useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.isVisible).map((c) => c.id));
    const list = Object.values(events).filter(
      (e) => visible.has(e.calendarId) && (!labelFilter || e.labels.includes(labelFilter)),
    );
    // El borrador se muestra siempre, aunque su calendario esté oculto.
    if (draft) list.push(draft);
    return list.sort((a, b) => a.startAt - b.startAt || b.endAt - a.endAt);
  }, [events, draft, calendars, labelFilter]);
}

/**
 * Tareas con fecha que se dibujan en el calendario: las sin calendario o de
 * calendarios visibles. Con un filtro de etiqueta activo no se muestran
 * (las tareas no llevan etiquetas).
 */
export function useCalendarTasks(): Task[] {
  const tasks = useTaskStore((s) => s.tasks);
  const calendars = useCalendarStore((s) => s.calendars);
  const labelFilter = useLabelStore((s) => s.filterId);
  return useMemo(() => {
    if (labelFilter) return [];
    const hidden = new Set(calendars.filter((c) => !c.isVisible).map((c) => c.id));
    return tasks.filter((t) => t.dueAt !== null && !(t.calendarId && hidden.has(t.calendarId)));
  }, [tasks, calendars, labelFilter]);
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
