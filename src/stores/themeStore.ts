import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";

const KEY = "chronos.theme";

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* almacenamiento no disponible: se usa el del sistema */
  }
  return "system";
}

function apply(pref: ThemePreference) {
  const dark =
    pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  cycle: () => void;
}

/**
 * El tema es una preferencia de interfaz no sensible; se guarda en el
 * almacenamiento local del WebView para poder aplicarlo antes de desbloquear.
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: readPreference(),
  setPreference: (preference) => {
    try {
      localStorage.setItem(KEY, preference);
    } catch {
      /* ignorado */
    }
    apply(preference);
    set({ preference });
  },
  cycle: () => {
    const order: ThemePreference[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(get().preference) + 1) % order.length] ?? "system";
    get().setPreference(next);
  },
}));

export function initTheme() {
  apply(useThemeStore.getState().preference);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    apply(useThemeStore.getState().preference);
  });
}
