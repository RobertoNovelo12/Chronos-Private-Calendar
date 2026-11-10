import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronUp, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateSelect } from "@/components/ui/pickers";
import { MenuItem, MenuSeparator, Popover } from "@/components/ui/popover";
import type { WeekStart } from "@/lib/dates";
import {
  WEEKDAY_CODES,
  dayName,
  nthWeekday,
  buildRule,
  describeRule,
  nthWeekdayOfMonth,
  parseRule,
  presets,
  untilEndOfDay,
  untilToDate,
  weekdayCode,
  type Freq,
  type RuleParts,
} from "@/lib/rrule";
import { cn } from "@/lib/utils";
import { dateLocale, t, tp } from "@/i18n";

/** Inicial corta del día en el idioma activo ("Lu", "Mo", "一"…). */
const dayShort = (i: number) => format(new Date(1970, 0, 4 + i), "EEEEEE", { locale: dateLocale() });

interface Props {
  rule: string | null;
  start: Date;
  allDay: boolean;
  weekStartsOn: WeekStart;
  /** "" quita la repetición. */
  onChange: (rule: string) => void;
  /** "chip": texto compacto "Repetir"; "row": fila con icono y resumen. */
  variant: "row" | "chip";
}

export function RepeatPicker({ rule, start, allDay, weekStartsOn, onChange, variant }: Props) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const isPreset = !!rule && presets(start).some((p) => p.rule === rule);
  const choose = (r: string) => {
    setOpen(false);
    setDialog(false);
    if (r !== (rule ?? "")) onChange(r);
  };

  return (
    <>
      {variant === "chip" ? (
        <button ref={ref} onClick={() => setOpen((v) => !v)} className="h-7 rounded-md px-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-strong">
          {t("Repetir")}
        </button>
      ) : (
        <button
          ref={ref}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex h-7 min-w-0 items-center rounded-md px-1.5 text-left text-[13px] hover:bg-surface-hover",
            rule ? "text-strong" : "text-muted",
          )}
        >
          <span className="truncate">{rule ? describeRule(rule, start, allDay) : t("Repetir")}</span>
        </button>
      )}
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} className="w-[260px]">
        <MenuItem onClick={() => choose("")}>
          <span className="w-3.5">{!rule && <Check className="size-3.5" />}</span>
          {t("No se repite")}
        </MenuItem>
        <MenuSeparator />
        {presets(start).map((p) => (
          <MenuItem key={p.rule} onClick={() => choose(p.rule)}>
            <span className="w-3.5">{rule === p.rule && <Check className="size-3.5" />}</span>
            {p.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          onClick={() => {
            setOpen(false);
            setDialog(true);
          }}
        >
          <span className="w-3.5">{rule && !isPreset && <Check className="size-3.5" />}</span>
          {t("Personalizar…")}
        </MenuItem>
      </Popover>
      {dialog && (
        <RepeatDialog
          initial={parseRule(rule)}
          start={start}
          allDay={allDay}
          weekStartsOn={weekStartsOn}
          onCancel={() => setDialog(false)}
          onDone={choose}
        />
      )}
    </>
  );
}

/** Icono de la fila de repetición (para el panel). */
export function RepeatIcon() {
  return <Repeat className="size-4" />;
}

function NumberField({ value, onChange, min, max, disabled, label }: { value: number; onChange: (n: number) => void; min: number; max: number; disabled?: boolean; label: string }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className={cn("flex h-8 items-center rounded-md bg-control pl-2", disabled && "opacity-50")}>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          if (Number.isFinite(n) && n > 0) onChange(clamp(n));
        }}
        className="w-8 bg-transparent text-[13px] tabular-nums text-strong focus:outline-none"
      />
      <div className="flex flex-col pr-0.5">
        <button type="button" disabled={disabled} onClick={() => onChange(clamp(value + 1))} className="flex h-3.5 w-4 items-center justify-center text-muted hover:text-strong" aria-label={t("Aumentar")}>
          <ChevronUp className="size-3" />
        </button>
        <button type="button" disabled={disabled} onClick={() => onChange(clamp(value - 1))} className="flex h-3.5 w-4 items-center justify-center text-muted hover:text-strong" aria-label={t("Disminuir")}>
          <ChevronDown className="size-3" />
        </button>
      </div>
    </div>
  );
}

