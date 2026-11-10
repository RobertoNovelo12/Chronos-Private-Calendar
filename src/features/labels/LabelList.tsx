import { useEffect, useRef, useState, type FormEvent } from "react";
import { Filter, FilterX, MoreHorizontal, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { MenuItem, MenuSeparator, Popover } from "@/components/ui/popover";
import { CALENDAR_COLORS, ColorPicker } from "@/features/calendars/CalendarList";
import { errorMessage } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { nextLabelColor, useLabelStore } from "@/stores/labelStore";
import type { Label } from "@/types/domain";

/** Etiquetas en la barra lateral: pulsar una filtra el calendario por ella. */
export function LabelList({ onError }: { onError: (message: string) => void }) {
  const { labels, filterId, setFilter, update, remove } = useLabelStore();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Label | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <section className="mt-4 px-2 pb-3">
      <div className="flex h-6 items-center justify-between px-1.5 pb-1">
        <span className="text-[12px] font-medium text-muted">Etiquetas</span>
        {filterId && (
          <button
            onClick={() => setFilter(null)}
            className="flex items-center gap-1 rounded px-1 text-[11px] text-accent hover:bg-surface-hover"
            title="Mostrar todos los eventos"
          >
            <FilterX className="size-3" /> Quitar filtro
          </button>
        )}
      </div>
      <ul>
        {labels.map((label) =>
          editingId === label.id ? (
            <li key={label.id}>
              <LabelEditor
                initial={label}
                onCancel={() => setEditingId(null)}
                onSave={async (name, color) => {
                  await run(() => update(label.id, { name, color }));
                  setEditingId(null);
                }}
              />
            </li>
          ) : (
            <LabelRow
              key={label.id}
              label={label}
              active={filterId === label.id}
              dimmed={filterId !== null && filterId !== label.id}
              onFilter={() => setFilter(filterId === label.id ? null : label.id)}
              onEdit={() => setEditingId(label.id)}
              onDelete={() => setPendingDelete(label)}
            />
          ),
        )}
      </ul>

      {adding ? (
        <NewLabelForm onDone={() => setAdding(false)} onError={onError} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-1 flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-[13px] font-medium text-muted hover:bg-surface-hover hover:text-strong"
        >
          <Plus className="size-4" /> Añadir etiqueta
        </button>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="¿Eliminar etiqueta?"
        description={`Se quitará “${pendingDelete?.name ?? ""}” de todos los eventos. Los eventos no se eliminan.`}
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

function LabelRow({
  label,
  active,
  dimmed,
  onFilter,
  onEdit,
  onDelete,
}: {
  label: Label;
  active: boolean;
  dimmed: boolean;
  onFilter: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  return (
    <li
      className={cn(
        "group flex h-7 items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover",
        (menu || active) && "bg-surface-hover",
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={onFilter}
        onDoubleClick={onEdit}
        aria-pressed={active}
        title={active ? "Mostrar todos los eventos" : `Mostrar solo eventos con “${label.name}”`}
      >
        <Tag className="size-3.5 shrink-0" style={{ color: label.color }} strokeWidth={2.5} />
        <span className={cn("min-w-0 truncate text-[13px] font-medium", dimmed ? "text-faint" : "text-strong")}>
          {label.name}
        </span>
      </button>
      {active && <Filter className="size-3.5 shrink-0 text-accent group-hover:hidden" aria-label="Filtro activo" />}
      <button
        ref={moreRef}
        onClick={() => setMenu((v) => !v)}
        className={cn(
          "hidden size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-border-strong hover:text-strong group-hover:flex",
          menu && "flex",
        )}
        aria-label={`Opciones de ${label.name}`}
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      <Popover open={menu} onClose={() => setMenu(false)} anchorRef={moreRef} align="start" className="min-w-[200px]">
        <MenuItem onClick={act(onFilter)}>
          {active ? <FilterX className="size-3.5 text-muted" /> : <Filter className="size-3.5 text-muted" />}
          {active ? "Quitar filtro" : "Mostrar solo esta etiqueta"}
        </MenuItem>
        <MenuItem onClick={act(onEdit)}>
          <Pencil className="size-3.5 text-muted" /> Editar nombre y color
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onClick={act(onDelete)}>
          <Trash2 className="size-3.5" /> Eliminar etiqueta
        </MenuItem>
      </Popover>
    </li>
  );
}

function LabelEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Label;
  onSave: (name: string, color: string) => Promise<void>;
  onCancel: () => void;
}) {
  const labels = useLabelStore((s) => s.labels);
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? nextLabelColor(labels, CALENDAR_COLORS));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave(name.trim(), color);
  }

  return (
    <form
      onSubmit={submit}
      className="my-1 space-y-2 rounded-lg border border-border-strong bg-popover p-2"
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <Input ref={ref} value={name} maxLength={100} placeholder="Nombre de la etiqueta" onChange={(e) => setName(e.target.value)} className="h-8" />
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

function NewLabelForm({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const create = useLabelStore((s) => s.create);
  return (
    <LabelEditor
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
