// Lógica pura de tareas: fecha local, agrupación y textos.

import { addDays, differenceInCalendarDays, format, isSameDay, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { allDayToLocal, formatTime } from "@/lib/dates";
import type { Task } from "@/types/domain";

/** Momento de vencimiento en hora local (día completo: medianoche local de la fecha). */
export function taskDue(t: Pick<Task, "dueAt" | "isAllDay">): Date | null {
  if (t.dueAt === null) return null;
  return t.isAllDay ? allDayToLocal(t.dueAt) : new Date(t.dueAt);
}

/** ¿Vence en este día local? */
export function taskOnDay(t: Task, day: Date): boolean {
  const d = taskDue(t);
  return d !== null && isSameDay(d, day);
}

/** Pendiente y su vencimiento ya pasó (día completo: desde el día siguiente). */
export function isOverdue(t: Task, now: Date): boolean {
  if (t.completedAt !== null) return false;
  const d = taskDue(t);
  if (!d) return false;
  return t.isAllDay ? d < startOfDay(now) : d < now;
}

export type TaskGroupId = "overdue" | "today" | "upcoming" | "someday" | "done";

export const TASK_GROUP_LABEL: Record<TaskGroupId, string> = {
  overdue: "Vencidas",
  today: "Hoy",
  upcoming: "Próximas",
  someday: "Sin fecha",
  done: "Completadas",
};

/** Agrupa para la barra lateral. Dentro de cada grupo: por vencimiento, prioridad y orden. */
export function groupTasks(tasks: Task[], now: Date): Record<TaskGroupId, Task[]> {
  const g: Record<TaskGroupId, Task[]> = { overdue: [], today: [], upcoming: [], someday: [], done: [] };
  for (const t of tasks) {
    const d = taskDue(t);
    if (t.completedAt !== null) g.done.push(t);
    else if (!d) g.someday.push(t);
    else if (isOverdue(t, now)) g.overdue.push(t);
    else if (isSameDay(d, now)) g.today.push(t);
    else g.upcoming.push(t);
  }
  const byDue = (a: Task, b: Task) =>
    (taskDue(a)?.getTime() ?? Infinity) - (taskDue(b)?.getTime() ?? Infinity) ||
    // Día completo antes que con hora en el mismo instante; luego prioridad.
    Number(b.isAllDay) - Number(a.isAllDay) ||
    b.priority - a.priority ||
    a.sortOrder - b.sortOrder;
  for (const k of ["overdue", "today", "upcoming"] as const) g[k].sort(byDue);
  g.someday.sort((a, b) => b.priority - a.priority || a.sortOrder - b.sortOrder);
  g.done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return g;
}

/** "Hoy", "Mañana 15:00", "Ayer", "Lun 16 nov", "16 nov 2027 9:00". */
export function formatDue(t: Task, now: Date): string {
  const d = taskDue(t);
  if (!d) return "Sin fecha";
  const diff = differenceInCalendarDays(d, now);
  let day: string;
  if (diff === 0) day = "Hoy";
  else if (diff === 1) day = "Mañana";
  else if (diff === -1) day = "Ayer";
  else if (diff > 1 && diff < 7) day = cap(format(d, "EEEE", { locale: es }));
  else if (d.getFullYear() === now.getFullYear()) day = cap(format(d, "EEE d MMM", { locale: es }).replace(/\./g, ""));
  else day = format(d, "d MMM yyyy", { locale: es }).replace(/\./g, "");
  return t.isAllDay ? day : `${day} ${formatTime(d)}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Vencimiento por defecto de una tarea nueva: hoy, todo el día. */
export function todayAllDay(now = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export const PRIORITY_LABEL = ["Sin prioridad", "Baja", "Media", "Alta"] as const;

/** Siguiente día local (para "vence mañana"). */
export const tomorrow = (now = new Date()) => addDays(startOfDay(now), 1);
