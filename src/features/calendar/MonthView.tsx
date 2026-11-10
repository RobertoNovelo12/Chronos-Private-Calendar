import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { addDays, format, isSameDay, isSameMonth } from "date-fns";
import { dayMonthShort, eventStart, formatEventTime, formatTime } from "@/lib/dates";
import { eventColor, layoutSpans } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { CircleCheck } from "lucide-react";
import { useCalendarMap, useCalendarTasks, useNow, useVisibleEvents } from "@/hooks/useCalendarData";
import { taskOnDay } from "@/lib/tasks";
import { createEventAt, eventBlockStyle, shiftedByDays, updateEvent } from "@/features/events/actions";
import { setHoverSlot } from "@/features/events/clipboard";
import { DRAFT_ID } from "@/stores/eventStore";
import { useUiStore } from "@/stores/uiStore";
import type { CalendarEvent } from "@/types/domain";
import { dateLocale, t, tp } from "@/i18n";

const ROW_H = 21;
const HEADER_H = 26;
const DRAG_THRESHOLD = 4;

interface Props {
  days: Date[];
  anchor: Date;
}

interface MoveDrag {
  event: CalendarEvent;
  originCell: number;
  delta: number;
  moved: boolean;
  x0: number;
  y0: number;
}

export function MonthView({ days, anchor }: Props) {
  const events = useVisibleEvents();
  const tasks = useCalendarTasks();
  const calendars = useCalendarMap();
  const selectedId = useUiStore((s) => s.selectedEventId);
  const select = useUiStore((s) => s.select);
  const setAnchor = useUiStore((s) => s.setAnchor);
  const setView = useUiStore((s) => s.setView);
  const openContextMenu = useUiStore((s) => s.openContextMenu);
  const now = useNow(60_000);
  const gridRef = useRef<HTMLDivElement>(null);
  const [rowsFit, setRowsFit] = useState(3);
  const [drag, setDrag] = useState<MoveDrag | null>(null);

  const weeks = useMemo(() => Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)), [days]);

  // Cuántas filas de eventos caben en cada celda según el tamaño de la ventana.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cellH = el.clientHeight / weeks.length;
      setRowsFit(Math.max(1, Math.floor((cellH - HEADER_H - 4) / ROW_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrag(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  const renderEvents = useMemo(() => {
    if (!drag?.moved || drag.delta === 0) return events;
    return events.map((e) => (e.id === drag.event.id ? { ...e, ...shiftedByDays(e, drag.delta) } : e));
  }, [events, drag]);

  function cellAt(clientX: number, clientY: number): number {
    const r = gridRef.current!.getBoundingClientRect();
    const col = Math.min(6, Math.max(0, Math.floor(((clientX - r.left) / r.width) * 7)));
    const row = Math.min(weeks.length - 1, Math.max(0, Math.floor(((clientY - r.top) / r.height) * weeks.length)));
    return row * 7 + col;
  }

  function onChipPointerDown(e: ReactPointerEvent, ev: CalendarEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    gridRef.current!.setPointerCapture(e.pointerId);
    setDrag({ event: ev, originCell: cellAt(e.clientX, e.clientY), delta: 0, moved: false, x0: e.clientX, y0: e.clientY });
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) <= DRAG_THRESHOLD && Math.abs(e.clientY - drag.y0) <= DRAG_THRESHOLD) return;
    setDrag({ ...drag, moved: true, delta: cellAt(e.clientX, e.clientY) - drag.originCell });
  }

  function onPointerUp() {
    const d = drag;
    setDrag(null);
    if (!d) return;
    select(d.event.id);
    if (d.moved && d.delta !== 0) void updateEvent(d.event.id, shiftedByDays(d.event, d.delta), { fromDrag: true });
  }

  function onCellClick(day: Date) {
    if (selectedId) {
      select(null);
      return;
    }
    void createEventAt(day, addDays(day, 1), true);
  }

  function openDay(day: Date) {
    setAnchor(day);
    setView("day");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-grid">
        {weeks[0]!.map((d) => (
          <div key={d.getTime()} className="px-2 py-1.5 text-[12px] text-muted">
            {format(d, "EEE", { locale: dateLocale() }).replace(".", "").replace(/^./, (c) => c.toUpperCase())}
          </div>
        ))}
      </div>
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverSlot(null)}
      >
        {weeks.map((week) => {
          const spans = layoutSpans(renderEvents, week, () => true);
          // Día con más eventos de los que caben: la última fila muestra "+N más".
          const covers = (sp: (typeof spans)[number], i: number) => sp.startIndex <= i && sp.endIndex >= i;
          const overflow = week.map((_, i) => spans.some((sp) => sp.row >= rowsFit && covers(sp, i)));
          const isVisible = (sp: (typeof spans)[number]) =>
            sp.row < rowsFit - 1 ||
            (sp.row === rowsFit - 1 && !overflow.slice(sp.startIndex, sp.endIndex + 1).some(Boolean));
          return (
            <div key={week[0]!.getTime()} className="relative grid grid-cols-7 border-b border-grid last:border-b-0">
              {week.map((d) => {
                const today = isSameDay(d, now);
                return (
                  <div
                    key={d.getTime()}
                    className={cn("border-l border-grid first:border-l-0", !isSameMonth(d, anchor) && "bg-shade")}
                    onClick={() => onCellClick(d)}
                    onPointerEnter={() => setHoverSlot({ time: d.getTime(), allDay: true })}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      useUiStore.getState().openSlotMenu({ x: e.clientX, y: e.clientY, time: d.getTime(), allDay: true });
                    }}
                  >
                    <div className="flex h-[26px] items-center px-1.5">
                      <button
                        className={cn(
                          "flex h-5 min-w-5 items-center justify-center rounded-[4px] px-1 text-[12px] font-medium hover:bg-surface-hover",
                          isSameMonth(d, anchor) ? "text-strong" : "text-faint",
                          today && "bg-today font-semibold text-white hover:bg-today",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          openDay(d);
                        }}
                        title={t("Ver este día")}
                      >
                        {d.getDate() === 1 ? dayMonthShort(d) : d.getDate()}
                      </button>
                      <DayTasksBadge tasks={tasks} day={d} onOpen={() => openDay(d)} />
                    </div>
                  </div>
                );
              })}

              {spans
                .filter(isVisible)
                .map((s) => {
                  const color = eventColor(s.event, calendars.get(s.event.calendarId)?.color);
                  const selected = s.event.id === selectedId;
                  const bar = s.event.isAllDay || s.endIndex > s.startIndex;
                  return (
                    <div
                      key={s.event.id}
                      data-event-key={s.event.id}
                      onPointerDown={(e) => onChipPointerDown(e, s.event)}
                      onClick={(e) => e.stopPropagation()}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (s.event.id !== DRAFT_ID) openContextMenu({ eventId: s.event.id, x: e.clientX, y: e.clientY });
                      }}
                      className={cn(
                        "absolute flex items-center gap-1.5 truncate px-1.5 text-[12px]",
                        bar ? "font-medium" : "hover:bg-surface-hover",
                        bar && (s.clippedStart ? "rounded-l-none" : "rounded-l"),
                        bar && (s.clippedEnd ? "rounded-r-none" : "rounded-r"),
                        !bar && "rounded",
                        selected && !bar && "bg-surface-hover ring-1 ring-border-strong",
                      )}
                      style={{
                        ...(bar ? eventBlockStyle(color, selected) : {}),
                        left: `calc(${(s.startIndex / 7) * 100}% + 3px)`,
                        width: `calc(${((s.endIndex - s.startIndex + 1) / 7) * 100}% - 6px)`,
                        top: HEADER_H + s.row * ROW_H,
                        height: ROW_H - 2,
                      }}
                      title={`${s.event.title || t("Sin título")} · ${formatEventTime(s.event)}`}
                    >
                      {!bar && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />}
                      {!bar && <span className="shrink-0 tabular-nums text-muted">{formatTime(eventStart(s.event))}</span>}
                      <span className="truncate">{s.event.title || t("Sin título")}</span>
                    </div>
                  );
                })}

              {week.map((d, i) => {
                if (!overflow[i]) return null;
                const hidden = spans.filter((sp) => sp.row >= rowsFit - 1 && covers(sp, i)).length;
                return (
                  <button
                    key={`more-${d.getTime()}`}
                    className="absolute rounded px-1.5 text-[11px] font-medium text-muted hover:bg-surface-hover hover:text-foreground"
                    style={{ left: `calc(${(i / 7) * 100}% + 3px)`, top: HEADER_H + rowsFit * ROW_H - ROW_H, height: ROW_H - 2 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openDay(d);
                    }}
                  >
                    {t("+{n} más", { n: hidden })}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tareas pendientes del día en el Mes (las tareas se ven en Día, Semana y Agenda). */
function DayTasksBadge({ tasks, day, onOpen }: { tasks: ReturnType<typeof useCalendarTasks>; day: Date; onOpen: () => void }) {
  const pending = tasks.filter((t) => t.completedAt === null && taskOnDay(t, day));
  if (pending.length === 0) return null;
  return (
    <button
      className="ml-auto flex h-5 items-center gap-1 rounded-[4px] px-1 text-[11px] font-medium text-muted hover:bg-surface-hover hover:text-strong"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={pending.length === 1 ? t("1 tarea: {title}", { title: pending[0]!.title }) : tp(pending.length, "{n} tarea pendiente", "{n} tareas pendientes")}
    >
      <CircleCheck className="size-3" />
      <span className="tabular-nums">{pending.length}</span>
    </button>
  );
}
