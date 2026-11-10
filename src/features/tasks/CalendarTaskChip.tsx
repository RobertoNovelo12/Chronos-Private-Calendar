import { useCalendarMap } from "@/hooks/useCalendarData";
import { formatTime } from "@/lib/dates";
import { taskDue } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { usePrefsStore } from "@/stores/prefsStore";
import { useUiStore } from "@/stores/uiStore";
import type { Task } from "@/types/domain";
import { toggleTask } from "./actions";
import { TaskCheckbox } from "./TaskCheckbox";

/** Tarea dentro del calendario: casilla + título (y hora si la tiene). */
export function CalendarTaskChip({
  task,
  showTime = true,
  agenda = false,
  className,
}: {
  task: Task;
  showTime?: boolean;
  /** Fila de la Agenda: columna de hora fija como los eventos. */
  agenda?: boolean;
  className?: string;
}) {
  const calendars = useCalendarMap();
  const selected = useUiStore((s) => s.selectedTaskId === task.id);
  const done = task.completedAt !== null;
  const color = task.calendarId ? calendars.get(task.calendarId)?.color : undefined;
  const due = taskDue(task);

  return (
    <div
      role="button"
      tabIndex={-1}
      data-task-key={task.id}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        usePrefsStore.getState().set({ rightPanelOpen: true });
        useUiStore.getState().selectTask(selected ? null : task.id);
      }}
      onContextMenu={(e) => e.stopPropagation()}
      className={cn(
        "flex h-[20px] min-w-0 cursor-default items-center gap-1.5 rounded px-1 text-[11.5px] hover:bg-surface-hover",
        selected && "bg-surface-hover ring-1 ring-border-strong",
        className,
      )}
      title={`Tarea: ${task.title}${due && !task.isAllDay ? ` · ${formatTime(due)}` : ""}`}
    >
      <TaskCheckbox done={done} color={color} size={12} onToggle={() => void toggleTask(task.id)} label={done ? "Marcar como pendiente" : `Completar «${task.title}»`} />
      {agenda ? (
        <span className="w-32 shrink-0 text-[12px] tabular-nums text-muted">{due && !task.isAllDay ? formatTime(due) : "Tarea"}</span>
      ) : (
        showTime && due && !task.isAllDay && <span className="shrink-0 tabular-nums text-muted">{formatTime(due)}</span>
      )}
      <span className={cn("truncate", done ? "text-faint line-through" : "font-medium text-strong")}>{task.title}</span>
    </div>
  );
}
