import { describe, expect, it } from "vitest";
import { fold, parseDate, parseQuickEvent, type QuickEventOptions } from "../nlp";

// Martes 10 de noviembre de 2026, 14:00 (hora local).
const NOW = new Date(2026, 10, 10, 14, 0);
const OPTS: QuickEventOptions = { now: NOW, weekStartsOn: 1, dayFirst: true, defaultDurationMin: 30 };
const D = (m: number, d: number, y = 2026) => new Date(y, m - 1, d);
const T = (m: number, d: number, h: number, min = 0, y = 2026) => new Date(y, m - 1, d, h, min);

const date = (s: string, o: Partial<QuickEventOptions> = {}) => parseDate(s, { ...OPTS, ...o });
const ev = (s: string, o: Partial<QuickEventOptions> = {}) => parseQuickEvent(s, { ...OPTS, ...o });

describe("fold", () => {
  it("quita acentos y mayúsculas sin cambiar la longitud", () => {
    expect(fold("Miércoles MAÑANA")).toBe("miercoles manana");
    expect(fold("Ñandú 日本")).toHaveLength("Ñandú 日本".length);
  });
});

describe("parseDate (Ir a la fecha)", () => {
  it.each([
    ["hoy", D(11, 10)],
    ["today", D(11, 10)],
    ["mañana", D(11, 11)],
    ["Tomorrow", D(11, 11)],
    ["pasado mañana", D(11, 12)],
    ["ayer", D(11, 9)],
    ["15 dic", D(12, 15)],
    ["15 de diciembre", D(12, 15)],
    ["15 de diciembre de 2027", D(12, 15, 2027)],
    ["dec 15", D(12, 15)],
    ["December 15th, 2027", D(12, 15, 2027)],
    ["the 3rd of march", D(3, 3)],
    ["1 ene", D(1, 1)],
    ["15/12", D(12, 15)],
    ["15/12/2027", D(12, 15, 2027)],
    ["15.12.2027", D(12, 15, 2027)],
    ["2027-02-03", D(2, 3, 2027)],
    ["lunes", D(11, 16)],
    ["martes", D(11, 10)],
    ["próximo martes", D(11, 17)],
    ["next friday", D(11, 13)],
    ["el viernes que viene", D(11, 13)],
    ["vie", D(11, 13)],
    ["Sat", D(11, 14)],
    ["en 3 días", D(11, 13)],
    ["dentro de dos semanas", D(11, 24)],
    ["in 2 weeks", D(11, 24)],
    ["la semana que viene", D(11, 16)],
    ["next week", D(11, 16)],
    ["next month", D(12, 1)],
    ["marzo", D(3, 1)],
    ["march 2027", D(3, 1, 2027)],
    ["2028", D(1, 1, 2028)],
    ["el 20", D(11, 20)],
    ["20", D(11, 20)],
    ["ir a 15 dic", D(12, 15)],
    ["  go to dec 24  ", D(12, 24)],
  ])("«%s»", (text, expected) => {
    expect(date(text)).toEqual(expected);
  });

  it("formato mes/día en inglés de EE. UU.", () => {
    expect(date("12/15", { dayFirst: false })).toEqual(D(12, 15));
    expect(date("3/4/2027", { dayFirst: false })).toEqual(D(3, 4, 2027));
  });

  it("la semana empieza en domingo si así está configurado", () => {
    expect(date("next week", { weekStartsOn: 0 })).toEqual(D(11, 15));
  });

  it.each(["", "hola", "31 feb", "15 dic reunión", "13/13/2026", "lunes martes", "32"])("rechaza «%s»", (text) => {
    expect(date(text)).toBeNull();
  });
});

