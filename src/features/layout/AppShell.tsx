import { useCallback, useEffect } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toaster } from "@/components/ui/toaster";
import { CalendarView, useVisibleRange } from "@/features/calendar/CalendarView";
import { deleteEventConfirmed } from "@/features/events/actions";
import { EventContextMenu } from "@/features/events/EventContextMenu";
import { SlotContextMenu } from "@/features/events/SlotContextMenu";
import { clearClipboard } from "@/features/events/clipboard";
import { FloatingEventCard } from "@/features/events/FloatingEventCard";
import { ScopeDialog } from "@/features/events/ScopeDialog";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { ShortcutsDialog } from "@/features/settings/ShortcutsDialog";
import { useAutoLock, useShortcuts } from "@/hooks/useShortcuts";
import { errorMessage } from "@/lib/ipc";
import { useCalendarStore } from "@/stores/calendarStore";
import { useEventStore } from "@/stores/eventStore";
import { usePrefsStore } from "@/stores/prefsStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { RightPanel } from "./RightPanel";
import { Sidebar } from "./Sidebar";

/** Estructura principal: barra lateral + calendario + panel derecho. */
export function AppShell() {
  const lock = useVaultStore((s) => s.lock);
  const { load, clear: clearCalendars, loaded } = useCalendarStore();
  const clearEvents = useEventStore((s) => s.clear);
  const { autoLockMinutes, leftSidebarOpen, rightPanelOpen, timeFormat } = usePrefsStore();
  const confirmDeleteId = useUiStore((s) => s.confirmDeleteId);
  const selectedId = useUiStore((s) => s.selectedEventId);
  const askDelete = useUiStore((s) => s.askDelete);
  const deleting = useEventStore((s) => (confirmDeleteId ? s.events[confirmDeleteId] : undefined));
  const scopeRequest = useUiStore((s) => s.scopeRequest);
  const range = useVisibleRange();

  useEffect(() => {
    load().catch((e) => toast.error(errorMessage(e)));
  }, [load]);

  const onLock = useCallback(async () => {
    try {
      await lock();
      // No deben quedar datos del calendario en la memoria del frontend.
      useUiStore.getState().reset();
      clearClipboard();
      clearCalendars();
      clearEvents();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [lock, clearCalendars, clearEvents]);

  useShortcuts(onLock);
  useAutoLock(autoLockMinutes, onLock);

  // Con el panel derecho oculto, los detalles se abren en una tarjeta flotante.
  const showRight = rightPanelOpen;

  return (
    <div className="flex h-full bg-surface">
      {leftSidebarOpen && <Sidebar range={range} onLock={onLock} />}
      {/* key: el formato horario es global; se vuelve a dibujar al cambiarlo. */}
      {loaded && <CalendarView key={timeFormat} />}
      {showRight && <RightPanel />}
      {!showRight && selectedId && <FloatingEventCard />}

      <EventContextMenu />
      <SlotContextMenu />
      <SettingsDialog />
      <ShortcutsDialog />
      {/* Edición de un evento repetido */}
      <ScopeDialog
        open={scopeRequest !== null}
        kind={scopeRequest?.kind ?? "edit"}
        allowThis={scopeRequest?.allowThis ?? true}
        onResolve={(scope) => scopeRequest?.resolve(scope)}
      />
      {/* Eliminación de un evento repetido */}
      <ScopeDialog
        open={confirmDeleteId !== null && deleting?.isRecurring === true}
        kind="delete"
        allowThis
        onResolve={(scope) => {
          const id = confirmDeleteId;
          askDelete(null);
          if (id && scope) void deleteEventConfirmed(id, scope);
        }}
      />
      <ConfirmDialog
        open={confirmDeleteId !== null && deleting?.isRecurring !== true}
        title="¿Eliminar evento?"
        description={`“${deleting?.title || "Sin título"}” se eliminará de este equipo. Podrás deshacerlo con Ctrl+Z mientras la aplicación siga desbloqueada.`}
        confirmLabel="Eliminar"
        destructive
        onCancel={() => askDelete(null)}
        onConfirm={() => {
          const id = confirmDeleteId;
          askDelete(null);
          if (id) void deleteEventConfirmed(id);
        }}
      />
      <Toaster />
    </div>
  );
}
