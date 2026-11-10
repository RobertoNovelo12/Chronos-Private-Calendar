import { create } from "zustand";
import { api } from "@/lib/ipc";
import type { CalendarEvent, EditScope, EventPatch, NewEvent, SeriesSnapshot } from "@/types/domain";

/** Identificador del borrador (evento aún no guardado). */
export const DRAFT_ID = "draft";

/** Operación reversible para deshacer/rehacer. */
interface HistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_HISTORY = 100;

interface EventState {
  events: Record<string, CalendarEvent>;
  /** Evento nuevo que solo existe en pantalla hasta que se modifica algún dato. */
  draft: CalendarEvent | null;
  range: { from: number; to: number } | null;
  loading: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Carga los eventos del rango (sustituye la caché: nunca se carga todo). */
  load: (from: number, to: number) => Promise<void>;
  reload: () => Promise<void>;
  setDraft: (draft: CalendarEvent | null) => void;
  patchDraft: (patch: Partial<CalendarEvent>) => void;
  create: (input: NewEvent) => Promise<CalendarEvent>;
  /** En eventos repetidos `scope` decide el alcance; no se registra en el historial. */
  update: (id: string, patch: EventPatch, scope?: EditScope) => Promise<CalendarEvent>;
  remove: (id: string, scope?: EditScope) => Promise<CalendarEvent>;
  duplicate: (id: string) => Promise<CalendarEvent>;
  undo: () => Promise<string | null>;
  redo: () => Promise<string | null>;
  clear: () => void;
}

