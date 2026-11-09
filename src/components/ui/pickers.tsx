import { useEffect, useRef, useState } from "react";
import { addDays, addMonths, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MINUTE_MS, formatDuration, formatShortDate, formatTime, monthGridTitle, type WeekStart } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Popover } from "./popover";

const triggerCls =
  "h-7 rounded-md px-1.5 text-[13px] font-medium text-strong hover:bg-surface-hover data-[open=true]:bg-surface-hover";

/** Selector de hora en pasos de 15 minutos. Con `durationFrom` muestra la duración. */
export function TimeSelect({
  value,
  onChange,
  durationFrom,
  label,
}: {
  value: Date;
  onChange: (d: Date) => void;
  durationFrom?: Date;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const day = startOfDay(value);
  const slots = Array.from({ length: 96 }, (_, i) => new Date(day.getTime() + i * 15 * MINUTE_MS));

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>("[data-selected=true]")?.scrollIntoView({ block: "center" });
    });
  }, [open]);

  return (
    <>
      <button ref={ref} className={triggerCls} data-open={open} onClick={() => setOpen((v) => !v)} aria-label={label}>
        {formatTime(value)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} className="w-[190px] p-0">
        <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
          {slots.map((slot) => {
            const disabled = durationFrom ? slot.getTime() <= durationFrom.getTime() : false;
            if (disabled) return null;
            const selected = slot.getTime() === value.getTime();
            return (
              <button
                key={slot.getTime()}
                data-selected={selected}
                onClick={() => {
                  onChange(slot);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-7 w-full items-center justify-between rounded-md px-2 text-[13px] text-strong hover:bg-surface-hover",
                  selected && "bg-surface-hover font-semibold",
                )}
              >
                <span>{formatTime(slot)}</span>
                {durationFrom && <span className="text-[12px] text-muted">{formatDuration(slot.getTime() - durationFrom.getTime())}</span>}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

/** Selector de fecha con calendario mensual. */
export function DateSelect({
  value,
  onChange,
  weekStartsOn,
  label,
}: {
  value: Date;
  onChange: (d: Date) => void;
  weekStartsOn: WeekStart;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(value));
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setMonth(startOfMonth(value));
  }, [open, value]);

  const start = startOfWeek(month, { weekStartsOn });
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = new Date();

  return (
    <>
      <button ref={ref} className={triggerCls} data-open={open} onClick={() => setOpen((v) => !v)} aria-label={label}>
        {formatShortDate(value)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} className="w-[236px] p-2">
        <div className="flex items-center justify-between pb-1">
          <span className="pl-1 text-[13px] font-semibold text-strong">{monthGridTitle(month)}</span>
          <div className="flex">
            <button className="flex size-6 items-center justify-center rounded text-muted hover:bg-surface-hover" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mes anterior">
              <ChevronLeft className="size-4" />
            </button>
            <button className="flex size-6 items-center justify-center rounded text-muted hover:bg-surface-hover" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mes siguiente">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-[10px] font-medium text-muted">
          {cells.slice(0, 7).map((d) => (
            <div key={d.getTime()} className="py-1">
              {format(d, "EEEEEE", { locale: es }).replace(/^./, (c) => c.toUpperCase())}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5 text-center">
          {cells.map((d) => (
            <button
              key={d.getTime()}
              onClick={() => {
                onChange(d);
                setOpen(false);
              }}
              className={cn(
                "mx-auto flex size-7 items-center justify-center rounded-md text-[12px] tabular-nums hover:bg-surface-hover",
                isSameMonth(d, month) ? "text-strong" : "text-faint",
                isSameDay(d, today) && "font-bold text-today",
                isSameDay(d, value) && "bg-accent font-semibold text-white hover:bg-accent",
              )}
            >
              {d.getDate()}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
