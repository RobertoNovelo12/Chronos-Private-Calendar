// Navegación con teclado entre los eventos de la vista.
//
// Cada bloque de evento es enfocable (Tab) y lleva `data-nav-day` (inicio del
// día donde se dibuja) y `data-nav-start`. Con un evento enfocado:
//   ↓ (sin foco) enfoca el evento seleccionado o el primero de la vista
//   ↑ / ↓      anterior / siguiente (por día y hora)
//   ← / →      el evento más cercano en hora del día anterior / siguiente
//   Enter      abre los detalles
//   Alt+↑/↓    mueve 15 minutos · Alt+←/→ mueve un día
//   Shift+F10  menú contextual

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { addMinutes } from "date-fns";
import { eventStart, formatEventTime, formatLongDate, isAllDayLike, SNAP_MINUTES } from "@/lib/dates";
import { shiftedByDays, updateEvent } from "@/features/events/actions";
import { DRAFT_ID, useEventStore } from "@/stores/eventStore";
import { useUiStore } from "@/stores/uiStore";
import type { CalendarEvent } from "@/types/domain";
import { t } from "@/i18n";

export interface NavItem {
  day: number;
  start: number;
}

export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** Índice del siguiente elemento al pulsar `key` desde `current` (o null). */
export function navTarget(items: readonly NavItem[], current: number, key: NavKey): number | null {
  const cur = items[current];
  if (!cur) return items.length ? 0 : null;
  const order = items
    .map((it, i) => ({ ...it, i }))
    .sort((a, b) => a.day - b.day || a.start - b.start || a.i - b.i);
  const pos = order.findIndex((o) => o.i === current);
  if (key === "ArrowDown") return order[pos + 1]?.i ?? null;
  if (key === "ArrowUp") return order[pos - 1]?.i ?? null;

  const days = [...new Set(order.map((o) => o.day))];
  const di = days.indexOf(cur.day);
  const targetDay = days[key === "ArrowRight" ? di + 1 : di - 1];
  if (targetDay === undefined) return null;
  // Misma hora del día aproximada: se compara la distancia desde el inicio de cada día.
  const offset = cur.start - cur.day;
  let best: (typeof order)[number] | null = null;
  for (const o of order) {
    if (o.day !== targetDay) continue;
    if (!best || Math.abs(o.start - o.day - offset) < Math.abs(best.start - best.day - offset)) best = o;
  }
  return best?.i ?? null;
}

function navElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-nav-day]")].filter((el) => el.offsetParent !== null);
}

function focusEvent(id: string) {
  // Tras guardar, la vista se vuelve a dibujar: se espera a que exista el bloque.
  let tries = 0;
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(`[data-nav-day][data-event-key="${CSS.escape(id)}"]`);
    if (el) el.focus();
    else if (tries++ < 10) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/** Flechas sobre un evento enfocado. Devuelve true si se ha gestionado la tecla. */
export function handleEventNavKey(e: KeyboardEvent): boolean {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) || e.ctrlKey || e.metaKey) return false;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-nav-day]") : null;
  const key = e.key as NavKey;

  if (e.altKey) {
    const id = focused?.dataset.eventKey ?? useUiStore.getState().selectedEventId;
    if (!id) return false;
    e.preventDefault();
    void nudgeEvent(id, key);
    return true;
  }
  const els = navElements();
  if (!focused) {
    // ↓/↑ sin nada enfocado: al evento seleccionado o al primero de la vista.
    const idle = !document.activeElement || document.activeElement === document.body;
    if (!idle || (key !== "ArrowDown" && key !== "ArrowUp") || !els.length) return false;
    const sel = useUiStore.getState().selectedEventId;
    const target = (sel && els.find((el) => el.dataset.eventKey === sel)) || els[0]!;
    e.preventDefault();
    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }
  const items = els.map((el) => ({ day: Number(el.dataset.navDay), start: Number(el.dataset.navStart) }));
  const next = navTarget(items, els.indexOf(focused), key);
  e.preventDefault();
  if (next !== null) {
    els[next]!.focus();
    els[next]!.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  return true;
}

/** Alt+flechas: 15 minutos arriba/abajo o un día a los lados. */
export async function nudgeEvent(id: string, key: NavKey): Promise<void> {
  const store = useEventStore.getState();
  const ev = id === DRAFT_ID ? store.draft : store.events[id];
  if (!ev) return;
  let patch: { startAt: number; endAt: number };
  if (key === "ArrowLeft" || key === "ArrowRight") {
    patch = shiftedByDays(ev, key === "ArrowRight" ? 1 : -1);
  } else {
    if (isAllDayLike(ev)) return;
    const delta = key === "ArrowDown" ? SNAP_MINUTES : -SNAP_MINUTES;
    patch = { startAt: addMinutes(new Date(ev.startAt), delta).getTime(), endAt: addMinutes(new Date(ev.endAt), delta).getTime() };
  }
  const updated = await updateEvent(id, patch, { fromDrag: true });
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const d = new Date(patch.startAt);
    const ui = useUiStore.getState();
    // Si el evento sale de la vista, la vista lo sigue.
    if (ui.view === "day") ui.setAnchor(ev.isAllDay ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d);
  }
  focusEvent(updated?.id ?? id);
}

/** Propiedades comunes de un bloque de evento enfocable. */
export function eventNavProps(ev: CalendarEvent, day: Date) {
  return {
    tabIndex: 0,
    role: "button",
    "aria-label": `${ev.title || t("Sin título")}, ${formatLongDate(eventStart(ev))}, ${formatEventTime(ev)}`,
    "data-nav-day": day.getTime(),
    "data-nav-start": ev.startAt,
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        useUiStore.getState().select(ev.id);
      } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        e.preventDefault();
        if (ev.id === DRAFT_ID) return;
        const r = e.currentTarget.getBoundingClientRect();
        useUiStore.getState().openContextMenu({ eventId: ev.id, x: r.left + Math.min(24, r.width / 2), y: r.top + Math.min(20, r.height / 2) });
      }
    },
  } as const;
}

/** Estilo del foco visible en los bloques de evento. */
export const EVENT_FOCUS = "outline-none focus-visible:z-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";
