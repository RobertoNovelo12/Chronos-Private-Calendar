import { errorMessage } from "@/lib/ipc";
import { todayAllDay } from "@/lib/tasks";
import { usePrefsStore } from "@/stores/prefsStore";
import { useTaskStore } from "@/stores/taskStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import type { NewTask } from "@/types/domain";
import { t as tr } from "@/i18n";

/**
 * Crea una tarea «Nueva tarea» y la abre en el panel con el título seleccionado
 * para escribir encima. Por defecto vence hoy (todo el día).
 */
export async function createTask(input: Partial<NewTask> = {}) {
  try {
    const t = await useTaskStore.getState().create({
      title: tr("Nueva tarea"),
      dueAt: todayAllDay(),
      isAllDay: true,
      ...input,
    });
    usePrefsStore.getState().set({ rightPanelOpen: true });
    useUiStore.getState().selectTask(t.id, true);
    return t;
  } catch (e) {
    toast.error(errorMessage(e));
    return null;
  }
}

/** Elimina sin preguntar y ofrece «Deshacer» durante unos segundos. */
export async function deleteTask(id: string) {
  try {
    const removed = await useTaskStore.getState().remove(id);
    if (useUiStore.getState().selectedTaskId === id) useUiStore.getState().selectTask(null);
    toast.info(tr("Tarea eliminada"), {
      label: tr("Deshacer"),
      run: () => {
        useTaskStore
          .getState()
          .restore(removed)
          .catch((e) => toast.error(errorMessage(e)));
      },
    });
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export async function toggleTask(id: string) {
  try {
    await useTaskStore.getState().toggle(id);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