/** Diálogo "Repetir": Cada · En · Termina. */
function RepeatDialog({
  initial,
  start,
  allDay,
  weekStartsOn,
  onDone,
  onCancel,
}: {
  initial: RuleParts | null;
  start: Date;
  allDay: boolean;
  weekStartsOn: WeekStart;
  onDone: (rule: string) => void;
  onCancel: () => void;
}) {
  const nth = nthWeekdayOfMonth(start);
  const wd = weekdayCode(start);
  const [freq, setFreq] = useState<Freq>(initial?.freq ?? "WEEKLY");
  const [interval, setIntervalN] = useState(initial?.interval ?? 1);
  const [days, setDays] = useState<string[]>(
    initial?.freq === "WEEKLY" && initial.byDay.length ? initial.byDay.filter((d) => /^[A-Z]{2}$/.test(d)) : [wd],
  );
  const [monthly, setMonthly] = useState<"day" | "nth">(initial?.freq === "MONTHLY" && initial.byDay.length ? "nth" : "day");
  const [end, setEnd] = useState<"never" | "until" | "count">(initial?.count ? "count" : initial?.until ? "until" : "never");
  const [untilDate, setUntilDate] = useState<Date>(
    (initial?.until && untilToDate(initial.until, allDay)) || new Date(start.getFullYear(), start.getMonth(), start.getDate() + 28),
  );
  const [count, setCount] = useState(initial?.count ?? 4);

  const order = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
  const valid = freq !== "WEEKLY" || days.length > 0;

  function done() {
    if (!valid) return;
    onDone(
      buildRule({
        freq,
        interval,
        byDay: freq === "WEEKLY" ? WEEKDAY_CODES.filter((c) => days.includes(c)) : freq === "MONTHLY" && monthly === "nth" ? [`${nth}${wd}`] : [],
        byMonthDay: freq === "MONTHLY" && monthly === "day" ? [start.getDate()] : [],
        count: end === "count" ? count : undefined,
        until: end === "until" ? untilEndOfDay(untilDate, allDay) : undefined,
      }),
    );
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const label = "w-16 shrink-0 text-[13px] text-strong";
  const unitNames: Record<Freq, string> = {
    DAILY: tp(interval, "día", "días"),
    WEEKLY: tp(interval, "semana", "semanas"),
    MONTHLY: tp(interval, "mes", "meses"),
    YEARLY: tp(interval, "año", "años"),
  };

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40" onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="repeat-title"
        className="w-[400px] rounded-xl border border-border-strong bg-popover p-6 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="repeat-title" className="mb-5 text-[16px] font-semibold text-strong">
          {t("Repetir")}
        </h2>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className={label}>{t("Cada")}</span>
            <NumberField value={interval} onChange={setIntervalN} min={1} max={999} label={t("Intervalo")} />
            <div className="relative">
              <select
                value={freq}
                onChange={(e) => setFreq(e.target.value as Freq)}
                className="h-8 appearance-none rounded-md bg-control pl-2.5 pr-7 text-[13px] text-strong focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {(Object.keys(unitNames) as Freq[]).map((f) => (
                  <option key={f} value={f}>
                    {unitNames[f]}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            </div>
          </div>

          {freq === "WEEKLY" && (
            <div className="flex items-center gap-2">
              <span className={label}>{t("En")}</span>
              <div className="flex gap-1.5" role="group" aria-label={t("Días de la semana")}>
                {order.map((i) => {
                  const code = WEEKDAY_CODES[i]!;
                  const on = days.includes(code);
                  return (
                    <button
                      key={code}
                      onClick={() => setDays(on ? days.filter((d) => d !== code) : [...days, code])}
                      aria-pressed={on}
                      aria-label={dayName(code)}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-[11px] font-semibold",
                        on ? "bg-accent text-white" : "bg-control text-muted hover:text-strong",
                      )}
                    >
                      {dayShort(i)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {freq === "MONTHLY" && (
            <div className="flex items-center gap-2">
              <span className={label}>{t("El")}</span>
              <select
                value={monthly}
                onChange={(e) => setMonthly(e.target.value as "day" | "nth")}
                className="h-8 rounded-md bg-control px-2.5 text-[13px] text-strong focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="day">{t("día {n} de cada mes", { n: start.getDate() })}</option>
                <option value="nth">{t("{nth} de cada mes", { nth: nthWeekday(nth, WEEKDAY_CODES[start.getDay()]!) })}</option>
              </select>
            </div>
          )}

          <div>
            <div className="mb-2 text-[13px] text-strong">{t("Termina")}</div>
            <div className="space-y-2.5">
              <label className="flex h-8 items-center gap-2.5 text-[13px] text-strong">
                <input type="radio" className="radio" checked={end === "never"} onChange={() => setEnd("never")} />
                {t("Nunca")}
              </label>
              <label className="flex h-8 items-center gap-2.5 text-[13px] text-strong">
                <input type="radio" className="radio" checked={end === "until"} onChange={() => setEnd("until")} />
                <span className="w-[76px]">{t("En")}</span>
                <span className={cn("rounded-md bg-control", end !== "until" && "pointer-events-none opacity-50")}>
                  <DateSelect value={untilDate} onChange={setUntilDate} weekStartsOn={weekStartsOn} label={t("Fecha en que termina")} />
                </span>
              </label>
              <label className="flex h-8 items-center gap-2.5 text-[13px] text-strong">
                <input type="radio" className="radio" checked={end === "count"} onChange={() => setEnd("count")} />
                <span className="w-[76px] whitespace-nowrap">{t("Después de")}</span>
                <NumberField value={count} onChange={setCount} min={1} max={5000} disabled={end !== "count"} label={t("Número de veces")} />
                <span className={cn("text-muted", end !== "count" && "opacity-50")}>{tp(count, "vez", "veces")}</span>
              </label>
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t("Cancelar")}
          </Button>
          <Button disabled={!valid} onClick={done}>
            {t("Listo")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
