import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { Minus, Plus, PlusIcon } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { TimeZonePicker } from "@/components/ui/timezone-picker";
import { DAY_MS, MINUTE_MS, SNAP_MINUTES, eventStart, formatEventTime, formatHourLabel, formatTime, isAllDayLike, isHour12, snap } from "@/lib/dates";
import { cityName, formatOffsetShort, offsetMinutes, wallTimeIn } from "@/lib/timezones";
import { MIN_VISUAL_MINUTES, eventColor, layoutSpans, layoutTimedEvents } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { useCalendarMap, useCalendarTasks, useNow, useVisibleEvents } from "@/hooks/useCalendarData";
import { createEventAt, eventBlockStyle, shiftedByDays, updateEvent } from "@/features/events/actions";
import { setHoverSlot } from "@/features/events/clipboard";
import { CalendarTaskChip } from "@/features/tasks/CalendarTaskChip";
import { taskOnDay } from "@/lib/tasks";
import { MAX_CUSTOM_DAYS, usePrefsStore } from "@/stores/prefsStore";
import { DRAFT_ID } from "@/stores/eventStore";
import { useUiStore } from "@/stores/uiStore";
import type { CalendarEvent } from "@/types/domain";
import { dateLocale, t } from "@/i18n";

const HOUR_H = 48;
const PX_PER_MIN = HOUR_H / 60;
const DRAG_THRESHOLD = 4;
const LANE_ROW_H = 22;
const LANE_MAX_ROWS = 4;

type Drag =
  | { kind: "create"; anchor: Date; current: Date; moved: boolean; x0: number; y0: number }
  | {
      kind: "move";
      event: CalendarEvent;
      grabOffset: number;
      startAt: number;
      endAt: number;
      moved: boolean;
      x0: number;
      y0: number;
    }
  | { kind: "resize"; event: CalendarEvent; startAt: number; endAt: number; moved: boolean; x0: number; y0: number }
  | { kind: "laneCreate"; anchorIdx: number; currentIdx: number }
  | { kind: "laneMove"; event: CalendarEvent; originIdx: number; delta: number; moved: boolean; x0: number; y0: number };

interface Props {
  days: Date[];
}

