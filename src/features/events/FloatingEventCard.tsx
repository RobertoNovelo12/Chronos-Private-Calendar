import { useLayoutEffect, useRef, useState } from "react";
import { useSelectedEvent } from "@/stores/eventStore";
import { useUiStore } from "@/stores/uiStore";
import { EventPanel } from "./EventPanel";

const CARD_W = 300;
const GAP = 10;
const MARGIN = 8;

/** Detalles del evento en una tarjeta junto al evento (cuando el panel lateral está oculto). */
export function FloatingEventCard() {
  const selectedId = useUiStore((s) => s.selectedEventId);
  const event = useSelectedEvent(selectedId);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!selectedId) return;
    const place = () => {
      const card = ref.current;
      if (!card) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = card.offsetHeight;
      const el = document.querySelector<HTMLElement>(`[data-event-key="${CSS.escape(selectedId)}"]`);
      let left: number;
      let top: number;
      if (el) {
        const r = el.getBoundingClientRect();
        left = r.right + GAP;
        if (left + CARD_W > vw - MARGIN) left = r.left - CARD_W - GAP;
        if (left < MARGIN) left = vw - CARD_W - MARGIN;
        top = r.top - 40;
      } else {
        left = vw - CARD_W - 24;
        top = 64;
      }
      top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
      setPos((p) => (p && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 ? p : { left, top }));
    };
    place();
    // Sigue al evento al desplazar la rejilla, redimensionar o moverlo.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const t = setInterval(place, 150);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      clearInterval(t);
    };
  }, [selectedId]);

  if (!event) return null;
  return (
    <div
      ref={ref}
      className="fixed z-[60] flex max-h-[calc(100vh-16px)] flex-col overflow-hidden rounded-xl border border-border-strong bg-popover shadow-[0_16px_48px_-12px_rgba(0,0,0,0.55)]"
      style={{ width: CARD_W, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      <EventPanel floating />
    </div>
  );
}
