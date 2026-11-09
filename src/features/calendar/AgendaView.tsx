import { useMemo } from "react";
import { format, isSameDay } from "date-fns";
import { es } from "date-fns/locale";
import { coversDay, formatEventTime } from "@/lib/dates";
import { eventColor } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { useCalendarMap, useNow, useVisibleEvents } from "@/hooks/useCalendarData";
import { useUiStore } from "@/stores/uiStore";

/** Lista de los próximos días con eventos (los días vacíos se omiten). */
export function AgendaView({ days }: { days: Date[] }) {
  const events = useVisibleEvents();
  const calendars = useCalendarMap();
  const selectedId = useUiStore((s) => s.selectedEventId);
  const select = useUiStore((s) => s.select);
  const openContextMenu = useUiStore((s) => s.openContextMenu);
  const now = useNow(60_000);

  const groups = useMemo(
    () =>
      days
        .map((day) => ({
          day,
          items: events
            .filter((e) => coversDay(e, day))
            .sort((a, b) => Number(b.isAllDay) - Number(a.isAllDay) || a.startAt - b.startAt),
        }))
        .filter((g) => g.items.length > 0),
    [days, events],
  );

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-center">
        <div>
          <p className="text-[13px] font-medium">Sin eventos en los próximos {days.length} días</p>
          <p className="mt-1 text-[12px] text-muted">Pulsa C o cambia a la vista Semana para crear uno.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-4">
        {groups.map(({ day, items }) => {
          const today = isSameDay(day, now);
          return (
            <section key={day.getTime()} className="flex gap-6 border-b border-grid py-3 last:border-b-0">
              <div className="w-28 shrink-0 pt-0.5">
                <div className={cn("text-[13px] font-semibold text-strong", today && "text-today")}>
                  {today ? "Hoy" : format(day, "EEEE", { locale: es }).replace(/^./, (c) => c.toUpperCase())}
                </div>
                <div className="text-[12px] text-muted">{format(day, "d 'de' LLLL", { locale: es })}</div>
              </div>
              <ul className="min-w-0 flex-1 space-y-0.5">
                {items.map((e) => {
                  const color = eventColor(e, calendars.get(e.calendarId)?.color);
                  return (
                    <li key={e.id}>
                      <button
                        data-event-key={e.id}
                        onClick={() => select(e.id)}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          openContextMenu({ eventId: e.id, x: ev.clientX, y: ev.clientY });
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover",
                          e.id === selectedId && "bg-surface-hover",
                        )}
                      >
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
                        <span className="w-32 shrink-0 text-[12px] tabular-nums text-muted">{formatEventTime(e)}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">{e.title || "Sin título"}</span>
                        {e.location && <span className="max-w-[30%] truncate text-[12px] text-muted">{e.location}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
