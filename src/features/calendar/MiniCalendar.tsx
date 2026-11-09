import { useEffect, useState } from "react";
import { addDays, addMonths, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown, ChevronUp } from "lucide-react";
import { monthGridTitle, weekNumber, type VisibleRange } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useCalendarData";
import { usePrefsStore } from "@/stores/prefsStore";
import { useUiStore } from "@/stores/uiStore";

/** Mini calendario mensual con números de semana; resalta los días visibles. */
export function MiniCalendar({ range }: { range: VisibleRange }) {
  const anchor = useUiStore((s) => s.anchor);
  const setAnchor = useUiStore((s) => s.setAnchor);
  const view = useUiStore((s) => s.view);
  const weekStartsOn = usePrefsStore((s) => s.weekStartsOn);
  const showWeekNumbers = usePrefsStore((s) => s.showWeekNumbers);
  const now = useNow(60_000);
  const [month, setMonth] = useState(() => startOfMonth(anchor));

  // Sigue a la vista principal cuando esta cambia de mes.
  useEffect(() => setMonth(startOfMonth(anchor)), [anchor]);

  const start = startOfWeek(month, { weekStartsOn });
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  const highlight = view !== "agenda";
  const inRange = (d: Date) => highlight && d >= range.start && d < range.end;

  return (
    <div className="px-3 pb-3">
      <div className="flex h-7 items-center justify-between">
        <span className="pl-1 text-[12px] font-medium text-muted">{monthGridTitle(month)}</span>
        <div className="flex">
          <button
            className="flex size-6 items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-strong"
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Mes anterior"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            className="flex size-6 items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-strong"
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Mes siguiente"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      </div>
      <table className="w-full border-separate border-spacing-0 text-center">
        <thead>
          <tr className="text-[10px] font-medium text-muted">
            {showWeekNumbers && <th className="w-5" />}
            {weeks[0]!.map((d) => (
              <th key={d.getTime()} className="pb-1 font-medium">
                {format(d, "EEEEEE", { locale: es }).replace(/^./, (c) => c.toUpperCase())}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.getTime()}>
              {showWeekNumbers && (
                <td className="pr-1 text-left text-[10px] tabular-nums text-faint">{weekNumber(week[0]!, weekStartsOn)}</td>
              )}
              {week.map((d, i) => {
                const sel = inRange(d);
                const prevSel = i > 0 && inRange(week[i - 1]!);
                const nextSel = i < 6 && inRange(week[i + 1]!);
                const today = isSameDay(d, now);
                return (
                  <td key={d.getTime()} className="p-0">
                    <div
                      className={cn(
                        "flex h-[26px] items-center justify-center",
                        sel && "bg-control",
                        sel && !prevSel && "rounded-l-md",
                        sel && !nextSel && "rounded-r-md",
                      )}
                    >
                      <button
                        onClick={() => setAnchor(d)}
                        className={cn(
                          "flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] px-0.5 text-[12px] tabular-nums",
                          isSameMonth(d, month) ? "font-semibold text-strong" : "text-faint",
                          !today && "hover:bg-surface-hover",
                          today && "bg-today text-white",
                        )}
                        aria-label={format(d, "d 'de' LLLL yyyy", { locale: es })}
                      >
                        {d.getDate()}
                      </button>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
