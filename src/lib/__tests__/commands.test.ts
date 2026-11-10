import { describe, expect, it } from "vitest";
import { matchScore, rankCommands } from "../commands";

const ITEMS = [
  { id: "new-event", label: "Nuevo evento" },
  { id: "new-task", label: "Nueva tarea" },
  { id: "today", label: "Ir a hoy" },
  { id: "goto", label: "Ir a la fecha…" },
  { id: "week", label: "Vista: Semana" },
  { id: "month", label: "Vista: Mes" },
  { id: "backup", label: "Crear copia de seguridad ahora" },
  { id: "privacy", label: "Privacidad y seguridad" },
  { id: "lock", label: "Bloquear Chronos" },
  { id: "theme-dark", label: "Tema oscuro" },
  { id: "lang", label: "Language", keywords: ["Idioma"] },
];
const ids = (q: string) => rankCommands(ITEMS, q).map((i) => i.id);

describe("matchScore", () => {
  it("ordena igual > empieza > palabra > contiene > iniciales", () => {
    const scores = [
      matchScore("semana", "semana"),
      matchScore("Semanal", "semana"),
      matchScore("Vista: Semana", "semana"),
      matchScore("fin de semanas", "eman"),
      matchScore("Nueva tarea", "nt"),
      matchScore("Language", "nue"),
    ];
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(scores.slice(0, -1).every((s) => s > 0)).toBe(true);
    expect(scores.at(-1)).toBe(0);
  });
  it("ignora acentos y mayúsculas", () => {
    expect(matchScore("Configuración", "CONFIGURACION")).toBe(100);
    expect(matchScore("Ir a la fecha", "fecha")).toBeGreaterThan(0);
  });
  it("no coincide si faltan letras", () => {
    expect(matchScore("Vista: Mes", "semana")).toBe(0);
    expect(matchScore("Bloquear", "x")).toBe(0);
  });
});

describe("rankCommands", () => {
  it("sin búsqueda devuelve todo en su orden", () => {
    expect(ids("")).toEqual(ITEMS.map((i) => i.id));
  });
  it("pone primero lo que empieza igual", () => {
    expect(ids("nue")).toEqual(["new-event", "new-task"]);
    expect(ids("ir a")).toEqual(["today", "goto"]);
  });
  it("encuentra por palabra interior y sin acentos", () => {
    expect(ids("semana")[0]).toBe("week");
    expect(ids("segur")).toEqual(["backup", "privacy"]);
    expect(ids("oscuro")).toEqual(["theme-dark"]);
  });
  it("varias palabras en cualquier orden", () => {
    expect(ids("copia crear")).toEqual(["backup"]);
  });
  it("palabras clave adicionales (otro idioma)", () => {
    expect(ids("idioma")).toEqual(["lang"]);
    expect(ids("lang")).toEqual(["lang"]);
  });
  it("iniciales", () => {
    expect(ids("bch")).toContain("lock");
  });
});
