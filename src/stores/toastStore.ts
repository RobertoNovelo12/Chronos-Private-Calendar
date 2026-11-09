import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, kind?: Toast["kind"], action?: Toast["action"]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, kind = "info", action) => {
    const id = nextId++;
    // Como máximo 3 avisos a la vez.
    set({ toasts: [...get().toasts.slice(-2), { id, message, kind, action }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 7000 : 5000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  info: (m: string, action?: Toast["action"]) => useToastStore.getState().show(m, "info", action),
  error: (m: string) => useToastStore.getState().show(m, "error"),
};
