import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Check, EyeOff, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { MenuItem, MenuSeparator, Popover } from "@/components/ui/popover";
import { errorMessage } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useCalendarStore } from "@/stores/calendarStore";
import type { Calendar } from "@/types/domain";
import { t } from "@/i18n";

export const CALENDAR_COLORS = [
  "#2f80ed", "#eb5757", "#f2994a", "#f2c94c", "#27ae60",
  "#2d9cdb", "#9b51e0", "#e84393", "#6b7280", "#0f766e",
];

interface Props {
  onError: (message: string) => void;
}

/** Lista de calendarios locales. */
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
    <section className="px-2">
      <div className="px-1.5 pb-1 text-[12px] font-medium text-muted">{t("En este equipo")}</div>
      <ul>
        {calendars.map((cal, i) =>
          editingId === cal.id ? (
            <li key={cal.id}>
              <CalendarEditor
                initial={cal}
                onCancel={() => setEditingId(null)}
                onSave={async (name, color) => {
                  await run(() => update(cal.id, { name, color }));
                  setEditingId(null);
                }}
              />
            </li>
          ) : (
            <CalendarRow
              key={cal.id}
              cal={cal}
              first={i === 0}
              last={i === calendars.length - 1}
              onlyOne={calendars.length <= 1}
              onToggle={() => void run(() => update(cal.id, { isVisible: !cal.isVisible }))}
              onEdit={() => setEditingId(cal.id)}
              onDefault={() => void run(() => setDefault(cal.id))}
              onMove={(d) => move(i, d)}
              onDelete={() => setPendingDelete(cal)}
            />
          ),
        )}
      </ul>

      {adding ? (
        <NewCalendarForm onDone={() => setAdding(false)} onError={onError} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-1 flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-[13px] font-medium text-muted hover:bg-surface-hover hover:text-strong"
        >
          <Plus className="size-4" /> {t("Añadir calendario")}
        </button>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("¿Eliminar calendario?")}
        description={t("Se eliminarán “{name}” y todos sus eventos de forma permanente. Esta acción no se puede deshacer.", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("Eliminar")}
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

function CalendarRow({
  cal,
  first,
  last,
  onlyOne,
  onToggle,
  onEdit,
  onDefault,
  onMove,
  onDelete,
}: {
  cal: Calendar;
  first: boolean;
  last: boolean;
  onlyOne: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDefault: () => void;
  onMove: (delta: number) => void;
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
      className={cn("group flex h-7 items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover", menu && "bg-surface-hover")}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      <button
        role="checkbox"
        aria-checked={cal.isVisible}
        aria-label={`${cal.isVisible ? t("Ocultar") : t("Mostrar")} ${cal.name}`}
        onClick={onToggle}
        className="flex size-[15px] shrink-0 items-center justify-center rounded-[4px]"
        style={{
          background: cal.isVisible ? cal.color : "transparent",
          boxShadow: `inset 0 0 0 1.5px ${cal.isVisible ? cal.color : `color-mix(in srgb, ${cal.color} 45%, transparent)`}`,
        }}
      >
        {cal.isVisible && <Check className="size-2.5 text-white" strokeWidth={3.5} />}
      </button>
      <button
        className={cn("min-w-0 truncate text-left text-[13px] font-medium", cal.isVisible ? "text-strong" : "text-faint")}
        onDoubleClick={onEdit}
        onClick={onToggle}
        title={cal.description || cal.name}
      >
        {cal.name}
      </button>
      {cal.isDefault && <span className="shrink-0 text-[12px] text-muted group-hover:hidden">{t("Predeterminado")}</span>}
      <span className="ml-auto flex shrink-0 items-center">
        {!cal.isVisible && <EyeOff className="size-3.5 text-faint group-hover:hidden" aria-label={t("Oculto")} />}
        <button
          ref={moreRef}
          onClick={() => setMenu((v) => !v)}
          className={cn(
            "hidden size-5 items-center justify-center rounded text-muted hover:bg-border-strong hover:text-strong group-hover:flex",
            menu && "flex",
          )}
          aria-label={t("Opciones de {name}", { name: cal.name })}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </span>
      <Popover open={menu} onClose={() => setMenu(false)} anchorRef={moreRef} align="start" className="min-w-[200px]">
        <MenuItem onClick={act(onEdit)}>
          <Pencil className="size-3.5 text-muted" /> {t("Editar nombre y color")}
        </MenuItem>
        {!cal.isDefault && (
          <MenuItem onClick={act(onDefault)}>
            <Star className="size-3.5 text-muted" /> {t("Hacer predeterminado")}
          </MenuItem>
        )}
        {!first && (
          <MenuItem onClick={act(() => onMove(-1))}>
            <ArrowUp className="size-3.5 text-muted" /> {t("Subir")}
          </MenuItem>
        )}
        {!last && (
          <MenuItem onClick={act(() => onMove(1))}>
            <ArrowDown className="size-3.5 text-muted" /> {t("Bajar")}
          </MenuItem>
        )}
        {!onlyOne && (
          <>
            <MenuSeparator />
            <MenuItem danger onClick={act(onDelete)}>
              <Trash2 className="size-3.5" /> {t("Eliminar calendario")}
            </MenuItem>
          </>
        )}
      </Popover>
    </li>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Color")}>
      {CALENDAR_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn("size-4 rounded-[4px] ring-offset-2 ring-offset-popover", value === c && "ring-2")}
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
    <form
      onSubmit={submit}
      className="my-1 space-y-2 rounded-lg border border-border-strong bg-popover p-2"
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <Input ref={ref} value={name} maxLength={200} placeholder={t("Nombre del calendario")} onChange={(e) => setName(e.target.value)} className="h-8" />
      <ColorPicker value={color} onChange={setColor} />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("Cancelar")}
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>
          {t("Guardar")}
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
