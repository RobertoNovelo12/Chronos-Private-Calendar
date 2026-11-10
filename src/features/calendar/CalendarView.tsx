import { useEffect, useMemo } from "react";
import { DAY_MS, rangeTitle, visibleRange, weekNumber, type VisibleRange } from "@/lib/dates";
import { errorMessage } from "@/lib/ipc";
import { useEventStore } from "@/stores/eventStore";
import { usePrefsStore } from "@/stores/prefsStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import { AgendaView } from "./AgendaView";
import { MonthView } from "./MonthView";
import { TimeGridView } from "./TimeGridView";
import { Toolbar } from "./Toolbar";
import { t } from "@/i18n";

export function useVisibleRange(): VisibleRange {
  const view = useUiStore((s) => s.view);
  const anchor = useUiStore((s) => s.anchor);
  const weekStartsOn = usePrefsStore((s) => s.weekStartsOn);
  const customDays = usePrefsStore((s) => s.customDays);
  return useMemo(() => visibleRange(view, anchor, weekStartsOn, customDays), [view, anchor, weekStartsOn, customDays]);
}

/** Área principal: barra superior, título y vista activa. Carga solo el rango visible. */
export function CalendarView() {
  const view = useUiStore((s) => s.view);
  const anchor = useUiStore((s) => s.anchor);
  const weekStartsOn = usePrefsStore((s) => s.weekStartsOn);
  const range = useVisibleRange();
  const load = useEventStore((s) => s.load);

  // Se amplía un día por cada lado: los eventos de día completo son fechas
  // flotantes (medianoche UTC) y pueden caer fuera del rango en horas locales.
  const from = range.start.getTime() - DAY_MS;
  const to = range.end.getTime() + DAY_MS;
  useEffect(() => {
    load(from, to).catch((e) => toast.error(errorMessage(e)));
  }, [from, to, load]);

  const weekRef = view === "month" ? anchor : range.days[0]!;

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <Toolbar />
      <div className="flex shrink-0 items-baseline gap-2 px-5 pb-2.5 pt-1">
        <h1 className="text-[22px] font-bold tracking-tight text-strong">{rangeTitle(view, anchor, range)}</h1>
        {view !== "month" && view !== "agenda" && (
          <span className="text-[12px] font-medium text-muted">{t("Semana {n}", { n: weekNumber(weekRef, weekStartsOn) })}</span>
        )}
      </div>
      {view === "month" ? (
        <MonthView days={range.days} anchor={anchor} />
      ) : view === "agenda" ? (
        <AgendaView days={range.days} />
      ) : (
        <TimeGridView days={range.days} />
      )}
    </main>
  );
}
