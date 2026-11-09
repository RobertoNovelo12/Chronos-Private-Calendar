import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: "start" | "end";
  /** Abre a la derecha del ancla (submenús). */
  side?: "bottom" | "right";
  className?: string;
  /** Popovers del mismo grupo (menú + submenús) no se cierran entre sí. */
  group?: string;
}

/** Capa flotante anclada a un elemento. Se cierra con Esc o clic fuera. */
export function Popover({ open, onClose, anchorRef, children, align = "start", side = "bottom", className, group }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const a = anchorRef.current?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if (side === "right") {
      left = a.right + 4;
      top = a.top - 4;
      if (left + w > window.innerWidth - 8) left = a.left - w - 4;
    } else {
      left = align === "end" ? a.right - w : a.left;
      top = a.bottom + 4;
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 4);
    }
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [open, anchorRef, align, side]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      if (group && t instanceof Element && t.closest(`[data-popover-group="${group}"]`)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      data-popover-group={group}
      className={cn(
        "fixed z-[90] rounded-lg border border-border-strong bg-popover p-1 shadow-[0_10px_38px_-10px_rgba(0,0,0,0.45),0_10px_20px_-15px_rgba(0,0,0,0.3)]",
        className,
      )}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  children,
  onClick,
  hint,
  active,
  danger,
  className,
  onMouseEnter,
}: {
  children: ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  hint?: ReactNode;
  active?: boolean;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-surface-hover",
        active && "bg-surface-hover",
        danger ? "text-danger" : "text-strong",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {hint && <span className="ml-4 shrink-0 text-[12px] text-muted">{hint}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 border-t border-border-strong/60" />;
}