/** Vistas Día, 3 días y Semana. */
export function TimeGridView({ days }: Props) {
  const events = useVisibleEvents();
  const calendars = useCalendarMap();
  const { workStartHour, workEndHour, defaultDurationMin, secondaryTimeZone } = usePrefsStore();
  const setPrefs = usePrefsStore((s) => s.set);
  const gutterW = secondaryTimeZone ? 112 : 64;
  const selectedId = useUiStore((s) => s.selectedEventId);
  const select = useUiStore((s) => s.select);
  const setView = useUiStore((s) => s.setView);
  const setAnchor = useUiStore((s) => s.setAnchor);
  const openContextMenu = useUiStore((s) => s.openContextMenu);
  const now = useNow();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [scrollbarW, setScrollbarW] = useState(0);
  const [laneExpanded, setLaneExpanded] = useState(false);
  const n = days.length;

  // Vista previa de la operación en curso.
  const renderEvents = useMemo(() => {
    if (!drag) return events;
    if ((drag.kind === "move" || drag.kind === "resize") && drag.moved) {
      return events.map((e) => (e.id === drag.event.id ? { ...e, startAt: drag.startAt, endAt: drag.endAt } : e));
    }
    if (drag.kind === "laneMove" && drag.moved && drag.delta !== 0) {
      return events.map((e) => (e.id === drag.event.id ? { ...e, ...shiftedByDays(e, drag.delta) } : e));
    }
    return events;
  }, [events, drag]);

  const segments = useMemo(() => layoutTimedEvents(renderEvents, days), [renderEvents, days]);
  const spans = useMemo(() => layoutSpans(renderEvents, days, isAllDayLike), [renderEvents, days]);
  const laneRows = spans.reduce((m, s) => Math.max(m, s.row + 1), 0);
  const visibleLaneRows = laneExpanded ? laneRows : Math.min(laneRows, LANE_MAX_ROWS);
  const hiddenPerDay = useMemo(() => {
    if (laneExpanded) return [];
    return days.map((_, i) => spans.filter((s) => s.row >= LANE_MAX_ROWS && s.startIndex <= i && s.endIndex >= i).length);
  }, [spans, days, laneExpanded]);

  // Desplazamiento inicial: hora actual si hoy es visible; si no, inicio del horario laboral.
  const firstDayKey = days[0]?.getTime();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const todayVisible = days.some((d) => isSameDay(d, new Date()));
    const hour = todayVisible ? Math.max(0, new Date().getHours() - 2) : Math.max(0, workStartHour - 1);
    el.scrollTop = hour * HOUR_H;
    setScrollbarW(el.offsetWidth - el.clientWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDayKey, n]);

  // Esc cancela un arrastre.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrag(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  function pointToTime(clientX: number, clientY: number): Date {
    const r = bodyRef.current!.getBoundingClientRect();
    const idx = Math.min(n - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * n)));
    const minutes = Math.min(24 * 60, Math.max(0, (clientY - r.top) / PX_PER_MIN));
    return new Date(startOfDay(days[idx]!).getTime() + minutes * MINUTE_MS);
  }

  function pointToLaneIdx(clientX: number): number {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * n)));
  }

  const passed = (d: { x0: number; y0: number }, e: ReactPointerEvent) =>
    Math.abs(e.clientX - d.x0) > DRAG_THRESHOLD || Math.abs(e.clientY - d.y0) > DRAG_THRESHOLD;

  // ---- Rejilla horaria ----
  function onBodyPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = pointToTime(e.clientX, e.clientY);
    setDrag({ kind: "create", anchor: t, current: t, moved: false, x0: e.clientX, y0: e.clientY });
  }

  function onEventPointerDown(e: ReactPointerEvent, ev: CalendarEvent, resize: boolean) {
    if (e.button !== 0) return;
    e.stopPropagation();
    bodyRef.current!.setPointerCapture(e.pointerId);
    const base = { event: ev, startAt: ev.startAt, endAt: ev.endAt, moved: false, x0: e.clientX, y0: e.clientY };
    if (resize) setDrag({ kind: "resize", ...base });
    else setDrag({ kind: "move", ...base, grabOffset: pointToTime(e.clientX, e.clientY).getTime() - ev.startAt });
  }

  function onBodyPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    setHoverSlot({ time: snap(pointToTime(e.clientX, e.clientY), "floor").getTime(), allDay: false });
    if (!drag || drag.kind === "laneCreate" || drag.kind === "laneMove") return;
    if (!drag.moved && !passed(drag, e)) return;
    const t = pointToTime(e.clientX, e.clientY);
    if (drag.kind === "create") {
      // Crear arrastrando se limita al día donde empezó el gesto.
      const minutes = (t.getTime() - startOfDay(t).getTime()) / MINUTE_MS;
      const current = new Date(startOfDay(drag.anchor).getTime() + minutes * MINUTE_MS);
      setDrag({ ...drag, current, moved: true });
    } else if (drag.kind === "move") {
      const duration = drag.event.endAt - drag.event.startAt;
      const start = snap(new Date(t.getTime() - drag.grabOffset)).getTime();
      setDrag({ ...drag, startAt: start, endAt: start + duration, moved: true });
    } else {
      const end = Math.max(snap(t).getTime(), drag.event.startAt + SNAP_MINUTES * MINUTE_MS);
      setDrag({ ...drag, endAt: end, moved: true });
    }
  }

  function onBodyPointerUp() {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "create") {
      if (!d.moved && selectedId) {
        // Con un evento abierto, un clic en vacío solo cierra el panel.
        select(null);
      } else if (!d.moved) {
        const start = snap(d.anchor, "floor");
        void createEventAt(start, new Date(start.getTime() + defaultDurationMin * MINUTE_MS), false);
      } else {
        const [a, b] = d.anchor < d.current ? [d.anchor, d.current] : [d.current, d.anchor];
        const start = snap(a, "floor");
        let end = snap(b, "ceil");
        if (end.getTime() - start.getTime() < SNAP_MINUTES * MINUTE_MS) end = new Date(start.getTime() + SNAP_MINUTES * MINUTE_MS);
        void createEventAt(start, end, false);
      }
    } else if (d.kind === "move" || d.kind === "resize") {
      select(d.event.id);
      if (d.moved && (d.startAt !== d.event.startAt || d.endAt !== d.event.endAt)) {
        void updateEvent(d.event.id, d.kind === "move" ? { startAt: d.startAt, endAt: d.endAt } : { endAt: d.endAt }, { fromDrag: true });
      }
    }
  }

  // Clic derecho en un hueco: menú "Crear evento / Pegar evento".
  function onBodyContextMenu(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault();
    if ((e.target as HTMLElement).closest("[data-event-key]")) return;
    const time = snap(pointToTime(e.clientX, e.clientY), "floor").getTime();
    useUiStore.getState().openSlotMenu({ x: e.clientX, y: e.clientY, time, allDay: false });
  }

  function onLaneContextMenu(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault();
    if ((e.target as HTMLElement).closest("[data-event-key], button")) return;
    const time = startOfDay(days[pointToLaneIdx(e.clientX)]!).getTime();
    useUiStore.getState().openSlotMenu({ x: e.clientX, y: e.clientY, time, allDay: true });
  }

  // ---- Franja de día completo ----
  function onLanePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const idx = pointToLaneIdx(e.clientX);
    setDrag({ kind: "laneCreate", anchorIdx: idx, currentIdx: idx });
  }

  function onSpanPointerDown(e: ReactPointerEvent, ev: CalendarEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    laneRef.current!.setPointerCapture(e.pointerId);
    setDrag({ kind: "laneMove", event: ev, originIdx: pointToLaneIdx(e.clientX), delta: 0, moved: false, x0: e.clientX, y0: e.clientY });
  }

  function onLanePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    setHoverSlot({ time: startOfDay(days[pointToLaneIdx(e.clientX)]!).getTime(), allDay: true });
    if (!drag) return;
    if (drag.kind === "laneCreate") {
      setDrag({ ...drag, currentIdx: pointToLaneIdx(e.clientX) });
    } else if (drag.kind === "laneMove") {
      if (!drag.moved && !passed(drag, e)) return;
      setDrag({ ...drag, delta: pointToLaneIdx(e.clientX) - drag.originIdx, moved: true });
    }
  }

  function onLanePointerUp() {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "laneCreate") {
      const a = Math.min(d.anchorIdx, d.currentIdx);
      const b = Math.max(d.anchorIdx, d.currentIdx);
      void createEventAt(days[a]!, addDays(days[b]!, 1), true);
    } else if (d.kind === "laneMove") {
      select(d.event.id);
      if (d.moved && d.delta !== 0) void updateEvent(d.event.id, shiftedByDays(d.event, d.delta), { fromDrag: true });
    }
  }

  const createGhost = drag?.kind === "create" && drag.moved ? ghostRect(drag.anchor, drag.current, days) : null;
  const laneGhost =
    drag?.kind === "laneCreate"
      ? { from: Math.min(drag.anchorIdx, drag.currentIdx), to: Math.max(drag.anchorIdx, drag.currentIdx) }
      : null;
  const tzLabel = format(now, "O");
  const todayVisible = days.some((d) => isSameDay(d, now));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Cabecera de días */}
      <div className="flex shrink-0" style={{ paddingRight: scrollbarW }}>
        <TimeZoneHeader width={gutterW} primaryLabel={tzLabel} secondary={secondaryTimeZone} onChange={(tz) => setPrefs({ secondaryTimeZone: tz })} />
        <div className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          <DaysStepper count={n} />
          {days.map((d) => {
            const today = isSameDay(d, now);
            return (
              <button
                key={d.getTime()}
                onClick={() => {
                  setAnchor(d);
                  setView("day");
                }}
                className={cn(
                  "flex h-8 items-center justify-center gap-[3px] truncate rounded-md text-[13px] hover:bg-surface-hover",
                  today ? "font-semibold text-strong" : "text-muted",
                )}
                title={t("Ver este día")}
              >
                <span>{weekdayLabel(d)}</span>
                <span
                  className={cn(
                    "flex h-[18px] items-center justify-center rounded-[4px] tabular-nums",
                    today && "min-w-[18px] bg-today px-[3px] text-white",
                  )}
                >
                  {format(d, "d")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Franja de día completo */}
      <div className="flex shrink-0 border-b border-grid" style={{ paddingRight: scrollbarW }}>
        <div className="flex shrink-0 items-start justify-end whitespace-nowrap pr-2 pt-[5px] text-[10px] font-medium text-muted" style={{ width: gutterW }}>
          {laneRows > LANE_MAX_ROWS ? (
            <button className="hover:text-foreground" onClick={() => setLaneExpanded((v) => !v)}>
              {laneExpanded ? t("Menos") : t("Más")}
            </button>
          ) : (
            t("Todo el día")
          )}
        </div>
        <div
          ref={laneRef}
          className="relative flex-1 cursor-default"
          style={{ height: Math.max(1, visibleLaneRows) * LANE_ROW_H + 4 + (hiddenPerDay.some((h) => h > 0) ? 16 : 0) }}
          onPointerDown={onLanePointerDown}
          onPointerMove={onLanePointerMove}
          onPointerUp={onLanePointerUp}
          onPointerLeave={() => setHoverSlot(null)}
          onContextMenu={onLaneContextMenu}
          title={t("Haz clic o arrastra para crear un evento de día completo")}
        >
          {days.map((d, i) => (
            <div key={d.getTime()} className="absolute inset-y-0 border-l border-grid" style={{ left: `${(i / n) * 100}%` }} />
          ))}
          {laneGhost && (
            <div
              className="absolute top-1 rounded bg-accent/25"
              style={{ left: `${(laneGhost.from / n) * 100}%`, width: `${((laneGhost.to - laneGhost.from + 1) / n) * 100}%`, height: LANE_ROW_H - 2 }}
            />
          )}
          {spans
            .filter((s) => s.row < visibleLaneRows)
            .map((s) => {
              const color = eventColor(s.event, calendars.get(s.event.calendarId)?.color);
              const selected = s.event.id === selectedId;
              return (
                <div
                  key={s.event.id}
                  data-event-key={s.event.id}
                  onPointerDown={(e) => onSpanPointerDown(e, s.event)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (s.event.id !== DRAFT_ID) openContextMenu({ eventId: s.event.id, x: e.clientX, y: e.clientY });
                  }}
                  className={cn(
                    "absolute flex items-center truncate px-1.5 text-[11.5px] font-medium",
                    s.clippedStart ? "rounded-l-none" : "rounded-l",
                    s.clippedEnd ? "rounded-r-none" : "rounded-r",
                  )}
                  style={{
                    ...eventBlockStyle(color, selected),
                    left: `calc(${(s.startIndex / n) * 100}% + 2px)`,
                    width: `calc(${((s.endIndex - s.startIndex + 1) / n) * 100}% - 4px)`,
                    top: 2 + s.row * LANE_ROW_H,
                    height: LANE_ROW_H - 3,
                  }}
                  title={`${s.event.title || t("Sin título")} · ${formatEventTime(s.event)}`}
                >
                  <span className="truncate">{s.event.title || t("Sin título")}</span>
                </div>
              );
            })}
          {hiddenPerDay.map((h, i) =>
            h > 0 ? (
              <button
                key={i}
                className="absolute bottom-0.5 text-[11px] text-muted hover:text-foreground"
                style={{ left: `calc(${(i / n) * 100}% + 6px)` }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setLaneExpanded(true)}
              >
                {t("+{n} más", { n: h })}
              </button>
            ) : null,
          )}
        </div>
      </div>

      {/* Tareas con fecha en los días visibles */}
      <TaskStrip days={days} gutterW={gutterW} scrollbarW={scrollbarW} />

      {/* Rejilla horaria */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_H }}>
          <div className="relative flex shrink-0" style={{ width: gutterW }}>
            {secondaryTimeZone && (
              <div className="relative w-12 shrink-0">
                {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
                  <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] font-medium tabular-nums text-faint" style={{ top: h * HOUR_H }}>
                    {secondaryHourLabel(days[0]!, h, secondaryTimeZone)}
                  </div>
                ))}
              </div>
            )}
            <div className="relative flex-1">
              {Array.from({ length: 23 }, (_, i) => i + 1).map((h) =>
                todayVisible && Math.abs(nowMinutes - h * 60) < 14 ? null : (
                  <div key={h} className="absolute right-2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-muted" style={{ top: h * HOUR_H }}>
                    {formatHourLabel(h)}
                  </div>
                ),
              )}
              {todayVisible && (
                <div
                  className="absolute right-1 z-40 -translate-y-1/2 rounded-[4px] bg-today px-1 py-px text-[10px] font-semibold tabular-nums text-white"
                  style={{ top: nowMinutes * PX_PER_MIN }}
                >
                  {formatTime(now)}
                </div>
              )}
            </div>
          </div>
          <div
            ref={bodyRef}
            className="relative flex-1"
            onPointerDown={onBodyPointerDown}
            onPointerMove={onBodyPointerMove}
            onPointerUp={onBodyPointerUp}
            onPointerLeave={() => setHoverSlot(null)}
            onContextMenu={onBodyContextMenu}
          >
            {days.map((d, i) => (
              <DayColumn
                key={d.getTime()}
                day={d}
                index={i}
                count={n}
                now={now}
                workStartHour={workStartHour}
                workEndHour={workEndHour}
              />
            ))}
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-grid" style={{ top: h * HOUR_H }} />
            ))}
            {todayVisible && (
              <div className="pointer-events-none absolute inset-x-0 z-[35] h-px bg-today/50" style={{ top: nowMinutes * PX_PER_MIN }} />
            )}

            {segments.map((s) => {
              const color = eventColor(s.event, calendars.get(s.event.calendarId)?.color);
              const selected = s.event.id === selectedId;
              const dragging = drag && "event" in drag && drag.event.id === s.event.id && drag.moved;
              const heightMin = Math.max(s.bottom - s.top, MIN_VISUAL_MINUTES);
              const compact = heightMin < 45;
              const free = s.event.availability === "free";
              return (
                <div
                  key={`${s.event.id}-${s.dayIndex}`}
                  data-event-key={s.event.id}
                  onPointerDown={(e) => onEventPointerDown(e, s.event, false)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (s.event.id !== DRAFT_ID) openContextMenu({ eventId: s.event.id, x: e.clientX, y: e.clientY });
                  }}
                  className={cn(
                    "group absolute overflow-hidden rounded-[4px] px-1.5 text-[11.5px] leading-[1.3]",
                    compact ? "py-0.5" : "py-1",
                    dragging ? "z-30 opacity-90 shadow-lg" : selected ? "z-20 shadow-md" : "z-10",
                    !s.isStart && "rounded-t-none",
                    !s.isEnd && "rounded-b-none",
                  )}
                  style={{
                    ...eventBlockStyle(color, selected),
                    ...(free && !selected ? { background: "var(--background)", boxShadow: `inset 0 0 0 1px ${color}` } : {}),
                    top: s.top * PX_PER_MIN + 1,
                    height: heightMin * PX_PER_MIN - 2,
                    left: `calc(${((s.dayIndex + s.column / s.columns) / n) * 100}% + 2px)`,
                    width: `calc(${(1 / s.columns / n) * 100}% - 4px)`,
                  }}
                >
                  {compact ? (
                    <div className="truncate">
                      <span className="font-semibold">{s.event.title || t("Sin título")}</span>
                      <span className="opacity-80">, {formatTime(eventStart(s.event))}</span>
                    </div>
                  ) : (
                    <>
                      <div className="line-clamp-2 font-semibold">{s.event.title || t("Sin título")}</div>
                      <div className="truncate opacity-80">{formatEventTime(s.event)}</div>
                      {s.event.location && heightMin >= 75 && <div className="truncate opacity-75">{s.event.location}</div>}
                    </>
                  )}
                  {s.isEnd && (
                    <div
                      className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                      onPointerDown={(e) => onEventPointerDown(e, s.event, true)}
                    />
                  )}
                </div>
              );
            })}

            {createGhost && (
              <div
                className="pointer-events-none absolute z-30 rounded-[4px] bg-accent/30 px-1.5 py-1 text-[11.5px] font-semibold text-strong"
                style={{
                  top: createGhost.top * PX_PER_MIN,
                  height: Math.max(createGhost.bottom - createGhost.top, SNAP_MINUTES) * PX_PER_MIN,
                  left: `calc(${(createGhost.dayIndex / n) * 100}% + 2px)`,
                  width: `calc(${(1 / n) * 100}% - 4px)`,
                }}
              >
                {createGhost.label}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  index,
  count,
  now,
  workStartHour,
  workEndHour,
}: {
  day: Date;
  index: number;
  count: number;
  now: Date;
  workStartHour: number;
  workEndHour: number;
}) {
  const today = isSameDay(day, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    <div
      className="pointer-events-none absolute inset-y-0 border-l border-grid"
      style={{ left: `${(index / count) * 100}%`, width: `${100 / count}%` }}
    >
      <div className="absolute inset-x-0 top-0 bg-shade" style={{ height: workStartHour * HOUR_H }} />
      <div className="absolute inset-x-0 bottom-0 bg-shade" style={{ top: workEndHour * HOUR_H }} />
      {today && (
        <div className="absolute inset-x-0 z-40" style={{ top: nowMin * PX_PER_MIN }}>
          <div className="absolute -top-[5px] left-0 h-[11px] w-[2px] rounded-full bg-today" />
          <div className="-mt-px h-[2px] bg-today" />
        </div>
      )}
    </div>
  );
}

