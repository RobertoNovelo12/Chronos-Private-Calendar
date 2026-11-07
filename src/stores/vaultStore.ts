import { create } from "zustand";
import { api } from "@/lib/ipc";

type Phase = "loading" | "setup" | "locked" | "unlocked";

interface VaultState {
  phase: Phase;
  /** Error al consultar el estado inicial (p. ej. carpeta de datos inaccesible). */
  bootError: string | null;
  refresh: () => Promise<void>;
  setup: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
}

function phaseOf(s: { initialized: boolean; unlocked: boolean }): Phase {
  if (!s.initialized) return "setup";
  return s.unlocked ? "unlocked" : "locked";
}

export const useVaultStore = create<VaultState>((set) => ({
  phase: "loading",
  bootError: null,
  refresh: async () => {
    try {
      const s = await api.vault.status();
      set({ phase: phaseOf(s), bootError: null });
    } catch (e) {
      set({ bootError: e instanceof Error ? e.message : "No se pudo iniciar" });
    }
  },
  setup: async (password) => {
    const s = await api.vault.setup(password);
    set({ phase: phaseOf(s) });
  },
  unlock: async (password) => {
    const s = await api.vault.unlock(password);
    set({ phase: phaseOf(s) });
  },
  lock: async () => {
    const s = await api.vault.lock();
    set({ phase: phaseOf(s) });
  },
}));
