// Acciones de alto nivel sobre eventos compartidas por vistas, panel y atajos.

import { addDays, addMinutes } from "date-fns";
import { DAY_MS, MINUTE_MS, localToAllDay, snap, systemTimeZone } from "@/lib/dates";
import { errorMessage } from "@/lib/ipc";
import { useCalendarStore } from "@/stores/calendarStore";
import { DRAFT_ID, useEventStore } from "@/stores/eventStore";
import { usePrefsStore } from "@/stores/prefsStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import type { CalendarEvent, EditScope, EventPatch } from "@/types/domain";
import { t } from "@/i18n";

/** Calendario donde se crean los eventos nuevos: el predeterminado si es visible. */
function targetCalendarId(): string | null {
  const cals = useCalendarStore.getState().calendars;
  const cal = cals.find((c) => c.isDefault && c.isVisible) ?? cals.find((c) => c.isVisible) ?? cals[0];
  return cal?.id ?? null;
}

/**
 * Abre un BORRADOR en el panel con el título enfocado. No se guarda nada hasta
 * que el usuario escribe un título o cambia algún dato; si se cierra antes,
 * desaparece. Para día completo, `end` es el día siguiente al último (exclusivo).
 */
export async function createEventAt(start: Date, end: Date, allDay: boolean): Promise<void> {
  const calendarId = targetCalendarId();
  if (!calendarId) {
    toast.error(t("Crea un calendario antes de añadir eventos"));
    return;
  }
  const times = allDay
    ? { startAt: localToAllDay(start), endAt: Math.max(localToAllDay(end), localToAllDay(start) + DAY_MS) }
    : { startAt: start.getTime(), endAt: end.getTime() };
  const now = Date.now();
  // Si había otro borrador, se sustituye.
  useUiStore.getState().select(null);
  useEventStore.getState().setDraft({
    id: DRAFT_ID,
    calendarId,
    title: "",
    description: "",
    location: "",
    links: [],
    color: null,
    timezone: systemTimeZone(),
    isAllDay: allDay,
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
    createdAt: now,
    updatedAt: now,
    ...times,
  });
  useUiStore.getState().select(DRAFT_ID, true);
}

/** Guardado del borrador en curso (para encadenar cambios rápidos). */
let draftSaving: Promise<string | null> | null = null;

async function saveDraft(patch: EventPatch): Promise<string | null> {
  const store = useEventStore.getState();
  const d = store.draft;
  if (!d) return null;
  const merged = { ...d, ...patchToFields(patch) };
  const created = await store.create({
    calendarId: merged.calendarId,
    title: merged.title,
    description: merged.description,
    location: merged.location,
    links: merged.links,
    color: merged.color,
    startAt: merged.startAt,
    endAt: merged.endAt,
    timezone: merged.timezone,
    isAllDay: merged.isAllDay,
    visibility: merged.visibility,
    availability: merged.availability,
    recurrence: merged.recurrence,
    reminders: merged.reminders,
    labels: merged.labels,
    attendees: merged.attendees,
  });
  useEventStore.getState().setDraft(null);
  useUiStore.getState().promoteDraft(created.id);
  return created.id;
}

function patchToFields(patch: EventPatch): Partial<CalendarEvent> {
  const { color, recurrence, ...rest } = patch;
  const out: Partial<CalendarEvent> = { ...rest };
  if (color !== undefined) out.color = color === "" ? null : color;
  if (recurrence !== undefined) out.recurrence = recurrence === "" ? null : recurrence;
  return out;
}

interface UpdateOptions {
  /** Cambio hecho arrastrando en la rejilla: en un borrador solo lo recoloca. */
  fromDrag?: boolean;
}

/**
 * Punto único de edición: guarda borradores, pregunta el alcance en eventos
 * repetidos y mantiene la selección. Devuelve el evento resultante o null.
 */
