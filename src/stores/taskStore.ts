import { create } from "zustand";
import { api } from "@/lib/ipc";
import type { NewTask, Task, TaskPatch } from "@/types/domain";

interface TaskState {
  tasks: Task[];
  load: () => Promise<void>;
  create: (input: NewTask) => Promise<Task>;
  update: (id: string, patch: TaskPatch) => Promise<Task>;
  toggle: (id: string) => Promise<void>;
  /** Elimina y devuelve la tarea (para «Deshacer»). */
  remove: (id: string) => Promise<Task>;
  restore: (task: Task) => Promise<void>;
  removeCompleted: () => Promise<number>;
  /** Vacía la caché al bloquear. */
  clear: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => {
  const replace = (t: Task) => set({ tasks: get().tasks.map((x) => (x.id === t.id ? t : x)) });
  return {
    tasks: [],
    load: async () => set({ tasks: await api.tasks.list() }),
    create: async (input) => {
      const t = await api.tasks.create(input);
      set({ tasks: [...get().tasks, t] });
      return t;
    },
    update: async (id, patch) => {
      const prev = get().tasks.find((t) => t.id === id);
      // Actualización optimista de los campos simples (la casilla responde al instante).
      if (prev) {
        const optimistic: Task = { ...prev };
        if (patch.title !== undefined) optimistic.title = patch.title;
        if (patch.notes !== undefined) optimistic.notes = patch.notes;
        if (patch.priority !== undefined) optimistic.priority = patch.priority as Task["priority"];
        if (patch.completed !== undefined) optimistic.completedAt = patch.completed ? Date.now() : null;
        replace(optimistic);
      }
      try {
        const t = await api.tasks.update(id, patch);
        replace(t);
        return t;
      } catch (e) {
        if (prev) replace(prev);
        throw e;
      }
    },
    toggle: async (id) => {
      const t = get().tasks.find((x) => x.id === id);
      if (t) await get().update(id, { completed: t.completedAt === null });
    },
    remove: async (id) => {
      const removed = await api.tasks.remove(id);
      set({ tasks: get().tasks.filter((t) => t.id !== id) });
      return removed;
    },
    restore: async (task) => {
      const t = await api.tasks.restore(task);
      set({ tasks: [...get().tasks, t] });
    },
    removeCompleted: async () => {
      const n = await api.tasks.removeCompleted();
      set({ tasks: get().tasks.filter((t) => t.completedAt === null) });
      return n;
    },
    clear: () => set({ tasks: [] }),
  };
});
