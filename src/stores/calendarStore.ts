import { create } from "zustand";
import { api } from "@/lib/ipc";
import { useEventStore } from "./eventStore";
import { useLabelStore } from "./labelStore";
import { useTaskStore } from "./taskStore";
import type { Calendar, CalendarPatch, NewCalendar } from "@/types/domain";

interface CalendarState {
  calendars: Calendar[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (input: NewCalendar) => Promise<Calendar>;
  update: (id: string, patch: CalendarPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  /** Vacía la caché al bloquear: no deben quedar datos en memoria del frontend. */
  clear: () => void;
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  calendars: [],
  loaded: false,
  load: async () => {
    // Etiquetas y tareas se cargan y se vacían junto con los calendarios.
    const [calendars] = await Promise.all([
      api.calendars.list(),
      useLabelStore.getState().load(),
      useTaskStore.getState().load(),
    ]);
    set({ calendars, loaded: true });
  },
  create: async (input) => {
    const cal = await api.calendars.create(input);
    set({ calendars: [...get().calendars, cal] });
    return cal;
  },
  update: async (id, patch) => {
    // Actualización optimista de la visibilidad para que el interruptor responda al instante.
    const prev = get().calendars;
    if (patch.isVisible !== undefined) {
      set({ calendars: prev.map((c) => (c.id === id ? { ...c, isVisible: patch.isVisible! } : c)) });
    }
    try {
      const updated = await api.calendars.update(id, patch);
      set({ calendars: get().calendars.map((c) => (c.id === id ? updated : c)) });
    } catch (e) {
      set({ calendars: prev });
      throw e;
    }
  },
  remove: async (id) => {
    await api.calendars.remove(id);
    // El backend puede reasignar el predeterminado, borra en cascada los eventos
    // y deja sin calendario sus tareas.
    await get().load();
    await useEventStore.getState().reload();
  },
  setDefault: async (id) => {
    await api.calendars.setDefault(id);
    await get().load();
  },
  reorder: async (ids) => {
    const calendars = await api.calendars.reorder(ids);
    set({ calendars });
  },
  clear: () => {
    useLabelStore.getState().clear();
    useTaskStore.getState().clear();
    set({ calendars: [], loaded: false });
  },
}));
