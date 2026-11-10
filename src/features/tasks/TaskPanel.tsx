import { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, Clock, Flag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateSelect, TimeSelect } from "@/components/ui/pickers";
import { RemindersEditor } from "@/features/events/RemindersEditor";
import { useCalendarMap } from "@/hooks/useCalendarData";
import { localToAllDay } from "@/lib/dates";
import { errorMessage } from "@/lib/ipc";
import { PRIORITY_LABEL, taskDue, todayAllDay } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { useCalendarStore } from "@/stores/calendarStore";
import { usePrefsStore } from "@/stores/prefsStore";
import { useTaskStore } from "@/stores/taskStore";
import { toast } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import type { Task, TaskPatch } from "@/types/domain";
import { deleteTask, toggleTask } from "./actions";
import { TaskCheckbox } from "./TaskCheckbox";
import { intlLocale, t } from "@/i18n";

const inlineSelect =
  "h-7 max-w-full cursor-pointer appearance-none rounded-md px-1.5 text-[13px] text-strong hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-ring";

/** Detalles de la tarea seleccionada (panel derecho). Todo se guarda solo. */
export function TaskPanel() {
  const id = useUiStore((s) => s.selectedTaskId);
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === id));
  const selectTask = useUiStore((s) => s.selectTask);

  // La tarea dejó de existir (eliminada, restauración de copia…): se cierra.
  useEffect(() => {
    if (id && !task) selectTask(null);
  }, [id, task, selectTask]);

  if (!task) return null;
  return <TaskBody key={task.id} task={task} />;
}

