import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatLongDate, fromInputs, localeDayFirst, toDateInput } from "@/lib/dates";
import { parseDate } from "@/lib/nlp";
import { usePrefsStore } from "@/stores/prefsStore";
import { useUiStore } from "@/stores/uiStore";
import { t } from "@/i18n";

/** «Ir a la fecha» (tecla `.`): texto libre o selector de fecha. */
export function GoToDate() {
  const open = useUiStore((s) => s.goToOpen);
  return open ? <GoToDateDialog /> : null;
}

function GoToDateDialog() {
  const close = () => useUiStore.getState().setGoToOpen(false);
  const anchor = useUiStore((s) => s.anchor);
  const weekStartsOn = usePrefsStore((s) => s.weekStartsOn);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState(toDateInput(anchor));
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    inputRef.current?.focus();
    const el = restoreFocus.current;
    return () => {
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, []);

  const parsed = useMemo(
    () => (text.trim() ? parseDate(text, { now: new Date(), weekStartsOn, dayFirst: localeDayFirst() }) : null),
    [text, weekStartsOn],
  );
  const target = text.trim() ? parsed : fromInputs(picked);

  function go() {
    if (!target) return;
    useUiStore.getState().setAnchor(target);
    close();
  }

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/25 pt-[16vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="goto-title"
        className="h-fit w-[min(400px,calc(100vw-32px))] rounded-xl border border-border-strong bg-popover p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === "Enter") {
            e.preventDefault();
            go();
          }
        }}
      >
        <h2 id="goto-title" className="text-[14px] font-semibold text-strong">
          {t("Ir a la fecha")}
        </h2>
        <label className="mt-3 block space-y-1">
          <span className="text-[12px] text-muted">{t("Escribe una fecha")}</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("«15 dic», «próximo lunes», «en 2 semanas»…")}
            spellCheck={false}
            aria-describedby="goto-preview"
            className="h-9 w-full rounded-md bg-control px-2.5 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[12px] text-muted">{t("o elígela")}</span>
          <input
            type="date"
            value={picked}
            onChange={(e) => {
              setPicked(e.target.value);
              setText("");
            }}
            className="h-8 rounded-md bg-control px-2 text-[13px] text-strong focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <p id="goto-preview" aria-live="polite" className="mt-3 min-h-5 text-[12.5px]">
          {target ? (
            <span className="text-strong">{formatLongDate(target)}</span>
          ) : (
            <span className="text-muted">{t("No se entiende la fecha. Prueba «15/12», «dec 15» o «viernes».")}</span>
          )}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {t("Cancelar")}
          </Button>
          <Button onClick={go} disabled={!target}>
            {t("Ir")}
            <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
