import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventPanel } from "@/features/events/EventPanel";
import { SearchBox } from "@/features/search/SearchBox";
import { TaskPanel } from "@/features/tasks/TaskPanel";
import { useSelectedEvent } from "@/stores/eventStore";
import { usePrefsStore } from "@/stores/prefsStore";
import { useUiStore } from "@/stores/uiStore";
import { msg, t } from "@/i18n";

const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: msg("Menú de comandos y búsqueda"), keys: ["Ctrl", "K"] },
  { label: msg("Crear evento escribiendo"), keys: ["N"] },
  { label: msg("Ir a la fecha…"), keys: ["."] },
  { label: msg("Nueva tarea"), keys: ["Shift", "C"] },
  { label: msg("Ir a hoy"), keys: ["T"] },
  { label: msg("Mostrar/ocultar barra lateral"), keys: ["`"] },
  { label: msg("Deshacer"), keys: ["Ctrl", "Z"] },
  { label: msg("Bloquear Chronos"), keys: ["Ctrl", "L"] },
];

/** Panel derecho: buscador + detalles del evento o de la tarea, o atajos útiles. */
export function RightPanel() {
  const selectedId = useUiStore((s) => s.selectedEventId);
  const selected = useSelectedEvent(selectedId);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const setPrefs = usePrefsStore((s) => s.set);

  return (
    <aside className="flex w-[290px] shrink-0 flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-1 pl-1 pr-2.5">
        <div className="min-w-0 flex-1">
          <SearchBox />
        </div>
        <Button variant="ghost" size="icon" onClick={() => setPrefs({ rightPanelOpen: false })} aria-label={t("Ocultar panel")} title={t("Ocultar panel")}>
          <PanelRight />
        </Button>
      </div>
      {selectedId && selected ? (
        <EventPanel />
      ) : selectedTaskId ? (
        <TaskPanel />
      ) : (
        <div className="px-4 pt-6">
          <h2 className="pb-2 text-[13px] font-semibold text-strong">{t("Atajos útiles")}</h2>
          <ul className="space-y-1">
            {SHORTCUTS.map((s) => (
              <li key={s.label} className="flex h-6 items-center justify-between text-[12px] text-muted">
                <span>{t(s.label)}</span>
                <span className="flex gap-1">
                  {s.keys.map((k) => (
                    <kbd key={k} className="kbd">
                      {k}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
            <li>
              <button className="flex h-6 w-full items-center justify-between text-[12px] text-muted hover:text-strong" onClick={() => setShortcutsOpen(true)}>
                <span>{t("Todos los atajos de teclado")}</span>
                <kbd className="kbd">?</kbd>
              </button>
            </li>
          </ul>
        </div>
      )}
    </aside>
  );
}
