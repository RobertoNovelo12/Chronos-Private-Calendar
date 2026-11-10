import { addDays } from "date-fns";
import { CircleCheck, ClipboardPaste, Plus } from "lucide-react";
import { createTask } from "@/features/tasks/actions";
import { localToAllDay } from "@/lib/dates";
import { ContextMenuItem, ContextMenuShell } from "@/components/ui/context-menu";
import { MINUTE_MS, snap } from "@/lib/dates";
import { usePrefsStore } from "@/stores/prefsStore";
import { useUiStore } from "@/stores/uiStore";
import { createEventAt } from "./actions";
import { pasteEvent, useClipboard } from "./clipboard";

const MOD = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

/** Menú del clic derecho sobre un hueco vacío: crear o pegar ahí. */
export function SlotContextMenu() {
  const menu = useUiStore((s) => s.slotMenu);
  const copied = useClipboard((s) => s.copied);
  if (!menu) return null;
  const close = () => useUiStore.getState().openSlotMenu(null);

  function create() {
    if (!menu) return;
    close();
    if (menu.allDay) {
      const day = new Date(menu.time);
      void createEventAt(day, addDays(day, 1), true);
    } else {
      const start = snap(new Date(menu.time), "floor");
      void createEventAt(start, new Date(start.getTime() + usePrefsStore.getState().defaultDurationMin * MINUTE_MS), false);
    }
  }

  /** Tarea que vence en ese hueco (día completo en la franja superior o en el Mes). */
  function task() {
    if (!menu) return;
    close();
    if (menu.allDay) void createTask({ dueAt: localToAllDay(new Date(menu.time)), isAllDay: true });
    else void createTask({ dueAt: snap(new Date(menu.time), "floor").getTime(), isAllDay: false });
  }

  function paste() {
    if (!menu || !copied) return;
    close();
    void pasteEvent({ time: menu.time, allDay: menu.allDay });
  }

  return (
    <ContextMenuShell key={`${menu.x}-${menu.y}`} x={menu.x} y={menu.y} onClose={close} keys={{ c: create, "shift+c": task, "mod+v": paste }}>
      <ContextMenuItem icon={<Plus />} label="Crear evento" shortcut="C" onSelect={create} />
      <ContextMenuItem icon={<CircleCheck />} label="Crear tarea" shortcut="⇧C" onSelect={task} />
      <ContextMenuItem
        icon={<ClipboardPaste />}
        label="Pegar evento"
        shortcut={`${MOD}V`}
        disabled={!copied}
        onSelect={paste}
      />
    </ContextMenuShell>
  );
}
