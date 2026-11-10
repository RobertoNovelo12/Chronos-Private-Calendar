import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Casilla redonda de tarea. `color`: el del calendario (o el de acento). */
export function TaskCheckbox({
  done,
  color,
  onToggle,
  size = 15,
  label,
}: {
  done: boolean;
  color?: string;
  onToggle: () => void;
  size?: number;
  label: string;
}) {
  const c = color ?? "var(--accent)";
  return (
    <button
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn("flex shrink-0 items-center justify-center rounded-full transition-colors", !done && "hover:opacity-80")}
      style={{
        width: size,
        height: size,
        background: done ? c : "transparent",
        boxShadow: `inset 0 0 0 1.5px ${c}`,
      }}
    >
      {done && <Check className="text-white" style={{ width: size * 0.65, height: size * 0.65 }} strokeWidth={3.5} />}
    </button>
  );
}
