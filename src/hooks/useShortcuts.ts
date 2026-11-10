import { useEffect } from "react";
import { MINUTE_MS } from "@/lib/dates";
import { createEventNow, duplicateEvent, redo, undo } from "@/features/events/actions";
import { copyEvent, pasteEvent } from "@/features/events/clipboard";
import { createTask, deleteTask } from "@/features/tasks/actions";
import { usePrefsStore } from "@/stores/prefsStore";
import { useUiStore } from "@/stores/uiStore";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Atajos de teclado globales (no actúan mientras se escribe en un campo). */
export function useShortcuts(onLock: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "l") {
        e.preventDefault();
        onLock();
        return;
      }
      if (mod && key === "k") {
        e.preventDefault();
        window.dispatchEvent(new Event("chronos:focus-search"));
        return;
      }
      if (isTyping(e.target) || ui.settingsOpen || ui.shortcutsOpen || ui.confirmDeleteId || ui.scopeRequest) return;

      if (mod && key === "z") {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        void redo();
        return;
      }
      if (mod && key === "c" && ui.selectedEventId) {
        // Si hay texto seleccionado se respeta la copia normal del texto.
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        copyEvent(ui.selectedEventId);
        return;
      }
      if (mod && key === "v") {
        e.preventDefault();
        void pasteEvent();
        return;
      }
      if (mod && key === "d" && ui.selectedEventId) {
        e.preventDefault();
        void duplicateEvent(ui.selectedEventId);
        return;
      }
      if (mod || e.altKey) return;

      switch (key) {
        case "t":
          ui.today();
          break;
        case "d":
        case "1":
          ui.setView("day");
          break;
        case "w":
        case "0":
          ui.setView("week");
          break;
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9":
          usePrefsStore.getState().set({ customDays: Number(key) });
          ui.setView("days");
          break;
        case "`":
          usePrefsStore.getState().set({ leftSidebarOpen: !usePrefsStore.getState().leftSidebarOpen });
          break;
        case "?":
          ui.setShortcutsOpen(true);
          break;
        case "m":
          ui.setView("month");
          break;
        case "a":
          ui.setView("agenda");
          break;
        case "j":
        case "arrowright":
          ui.step(1);
          break;
        case "k":
        case "arrowleft":
          ui.step(-1);
          break;
        case "c":
          // Shift+C: nueva tarea para hoy.
          void (e.shiftKey ? createTask() : createEventNow());
          break;
        case "/":
          window.dispatchEvent(new Event("chronos:focus-search"));
          break;
        case "delete":
        case "backspace":
          if (ui.selectedEventId) ui.askDelete(ui.selectedEventId);
          else if (ui.selectedTaskId) void deleteTask(ui.selectedTaskId);
          break;
        case "escape":
          if (ui.slotMenu) ui.openSlotMenu(null);
          else if (ui.contextMenu) ui.openContextMenu(null);
          else if (ui.selectedEventId) ui.select(null);
          else if (ui.selectedTaskId) ui.selectTask(null);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLock]);
}

/** Bloquea la aplicación tras `minutes` sin actividad (0 = desactivado). */
export function useAutoLock(minutes: number, onLock: () => void) {
  useEffect(() => {
    if (minutes <= 0) return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last >= minutes * MINUTE_MS) onLock();
    }, 5_000);
    return () => {
      clearInterval(t);
      events.forEach((ev) => window.removeEventListener(ev, bump));
    };
  }, [minutes, onLock]);
}
