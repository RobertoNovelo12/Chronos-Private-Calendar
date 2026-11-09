import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EditScope } from "@/types/domain";

const OPTIONS: { value: EditScope; label: string }[] = [
  { value: "this", label: "Este evento" },
  { value: "following", label: "Este y los siguientes" },
  { value: "all", label: "Todos los eventos" },
];

interface Props {
  open: boolean;
  kind: "edit" | "delete";
  allowThis: boolean;
  onResolve: (scope: EditScope | null) => void;
}

/** "¿Editar/Eliminar evento repetido?" con las tres opciones de RFC 5545. */
export function ScopeDialog({ open, kind, allowThis, onResolve }: Props) {
  const [value, setValue] = useState<EditScope>(allowThis ? "this" : "following");
  const valueRef = useRef(value);
  valueRef.current = value;
  const resolveRef = useRef(onResolve);
  resolveRef.current = onResolve;

  // Al abrir: opción por defecto.
  useEffect(() => {
    if (open) setValue(allowThis ? "this" : "following");
  }, [open, allowThis]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        resolveRef.current(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        resolveRef.current(valueRef.current);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" onMouseDown={() => onResolve(null)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scope-title"
        className="w-[340px] rounded-xl border border-border-strong bg-popover p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="scope-title" className="text-[15px] font-semibold text-strong">
          {kind === "edit" ? "Editar evento repetido" : "Eliminar evento repetido"}
        </h2>
        <div className="mt-3 space-y-0.5" role="radiogroup">
          {OPTIONS.filter((o) => allowThis || o.value !== "this").map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] text-strong hover:bg-surface-hover",
                value === o.value && "bg-surface-hover",
              )}
            >
              <input
                type="radio"
                name="scope"
                checked={value === o.value}
                onChange={() => setValue(o.value)}
                className="radio"
              />
              {o.label}
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onResolve(null)}>
            Cancelar
          </Button>
          <Button variant={kind === "delete" ? "danger" : "default"} onClick={() => onResolve(value)} autoFocus>
            {kind === "delete" ? "Eliminar" : "Aceptar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
