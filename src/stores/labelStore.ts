import { create } from "zustand";
import { api } from "@/lib/ipc";
import { useEventStore } from "./eventStore";
import type { Label, LabelPatch, NewLabel } from "@/types/domain";
import { intlLocale } from "@/i18n";

interface LabelState {
  labels: Label[];
  /** Filtro de la barra lateral: solo se muestran eventos con esta etiqueta. */
  filterId: string | null;
  load: () => Promise<void>;
  create: (input: NewLabel) => Promise<Label>;
  update: (id: string, patch: LabelPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setFilter: (id: string | null) => void;
  /** Vacía la caché al bloquear. */
  clear: () => void;
}

const byName = (a: Label, b: Label) => a.name.localeCompare(b.name, intlLocale(), { sensitivity: "base" });

export const useLabelStore = create<LabelState>((set, get) => ({
  labels: [],
  filterId: null,
  load: async () => {
    const labels = await api.labels.list();
    const { filterId } = get();
    set({ labels, filterId: filterId && labels.some((l) => l.id === filterId) ? filterId : null });
  },
  create: async (input) => {
    const label = await api.labels.create(input);
    set({ labels: [...get().labels, label].sort(byName) });
    return label;
  },
  update: async (id, patch) => {
    const updated = await api.labels.update(id, patch);
    set({ labels: get().labels.map((l) => (l.id === id ? updated : l)).sort(byName) });
  },
  remove: async (id) => {
    await api.labels.remove(id);
    set({ labels: get().labels.filter((l) => l.id !== id), filterId: get().filterId === id ? null : get().filterId });
    // Los eventos pierden la etiqueta en la base: se vuelven a leer.
    await useEventStore.getState().reload();
  },
  setFilter: (filterId) => set({ filterId }),
  clear: () => set({ labels: [], filterId: null }),
}));

/** Siguiente color libre de la paleta para una etiqueta nueva. */
export function nextLabelColor(labels: Label[], palette: readonly string[]): string {
  const used = new Set(labels.map((l) => l.color));
  return palette.find((c) => !used.has(c)) ?? palette[labels.length % palette.length]!;
}
