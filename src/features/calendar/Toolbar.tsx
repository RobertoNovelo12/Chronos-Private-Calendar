import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronRight as Caret, Loader2, PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator, Popover } from "@/components/ui/popover";
import { CUSTOM_DAY_OPTIONS, type ViewKind } from "@/lib/dates";
import { useEventStore } from "@/stores/eventStore";
import { usePrefsStore } from "@/stores/prefsStore";
import { useUiStore } from "@/stores/uiStore";

function viewLabel(view: ViewKind, customDays: number): string {
  switch (view) {
    case "day":
      return "Día";
    case "week":
      return "Semana";
    case "month":
      return "Mes";
    case "agenda":
      return "Agenda";
    case "days":
      return `${customDays} días`;
  }
}

/** Barra superior: selector de vista, Hoy y navegación. */
export function Toolbar() {
  const { view, setView, today, step } = useUiStore();
  const prefs = usePrefsStore();
  const loading = useEventStore((s) => s.loading);
  const [menu, setMenu] = useState<null | "main" | "days" | "config">(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const daysRef = useRef<HTMLButtonElement>(null);
  const configRef = useRef<HTMLButtonElement>(null);

  const choose = (v: ViewKind) => {
    setView(v);
    setMenu(null);
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 px-3">
      {!prefs.leftSidebarOpen && (
        <Button variant="ghost" size="icon" onClick={() => prefs.set({ leftSidebarOpen: true })} aria-label="Mostrar barra lateral" title="Mostrar barra lateral (`)">
          <PanelLeft />
        </Button>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {loading && <Loader2 className="mr-1 size-3.5 animate-spin text-faint" aria-label="Cargando" />}
        <Button ref={btnRef} variant="secondary" size="sm" className="gap-1 px-2.5" onClick={() => setMenu(menu ? null : "main")} aria-haspopup="menu">
          {viewLabel(view, prefs.customDays)}
          <ChevronDown className="!size-3.5 opacity-70" />
        </Button>
        <Button variant="secondary" size="sm" className="px-2.5" onClick={today} title="Ir a hoy (T)">
          Hoy
        </Button>
        <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Anterior" title="Anterior (K o ←)">
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Siguiente" title="Siguiente (J o →)">
          <ChevronRight />
        </Button>
        {!prefs.rightPanelOpen && (
          <Button variant="ghost" size="icon" onClick={() => prefs.set({ rightPanelOpen: true })} aria-label="Mostrar panel" title="Mostrar panel">
            <PanelRight />
          </Button>
        )}
      </div>

      <Popover open={menu !== null} onClose={() => setMenu(null)} anchorRef={btnRef} align="end" group="viewmenu" className="w-[210px]">
        <MenuItem onMouseEnter={() => setMenu("main")} onClick={() => choose("day")} hint="1 o D" active={view === "day"}>
          Día
        </MenuItem>
        <MenuItem onMouseEnter={() => setMenu("main")} onClick={() => choose("week")} hint="0 o W" active={view === "week"}>
          Semana
        </MenuItem>
        <MenuItem onMouseEnter={() => setMenu("main")} onClick={() => choose("month")} hint="M" active={view === "month"}>
          Mes
        </MenuItem>
        <MenuItem onMouseEnter={() => setMenu("main")} onClick={() => choose("agenda")} hint="A" active={view === "agenda"}>
          Agenda
        </MenuItem>
        <MenuSeparator />
        <button
          ref={daysRef}
          onMouseEnter={() => setMenu("days")}
          onClick={() => setMenu("days")}
          className="flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] text-strong hover:bg-surface-hover data-[open=true]:bg-surface-hover"
          data-open={menu === "days"}
        >
          <span className="flex-1">Número de días</span>
          <Caret className="size-3.5 text-muted" />
        </button>
        <MenuSeparator />
        <button
          ref={configRef}
          onMouseEnter={() => setMenu("config")}
          onClick={() => setMenu("config")}
          className="flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] text-strong hover:bg-surface-hover data-[open=true]:bg-surface-hover"
          data-open={menu === "config"}
        >
          <span className="flex-1">Configuración de la vista</span>
          <Caret className="size-3.5 text-muted" />
        </button>
      </Popover>

      <Popover open={menu === "days"} onClose={() => setMenu(null)} anchorRef={daysRef} side="right" group="viewmenu" className="w-[150px]">
        {CUSTOM_DAY_OPTIONS.map((n) => (
          <MenuItem
            key={n}
            hint={n <= 9 ? String(n) : undefined}
            onClick={() => {
              prefs.set({ customDays: n });
              choose("days");
            }}
          >
            <span className="w-3.5">{view === "days" && prefs.customDays === n && <Check className="size-3.5" />}</span>
            {n} días
          </MenuItem>
        ))}
      </Popover>

      <Popover open={menu === "config"} onClose={() => setMenu(null)} anchorRef={configRef} side="right" group="viewmenu" className="w-[220px]">
        <div className="px-2 pb-1 pt-1 text-[11px] text-muted">Formato de hora</div>
        <MenuItem onClick={() => prefs.set({ timeFormat: "12h" })}>
          <span className="w-3.5">{prefs.timeFormat === "12h" && <Check className="size-3.5" />}</span>
          12 horas (1:00PM)
        </MenuItem>
        <MenuItem onClick={() => prefs.set({ timeFormat: "24h" })}>
          <span className="w-3.5">{prefs.timeFormat === "24h" && <Check className="size-3.5" />}</span>
          24 horas (13:00)
        </MenuItem>
        <MenuSeparator />
        <div className="px-2 pb-1 pt-1 text-[11px] text-muted">La semana empieza el</div>
        <MenuItem onClick={() => prefs.set({ weekStartsOn: 0 })}>
          <span className="w-3.5">{prefs.weekStartsOn === 0 && <Check className="size-3.5" />}</span>
          Domingo
        </MenuItem>
        <MenuItem onClick={() => prefs.set({ weekStartsOn: 1 })}>
          <span className="w-3.5">{prefs.weekStartsOn === 1 && <Check className="size-3.5" />}</span>
          Lunes
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => prefs.set({ showWeekNumbers: !prefs.showWeekNumbers })}>
          <span className="w-3.5">{prefs.showWeekNumbers && <Check className="size-3.5" />}</span>
          Mostrar números de semana
        </MenuItem>
      </Popover>
    </div>
  );
}