function TaskBody({ task }: { task: Task }) {
  const calendars = useCalendarStore((s) => s.calendars);
  const calendarMap = useCalendarMap();
  const { weekStartsOn, workStartHour } = usePrefsStore();
  const selectTask = useUiStore((s) => s.selectTask);
  const focusTitle = useUiStore((s) => s.focusTaskTitle);
  const update = useTaskStore((s) => s.update);

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const saved = useRef({ title: task.title, notes: task.notes });

  useEffect(() => {
    if (focusTitle) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [focusTitle]);

  async function commit(patch: TaskPatch) {
    try {
      await update(task.id, patch);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  // Título y notas: se guardan tras una pausa al escribir.
  useEffect(() => {
    const t = title.trim();
    if (!t || t === saved.current.title) return;
    const h = setTimeout(() => {
      saved.current.title = t;
      void commit({ title: t });
    }, 600);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);
  useEffect(() => {
    if (notes === saved.current.notes) return;
    const h = setTimeout(() => {
      saved.current.notes = notes;
      void commit({ notes });
    }, 600);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const done = task.completedAt !== null;
  const due = taskDue(task);
  const color = task.calendarId ? calendarMap.get(task.calendarId)?.color : undefined;

  function setDate(d: Date) {
    if (task.isAllDay) return void commit({ dueAt: localToAllDay(d) });
    const cur = due ?? d;
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), cur.getHours(), cur.getMinutes());
    void commit({ dueAt: next.getTime() });
  }

  function toggleAllDay() {
    if (!due) return;
    if (task.isAllDay) {
      const at = new Date(due.getFullYear(), due.getMonth(), due.getDate(), workStartHour);
      void commit({ isAllDay: false, dueAt: at.getTime() });
    } else {
      void commit({ isAllDay: true, dueAt: localToAllDay(due) });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between pl-4 pr-2">
        <span className="text-[13px] font-semibold text-strong">{t("Tarea")}</span>
        <div className="flex">
          <Button variant="ghost" size="icon" onClick={() => void deleteTask(task.id)} aria-label={t("Eliminar tarea")} title={t("Eliminar tarea")}>
            <Trash2 />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => selectTask(null)} aria-label={t("Cerrar")}>
            <X />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex items-start gap-2 px-4 pb-3 pt-1">
          <span className="pt-[7px]">
            <TaskCheckbox
              done={done}
              color={color}
              size={16}
              onToggle={() => void toggleTask(task.id)}
              label={done ? t("Marcar como pendiente") : t("Completar tarea")}
            />
          </span>
          <textarea
            ref={titleRef}
            value={title}
            rows={1}
            maxLength={1000}
            placeholder={t("Título de la tarea")}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
            onBlur={() => !title.trim() && setTitle(saved.current.title)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
            className={cn(
              "field-sizing-content min-w-0 flex-1 resize-none rounded-md bg-transparent px-1.5 py-1 text-[16px] font-semibold leading-snug text-strong placeholder:text-faint focus:bg-control focus:outline-none",
              done && "text-faint line-through",
            )}
          />
        </section>
        {done && (
          <p className="px-4 pb-2 pl-[50px] text-[12px] text-muted">
            {t("Completada el {date}", { date: new Date(task.completedAt!).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" }) })}
          </p>
        )}
        <div className="mx-3 border-t border-border" />

        <section className="space-y-0.5 px-3 py-2.5">
          <Row icon={<Clock className="size-4" />}>
            {due ? (
              <>
                <DateSelect value={due} onChange={setDate} weekStartsOn={weekStartsOn} label={t("Fecha de vencimiento")} />
                {!task.isAllDay && <TimeSelect value={due} onChange={(d) => void commit({ dueAt: d.getTime() })} label={t("Hora de vencimiento")} />}
                <button
                  className="ml-auto flex size-6 items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-strong"
                  onClick={() => void commit({ dueAt: null })}
                  aria-label={t("Quitar fecha")}
                  title={t("Quitar fecha")}
                >
                  <X className="size-3.5" />
                </button>
              </>
            ) : (
              <button
                className="h-7 rounded-md px-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-strong"
                onClick={() => void commit({ dueAt: todayAllDay(), isAllDay: true })}
              >
                {t("Añadir fecha")}
              </button>
            )}
          </Row>
          {due && (
            <Row>
              <label className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-strong">
                <input type="checkbox" className="accent-[var(--accent)]" checked={task.isAllDay} onChange={toggleAllDay} />
                {t("Todo el día")}
              </label>
            </Row>
          )}
          <Row icon={<Flag className={cn("size-4", task.priority === 3 && "text-danger")} />}>
            <select
              value={task.priority}
              onChange={(e) => void commit({ priority: Number(e.target.value) })}
              className={inlineSelect}
              aria-label={t("Prioridad")}
            >
              {PRIORITY_LABEL.map((l, i) => (
                <option key={l} value={i}>
                  {i === 0 ? t(l) : t("Prioridad {level}", { level: t(l).toLocaleLowerCase(intlLocale()) })}
                </option>
              ))}
            </select>
          </Row>
          <Row
            icon={
              color ? <span className="block size-3.5 rounded-[4px]" style={{ background: color }} /> : <CalendarIcon className="size-4" />
            }
          >
            <select
              value={task.calendarId ?? ""}
              onChange={(e) => void commit({ calendarId: e.target.value || null })}
              className={cn(inlineSelect, "font-medium")}
              aria-label={t("Calendario")}
            >
              <option value="">{t("Sin calendario")}</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          {due && (
            <RemindersEditor reminders={task.reminders} allDay={task.isAllDay} onChange={(reminders) => void commit({ reminders })} />
          )}
        </section>
        <div className="mx-3 border-t border-border" />
        <section className="px-3 py-2.5">
          <textarea
            value={notes}
            maxLength={50_000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("Notas")}
            className="field-sizing-content min-h-[72px] w-full resize-none rounded-md bg-transparent px-1.5 py-1 text-[13px] leading-relaxed text-strong placeholder:text-muted hover:bg-surface-hover focus:bg-control focus:outline-none"
          />
        </section>
      </div>
      <div className="shrink-0 px-4 py-2 text-[11px] text-faint">{t("Guardado automáticamente · cifrado en este equipo")}</div>
    </div>
  );
}

function Row({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-1">
      <span className="flex w-6 shrink-0 justify-center text-muted">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">{children}</div>
    </div>
  );
}