/** Etiqueta de la hora `h` del primer día visible en otra zona horaria. */
function secondaryHourLabel(day: Date, h: number, tz: string): string {
  const instant = startOfDay(day).getTime() + h * 3_600_000;
  const w = wallTimeIn(instant, tz);
  if (!isHour12()) return `${w.hour}:${String(w.minute).padStart(2, "0")}`;
  const suffix = w.hour < 12 ? "AM" : "PM";
  const hh = w.hour % 12 || 12;
  return w.minute ? `${hh}:${String(w.minute).padStart(2, "0")}${suffix}` : `${hh}${suffix}`;
}

/** "+" para añadir una segunda zona horaria y etiquetas de las zonas. */
function TimeZoneHeader({
  width,
  primaryLabel,
  secondary,
  onChange,
}: {
  width: number;
  primaryLabel: string;
  secondary: string | null;
  onChange: (tz: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex shrink-0 items-center gap-0.5 pl-1 pr-2 text-[10px] font-medium text-muted" style={{ width }}>
      <button
        ref={ref}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-5 shrink-0 items-center justify-center rounded px-1 hover:bg-surface-hover hover:text-strong",
          secondary ? "w-12 justify-end text-faint" : "w-5",
        )}
        title={secondary ? t("{city} · cambiar o quitar", { city: cityName(secondary) }) : t("Añadir zona horaria")}
        aria-label={secondary ? t("Cambiar segunda zona horaria") : t("Añadir zona horaria")}
      >
        {secondary ? formatOffsetShort(offsetMinutes(secondary)) : <PlusIcon className="size-3" />}
      </button>
      <span className="ml-auto" title={t("Zona horaria del sistema")}>
        {primaryLabel.replace("-", "−")}
      </span>
      <TimeZonePicker
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        selected={secondary}
        onSelect={(tz) => onChange(tz)}
        footer={secondary ? { label: t("Quitar segunda zona horaria"), run: () => onChange(null) } : undefined}
      />
    </div>
  );
}

