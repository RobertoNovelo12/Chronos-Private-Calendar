import { describe, expect, it } from "vitest";
import { formatDue, groupTasks, isOverdue, taskDue, taskOnDay } from "@/lib/tasks";
import type { Task } from "@/types/domain";

const NOW = new Date(2026, 10, 10, 12, 0); // martes 10 nov 2026, 12:00 local

function task(p: Partial<Task>): Task {
  return {
    id: p.title ?? "t",
    calendarId: null,
    title: "t",
    notes: "",
    dueAt: null,
    isAllDay: false,
    priority: 0,
    completedAt: null,
    sortOrder: 0,
    reminders: [],
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}
const allDay = (y: number, m: number, d: number) => Date.UTC(y, m, d);
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime();

describe("tareas", () => {
  it("las de día completo usan la fecha, no la hora UTC", () => {
    const t = task({ dueAt: allDay(2026, 10, 10), isAllDay: true });
    expect(taskDue(t)).toEqual(new Date(2026, 10, 10));
    expect(taskOnDay(t, NOW)).toBe(true);
    expect(isOverdue(t, NOW)).toBe(false); // vence hoy: aún no está vencida
    expect(isOverdue(t, new Date(2026, 10, 11, 0, 1))).toBe(true);
  });

  it("agrupa en vencidas, hoy, próximas, sin fecha y completadas", () => {
    const g = groupTasks(
      [
        task({ title: "ayer", dueAt: allDay(2026, 10, 9), isAllDay: true }),
        task({ title: "esta mañana", dueAt: local(2026, 10, 10, 9) }),
        task({ title: "esta tarde", dueAt: local(2026, 10, 10, 18) }),
        task({ title: "hoy", dueAt: allDay(2026, 10, 10), isAllDay: true }),
        task({ title: "viernes", dueAt: local(2026, 10, 13, 9) }),
        task({ title: "alguna vez", priority: 1 }),
        task({ title: "urgente sin fecha", priority: 3 }),
        task({ title: "hecha", dueAt: local(2026, 10, 1), completedAt: 5 }),
      ],
      NOW,
    );
    const titles = (k: keyof typeof g) => g[k].map((t) => t.title);
    expect(titles("overdue")).toEqual(["ayer", "esta mañana"]);
    expect(titles("today")).toEqual(["hoy", "esta tarde"]);
    expect(titles("upcoming")).toEqual(["viernes"]);
    expect(titles("someday")).toEqual(["urgente sin fecha", "alguna vez"]);
    expect(titles("done")).toEqual(["hecha"]);
  });

  it("describe el vencimiento", () => {
    expect(formatDue(task({ dueAt: allDay(2026, 10, 10), isAllDay: true }), NOW)).toBe("Hoy");
    expect(formatDue(task({ dueAt: allDay(2026, 10, 11), isAllDay: true }), NOW)).toBe("Mañana");
    expect(formatDue(task({ dueAt: allDay(2026, 10, 9), isAllDay: true }), NOW)).toBe("Ayer");
    expect(formatDue(task({ dueAt: allDay(2026, 10, 13), isAllDay: true }), NOW)).toBe("Viernes");
    expect(formatDue(task({ dueAt: allDay(2027, 0, 5), isAllDay: true }), NOW)).toBe("5 ene 2027");
    expect(formatDue(task({}), NOW)).toBe("Sin fecha");
  });
});
