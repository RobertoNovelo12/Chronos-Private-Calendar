import { Check, ClipboardCopy, Copy, FileDown, PanelRight, Trash2 } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShell } from "@/components/ui/context-menu";
import { api, errorMessage } from "@/lib/ipc";
import { useCalendarStore } from "@/stores/calendarStore";
import { useEventStore } from "@/stores/eventStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import { duplicateEvent, updateEvent } from "./actions";
import { copyEvent } from "./clipboard";

const MOD = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

async function exportOne(id: string, title: string) {
  try {
    const r = await api.data.export("ics", { eventIds: [id] }, title || "evento");
    if (r) toast.info("Evento exportado");
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** Menú contextual (clic derecho) de un evento. */
export function EventContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const event = useEventStore((s) => (menu ? s.events[menu.eventId] : undefined));
  const calendars = useCalendarStore((s) => s.calendars);
  if (!menu || !event) return null;
  const close = () => useUiStore.getState().openContextMenu(null);
  const run = (f: () => void) => () => {
    close();
    f();
  };

  return (
    <ContextMenuShell key={`${menu.eventId}-${menu.x}-${menu.y}`} x={menu.x} y={menu.y} onClose={close}>
      <ContextMenuItem icon={<PanelRight />} label="Abrir detalles" onSelect={run(() => useUiStore.getState().select(event.id))} />
      <ContextMenuItem icon={<ClipboardCopy />} label="Copiar" shortcut={`${MOD}C`} onSelect={run(() => copyEvent(event.id))} />
      <ContextMenuItem icon={<Copy />} label="Duplicar" shortcut={`${MOD}D`} onSelect={run(() => void duplicateEvent(event.id))} />
      <ContextMenuItem icon={<FileDown />} label="Exportar como .ics…" onSelect={run(() => void exportOne(event.id, event.title))} />
      <ContextMenuSeparator />
      <div className="px-2 pb-1 pt-0.5 text-[11px] uppercase tracking-wide text-muted">Mover a</div>
      {calendars.map((c) => (
        <button
          key={c.id}
          role="menuitemradio"
          aria-checked={c.id === event.calendarId}
          className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[13px] hover:bg-surface-hover"
          onClick={run(() => {
            if (c.id !== event.calendarId) void updateEvent(event.id, { calendarId: c.id });
          })}
        >
          <span className="size-2.5 rounded-full" style={{ background: c.color }} />
          <span className="flex-1 truncate">{c.name}</span>
          {c.id === event.calendarId && <Check className="size-3.5 text-muted" />}
        </button>
      ))}
      <ContextMenuSeparator />
      <ContextMenuItem icon={<Trash2 />} label="Eliminar" shortcut="Supr" danger onSelect={() => useUiStore.getState().askDelete(event.id)} />
    </ContextMenuShell>
  );
}