describe("parseQuickEvent (crear escribiendo)", () => {
  it("Dentista mañana 5pm 1h", () => {
    const r = ev("Dentista mañana 5pm 1h")!;
    expect(r.title).toBe("Dentista");
    expect(r.allDay).toBe(false);
    expect(r.start).toEqual(T(11, 11, 17));
    expect(r.end).toEqual(T(11, 11, 18));
    expect(r.recurrence).toBeNull();
    expect(r.found).toEqual({ date: true, time: true, duration: true, recurrence: false });
  });

  it("Gimnasio lunes y miércoles 7am: semanal y empieza el próximo de esos días", () => {
    const r = ev("Gimnasio lunes y miércoles 7am")!;
    expect(r.title).toBe("Gimnasio");
    expect(r.recurrence).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(r.start).toEqual(T(11, 11, 7));
    expect(r.end).toEqual(T(11, 11, 7, 30));
  });

  it("Viaje 10–12 dic: varios días completos", () => {
    const r = ev("Viaje 10–12 dic")!;
    expect(r.title).toBe("Viaje");
    expect(r.allDay).toBe(true);
    expect(r.start).toEqual(D(12, 10));
    expect(r.end).toEqual(D(12, 13));
  });

  it.each<[string, string, Date, Date, boolean?]>([
    ["Cena con Ana el viernes a las 8 de la noche", "Cena con Ana", T(11, 13, 20), T(11, 13, 20, 30)],
    ["Cena con Ana el viernes a las 9", "Cena con Ana", T(11, 13, 9), T(11, 13, 9, 30)],
    ["Merienda a las 5", "Merienda", T(11, 10, 17), T(11, 10, 17, 30)],
    ["Reunión 10:00-11:30 jueves", "Reunión", T(11, 12, 10), T(11, 12, 11, 30)],
    ["Call 3-4pm tomorrow", "Call", T(11, 11, 15), T(11, 11, 16)],
    ["Brunch 11-1pm Sunday", "Brunch", T(11, 15, 11), T(11, 15, 13)],
    ["Clase de 9 a 5 el lunes", "Clase", T(11, 16, 9), T(11, 16, 17)],
    ["Taller 17h30 jueves 90 min", "Taller", T(11, 12, 17, 30), T(11, 12, 19)],
    ["Taller jueves 17h 2h", "Taller", T(11, 12, 17), T(11, 12, 19)],
    ["Desayuno mañana 8:30 de la mañana", "Desayuno", T(11, 11, 8, 30), T(11, 11, 9)],
    ["Cine 7 de la tarde el sábado", "Cine", T(11, 14, 19), T(11, 14, 19, 30)],
    ["Lunch at noon on friday for an hour", "Lunch", T(11, 13, 12), T(11, 13, 13)],
    ["Lunch at noon friday", "Lunch", T(11, 13, 12), T(11, 13, 12, 30)],
    ["Entrevista 15 dic 10am 45 minutes", "Entrevista", T(12, 15, 10), T(12, 15, 10, 45)],
    ["Revisión 4/1 a las 12:15 por media hora", "Revisión", T(1, 4, 12, 15, 2027), T(1, 4, 12, 45, 2027)],
    ["Partido 20:00 hora y media", "Partido", T(11, 10, 20), T(11, 10, 21, 30)],
    ["Vuelo 23:00-01:30 el 20", "Vuelo", T(11, 20, 23), T(11, 21, 1, 30)],
    ["Llamar a mamá mañana por la tarde", "Llamar a mamá", T(11, 11, 16), T(11, 11, 16, 30)],
    ["Pagar alquiler el 1", "Pagar alquiler", D(12, 1), D(12, 2), true],
    ["Cumpleaños de Ana 3 de marzo", "Cumpleaños de Ana", D(3, 3, 2027), D(3, 4, 2027), true],
    ["Vacaciones del 30 dic al 2 ene", "Vacaciones", D(12, 30), D(1, 3, 2027), true],
    ["Conference dec 7-9", "Conference", D(12, 7), D(12, 10), true],
    ["Dentista", "Dentista", D(11, 10), D(11, 11), true],
    ["Café 9am", "Café", T(11, 11, 9), T(11, 11, 9, 30)],
    ["Café 4pm", "Café", T(11, 10, 16), T(11, 10, 16, 30)],
    ["Doctor next tuesday morning", "Doctor", T(11, 17, 9), T(11, 17, 9, 30)],
    ["Meeting at 10.30am", "Meeting", T(11, 11, 10, 30), T(11, 11, 11)],
    ["Sprint review every 2 weeks friday 4pm", "Sprint review", T(11, 13, 16), T(11, 13, 16, 30)],
    ["Revisar informe en 3 días", "Revisar informe", D(11, 13), D(11, 14), true],
  ])("«%s»", (text, title, start, end, allDay = false) => {
    const r = ev(text)!;
    expect(r).not.toBeNull();
    expect(r.title).toBe(title);
    expect(r.start).toEqual(start);
    expect(r.end).toEqual(end);
    expect(r.allDay).toBe(allDay);
  });

  it.each([
    ["Standup every weekday 9:30", "Standup", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    ["Standup entre semana a las 9:30", "Standup", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    ["Yoga todos los martes 18:00", "Yoga", "FREQ=WEEKLY;BYDAY=TU"],
    ["Yoga los martes y jueves 18:00", "Yoga", "FREQ=WEEKLY;BYDAY=TU,TH"],
    ["Piano mondays 5pm", "Piano", "FREQ=WEEKLY;BYDAY=MO"],
    ["Run every monday, wednesday and friday at 7", "Run", "FREQ=WEEKLY;BYDAY=MO,WE,FR"],
    ["Tomar pastilla todos los días 8am", "Tomar pastilla", "FREQ=DAILY"],
    ["Backup daily 23:00", "Backup", "FREQ=DAILY"],
    ["Pagar tarjeta cada mes el 5", "Pagar tarjeta", "FREQ=MONTHLY"],
    ["Revisión cada 2 semanas jueves 10am", "Revisión", "FREQ=WEEKLY;INTERVAL=2"],
    ["Aniversario cada año 14 feb", "Aniversario", "FREQ=YEARLY"],
    ["Clase todos los lunes 10 veces 9am", "Clase", "FREQ=WEEKLY;BYDAY=MO;COUNT=10"],
  ])("repetición: «%s»", (text, title, rule) => {
    const r = ev(text)!;
    expect(r.title).toBe(title);
    expect(r.recurrence).toBe(rule);
    expect(r.found.recurrence).toBe(true);
  });

  it("repetición con fin: «hasta el 15 dic»", () => {
    const r = ev("Fisioterapia los lunes 6pm hasta el 15 dic")!;
    expect(r.title).toBe("Fisioterapia");
    expect(r.recurrence).toMatch(/^FREQ=WEEKLY;BYDAY=MO;UNTIL=\d{8}T\d{6}Z$/);
    expect(r.start).toEqual(T(11, 16, 18));
  });

  it("la serie diaria empieza mañana si la hora de hoy ya pasó", () => {
    expect(ev("Backup daily 9am")!.start).toEqual(T(11, 11, 9));
    expect(ev("Backup daily 9pm")!.start).toEqual(T(11, 10, 21));
  });

  it("conserva mayúsculas y acentos del título", () => {
    expect(ev("Reunión con José en Él Café mañana 10am")!.title).toBe("Reunión con José en Él Café");
  });

  it("no confunde números del título con horas o fechas", () => {
    expect(ev("Comprar 2 kilos de manzanas")!.title).toBe("Comprar 2 kilos de manzanas");
    expect(ev("Comprar 2 kilos de manzanas")!.allDay).toBe(true);
    expect(ev("Leer capítulo 12")!.title).toBe("Leer capítulo 12");
    expect(ev("Cumpleaños de Mayo")!.title).toBe("Cumpleaños de Mayo");
    expect(ev("Episodio 5 de la serie")!.title).toBe("Episodio 5 de la serie");
    for (const t of ["Reunión 10-12", "Proyecto v2.5 entrega", "Partido 2-1 resumen", "Revisar PR #123"]) {
      expect(ev(t)!.title).toBe(t);
      expect(ev(t)!.allDay).toBe(true);
    }
  });

  it("devuelve null si no queda título", () => {
    expect(ev("")).toBeNull();
    expect(ev("mañana 5pm")).toBeNull();
  });

  it("usa la duración predeterminada", () => {
    const r = ev("Llamada mañana 10am", { defaultDurationMin: 60 })!;
    expect(r.end.getTime() - r.start.getTime()).toBe(60 * 60_000);
  });
});
