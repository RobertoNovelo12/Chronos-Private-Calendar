import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { eventStart, formatEventTime } from "@/lib/dates";
import { api, errorMessage } from "@/lib/ipc";
import { eventColor } from "@/lib/layout";
import { useCalendarMap } from "@/hooks/useCalendarData";
import { useUiStore } from "@/stores/uiStore";
import type { CalendarEvent } from "@/types/domain";

/** Buscador local: consulta la base cifrada a través del backend. */
export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const calendars = useCalendarMap();
  const { setAnchor, select } = useUiStore();

  // "/" o Ctrl+K enfoca el buscador.
  useEffect(() => {
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener("chronos:focus-search", onFocus);
    return () => window.removeEventListener("chronos:focus-search", onFocus);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.events
        .search(q)
        .then((r) => {
          if (!cancelled) {
            setResults(r);
            setActive(0);
            setError(null);
          }
        })
        .catch((e) => !cancelled && setError(errorMessage(e)));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  function open(e: CalendarEvent) {
    setAnchor(eventStart(e));
    select(e.id);
    setQuery("");
    inputRef.current?.blur();
  }

  return (
    <div className="relative px-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            } else if (e.key === "ArrowDown" && results) {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && results?.[active]) {
              open(results[active]!);
            }
          }}
          placeholder="Buscar eventos"
          spellCheck={false}
          className="h-8 w-full rounded-md bg-transparent pl-8 pr-7 text-[13px] text-strong placeholder:text-muted hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
          title="Buscar (/ o Ctrl+K)"
        />
        {query && (
          <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground" onClick={() => setQuery("")} aria-label="Limpiar">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {(results || error) && (
        <div className="absolute inset-x-1 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border-strong bg-popover p-1 shadow-xl">
          {error && <p className="px-2 py-1.5 text-[12px] text-danger">{error}</p>}
          {results?.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted">Sin resultados</p>}
          {results?.map((e, i) => (
            <button
              key={e.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => open(e)}
              className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left ${i === active ? "bg-surface-hover" : ""}`}
            >
              <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: eventColor(e, calendars.get(e.calendarId)?.color) }} />
              <span className="min-w-0">
                <span className="block truncate text-[13px]">{e.title || "Sin título"}</span>
                <span className="block text-[11px] text-muted">
                  {format(eventStart(e), "d MMM yyyy", { locale: es })} · {formatEventTime(e)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
