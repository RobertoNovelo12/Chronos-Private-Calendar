import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Combinación normalizada de una pulsación: "c", "mod+v", "delete"… */
function comboOf(e: KeyboardEvent): string {
  const key = e.key.toLowerCase();
  const name = key === "backspace" ? "delete" : key;
  const shift = e.shiftKey && /^[a-z]$/.test(name) ? "shift+" : "";
  return `${e.ctrlKey || e.metaKey ? "mod+" : ""}${shift}${name}`;
}

/**
 * Contenedor de menú contextual: se mantiene dentro de la ventana y se cierra
 * con Esc o clic fuera. `keys` asocia atajos a acciones mientras el menú está
 * abierto (p. ej. "c" crea en el hueco del clic derecho, no en la hora actual).
 */
export function ContextMenuShell({
  x,
  y,
  onClose,
  keys,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  keys?: Record<string, () => void>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);

  useEffect(() => {
    const close = () => closeRef.current();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      const action = keysRef.current?.[comboOf(e)];
      if (action) {
        // El atajo pertenece al menú: no llega a los atajos globales.
        e.preventDefault();
        e.stopPropagation();
        action();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[200px] rounded-lg border border-border-strong bg-popover p-1 shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

export function ContextMenuItem({
  icon,
  label,
  shortcut,
  onSelect,
  disabled,
  danger,
}: {
  icon?: ReactNode;
  label: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[13px] hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40",
        danger && "text-danger",
      )}
      onClick={onSelect}
    >
      {icon && <span className={cn("flex size-4 items-center justify-center [&_svg]:size-4", !danger && "text-muted")}>{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {shortcut && <span className="ml-6 text-[11px] text-muted">{shortcut}</span>}
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="my-1 border-t border-border" />;
}
