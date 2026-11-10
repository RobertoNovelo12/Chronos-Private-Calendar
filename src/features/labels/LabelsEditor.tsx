import { useMemo, useRef, useState } from "react";
import { Check, Plus, Tag, X } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { CALENDAR_COLORS } from "@/features/calendars/CalendarList";
import { errorMessage } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { nextLabelColor, useLabelStore } from "@/stores/labelStore";
import { toast } from "@/stores/toastStore";
import { intlLocale, t } from "@/i18n";

const MAX_PER_EVENT = 20;

/** Fila «Etiquetas» del panel del evento: chips + selector con creación rápida. */
export function LabelsEditor({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const labels = useLabelStore((s) => s.labels);
  const create = useLabelStore((s) => s.create);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLButtonElement>(null);

  const assigned = labels.filter((l) => value.includes(l.id));
  const q = query.trim();
  const matches = useMemo(() => {
    const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    return labels.filter((l) => norm(l.name).includes(norm(q)));
  }, [labels, q]);
  const exact = labels.some((l) => l.name.localeCompare(q, intlLocale(), { sensitivity: "base" }) === 0);
  const canCreate = q.length > 0 && q.length <= 100 && !exact;
  const options = matches.length + (canCreate ? 1 : 0);

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (value.length < MAX_PER_EVENT) onChange([...value, id]);
    else toast.error(t("Máximo {n} etiquetas por evento", { n: MAX_PER_EVENT }));
  }

  async function createAndAssign() {
    try {
      const label = await create({ name: q, color: nextLabelColor(labels, CALENDAR_COLORS) });
      setQuery("");
      if (value.length < MAX_PER_EVENT) onChange([...value, label.id]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function close() {
    setOpen(false);
    setQuery("");
    setActive(0);
  }

  return (
    <div className="flex min-h-7 items-start gap-1">
      <span className="flex h-7 w-6 shrink-0 items-center justify-center text-muted">
        <Tag className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
        {assigned.map((l) => (
          <span
            key={l.id}
            className="group inline-flex h-6 max-w-full items-center gap-1 rounded-md pl-1.5 pr-1 text-[12px] font-medium text-strong"
            style={{ background: `color-mix(in srgb, ${l.color} 18%, transparent)` }}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: l.color }} />
            <span className="truncate">{l.name}</span>
            <button
              className="flex size-4 items-center justify-center rounded text-muted hover:text-danger"
              aria-label={t("Quitar etiqueta {name}", { name: l.name })}
              onClick={() => onChange(value.filter((x) => x !== l.id))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <button
          ref={ref}
          onClick={() => (open ? close() : setOpen(true))}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-strong"
          aria-label={t("Asignar etiquetas")}
        >
          {assigned.length === 0 ? t("Etiquetas") : <Plus className="size-3.5" />}
        </button>
        <Popover open={open} onClose={close} anchorRef={ref} className="w-[240px] p-1">
          <input
            autoFocus
            value={query}
            maxLength={100}
            placeholder={t("Buscar o crear etiqueta…")}
            className="mb-1 h-8 w-full rounded-md bg-control px-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-ring"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, Math.max(options - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (active < matches.length) toggle(matches[active]!.id);
                else if (canCreate) void createAndAssign();
              }
            }}
          />
          <div className="max-h-[240px] overflow-y-auto" role="listbox" aria-label={t("Etiquetas")} aria-multiselectable="true">
            {matches.map((l, i) => {
              const on = value.includes(l.id);
              return (
                <button
                  key={l.id}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(l.id)}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-strong",
                    i === active && "bg-surface-hover",
                  )}
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  {on && <Check className="size-3.5 shrink-0 text-accent" />}
                </button>
              );
            })}
            {canCreate && (
              <button
                onMouseEnter={() => setActive(matches.length)}
                onClick={() => void createAndAssign()}
                className={cn(
                  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-strong",
                  active === matches.length && "bg-surface-hover",
                )}
              >
                <Plus className="size-3.5 shrink-0 text-muted" />
                <span className="min-w-0 truncate">
                  {t("Crear «{name}»", { name: q })}
                </span>
              </button>
            )}
            {options === 0 && (
              <div className="px-2 py-1.5 text-[12px] text-muted">
                {labels.length === 0 ? t("Escribe un nombre para crear tu primera etiqueta") : t("Sin resultados")}
              </div>
            )}
          </div>
        </Popover>
      </div>
    </div>
  );
}
