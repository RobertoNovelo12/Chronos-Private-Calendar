import { describe, expect, it } from "vitest";
import { addDays } from "date-fns";
import {
  DAY_MS,
  allDayToLocal,
  coversDay,
  fromInputs,
  localToAllDay,
  shiftAnchor,
  snap,
  visibleRange,
} from "../dates";
import { layoutSpans, layoutTimedEvents } from "../layout";
import type { CalendarEvent } from "@/types/domain";

function ev(id: string, start: Date | number, end: Date | number, isAllDay = false): CalendarEvent {
  return {
    id,
    calendarId: "c",
    title: id,
    description: "",
    location: "",
    links: [],
    color: null,
    startAt: typeof start === "number" ? start : start.getTime(),
    endAt: typeof end === "number" ? end : end.getTime(),
    timezone: "UTC",
    isAllDay,
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
}

const at = (h: number, m = 0, day = 9) => new Date(2026, 10, day, h, m);

describe("fechas", () => {
  it("día completo es una fecha flotante", () => {
    const local = new Date(2026, 10, 7);
    const utc = localToAllDay(local);
    expect(utc % DAY_MS).toBe(0);
    expect(allDayToLocal(utc).getTime()).toBe(local.getTime());
  });

  it("rangos visibles", () => {
    const anchor = new Date(2026, 10, 11); // miércoles
    const week = visibleRange("week", anchor, 1);
    expect(week.days).toHaveLength(7);
    expect(week.start.getDay()).toBe(1);
    expect(visibleRange("week", anchor, 0).start.getDay()).toBe(0);
    const month = visibleRange("month", anchor, 1);
    expect(month.days).toHaveLength(42);
    expect(month.start <= new Date(2026, 10, 1)).toBe(true);
    expect(visibleRange("days", anchor, 1, 3).days[0]!.getDate()).toBe(11);
    const fifteen = visibleRange("days", anchor, 0, 15);
    expect(fifteen.days).toHaveLength(15);
    expect(fifteen.start.getDay()).toBe(0);
    expect(shiftAnchor("month", new Date(2026, 0, 31), 1).getMonth()).toBe(1);
  });

  it("ajuste a 15 minutos", () => {
    expect(snap(at(9, 7)).getMinutes()).toBe(0);
    expect(snap(at(9, 8)).getMinutes()).toBe(15);
    expect(snap(at(9, 1), "ceil").getMinutes()).toBe(15);
    expect(snap(at(9, 14), "floor").getMinutes()).toBe(0);
  });

  it("entrada de formularios", () => {
    expect(fromInputs("2026-11-09", "14:30")?.getTime()).toBe(at(14, 30).getTime());
    expect(fromInputs("no", "14:30")).toBeNull();
  });

  it("cobertura de días con fin exclusivo", () => {
    const allDay = ev("a", localToAllDay(new Date(2026, 10, 9)), localToAllDay(new Date(2026, 10, 10)), true);
    expect(coversDay(allDay, new Date(2026, 10, 9))).toBe(true);
    expect(coversDay(allDay, new Date(2026, 10, 10))).toBe(false);
    const night = ev("n", at(23), at(1, 0, 10));
    expect(coversDay(night, new Date(2026, 10, 10))).toBe(true);
    const endsMidnight = ev("m", at(22), at(0, 0, 10));
    expect(coversDay(endsMidnight, new Date(2026, 10, 10))).toBe(false);
  });
});

describe("disposición", () => {
  const days = [new Date(2026, 10, 9), new Date(2026, 10, 10)];

  it("eventos simultáneos se reparten en columnas", () => {
    const segs = layoutTimedEvents([ev("a", at(9), at(11)), ev("b", at(10), at(12)), ev("c", at(13), at(14))], days);
    const a = segs.find((s) => s.event.id === "a")!;
    const b = segs.find((s) => s.event.id === "b")!;
    const c = segs.find((s) => s.event.id === "c")!;
    expect(a.columns).toBe(2);
    expect(b.columns).toBe(2);
    expect(a.column).not.toBe(b.column);
    expect(c.columns).toBe(1);
  });

  it("eventos que cruzan la medianoche se dividen", () => {
    const segs = layoutTimedEvents([ev("n", at(22), at(2, 0, 10))], days);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ dayIndex: 0, top: 22 * 60, bottom: 24 * 60, isStart: true, isEnd: false });
    expect(segs[1]).toMatchObject({ dayIndex: 1, top: 0, bottom: 120, isStart: false, isEnd: true });
  });

  it("barras de día completo sin solapes", () => {
    const week = Array.from({ length: 7 }, (_, i) => addDays(new Date(2026, 10, 9), i));
    const d = (i: number) => localToAllDay(addDays(new Date(2026, 10, 9), i));
    const spans = layoutSpans(
      [ev("x", d(0), d(3), true), ev("y", d(1), d(2), true), ev("z", d(5), d(9), true)],
      week,
      () => true,
    );
    const x = spans.find((s) => s.event.id === "x")!;
    const y = spans.find((s) => s.event.id === "y")!;
    const z = spans.find((s) => s.event.id === "z")!;
    expect([x.startIndex, x.endIndex]).toEqual([0, 2]);
    expect(y.row).not.toBe(x.row);
    expect(z.endIndex).toBe(6);
    expect(z.clippedEnd).toBe(true);
  });
});