/** "±": ajustar cuántos días se ven. */
function DaysStepper({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const setPrefs = usePrefsStore((s) => s.set);
  const setView = useUiStore((s) => s.setView);
  const change = (n: number) => {
    const v = Math.max(1, Math.min(MAX_CUSTOM_DAYS, n));
    if (v === 1) setView("day");
    else if (v === 7) setView("week");
    else {
      setPrefs({ customDays: v });
      setView("days");
    }
  };
  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen((v) => !v)}
        className="absolute right-0.5 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded text-[12px] text-muted hover:bg-surface-hover hover:text-strong"
        title={t("Número de días")}
        aria-label={t("Ajustar número de días")}
      >
        ±
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="end" className="flex items-center gap-1 p-1">
        <button
          onClick={() => change(count - 1)}
          disabled={count <= 1}
          className="flex size-7 items-center justify-center rounded-md text-strong hover:bg-surface-hover disabled:opacity-40"
          aria-label={t("Menos días")}
        >
          <Minus className="size-3.5" />
        </button>
        <span className="w-7 text-center text-[13px] font-semibold tabular-nums text-strong">{count}</span>
        <button
          onClick={() => change(count + 1)}
          disabled={count >= MAX_CUSTOM_DAYS}
          className="flex size-7 items-center justify-center rounded-md bg-control text-strong hover:bg-surface-hover disabled:opacity-40"
          aria-label={t("Más días")}
        >
          <Plus className="size-3.5" />
        </button>
      </Popover>
    </>
  );
}