export const useEventStore = create<EventState>((set, get) => {
  const upsert = (e: CalendarEvent) => set({ events: { ...get().events, [e.id]: e } });
  const drop = (id: string) => {
    const { [id]: _removed, ...rest } = get().events;
    set({ events: rest });
  };
  const record = (entry: HistoryEntry) =>
    set({ past: [...get().past.slice(-(MAX_HISTORY - 1)), entry], future: [] });

  /**
   * Cambio en una serie: se guarda la serie antes y después. Deshacer borra las
   * raíces de ambos estados y repone el anterior; rehacer, el posterior.
   */
  const recordSeries = async (label: string, before: SeriesSnapshot | null, newRoot: string | null) => {
    if (!before) return;
    const roots = [...new Set([before.root.id, ...(newRoot ? [newRoot] : [])])];
    let after: SeriesSnapshot[];
    try {
      after = await api.events.snapshots(roots);
    } catch {
      return;
    }
    const all = [...new Set([...roots, ...after.map((s) => s.root.id)])];
    const apply = async (snaps: SeriesSnapshot[]) => {
      await api.events.replaceSeries(all, snaps);
      await get().reload();
    };
    record({ label, undo: () => apply([before]), redo: () => apply(after) });
  };
  /** Instantánea previa; si falla no se impide el cambio (solo no se podrá deshacer). */
  const snapshotOf = (id: string) => api.events.snapshot(id).catch(() => null);

  // Operaciones sin registro en el historial (usadas también por deshacer/rehacer).
  const rawUpdate = async (id: string, patch: EventPatch) => {
    const prev = get().events[id];
    if (prev) upsert({ ...prev, ...normalizePatch(patch) });
    try {
      const updated = await api.events.update(id, patch);
      upsert(updated);
      return updated;
    } catch (e) {
      if (prev) upsert(prev);
      throw e;
    }
  };
  const rawRemove = async (id: string) => {
    const removed = await api.events.remove(id);
    drop(id);
    return removed;
  };
  const rawRestore = async (e: CalendarEvent) => {
    const restored = await api.events.restore(e);
    upsert(restored);
    return restored;
  };

  return {
    events: {},
    draft: null,
    range: null,
    loading: false,
    past: [],
    future: [],

    load: async (from, to) => {
      set({ loading: true, range: { from, to } });
      try {
        const list = await api.events.listRange(from, to);
        // Si mientras tanto se pidió otro rango, se descarta esta respuesta.
        const r = get().range;
        if (!r || r.from !== from || r.to !== to) return;
        set({ events: Object.fromEntries(list.map((e) => [e.id, e])) });
      } finally {
        set({ loading: false });
      }
    },

    reload: async () => {
      const r = get().range;
      if (r) await get().load(r.from, r.to);
    },

    setDraft: (draft) => set({ draft }),
    patchDraft: (patch) => {
      const d = get().draft;
      if (d) set({ draft: { ...d, ...patch } });
    },

    create: async (input) => {
      const created = await api.events.create(input);
      if (created.isRecurring) {
        await get().reload();
        return created;
      }
      upsert(created);
      record({
        label: "crear evento",
        undo: async () => void (await rawRemove(created.id)),
        redo: async () => void (await rawRestore(created)),
      });
      return created;
    },

    update: async (id, patch, scope) => {
      const prev = get().events[id];
      if (!prev) throw new Error("El evento no está cargado en la vista actual");
      if (prev.isRecurring || patch.recurrence) {
        // Las series se recalculan en el backend: se recarga el rango visible.
        const before = await snapshotOf(id);
        const updated = await api.events.update(id, patch, scope ?? "this");
        await get().reload();
        // «Este y los siguientes» crea una serie nueva: también es parte del cambio.
        await recordSeries("editar evento repetido", before, updated.recurrenceMasterId ?? updated.id);
        return updated;
      }
      const inverse = inversePatch(prev, patch);
      const updated = await rawUpdate(id, patch);
      record({
        label: "editar evento",
        undo: async () => void (await rawUpdate(id, inverse)),
        redo: async () => void (await rawUpdate(id, patch)),
      });
      return updated;
    },

    remove: async (id, scope) => {
      const prev = get().events[id];
      if (prev?.isRecurring) {
        const before = await snapshotOf(id);
        const removed = await api.events.remove(id, scope ?? "this");
        await get().reload();
        await recordSeries("eliminar evento repetido", before, null);
        return removed;
      }
      const removed = await rawRemove(id);
      record({
        label: "eliminar evento",
        undo: async () => void (await rawRestore(removed)),
        redo: async () => void (await rawRemove(removed.id)),
      });
      return removed;
    },

    duplicate: async (id) => {
      const copy = await api.events.duplicate(id);
      upsert(copy);
      record({
        label: "duplicar evento",
        undo: async () => void (await rawRemove(copy.id)),
        redo: async () => void (await rawRestore(copy)),
      });
      return copy;
    },

    undo: async () => {
      const entry = get().past.at(-1);
      if (!entry) return null;
      await entry.undo();
      set({ past: get().past.slice(0, -1), future: [...get().future, entry] });
      return entry.label;
    },

    redo: async () => {
      const entry = get().future.at(-1);
      if (!entry) return null;
      await entry.redo();
      set({ future: get().future.slice(0, -1), past: [...get().past, entry] });
      return entry.label;
    },

    clear: () => set({ events: {}, draft: null, range: null, past: [], future: [] }),
  };
});

/** Aplica un patch al objeto local (para la actualización optimista). */
function normalizePatch(patch: EventPatch): Partial<CalendarEvent> {
  const { color, recurrence, ...rest } = patch;
  const out: Partial<CalendarEvent> = { ...rest };
  if (color !== undefined) out.color = color === "" ? null : color;
  if (recurrence !== undefined) out.recurrence = recurrence === "" ? null : recurrence;
  return out;
}

/** Patch que devuelve el evento a su estado anterior en los campos tocados. */
function inversePatch(prev: CalendarEvent, patch: EventPatch): EventPatch {
  const inv: EventPatch = {};
  for (const key of Object.keys(patch) as (keyof EventPatch)[]) {
    if (key === "color") inv.color = prev.color ?? "";
    else if (key === "recurrence") inv.recurrence = prev.recurrence ?? "";
    else (inv as Record<string, unknown>)[key] = prev[key as keyof CalendarEvent];
  }
  return inv;
}

/** Evento seleccionado (incluido el borrador). */
export function useSelectedEvent(selectedId: string | null): CalendarEvent | undefined {
  return useEventStore((s) => (selectedId === DRAFT_ID ? (s.draft ?? undefined) : selectedId ? s.events[selectedId] : undefined));
}
