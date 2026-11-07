import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronDown, ChevronUp, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useCalendarStore } from "@/stores/calendarStore";
import type { Calendar } from "@/types/domain";

export const CALENDAR_COLORS = [
  "#2f80ed", "#eb5757", "#f2994a", "#f2c94c", "#27ae60",
  "#2d9cdb", "#9b51e0", "#e84393", "#6b7280", "#0f766e",
];

interface Props {
  onError: (message: string) => void;
}

export function CalendarList({ onError }: Props) {
  const { calendars, update, remove, setDefault, reorder } = useCalendarStore();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Calendar | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  function move(index: number, delta: number) {
    const ids = calendars.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void run(() => reorder(ids));
  }

  return (
    <section>
      <div className="flex items-center justify-between px-2 pb-1">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">Calendarios</h2>
        <Button variant="ghost" size="icon" aria-label="Nuevo calendario" title="Nuevo calendario" onClick={() => setAdding(true)}>
          <Plus />
        </Button>
      </div>

      <ul className="space-y-px">
        {calendars.map((cal, i) => (
          <li key={cal.id} className="group relative">
            {editingId === cal.id ? (
              <CalendarEditor
                initial={cal}
                onCancel={() => setEditingId(null)}
                onSave={async (name, color) => {
                  await run(() => update(cal.id, { name, color }));
                  setEditingId(null);
                }}
              />
            ) : (
              <div className="flex h-7 items-center gap-2 rounded-md px-2 hover:bg-surface-hover">
                <button
                  role="checkbox"
                  aria-checked={cal.isVisible}
                  aria-label={`${cal.isVisible ? "Ocultar" : "Mostrar"} ${cal.name}`}
                  onClick={() => void run(() => update(cal.id, { isVisible: !cal.isVisible }))}
                  className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border-[1.5px]"
                  style={{ borderColor: cal.color, background: cal.isVisible ? cal.color : "transparent" }}
                >
                  {cal.isVisible && <Check className="size-2.5 text-white" strokeWidth={3.5} />}
                </button>
                <button
                  className={cn("min-w-0 flex-1 truncate text-left text-[13px]", !cal.isVisible && "text-muted")}
                  onDoubleClick={() => setEditingId(cal.id)}
                  title="Doble clic para editar"
                >
                  {cal.name}
                </button>
                {cal.isDefault && <Star className="size-3 shrink-0 fill-current text-muted" aria-label="Predeterminado" />}
                <div className="hidden shrink-0 items-center group-hover:flex">
                  <IconAction label="Subir" onClick={() => move(i, -1)} disabled={i === 0}>
                    <ChevronUp />
                  </IconAction>
                  <IconAction label="Bajar" onClick={() => move(i, 1)} disabled={i === calendars.length - 1}>
                    <ChevronDown />
                  </IconAction>
                  {!cal.isDefault && (
                    <IconAction label="Hacer predeterminado" onClick={() => void run(() => setDefault(cal.id))}>
                      <Star />
                    </IconAction>
                  )}
                  <IconAction
                    label="Eliminar"
                    onClick={() => setPendingDelete(cal)}
                    disabled={calendars.length <= 1}
                  >
                    <Trash2 />
                  </IconAction>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding && <NewCalendarForm onDone={() => setAdding(false)} onError={onError} />}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="¿Eliminar calendario?"
        description={`Se eliminarán “${pendingDelete?.name ?? ""}” y todos sus eventos de forma permanente. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        destructive
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setBusy(true);
          await run(() => remove(pendingDelete.id));
          setBusy(false);
          setPendingDelete(null);
        }}
      />
    </section>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-5 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground disabled:opacity-30 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
      {CALENDAR_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn("size-4 rounded-full ring-offset-2 ring-offset-background", value === c && "ring-2")}
          style={{ background: c, ["--tw-ring-color" as string]: c }}
        />
      ))}
    </div>
  );
}

function CalendarEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Calendar;
  onSave: (name: string, color: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? CALENDAR_COLORS[0]!);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave(name.trim(), color);
  }

  return (
    <form onSubmit={submit} className="mx-1 my-1 space-y-2 rounded-lg border border-border bg-background p-2" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <Input ref={ref} value={name} maxLength={200} placeholder="Nombre del calendario" onChange={(e) => setName(e.target.value)} className="h-8" />
      <ColorPicker value={color} onChange={setColor} />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

function NewCalendarForm({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const create = useCalendarStore((s) => s.create);
  return (
    <CalendarEditor
      onCancel={onDone}
      onSave={async (name, color) => {
        try {
          await create({ name, color });
          onDone();
        } catch (e) {
          onError(errorMessage(e));
        }
      }}
    />
  );
}
