import { HardDriveDownload, HelpCircle, Lock, PanelLeft, Search, Settings, SquarePen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MiniCalendar } from "@/features/calendar/MiniCalendar";
import { CalendarList } from "@/features/calendars/CalendarList";
import { LabelList } from "@/features/labels/LabelList";
import { TaskList } from "@/features/tasks/TaskList";
import { createEventNow } from "@/features/events/actions";
import { api, errorMessage } from "@/lib/ipc";
import type { VisibleRange } from "@/lib/dates";
import { formatBytes } from "@/lib/utils";
import { useCalendarStore } from "@/stores/calendarStore";
import { usePrefsStore } from "@/stores/prefsStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";

/** Barra lateral izquierda: acciones rápidas, mini calendario, calendarios, tareas y etiquetas. */
export function Sidebar({ range, onLock }: { range: VisibleRange; onLock: () => void }) {
  const loaded = useCalendarStore((s) => s.loaded);
  const setPrefs = usePrefsStore((s) => s.set);
  const { setSettingsOpen, setShortcutsOpen } = useUiStore();
  const [backingUp, setBackingUp] = useState(false);

  async function backup() {
    setBackingUp(true);
    try {
      const rec = await api.backup.create();
      toast.info(`Copia cifrada creada (${formatBytes(rec.sizeBytes)})`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <aside className="flex w-[240px] shrink-0 flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center justify-between px-2.5">
        <Button variant="ghost" size="icon" onClick={() => setPrefs({ leftSidebarOpen: false })} aria-label="Ocultar barra lateral" title="Ocultar barra lateral (`)">
          <PanelLeft />
        </Button>
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setPrefs({ rightPanelOpen: true });
              requestAnimationFrame(() => window.dispatchEvent(new Event("chronos:focus-search")));
            }}
            aria-label="Buscar"
            title="Buscar (Ctrl+K)"
          >
            <Search />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void createEventNow()} aria-label="Nuevo evento" title="Nuevo evento (C)">
            <SquarePen />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-3">
        <MiniCalendar range={range} />
        {loaded && <CalendarList onError={(m) => toast.error(m)} />}
        {loaded && <TaskList />}
        {loaded && <LabelList onError={(m) => toast.error(m)} />}
      </div>

      <div className="flex h-11 shrink-0 items-center justify-between px-2.5">
        <Button variant="ghost" size="icon" onClick={() => setShortcutsOpen(true)} aria-label="Atajos de teclado" title="Atajos de teclado (?)">
          <HelpCircle />
        </Button>
        <div className="flex">
          <Button variant="ghost" size="icon" onClick={backup} disabled={backingUp} aria-label="Crear copia de seguridad" title="Crear copia de seguridad cifrada">
            <HardDriveDownload className={backingUp ? "animate-pulse" : undefined} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Configuración" title="Configuración">
            <Settings />
          </Button>
          <Button variant="ghost" size="icon" onClick={onLock} aria-label="Bloquear" title="Bloquear (Ctrl+L)">
            <Lock />
          </Button>
        </div>
      </div>
    </aside>
  );
}
