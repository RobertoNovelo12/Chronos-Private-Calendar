import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Check } from "lucide-react";
import { COMMON_ZONES, allTimeZones, cityName, formatOffsetLong, longZoneName, matchesZone, offsetMinutes } from "@/lib/timezones";
import { cn } from "@/lib/utils";
import { Popover } from "./popover";
import { t } from "@/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  selected?: string | null;
  onSelect: (tz: string) => void;
  /** Acción extra al pie (p. ej. "Quitar zona horaria"). */
  footer?: { label: string; run: () => void };
}

function ZoneRow({ tz, active, selected, onPick }: { tz: string; active: boolean; selected: boolean; onPick: () => void }) {
  return (
    <button
      data-active={active}
      onClick={onPick}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] hover:bg-surface-hover",
        active && "bg-surface-hover",
      )}
    >
      <span className="w-[74px] shrink-0 tabular-nums text-muted">{formatOffsetLong(offsetMinutes(tz))}</span>
      <span className="min-w-0 flex-1 truncate text-strong">
        {longZoneName(tz)} <span className="text-muted">–</span> {cityName(tz)}
      </span>
      {selected && <Check className="size-3.5 shrink-0 text-accent" />}
    </button>
  );
}

/** Lista de zonas horarias con búsqueda por ciudad, nombre o desfase. */
export function TimeZonePicker({ open, onClose, anchorRef, selected, onSelect, footer }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const all = useMemo(() => (open ? allTimeZones() : []), [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const q = query.trim();
  const common = q ? [] : COMMON_ZONES.filter((z) => all.includes(z));
  const rest = all.filter((z) => matchesZone(z, q) && (q || !COMMON_ZONES.includes(z)));
  const flat = [...common, ...rest];

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-active=true]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (tz: string) => {
    onSelect(tz);
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} className="w-[380px] p-0">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(flat.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && flat[active]) {
            pick(flat[active]!);
          }
        }}
        placeholder={t("Zona horaria")}
        spellCheck={false}
        className="h-10 w-full border-b border-border-strong bg-transparent px-3 text-[13px] text-strong placeholder:text-muted focus:outline-none"
      />
      <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
        {common.map((tz, i) => (
          <ZoneRow key={tz} tz={tz} active={i === active} selected={tz === selected} onPick={() => pick(tz)} />
        ))}
        {common.length > 0 && <div className="my-1 border-t border-border-strong/60" />}
        {rest.map((tz, i) => (
          <ZoneRow key={tz} tz={tz} active={common.length + i === active} selected={tz === selected} onPick={() => pick(tz)} />
        ))}
        {flat.length === 0 && <div className="px-2 py-2 text-[12px] text-muted">{t("Sin resultados")}</div>}
      </div>
      {footer && (
        <div className="border-t border-border-strong/60 p-1">
          <button
            onClick={() => {
              footer.run();
              onClose();
            }}
            className="flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] text-danger hover:bg-surface-hover"
          >
            {footer.label}
          </button>
        </div>
      )}
    </Popover>
  );
}
