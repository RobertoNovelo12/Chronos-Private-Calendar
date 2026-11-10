import { describe, expect, it } from "vitest";
import { pastedTimes } from "@/features/events/clipboard";
import { DAY_MS, localToAllDay } from "@/lib/dates";
import type { CalendarEvent } from "@/types/domain";

const base: CalendarEvent = {
  id: "a",
  calendarId: "c",
  title: "x",
  description: "",
  location: "",
  links: [],
  color: null,
  startAt: new Date(2026, 10, 3, 9, 30).getTime(),
  endAt: new Date(2026, 10, 3, 10, 45).getTime(),
  timezone: "UTC",
  isAllDay: false,
  visibility: "default",
  availability: "busy",
  status: "confirmed",
  isRecurring: false,
  recurrenceMasterId: null,
  originalStartAt: null,
  recurrence: null,
  reminders: [],
    labels: [],
    attendees: [],
  createdAt: 0,
  updatedAt: 0,
};

describe("pegar eventos", () => {
  it("en la rejilla usa la franja y conserva la duración", () => {
    const t = new Date(2026, 10, 9, 14, 7).getTime();
    const r = pastedTimes(base, { time: t, allDay: false });
    expect(new Date(r.startAt).getHours()).toBe(14);
    expect(new Date(r.startAt).getMinutes()).toBe(0);
    expect(r.endAt - r.startAt).toBe(75 * 60_000);
  });

  it("en un día (mes / día completo) conserva la hora original", () => {
    const r = pastedTimes(base, { time: new Date(2026, 10, 20).getTime(), allDay: true });
    const s = new Date(r.startAt);
    expect([s.getDate(), s.getHours(), s.getMinutes()]).toEqual([20, 9, 30]);
  });

  it("un evento de día completo ocupa los mismos días", () => {
    const allDay = { ...base, isAllDay: true, startAt: localToAllDay(new Date(2026, 10, 3)), endAt: localToAllDay(new Date(2026, 10, 3)) + 2 * DAY_MS };
    const r = pastedTimes(allDay, { time: new Date(2026, 10, 9, 15).getTime(), allDay: false });
    expect(r.startAt).toBe(localToAllDay(new Date(2026, 10, 9)));
    expect(r.endAt - r.startAt).toBe(2 * DAY_MS);
  });
});