/** "Dom", "Lun"… */
function weekdayLabel(d: Date): string {
  const w = format(d, "EEE", { locale: dateLocale() }).replace(".", "");
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Rectángulo de vista previa al crear arrastrando (limitado al día de inicio). */
function ghostRect(a: Date, b: Date, days: Date[]) {
  const [s, e] = a < b ? [a, b] : [b, a];
  const start = snap(s, "floor");
  let end = snap(e, "ceil");
  const dayIndex = days.findIndex((d) => isSameDay(d, start));
  if (dayIndex < 0) return null;
  const dayStart = startOfDay(start).getTime();
  if (end.getTime() > dayStart + DAY_MS) end = new Date(dayStart + DAY_MS);
  const top = (start.getTime() - dayStart) / MINUTE_MS;
  const bottom = (end.getTime() - dayStart) / MINUTE_MS;
  return { dayIndex, top, bottom, label: `${formatTime(start)} – ${formatTime(end)}` };
}

/** Máximo de tareas por día antes de «+N más». */
const TASKS_MAX_ROWS = 3;

/** Franja «Tareas» bajo la de día completo; solo aparece si hay tareas en los días visibles. */
function TaskStrip({ days, gutterW, scrollbarW }: { days: Date[]; gutterW: number; scrollbarW: number }) {
  const tasks = useCalendarTasks();
  const [expanded, setExpanded] = useState(false);
  const perDay = useMemo(
    () =>
      days.map((d) =>
        tasks
          .filter((t) => taskOnDay(t, d))
          .sort(
            (a, b) =>
              Number(a.completedAt !== null) - Number(b.completedAt !== null) ||
              Number(b.isAllDay) - Number(a.isAllDay) ||
              (a.dueAt ?? 0) - (b.dueAt ?? 0) ||
              b.priority - a.priority,
          ),
      ),
    [tasks, days],
  );
  const most = perDay.reduce((m, l) => Math.max(m, l.length), 0);
  if (most === 0) return null;
  const rows = expanded ? most : Math.min(most, TASKS_MAX_ROWS);
  const n = days.length;

  return (
    <div className="flex shrink-0 border-b border-grid" style={{ paddingRight: scrollbarW }}>
      <div className="flex shrink-0 items-start justify-end whitespace-nowrap pr-2 pt-[5px] text-[10px] font-medium text-muted" style={{ width: gutterW }}>
        {most > TASKS_MAX_ROWS ? (
          <button className="hover:text-foreground" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("Menos") : t("Tareas")}
          </button>
        ) : (
          t("Tareas")
        )}
      </div>
      <div className="grid flex-1 py-0.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {perDay.map((list, i) => {
          const hidden = list.length - rows;
          const shown = hidden > 0 ? list.slice(0, rows - 1) : list.slice(0, rows);
          return (
            <div key={days[i]!.getTime()} className="min-w-0 border-l border-grid px-0.5" style={{ minHeight: rows * 21 }}>
              {shown.map((t) => (
                <CalendarTaskChip key={t.id} task={t} showTime={n <= 7} />
              ))}
              {hidden > 0 && (
                <button className="h-[20px] px-1.5 text-[11px] text-muted hover:text-foreground" onClick={() => setExpanded(true)}>
                  {t("+{n} más", { n: hidden + 1 })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
