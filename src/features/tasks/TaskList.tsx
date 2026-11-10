import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCalendarMap, useNow } from "@/hooks/useCalendarData";
import { errorMessage } from "@/lib/ipc";
import { formatDue, groupTasks, TASK_GROUP_LABEL, type TaskGroupId } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { usePrefsStore } from "@/stores/prefsStore";
import { useTaskStore } from "@/stores/taskStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import type { Task } from "@/types/domain";
import { toggleTask } from "./actions";
import { TaskCheckbox } from "./TaskCheckbox";
import { t, tp } from "@/i18n";

const GROUPS: TaskGroupId[] = ["overdue", "today", "upcoming", "someday", "done"];
/** Máximo de tareas visibles por grupo antes de «Ver todas». */
const PREVIEW = 8;

/** Tareas en la barra lateral: añadir rápido, grupos por vencimiento y completadas. */
export function TaskList() {
  const tasks = useTaskStore((s) => s.tasks);
  const now = useNow(60_000);
  const groups = useMemo(() => groupTasks(tasks, now), [tasks, now]);
  const [open, setOpen] = useState<Record<TaskGroupId, boolean>>({
    overdue: true,
    today: true,
    upcoming: true,
    someday: true,
    done: false,
  });
  const [expanded, setExpanded] = useState<Partial<Record<TaskGroupId, boolean>>>({});
  const [adding, setAdding] = useState(false);

  // `Shift+C` (o el menú) puede pedir el campo de tarea rápida.
  useEffect(() => {
    const onFocus = () => setAdding(true);
    window.addEventListener("chronos:quick-task", onFocus);
    return () => window.removeEventListener("chronos:quick-task", onFocus);
  }, []);

  const pending = tasks.length - groups.done.length;

  return (
    <section className="mt-4 px-2">
      <div className="flex h-6 items-center justify-between px-1.5 pb-1">
        <span className="text-[12px] font-medium text-muted">
          {t("Tareas")}{pending > 0 && <span className="ml-1 tabular-nums text-faint">{pending}</span>}
        </span>
      </div>

      {GROUPS.map((g) => {
        const list = groups[g];
        if (list.length === 0) return null;
        const shown = expanded[g] ? list : list.slice(0, PREVIEW);
        return (
          <div key={g} className="mb-1">
            <button
              onClick={() => setOpen((o) => ({ ...o, [g]: !o[g] }))}
              className={cn(
                "flex h-6 w-full items-center gap-1 rounded-md px-1 text-[11.5px] font-medium hover:bg-surface-hover",
                g === "overdue" ? "text-danger" : "text-muted",
              )}
              aria-expanded={open[g]}
            >
              <ChevronRight className={cn("size-3 transition-transform", open[g] && "rotate-90")} />
              {t(TASK_GROUP_LABEL[g])}
              <span className="tabular-nums text-faint">{list.length}</span>
            </button>
            {open[g] && (
              <ul>
                {shown.map((t) => (
                  <TaskRow key={t.id} task={t} now={now} />
                ))}
                {list.length > PREVIEW && (
                  <li>
                    <button
                      className="h-6 w-full rounded-md px-1.5 pl-7 text-left text-[12px] text-muted hover:bg-surface-hover hover:text-strong"
                      onClick={() => setExpanded((x) => ({ ...x, [g]: !x[g] }))}
                    >
                      {expanded[g] ? t("Ver menos") : t("Ver las {n}", { n: list.length })}
                    </button>
                  </li>
                )}
                {g === "done" && <ClearCompleted count={list.length} />}
              </ul>
            )}
          </div>
        );
      })}

      {adding ? (
        <QuickAdd onDone={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-0.5 flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-[13px] font-medium text-muted hover:bg-surface-hover hover:text-strong"
          title={t("Añadir tarea (Shift+C)")}
        >
          <Plus className="size-4" /> {t("Añadir tarea")}
        </button>
      )}
    </section>
  );
}

function TaskRow({ task, now }: { task: Task; now: Date }) {
  const calendars = useCalendarMap();
  const selectedId = useUiStore((s) => s.selectedTaskId);
  const selectTask = useUiStore((s) => s.selectTask);
  const done = task.completedAt !== null;
  const color = task.calendarId ? calendars.get(task.calendarId)?.color : undefined;
  const overdue = !done && task.dueAt !== null && groupTasks([task], now).overdue.length > 0;

  return (
    <li
      className={cn(
        "group flex min-h-7 cursor-default items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-hover",
        selectedId === task.id && "bg-surface-hover",
      )}
      onClick={() => {
        if (selectedId === task.id) return selectTask(null);
        usePrefsStore.getState().set({ rightPanelOpen: true });
        selectTask(task.id);
      }}
    >
      <TaskCheckbox
        done={done}
        color={color}
        onToggle={() => void toggleTask(task.id)}
        size={14}
        label={done ? t("Marcar «{title}» como pendiente", { title: task.title }) : t("Completar «{title}»", { title: task.title })}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13px]", done ? "text-faint line-through" : "text-strong")}>
          {task.priority === 3 && !done && <span className="mr-1 font-semibold text-danger">!</span>}
          {task.title}
        </span>
        {task.dueAt !== null && !done && (
          <span className={cn("block truncate text-[11px]", overdue ? "text-danger" : "text-muted")}>{formatDue(task, now)}</span>
        )}
      </span>
    </li>
  );
}

function QuickAdd({ onDone }: { onDone: () => void }) {
  const create = useTaskStore((s) => s.create);
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return onDone();
    try {
      await create({ title: t });
      setTitle("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="mt-0.5 flex items-center gap-2 px-1.5">
      <span className="size-[14px] shrink-0 rounded-full" style={{ boxShadow: "inset 0 0 0 1.5px var(--faint)" }} />
      <input
        ref={ref}
        value={title}
        maxLength={1000}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && onDone()}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        placeholder={t("Nueva tarea sin fecha · Enter")}
        className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-strong placeholder:text-faint focus:outline-none"
      />
    </form>
  );
}

function ClearCompleted({ count }: { count: number }) {
  const removeCompleted = useTaskStore((s) => s.removeCompleted);
  const [asking, setAsking] = useState(false);
  return (
    <li>
      <button
        className="flex h-6 w-full items-center gap-1.5 rounded-md px-1.5 pl-7 text-left text-[12px] text-muted hover:bg-surface-hover hover:text-danger"
        onClick={() => setAsking(true)}
      >
        <Trash2 className="size-3" /> {t("Eliminar completadas")}
      </button>
      <ConfirmDialog
        open={asking}
        title={t("¿Eliminar las tareas completadas?")}
        description={tp(count, "Se eliminará {n} tarea completada de forma permanente.", "Se eliminarán {n} tareas completadas de forma permanente.")}
        confirmLabel={t("Eliminar")}
        destructive
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          try {
            await removeCompleted();
          } catch (e) {
            toast.error(errorMessage(e));
          }
          setAsking(false);
        }}
      />
    </li>
  );
}
