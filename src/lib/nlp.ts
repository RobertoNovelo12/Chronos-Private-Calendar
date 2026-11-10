// Intérprete local de fechas y eventos escritos en español o inglés.
//
// «Dentista mañana 5pm 1h», «Gimnasio lunes y miércoles 7am», «Viaje 10–12 dic»,
// «Standup every weekday 9:30», «next friday». Todo se resuelve en el equipo:
// sin red, sin modelos, solo expresiones regulares sobre el texto.
//
// Funcionamiento: el texto se pliega (minúsculas, sin acentos, misma longitud)
// y se recorre con patrones en un orden fijo. Cada patrón que acierta marca sus
// caracteres como usados para que el siguiente no los reutilice; lo que queda
// sin usar es el título, con su ortografía original.

import { addDays, addMonths, addWeeks, addYears, isValid, startOfDay } from "date-fns";
import { untilEndOfDay } from "./rrule";

export interface ParseOptions {
  now: Date;
  weekStartsOn: 0 | 1;
  /** Fechas numéricas: 15/12 (día primero) o 12/15 (mes primero, inglés de EE. UU.). */
  dayFirst: boolean;
}

export interface QuickEventOptions extends ParseOptions {
  defaultDurationMin: number;
}

export interface QuickEvent {
  title: string;
  allDay: boolean;
  start: Date;
  /** Exclusivo. En día completo, medianoche del día siguiente al último. */
  end: Date;
  recurrence: string | null;
  found: { date: boolean; time: boolean; duration: boolean; recurrence: boolean };
}

// ---------------------------------------------------------------------------
// Vocabulario (ya plegado: minúsculas y sin acentos)

const MONTHS: Record<string, number> = {};
const addMonthsWords = (m: number, ...words: string[]) => words.forEach((w) => (MONTHS[w] = m));
addMonthsWords(0, "enero", "ene", "january", "jan");
addMonthsWords(1, "febrero", "feb", "february");
addMonthsWords(2, "marzo", "mar", "march");
addMonthsWords(3, "abril", "abr", "april", "apr");
addMonthsWords(4, "mayo", "may");
addMonthsWords(5, "junio", "jun", "june");
addMonthsWords(6, "julio", "jul", "july");
addMonthsWords(7, "agosto", "ago", "august", "aug");
addMonthsWords(8, "septiembre", "setiembre", "sept", "sep", "set", "september");
addMonthsWords(9, "octubre", "oct", "october");
addMonthsWords(10, "noviembre", "nov", "november");
addMonthsWords(11, "diciembre", "dic", "december", "dec");

