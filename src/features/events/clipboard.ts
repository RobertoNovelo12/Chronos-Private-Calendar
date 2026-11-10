// Copiar y pegar eventos dentro de Chronos.
//
// El evento copiado vive solo en la memoria de la aplicación (no en el
// portapapeles del sistema, para que su contenido no salga a otras apps) y se
// borra al bloquear.

import { create } from "zustand";
import { DAY_MS, MINUTE_MS, localToAllDay, snap } from "@/lib/dates";
import { errorMessage } from "@/lib/ipc";
import { useCalendarStore } from "@/stores/calendarStore";
import { DRAFT_ID, useEventStore } from "@/stores/eventStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import type { CalendarEvent } from "@/types/domain";

/** Destino de un pegado: un instante (rejilla horaria) o un día (día completo / mes). */
export interface Slot {
  time: number;
  /** Día sin hora concreta: los eventos con hora conservan la suya. */
  allDay: boolean;
}

export const useClipboard = create<{ copied: CalendarEvent | null }>(() => ({ copied: null }));

let hoverSlot: Slot | null = null;

/** La vista informa de la franja bajo el puntero (destino de Ctrl+V). */
export function setHoverSlot(slot: Slot | null) {
  hoverSlot = slot;
}

export function clearClipboard() {
  useClipboard.setState({ copied: null });
  hoverSlot = null;
}

export function copyEvent(id: string) {
  if (id === DRAFT_ID) return;
  const e = useEventStore.getState().events[id];
  if (!e) return;
  useClipboard.setState({ copied: structuredClone(e) });
  toast.info("Evento copiado");
}

/** Tiempos del evento pegado en `slot`, conservando la duración. */
export function pastedTimes(src: CalendarEvent, slot: Slot): { startAt: number; endAt: number } {
  const day = new Date(slot.time);
  day.setHours(0, 0, 0, 0);
  if (src.isAllDay) {
    const days = Math.max(1, Math.round((src.endAt - src.startAt) / DAY_MS));
    const startAt = localToAllDay(day);
    return { startAt, endAt: startAt + days * DAY_MS };
  }
  const duration = Math.max(0, src.endAt - src.startAt);
  let start: Date;
  if (slot.allDay) {
    const s = new Date(src.startAt);
    start = new Date(day);
    start.setHours(s.getHours(), s.getMinutes(), 0, 0);
  } else {
    start = snap(new Date(slot.time), "floor");
  }
  return { startAt: start.getTime(), endAt: start.getTime() + duration };
}

function defaultSlot(): Slot {
  const base = new Date(useUiStore.getState().anchor);
  const now = new Date();
  base.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return { time: snap(new Date(base.getTime() + 14 * MINUTE_MS), "floor").getTime(), allDay: false };
}

/** Pega el evento copiado como un evento nuevo (sin repetición) y lo selecciona. */
export async function pasteEvent(slot?: Slot): Promise<void> {
  const src = useClipboard.getState().copied;
  if (!src) return;
  const target = slot ?? hoverSlot ?? defaultSlot();
  const cals = useCalendarStore.getState().calendars;
  const calendarId = cals.some((c) => c.id === src.calendarId) ? src.calendarId : (cals.find((c) => c.isDefault) ?? cals[0])?.id;
  if (!calendarId) return;
  try {
    const created = await useEventStore.getState().create({
      calendarId,
      title: src.title,
      description: src.description,
      location: src.location,
      links: src.links,
      color: src.color,
      timezone: src.timezone,
      isAllDay: src.isAllDay,
      visibility: src.visibility,
      availability: src.availability,
      recurrence: null,
      reminders: src.reminders,
      labels: src.labels,
      attendees: src.attendees,
      ...pastedTimes(src, target),
    });
    useUiStore.getState().select(created.id);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
