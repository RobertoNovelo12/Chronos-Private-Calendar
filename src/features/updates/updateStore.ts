// Estado de las actualizaciones en línea, compartido por «Acerca de», el menú
// de comandos y la comprobación diaria opcional.
//
// La única conexión de red de Chronos ocurre aquí, y solo cuando el usuario la
// pide (o si activa expresamente la comprobación diaria, desactivada por defecto).

import { create } from "zustand";
import { api, errorMessage } from "@/lib/ipc";
import { usePrefsStore } from "@/stores/prefsStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import type { UpdateInfo } from "@/types/domain";
import { t } from "@/i18n";

export type UpdateStatus = "idle" | "checking" | "latest" | "available" | "installing" | "error";

interface UpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  error: string | null;
  checkedAt: number | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

const LAST_CHECK_KEY = "chronos.updates.lastCheck";
const DAY_MS = 86_400_000;

function rememberCheck(now: number) {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(now));
  } catch {
    /* almacenamiento no disponible */
  }
}

function lastCheck(): number {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY)) || 0;
  } catch {
    return 0;
  }
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  info: null,
  error: null,
  checkedAt: null,
  check: async () => {
    if (get().status === "checking" || get().status === "installing") return;
    set({ status: "checking", error: null });
    try {
      const info = await api.updates.check();
      const now = Date.now();
      rememberCheck(now);
      set({ status: info ? "available" : "latest", info, checkedAt: now });
    } catch (e) {
      set({ status: "error", error: errorMessage(e) });
    }
  },
  install: async () => {
    if (get().status !== "available") return;
    set({ status: "installing", error: null });
    try {
      // Si va bien, la aplicación se reinicia con la versión nueva.
      await api.updates.install();
    } catch (e) {
      set({ status: "error", error: errorMessage(e) });
    }
  },
}));

/** ¿Toca la comprobación diaria? (solo si el usuario la activó). */
export function shouldAutoCheck(enabled: boolean, last: number, now: number): boolean {
  return enabled && now - last >= DAY_MS;
}

/** Comprobación diaria opcional al abrir Chronos; avisa solo si hay versión nueva. */
export async function autoCheckForUpdates(): Promise<void> {
  if (!shouldAutoCheck(usePrefsStore.getState().autoUpdateCheck, lastCheck(), Date.now())) return;
  const store = useUpdateStore.getState();
  await store.check();
  const { status, info } = useUpdateStore.getState();
  if (status === "available" && info) {
    toast.info(t("Hay una versión nueva de Chronos: {version}", { version: info.version }), {
      label: t("Ver"),
      run: () => useUiStore.getState().openSettings("about"),
    });
  } else if (status === "error") {
    // En segundo plano no se molesta con errores de red; quedan visibles en «Acerca de».
    useUpdateStore.setState({ status: "idle", error: null });
  }
}