export async function updateEvent(id: string, patch: EventPatch, opts: UpdateOptions = {}): Promise<CalendarEvent | null> {
  try {
    if (id === DRAFT_ID) {
      if (draftSaving) {
        // Otro cambio ya está guardando el borrador: se aplica al evento resultante.
        const realId = await draftSaving;
        return realId ? updateEvent(realId, patch, opts) : null;
      }
      if (opts.fromDrag) {
        useEventStore.getState().patchDraft(patchToFields(patch));
        return useEventStore.getState().draft;
      }
      draftSaving = saveDraft(patch);
      try {
        const realId = await draftSaving;
        return realId ? (useEventStore.getState().events[realId] ?? null) : null;
      } finally {
        draftSaving = null;
      }
    }

    const store = useEventStore.getState();
    const prev = store.events[id];
    let scope: EditScope | undefined;
    if (prev?.isRecurring) {
      const s = await useUiStore.getState().askScope("edit", patch.recurrence === undefined);
      if (!s) return null;
      scope = s;
    }
    const wasSelected = useUiStore.getState().selectedEventId === id;
    const result = await store.update(id, patch, scope);
    // En series el id puede cambiar (nueva excepción u ocurrencia desplazada).
    if (wasSelected && result.id !== id) useUiStore.getState().select(result.id);
    return result;
  } catch (e) {
    toast.error(errorMessage(e));
    return null;
  }
}

/** Nuevo evento en el día de la vista, a la siguiente franja de 15 minutos. */
export async function createEventNow(): Promise<void> {
  const base = new Date(useUiStore.getState().anchor);
  const now = new Date();
  base.setHours(now.getHours(), now.getMinutes(), 0, 0);
  const start = snap(addMinutes(base, 14), "floor");
  const duration = usePrefsStore.getState().defaultDurationMin * MINUTE_MS;
  await createEventAt(start, new Date(start.getTime() + duration), false);
}

/** Desplaza un evento `delta` días conservando la hora local. */
export function shiftedByDays(e: CalendarEvent, delta: number): { startAt: number; endAt: number } {
  if (e.isAllDay) return { startAt: e.startAt + delta * DAY_MS, endAt: e.endAt + delta * DAY_MS };
  return {
    startAt: addDays(new Date(e.startAt), delta).getTime(),
    endAt: addDays(new Date(e.endAt), delta).getTime(),
  };
}

export async function duplicateEvent(id: string): Promise<void> {
  if (id === DRAFT_ID) return;
  try {
    const copy = await useEventStore.getState().duplicate(id);
    useUiStore.getState().select(copy.id);
    toast.info(t("Evento duplicado"));
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** Elimina tras la confirmación del usuario y ofrece deshacer (también en series). */
export async function deleteEventConfirmed(id: string, scope?: EditScope): Promise<void> {
  try {
    const recurring = useEventStore.getState().events[id]?.isRecurring ?? false;
    await useEventStore.getState().remove(id, scope);
    if (useUiStore.getState().selectedEventId === id) useUiStore.getState().select(null);
    const message = recurring && scope !== "this" ? t("Eventos eliminados") : t("Evento eliminado");
    toast.info(message, { label: t("Deshacer"), run: () => void undo() });
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export async function undo(): Promise<void> {
  try {
    const label = await useEventStore.getState().undo();
    if (label) toast.info(t("Deshecho: {action}", { action: t(label) }));
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export async function redo(): Promise<void> {
  try {
    const label = await useEventStore.getState().redo();
    if (label) toast.info(t("Rehecho: {action}", { action: t(label) }));
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** Estilos de un bloque de evento a partir de su color. */
export function eventBlockStyle(color: string, selected: boolean): React.CSSProperties {
  if (selected) {
    return { background: color, color: "#fff", boxShadow: `0 0 0 1px ${color}` };
  }
  return {
    background: `color-mix(in srgb, ${color} 26%, var(--background))`,
    color: `color-mix(in srgb, ${color} 30%, var(--strong))`,
  };
}