/** Nombres completos: válidos en cualquier frase. */
const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
/** Abreviaturas: solo cuando todo el texto es una fecha («Ir a la fecha»). */
const WEEKDAY_ABBR: Record<string, number> = {
  dom: 0, lun: 1, mar: 2, mie: 3, mier: 3, jue: 4, vie: 5, sab: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

const SMALL_NUMBERS: Record<string, number> = {
  un: 1, una: 1, uno: 1, a: 1, an: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4,
  cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10,
};

const alt = (words: string[]) => [...words].sort((a, b) => b.length - a.length).join("|");
const MONTH = `(${alt(Object.keys(MONTHS))})\\.?`;
const WD_FULL = `(${alt(Object.keys(WEEKDAYS))})`;
const WD_ANY = `(${alt([...Object.keys(WEEKDAYS), ...Object.keys(WEEKDAY_ABBR)])})\\.?`;
const NUM = `(\\d+|${alt(Object.keys(SMALL_NUMBERS))})`;
const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const DASH = "(?:-|–|—)";

const YEAR = `(?:,?\\s*(?:de\\s+|del\\s+|of\\s+)?(\\d{4}))?`;
const ORD = "(?:º|°|ª|st|nd|rd|th)?";

const re = (src: string) => new RegExp(L + src + R, "gu");
/** Para horas: tampoco pueden empezar justo después de «:» o «.» («23:00»). */
const reTime = (src: string) => new RegExp("(?<![\\p{L}\\p{N}:.])" + src + R, "gu");
const num = (s: string) => SMALL_NUMBERS[s] ?? Number(s);
const weekdayOf = (w: string) => WEEKDAYS[w] ?? WEEKDAY_ABBR[w.replace(/\.$/, "")]!;

/** Minúsculas y sin acentos, conservando la longitud (un carácter por carácter). */
export function fold(s: string): string {
  let out = "";
  for (const c of s) {
    const base = c.toLowerCase().normalize("NFD")[0] ?? c;
    out += base.length === c.length ? base : c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recorrido del texto

interface Hit {
  start: number;
  end: number;
}

class Scanner {
  readonly s: string;
  private readonly used: boolean[];
  constructor(readonly original: string) {
    this.s = fold(original);
    this.used = Array.from({ length: this.s.length }, () => false);
  }
  /** Recorre las coincidencias libres; `fn` devuelve false para no consumir. */
  each(rx: RegExp, fn: (m: RegExpExecArray) => boolean | void, once = false): boolean {
    let any = false;
    rx.lastIndex = 0;
    for (let m = rx.exec(this.s); m; m = rx.exec(this.s)) {
      if (m[0].length === 0) {
        rx.lastIndex++;
        continue;
      }
      const end = m.index + m[0].length;
      if (this.isUsed(m.index, end)) {
        rx.lastIndex = m.index + 1;
        continue;
      }
      if (fn(m) === false) {
        rx.lastIndex = m.index + 1;
        continue;
      }
      this.mark({ start: m.index, end });
      any = true;
      if (once) break;
    }
    return any;
  }
  isUsed(a: number, b: number) {
    for (let i = a; i < b; i++) if (this.used[i]) return true;
    return false;
  }
  mark(h: Hit) {
    for (let i = h.start; i < h.end; i++) this.used[i] = true;
  }
  /** Texto libre justo antes de `pos` (para conectores como «hasta el»). */
  before(pos: number): string {
    let i = pos;
    while (i > 0 && !this.used[i - 1]) i--;
    return this.s.slice(i, pos);
  }
  /** Texto original no usado, en trozos. */
  rest(): string {
    let out = "";
    for (let i = 0; i < this.original.length; i++) out += this.used[i] ? " " : this.original[i];
    return out;
  }
  /** Lo que queda sin usar, plegado (para comprobar que no sobra nada). */
  restFolded(): string {
    let out = "";
    for (let i = 0; i < this.s.length; i++) out += this.used[i] ? " " : this.s[i];
    return out;
  }
}

// ---------------------------------------------------------------------------
// Fechas

interface FoundDate {
  date: Date;
  /** Último día (inclusive) en un intervalo «10–12 dic». */
  last?: Date;
  hit: Hit;
}

function makeDate(y: number, m: number, d: number): Date | null {
  const out = new Date(y, m, d);
  return isValid(out) && out.getMonth() === m && out.getDate() === d ? out : null;
}

/** Día y mes sin año: este año, o el siguiente si ya pasó (si `future`). */
function resolveYear(m: number, d: number, today: Date, future: boolean): Date | null {
  const y = today.getFullYear();
  const date = makeDate(y, m, d) ?? makeDate(y + 1, m, d);
  if (!date) return null;
  if (future && date < today) return makeDate(y + 1, m, d);
  return date;
}

const fullYear = (s: string | undefined) => {
  if (!s) return undefined;
  const n = Number(s);
  return s.length <= 2 ? 2000 + n : n;
};

function nextWeekday(today: Date, wd: number, strictlyAfter: boolean): Date {
  let diff = (wd - today.getDay() + 7) % 7;
  if (diff === 0 && strictlyAfter) diff = 7;
  return addDays(today, diff);
}

function startOfWeekFrom(d: Date, weekStartsOn: 0 | 1): Date {
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(d, -diff);
}

interface DateCtx {
  sc: Scanner;
  today: Date;
  opts: ParseOptions;
  future: boolean;
  strict: boolean;
  out: FoundDate[];
}

function push(ctx: DateCtx, m: RegExpExecArray, date: Date | null, last?: Date | null): boolean {
  if (!date) return false;
  if (last && last < date) return false;
  ctx.out.push({ date, last: last ?? undefined, hit: { start: m.index, end: m.index + m[0].length } });
  return true;
}

/** Formas con mes, ISO y numéricas (van antes que las horas: «10–12 dic» no es un intervalo de horas). */
function findExplicitDates(ctx: DateCtx) {
  const { sc, today, future } = ctx;
  const year = fullYear;
  const withYear = (y: number | undefined, m: number, d: number) => (y ? makeDate(y, m, d) : resolveYear(m, d, today, future));

  // Intervalos dentro de un mes: «10–12 dic», «del 10 al 12 de diciembre», «dec 10-12».
  sc.each(re(`(?:(?:del|de|from)\\s+)?(\\d{1,2})${ORD}\\s*(?:${DASH}|al|a|to|until|hasta)\\s*(\\d{1,2})${ORD}\\s+(?:de\\s+|of\\s+)?${MONTH}${YEAR}`), (m) => {
    const mo = MONTHS[m[3]!]!;
    const y = year(m[4]);
    const a = withYear(y, mo, Number(m[1]));
    const b = a ? makeDate(a.getFullYear(), mo, Number(m[2])) : null;
    return push(ctx, m, a, b);
  });
  sc.each(re(`${MONTH}\\s+(\\d{1,2})${ORD}\\s*(?:${DASH}|to|until)\\s*(\\d{1,2})${ORD}${YEAR}`), (m) => {
    const mo = MONTHS[m[1]!]!;
    const a = withYear(year(m[4]), mo, Number(m[2]));
    const b = a ? makeDate(a.getFullYear(), mo, Number(m[3])) : null;
    return push(ctx, m, a, b);
  });

  // ISO: 2026-12-15
  sc.each(re(`(\\d{4})-(\\d{1,2})-(\\d{1,2})`), (m) => push(ctx, m, makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
  // Numérica: 15/12, 15/12/2026, 15.12.2026
  sc.each(re(`(\\d{1,2})(?:\\/(\\d{1,2})(?:\\/(\\d{2,4}))?|\\.(\\d{1,2})\\.(\\d{4}))`), (m) => {
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[4]);
    const [d, mo] = ctx.opts.dayFirst ? [a, b] : [b, a];
    return push(ctx, m, withYear(year(m[3] ?? m[5]), mo - 1, d));
  });
  // Día y mes: «15 dic», «15 de diciembre de 2026», «the 15th of december»
  sc.each(re(`(?:(?:el|the)\\s+)?(\\d{1,2})${ORD}\\s*(?:de\\s+|of\\s+)?${MONTH}${YEAR}`), (m) =>
    push(ctx, m, withYear(year(m[3]), MONTHS[m[2]!]!, Number(m[1]))),
  );
  // Mes y día: «dec 15», «december 15th, 2026»
  sc.each(re(`${MONTH}\\s+(\\d{1,2})${ORD}${YEAR}`), (m) => push(ctx, m, withYear(year(m[3]), MONTHS[m[1]!]!, Number(m[2]))));
}

/** Palabras relativas, días de la semana y día del mes. */
function findRelativeDates(ctx: DateCtx) {
  const { sc, today, future } = ctx;
  const year = fullYear;

  // Palabras relativas.
  sc.each(re(`(?:pasado\\s+manana|day\\s+after\\s+tomorrow)`), (m) => push(ctx, m, addDays(today, 2)));
  sc.each(re(`(?:antes\\s+de\\s+ayer|anteayer|day\\s+before\\s+yesterday)`), (m) => push(ctx, m, addDays(today, -2)));
  sc.each(re(`(?:hoy|today|tonight|esta\\s+noche|esta\\s+tarde)`), (m) => push(ctx, m, today));
  sc.each(re(`(?:manana|tomorrow)`), (m) => push(ctx, m, addDays(today, 1)));
  sc.each(re(`(?:ayer|yesterday)`), (m) => push(ctx, m, addDays(today, -1)));

  // «en 3 días», «dentro de 2 semanas», «in 3 days»
  sc.each(re(`(?:en|dentro\\s+de|in)\\s+${NUM}\\s+(dias?|semanas?|mes|meses|anos?|days?|weeks?|months?|years?)`), (m) => {
    const n = num(m[1]!);
    const u = m[2]!;
    const d = /^(dia|day)/.test(u) ? addDays(today, n) : /^(semana|week)/.test(u) ? addWeeks(today, n) : /^(mes|month)/.test(u) ? addMonths(today, n) : addYears(today, n);
    return push(ctx, m, d);
  });
  // «la semana que viene», «next week», «el mes que viene», «next month», «este fin de semana»
  sc.each(re(`(?:(?:la\\s+)?(?:proxima\\s+semana|semana\\s+(?:que\\s+viene|proxima))|next\\s+week)`), (m) =>
    push(ctx, m, startOfWeekFrom(addWeeks(today, 1), ctx.opts.weekStartsOn)),
  );
  sc.each(re(`(?:(?:el\\s+)?(?:proximo\\s+mes|mes\\s+(?:que\\s+viene|proximo))|next\\s+month)`), (m) =>
    push(ctx, m, new Date(today.getFullYear(), today.getMonth() + 1, 1)),
  );
  sc.each(re(`(?:(?:el\\s+|este\\s+)?fin\\s+de\\s+semana|(?:this\\s+|the\\s+)?weekend)`), (m) => push(ctx, m, nextWeekday(today, 6, false)));

  // Día de la semana: «lunes», «el próximo viernes», «next friday», «el lunes que viene».
  const WD = ctx.strict ? WD_ANY : WD_FULL;
  sc.each(re(`(?:(?:el|este|this|on)\\s+)?(?:(proximo|siguiente|next)\\s+)?${WD}(?:\\s+(que\\s+viene|proximo))?`), (m) => {
    const strictly = !!(m[1] || m[3]);
    return push(ctx, m, nextWeekday(today, weekdayOf(m[2]!), strictly));
  });

  // Día del mes: «el 15», «el día 15», «the 15th»
  sc.each(re(`(?:el\\s+(?:dia\\s+)?|dia\\s+|(?:on\\s+)?the\\s+)(\\d{1,2})${ORD}`), (m) => {
    const d = Number(m[1]);
    let date = makeDate(today.getFullYear(), today.getMonth(), d);
    if (date && future && date < today) date = makeDate(today.getFullYear(), today.getMonth() + 1, d) ?? addMonths(date, 1);
    return push(ctx, m, date);
  });

  if (ctx.strict) {
    // Solo en «Ir a la fecha»: mes suelto («marzo», «march 2027»), año suelto o «15».
    sc.each(re(`${MONTH}${YEAR}`), (m) => push(ctx, m, makeDate(year(m[2]) ?? today.getFullYear(), MONTHS[m[1]!]!, 1)));
    sc.each(re(`(\\d{4})`), (m) => push(ctx, m, makeDate(Number(m[1]), 0, 1)));
    sc.each(re(`(\\d{1,2})${ORD}`), (m) => push(ctx, m, makeDate(today.getFullYear(), today.getMonth(), Number(m[1]))));
  }
}

const FILLER = /^[\s,.;:·]*$/;
const STRICT_FILLER = re(`(?:ir\\s+a(?:l)?|go\\s+to|jump\\s+to|el|la|the|on|de|del|of)`);

/** Fecha escrita («15 dic», «próximo lunes», «2026-12-15»). Null si sobra texto o no se entiende. */
export function parseDate(text: string, opts: ParseOptions): Date | null {
  if (!text.trim()) return null;
  const sc = new Scanner(text.trim());
  const ctx: DateCtx = { sc, today: startOfDay(opts.now), opts, future: false, strict: true, out: [] };
  findExplicitDates(ctx);
  findRelativeDates(ctx);
  if (ctx.out.length !== 1) return null;
  sc.each(STRICT_FILLER, () => true);
  return FILLER.test(sc.restFolded()) ? ctx.out[0]!.date : null;
}

// ---------------------------------------------------------------------------
// Horas y duraciones

interface Clock {
  h: number;
  m: number;
}

const AM = "(?:am|a\\.m\\.?)";
const PM = "(?:pm|p\\.m\\.?)";
const PERIOD_AM = "(?:de\\s+la\\s+manana|por\\s+la\\s+manana|in\\s+the\\s+morning)";
const PERIOD_PM = "(?:de\\s+la\\s+(?:tarde|noche)|por\\s+la\\s+(?:tarde|noche)|in\\s+the\\s+(?:afternoon|evening)|at\\s+night)";
const SUFFIX = `(?:\\s*(${AM}|${PM}|${PERIOD_AM}|${PERIOD_PM}))?`;

function suffixKind(s: string | undefined): "am" | "pm" | null {
  if (!s) return null;
  if (new RegExp(`^(?:${AM}|${PERIOD_AM})$`, "u").test(s)) return "am";
  return "pm";
}

/** Hora en 24 h; sin am/pm, de 1 a 6 se entiende de la tarde («a las 5» → 17:00). */
function to24(h: number, m: number, kind: "am" | "pm" | null, leadingZero: boolean): Clock | null {
  if (m > 59) return null;
  if (kind) {
    if (h < 1 || h > 12) return kind === "pm" && h >= 13 && h <= 23 ? { h, m } : null;
    return { h: kind === "am" ? h % 12 : (h % 12) + 12, m };
  }
  if (h > 24) return null;
  if (h === 24) return m === 0 ? { h: 0, m } : null;
  if (!leadingZero && h >= 1 && h <= 6) return { h: h + 12, m };
  return { h, m };
}

interface TimeResult {
  start?: Clock;
  end?: Clock;
  durationMin?: number;
  /** Momento del día sin hora concreta («por la tarde»). */
  vague?: Clock;
}

function findTimes(sc: Scanner): TimeResult {
  const r: TimeResult = {};
  const T = `(\\d{1,2})(?:[:.](\\d{2}))?\\s*(${AM}|${PM})?`;

  // Intervalos: «5-6pm», «de 10 a 11:30», «from 9 to 5», «10:00–11:30»
  sc.each(
    reTime(`(?:(de|desde|from|entre|between)\\s+(?:las\\s+)?)?${T}\\s*(?:${DASH}|a|al|to|hasta|until|y|and)\\s*(?:las\\s+)?${T}${SUFFIX}`),
    (m) => {
      const [, pre, h1, m1, s1, h2, m2, s2, period] = m;
      if (!pre && !m1 && !m2 && !s1 && !s2 && !period) return false;
      const H1 = Number(h1);
      const H2 = Number(h2);
      const M1 = Number(m1 ?? 0);
      const M2 = Number(m2 ?? 0);
      const k2 = suffixKind(s2) ?? suffixKind(period);
      let k1 = suffixKind(s1);
      if (!k1 && k2) {
        // «5-6pm» → 17–18; «11-1pm» → 11–13
        const end = to24(H2, M2, k2, false);
        if (!end) return false;
        k1 = k2 === "pm" && ((H1 % 12) + 12) * 60 + M1 < end.h * 60 + end.m ? "pm" : "am";
      }
      const literal = (hh: string, h: number, mm: string | undefined) => hh.startsWith("0") || h > 12 || (!!mm && h >= 7);
      const a = to24(H1, M1, k1, literal(h1!, H1, m1));
      const b = to24(H2, M2, k2, literal(h2!, H2, m2));
      if (!a || !b) return false;
      // «de 9 a 5» → 9–17; si aun así acaba antes, termina al día siguiente («23:00-01:30»).
      if (!k2 && !literal(h2!, H2, m2) && b.h < 12 && b.h * 60 + b.m <= a.h * 60 + a.m) b.h += 12;
      if (b.h === a.h && b.m === a.m) return false;
      r.start = a;
      r.end = b;
      return true;
    },
    true,
  );

  if (!r.start) {
    // Hora suelta: «5pm», «17:00», «a las 5», «at 9», «17h», «17h30», «9:30 de la mañana»
    sc.each(
      reTime(`(?:(a\\s+las?|at|@)\\s*)?(\\d{1,2})(?:(:|\\.|h)(\\d{2})|(h))?\\s*(${AM}|${PM})?(?:\\s+(${PERIOD_AM}|${PERIOD_PM}))?`),
      (m) => {
        const [, pre, hh, sep, mm, hOnly, ap, period] = m;
        const H = Number(hh);
        if (sep === "." && !ap) return false; // «5.30» sin am/pm es ambiguo
        if (hOnly && !pre && H <= 8) return false; // «2h» es una duración
        if (sep === "h" && !pre && H <= 8) return false; // «1h30» también
        if (!pre && !mm && !hOnly && !ap && !period) return false;
        const c = to24(H, Number(mm ?? 0), suffixKind(ap) ?? suffixKind(period), hh!.startsWith("0") || H > 12 || (!!mm && H >= 7) || !!hOnly);
        if (!c) return false;
        r.start = c;
        return true;
      },
      true,
    );
  }
  if (!r.start) {
    sc.each(reTime(`(?:a\\s+(?:el\\s+)?|at\\s+)?(?:mediodia|noon|midday)`), () => void (r.start = { h: 12, m: 0 }), true) ||
      sc.each(reTime(`(?:a\\s+)?(?:medianoche|midnight)`), () => void (r.start = { h: 0, m: 0 }), true);
  }

  // Duraciones: «1h», «1h30», «90 min», «2 horas», «for 45 minutes», «media hora», «hora y media»
  const durPrefix = "(?:(?:durante|por|for)\\s+)?";
  sc.each(re(`${durPrefix}(?:(?:una|1|an|one)\\s+)?(?:hora\\s+y\\s+media|hour\\s+and\\s+a\\s+half)|${durPrefix}${NUM}\\s+(?:horas?|hours?)\\s+(?:y\\s+media|and\\s+a\\s+half)`), (m) => {
    const n = m[1] ? num(m[1]) : 1;
    r.durationMin = n * 60 + 30;
  }, true);
  if (r.durationMin === undefined) {
    sc.each(re(`${durPrefix}(?:media\\s+hora|half\\s+an\\s+hour|half\\s+hour)`), () => void (r.durationMin = 30), true);
  }
  if (r.durationMin === undefined) {
    sc.each(
      re(`${durPrefix}(\\d+(?:[.,]\\d+)?|${alt(Object.keys(SMALL_NUMBERS))})\\s*(?:h|hr|hrs|horas?|hours?)(?:\\s*(?:y\\s+)?(\\d{1,2})\\s*(?:m|min|mins|minutos?|minutes?)?)?`),
      (m) => {
        const h = m[1]!.match(/\d/) ? Number(m[1]!.replace(",", ".")) : num(m[1]!);
        const mins = Math.round(h * 60) + Number(m[2] ?? 0);
        if (mins <= 0 || mins > 7 * 24 * 60) return false;
        r.durationMin = mins;
        return true;
      },
      true,
    );
  }
  if (r.durationMin === undefined) {
    sc.each(re(`${durPrefix}(\\d+)\\s*(?:m|min|mins|minutos?|minutes?)`), (m) => {
      const mins = Number(m[1]);
      if (mins <= 0 || mins > 7 * 24 * 60) return false;
      r.durationMin = mins;
      return true;
    }, true);
  }

  // Momento del día sin hora: «por la mañana», «in the evening»
  if (!r.start) {
    sc.each(re(`(?:por\\s+la\\s+manana|(?:in\\s+the\\s+|this\\s+)?morning)`), () => void (r.vague = { h: 9, m: 0 }), true) ||
      sc.each(re(`(?:por\\s+la\\s+tarde|(?:in\\s+the\\s+|this\\s+)?afternoon)`), () => void (r.vague = { h: 16, m: 0 }), true) ||
      sc.each(re(`(?:por\\s+la\\s+noche|(?:in\\s+the\\s+|this\\s+)?evening)`), () => void (r.vague = { h: 20, m: 0 }), true);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Repetición

interface Recurrence {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number;
  days?: number[];
  count?: number;
}

function findRecurrence(sc: Scanner): Recurrence | null {
  let rec: Recurrence | null = null;
  const set = (r: Recurrence) => {
    rec = r;
  };

  sc.each(
    re(`(?:(?:todos\\s+los\\s+)?dias\\s+laborables|entre\\s+semana|de\\s+lunes\\s+a\\s+viernes|(?:every\\s+|on\\s+)?weekdays?|every\\s+weekday|monday\\s+(?:to|through|thru)\\s+friday|lun\\s*${DASH}\\s*vie|mon\\s*${DASH}\\s*fri)`),
    () => set({ freq: "WEEKLY", days: [1, 2, 3, 4, 5] }),
    true,
  );

  if (!rec) {
    sc.each(re(`(?:cada|every)\\s+(\\d+|${alt(Object.keys(SMALL_NUMBERS))})\\s+(dias?|semanas?|mes|meses|anos?|days?|weeks?|months?|years?)`), (m) => {
      const n = num(m[1]!);
      const u = m[2]!;
      if (n < 1 || n > 999) return false;
      set({ freq: /^(dia|day)/.test(u) ? "DAILY" : /^(semana|week)/.test(u) ? "WEEKLY" : /^(mes|month)/.test(u) ? "MONTHLY" : "YEARLY", interval: n });
      return true;
    }, true);
  }

  if (!rec) {
    // Días de la semana: «lunes y miércoles», «todos los martes», «every monday and friday», «mondays»
    const one = `(?:${WD_FULL}|(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays))`;
    const sep = "\\s*(?:,|y|e|and|&|\\/)\\s*(?:(?:el|los|on)\\s+)?";
    sc.each(re(`(?:(todos\\s+los|todas\\s+las|cada|los|every|on)\\s+)?${one}(?:${sep}${one})*`), (m) => {
      const words = m[0].match(new RegExp(`mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|${WD_FULL}`, "gu")) ?? [];
      const plural = words.some((w) => w.endsWith("s") && !(w in WEEKDAYS));
      const marker = !!m[1];
      if (words.length < 2 && !plural && !marker) return false;
      if (m[1] === "on" && words.length < 2 && !plural) return false;
      const days = [...new Set(words.map((w) => WEEKDAYS[w] ?? WEEKDAYS[w.slice(0, -1)]!))].sort((a, b) => a - b);
      set({ freq: "WEEKLY", days });
      return true;
    }, true);
  }

  if (!rec) {
    const table: [string, Recurrence["freq"]][] = [
      ["(?:todos\\s+los\\s+dias|cada\\s+dia|diario|diariamente|a\\s+diario|every\\s*day|daily)", "DAILY"],
      ["(?:todas\\s+las\\s+semanas|cada\\s+semana|semanal(?:mente)?|weekly|every\\s+week)", "WEEKLY"],
      ["(?:todos\\s+los\\s+meses|cada\\s+mes|mensual(?:mente)?|monthly|every\\s+month)", "MONTHLY"],
      ["(?:todos\\s+los\\s+anos|cada\\s+ano|anual(?:mente)?|yearly|annually|every\\s+year)", "YEARLY"],
    ];
    for (const [src, freq] of table) if (sc.each(re(src), () => set({ freq }), true)) break;
  }

  const r = rec as Recurrence | null;
  if (r) {
    sc.each(re(`(?:(\\d+)\\s+(?:veces|times)|(?:x|for)\\s+(\\d+)\\s+(?:veces|times|occurrences))`), (m) => {
      const n = Number(m[1] ?? m[2]);
      if (n < 1 || n > 999) return false;
      r.count = n;
      return true;
    }, true);
  }
  return r;
}

function buildRecurrence(r: Recurrence, until: Date | null, allDay: boolean): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.days?.length) parts.push(`BYDAY=${r.days.map((d) => BYDAY[d]).join(",")}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  else if (until) parts.push(`UNTIL=${untilEndOfDay(until, allDay)}`);
  return parts.join(";");
}

// ---------------------------------------------------------------------------
// Título

const EDGE_WORDS = new Set([
  "a", "al", "el", "la", "las", "los", "de", "del", "en", "para", "y", "e", "con", "desde", "hasta", "por", "durante", "este", "esta", "cada",
  "at", "on", "the", "from", "in", "for", "and", "to", "until", "by", "this", "every", "@", "-", "–", "—", ",", ".", ";", ":", "·",
]);

function cleanTitle(raw: string): string {
  const words = raw.split(/\s+/).filter(Boolean);
  const isEdge = (w: string) => EDGE_WORDS.has(fold(w)) || /^[\p{P}\p{S}]+$/u.test(w);
  while (words.length && isEdge(words[words.length - 1]!)) words.pop();
  while (words.length && isEdge(words[0]!)) words.shift();
  return words.join(" ").replace(/\s+([,.;:!?])/g, "$1").replace(/[,;:]$/, "");
}

// ---------------------------------------------------------------------------
// Evento escrito

const at = (d: Date, c: Clock) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), c.h, c.m);

/**
 * «Dentista mañana 5pm 1h» → título, inicio, fin, día completo y repetición.
 * Sin hora: evento de día completo. Sin fecha: hoy (o mañana si la hora ya pasó).
 * Devuelve null si no queda título.
 */
export function parseQuickEvent(text: string, opts: QuickEventOptions): QuickEvent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const sc = new Scanner(trimmed);
  const today = startOfDay(opts.now);

  const rec = findRecurrence(sc);
  // Fechas antes que horas: «10–12 dic» es un intervalo de días, no de horas.
  const dctx: DateCtx = { sc, today, opts, future: true, strict: false, out: [] };
  findExplicitDates(dctx);
  const time = findTimes(sc);
  findRelativeDates(dctx);

  const dates = [...dctx.out].sort((a, b) => a.hit.start - b.hit.start);
  let until: Date | null = null;
  let first: FoundDate | undefined;
  let lastDay: Date | undefined;
  for (const d of dates) {
    const prefix = sc.before(d.hit.start);
    const untilMatch = /(?:hasta(?:\s+el)?|until)\s*$/u.exec(prefix);
    if (rec && untilMatch) {
      until = d.date;
      sc.mark({ start: d.hit.start - untilMatch[0].length, end: d.hit.start });
      continue;
    }
    if (!first) {
      first = d;
      lastDay = d.last;
      const fromMatch = /(?:del|desde\s+el|from)\s*$/u.exec(prefix);
      if (fromMatch) sc.mark({ start: d.hit.start - fromMatch[0].length, end: d.hit.start });
      continue;
    }
    // Segunda fecha: «del 30 dic al 2 ene» → intervalo.
    const between = /^\s*(?:al|a|to|until|hasta(?:\s+el)?|-|–|—)\s*$/u.exec(sc.s.slice(first.hit.end, d.hit.start));
    if (between && !lastDay && d.date >= first.date) {
      lastDay = d.date;
      sc.mark({ start: first.hit.end, end: d.hit.start });
    }
  }

  const title = cleanTitle(sc.rest());
  if (!title) return null;

  const clock = time.start ?? time.vague;
  const hasTime = !!clock;
  let day = first?.date;

  if (!day && rec?.days?.length) {
    // «lunes y miércoles 7am»: el primer día de la lista a partir de hoy.
    const now = opts.now;
    for (let i = 0; i < 8; i++) {
      const d = addDays(today, i);
      if (!rec.days.includes(d.getDay())) continue;
      if (i === 0 && clock && at(d, clock) <= now) continue;
      day = d;
      break;
    }
  }
  if (!day) {
    day = today;
    if (clock && at(today, clock) <= opts.now) day = addDays(today, 1);
  }

  let start: Date;
  let end: Date;
  let allDay: boolean;
  if (clock && !lastDay) {
    allDay = false;
    start = at(day, clock);
    if (time.end) {
      end = at(day, time.end);
      if (end <= start) end = addDays(end, 1);
    } else {
      end = new Date(start.getTime() + (time.durationMin ?? opts.defaultDurationMin) * 60_000);
    }
  } else {
    allDay = true;
    start = day;
    end = addDays(lastDay ?? day, 1);
  }

  return {
    title,
    allDay,
    start,
    end,
    recurrence: rec ? buildRecurrence(rec, until, allDay) : null,
    found: { date: !!first, time: hasTime, duration: time.durationMin !== undefined || !!time.end, recurrence: !!rec },
  };
}
