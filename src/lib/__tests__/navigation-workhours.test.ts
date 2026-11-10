import { describe, expect, it } from "vitest";
import { navTarget, type NavItem } from "@/features/calendar/keyboardNav";
import { DEFAULT_WORK_HOURS, parsePrefs, workStartMinutes } from "@/stores/prefsStore";

const H = 3_600_000;
const DAY = 24 * H;
// Lunes (día 0): 9:00 y 14:00 · Martes: 10:00 · Jueves: 8:00, 15:00 (en desorden en el DOM)
const items: NavItem[] = [
  { day: 0, start: 14 * H },
  { day: 0, start: 9 * H },
  { day: DAY, start: DAY + 10 * H },
  { day: 3 * DAY, start: 3 * DAY + 15 * H },
  { day: 3 * DAY, start: 3 * DAY + 8 * H },
];

describe("navTarget", () => {
  it("↓ y ↑ siguen el orden por día y hora", () => {
    expect(navTarget(items, 1, "ArrowDown")).toBe(0);
    expect(navTarget(items, 0, "ArrowDown")).toBe(2);
    expect(navTarget(items, 2, "ArrowDown")).toBe(4);
    expect(navTarget(items, 3, "ArrowDown")).toBeNull();
    expect(navTarget(items, 2, "ArrowUp")).toBe(0);
    expect(navTarget(items, 1, "ArrowUp")).toBeNull();
  });
  it("→ y ← saltan al día con eventos más cercano, a la hora más parecida", () => {
    expect(navTarget(items, 0, "ArrowRight")).toBe(2);
    expect(navTarget(items, 2, "ArrowRight")).toBe(4); // 10:00 → 8:00 (más cerca que 15:00)
    expect(navTarget(items, 0, "ArrowLeft")).toBeNull();
    expect(navTarget(items, 3, "ArrowLeft")).toBe(2);
    expect(navTarget(items, 3, "ArrowRight")).toBeNull();
  });
  it("sin elemento actual empieza por el primero", () => {
    expect(navTarget(items, -1, "ArrowDown")).toBe(0);
    expect(navTarget([], -1, "ArrowDown")).toBeNull();
  });
});

describe("horario laboral por día", () => {
  it("por defecto, lunes a viernes de 9 a 18", () => {
    const p = parsePrefs(null);
    expect(p.workHours).toEqual(DEFAULT_WORK_HOURS);
    expect(p.workHours[0]).toBeNull();
    expect(p.workHours[1]).toEqual({ start: 540, end: 1080 });
  });
  it("migra el horario único anterior a todos los días (como se veía)", () => {
    const p = parsePrefs(JSON.stringify({ workStartHour: 8, workEndHour: 16 }));
    expect(p.workHours).toHaveLength(7);
    expect(p.workHours.every((d) => d?.start === 480 && d.end === 960)).toBe(true);
    expect("workStartHour" in p).toBe(false);
  });
  it("descarta horarios no válidos", () => {
    expect(parsePrefs(JSON.stringify({ workHours: [null] })).workHours).toEqual(DEFAULT_WORK_HOURS);
    expect(parsePrefs(JSON.stringify({ workHours: Array(7).fill({ start: 600, end: 500 }) })).workHours).toEqual(DEFAULT_WORK_HOURS);
  });
  it("hora de inicio de un día libre: la del primer día laborable", () => {
    expect(workStartMinutes(DEFAULT_WORK_HOURS, new Date(2026, 10, 15))).toBe(540); // domingo
    expect(workStartMinutes(Array(7).fill(null), new Date())).toBe(540);
  });
});