import { buildRule, describeRule, describeReminder, nthWeekdayOfMonth, parseRule, presets, untilEndOfDay, untilToDate } from "../rrule";

describe("reglas de repetición", () => {
  const mon = new Date(2026, 10, 9, 9, 0); // lunes 9 nov 2026
  it("presets según la fecha", () => {
    const p = presets(mon);
    expect(p[1]).toEqual({ label: "Cada semana el lunes", rule: "FREQ=WEEKLY;BYDAY=MO" });
    expect(p[4]!.rule).toBe("FREQ=MONTHLY;BYDAY=2MO");
    expect(nthWeekdayOfMonth(new Date(2026, 10, 30))).toBe(-1);
  });
  it("ida y vuelta y descripciones", () => {
    const r = buildRule({ freq: "WEEKLY", interval: 2, byDay: ["MO", "WE"], byMonthDay: [], count: 10 });
    expect(r).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10");
    expect(parseRule(r)).toMatchObject({ freq: "WEEKLY", interval: 2, byDay: ["MO", "WE"], count: 10 });
    expect(describeRule(r, mon, false)).toBe("Cada 2 semanas el lunes y miércoles, 10 veces");
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", mon, false)).toBe("Cada día laborable");
    expect(describeRule("FREQ=MONTHLY;BYDAY=-1FR", mon, false)).toBe("Cada mes el último viernes");
    expect(describeRule(null, mon, false)).toBe("No se repite");
  });
  it("fecha de fin", () => {
    const u = untilEndOfDay(new Date(2026, 11, 31), true);
    expect(u).toBe("20261231T235959Z");
    expect(untilToDate(u, true)!.getDate()).toBe(31);
    expect(describeRule(`FREQ=DAILY;UNTIL=${u}`, mon, true)).toContain("hasta el 31 dic 2026");
  });
  it("recordatorios", () => {
    expect(describeReminder(30, false)).toBe("30 minutos antes");
    expect(describeReminder(60, false)).toBe("1 hora antes");
    expect(describeReminder(1440, false)).toBe("1 día antes");
    expect(describeReminder(10080, false)).toBe("1 semana antes");
    expect(describeReminder(900, true)).toBe("El día anterior a las 9:00");
  });
});

import { formatOffsetShort, instantFromWall, matchesZone, offsetMinutes, wallTimeIn } from "../timezones";

describe("zonas horarias", () => {
  it("desfases y horario de verano", () => {
    expect(offsetMinutes("America/Mexico_City", Date.UTC(2026, 10, 7))).toBe(-360);
    expect(offsetMinutes("America/New_York", Date.UTC(2026, 6, 1))).toBe(-240);
    expect(offsetMinutes("America/New_York", Date.UTC(2026, 11, 1))).toBe(-300);
    expect(offsetMinutes("Asia/Kolkata")).toBe(330);
    expect(formatOffsetShort(330)).toBe("GMT+5:30");
    expect(formatOffsetShort(-300)).toBe("GMT−5");
  });
  it("hora de reloj ⇄ instante", () => {
    const t = instantFromWall({ year: 2026, month: 11, day: 9, hour: 9, minute: 30, second: 0 }, "America/New_York");
    expect(t).toBe(Date.UTC(2026, 10, 9, 14, 30));
    expect(wallTimeIn(t, "Europe/Madrid")).toMatchObject({ hour: 15, minute: 30 });
    // Hueco de DST (2:30 no existe el 8 mar 2026 en Nueva York): se resuelve sin error.
    const gap = instantFromWall({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, "America/New_York");
    expect(Number.isFinite(gap)).toBe(true);
  });
  it("búsqueda sin acentos", () => {
    expect(matchesZone("America/Mexico_City", "mexico")).toBe(true);
    expect(matchesZone("Asia/Kolkata", "GMT+5:30")).toBe(true);
    expect(matchesZone("Europe/London", "tokio")).toBe(false);
  });
});
