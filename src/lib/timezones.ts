// Utilidades de zonas horarias IANA con la API Intl (sin datos externos).

export interface WallTime {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Hora de reloj de un instante en una zona. */
export function wallTimeIn(instant: number, tz: string): WallTime {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(instant))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Desfase de la zona respecto a UTC en minutos (positivo al este). */
export function offsetMinutes(tz: string, instant: number = Date.now()): number {
  const w = wallTimeIn(instant, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** Instante en el que el reloj de `tz` marca `wall` (resuelve huecos/solapes de DST). */
export function instantFromWall(wall: WallTime, tz: string): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  let guess = naive - offsetMinutes(tz, naive) * 60_000;
  // Dos refinamientos bastan para los cambios de horario.
  for (let i = 0; i < 2; i++) guess = naive - offsetMinutes(tz, guess) * 60_000;
  return guess;
}

/** Hora de reloj local (del sistema) de un instante. */
export function localWall(instant: number): WallTime {
  const d = new Date(instant);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
  };
}

/** "GMT−5", "GMT+5:30", "GMT+0". */
export function formatOffsetShort(min: number): string {
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** "GMT−05:00" */
export function formatOffsetLong(min: number): string {
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  return `GMT${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** "Mexico City" */
export function cityName(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

const nameCache = new Map<string, string>();
/** Nombre largo en español: "hora estándar del centro". */
export function longZoneName(tz: string, instant: number = Date.now()): string {
  const key = tz;
  const cached = nameCache.get(key);
  if (cached) return cached;
  let name = tz;
  try {
    const part = new Intl.DateTimeFormat("es", { timeZone: tz, timeZoneName: "long" })
      .formatToParts(new Date(instant))
      .find((p) => p.type === "timeZoneName");
    if (part) name = part.value;
  } catch {
    /* zona desconocida para el motor */
  }
  nameCache.set(key, name);
  return name;
}

// Asia/Calcutta es el nombre antiguo de Asia/Kolkata (algunos motores solo conocen uno).
export const COMMON_ZONES = ["America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Brussels", "Asia/Kolkata", "Asia/Calcutta"];

/** Todas las zonas IANA que conoce el motor, ordenadas por desfase. */
export function allTimeZones(): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = [
      ...COMMON_ZONES,
      "America/Mexico_City", "America/Cancun", "America/Chicago", "America/Denver", "America/Bogota",
      "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires", "America/Sao_Paulo",
      "Europe/Madrid", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney", "UTC",
    ];
  }
  // Las zonas técnicas "Etc/GMT+12" confunden (su signo está invertido); se omiten.
  zones = zones.filter((z) => !z.startsWith("Etc/") || z === "Etc/UTC");
  if (zones.includes("Asia/Calcutta") && zones.includes("Asia/Kolkata")) zones = zones.filter((z) => z !== "Asia/Calcutta");
  const now = Date.now();
  return [...new Set(zones)].sort((a, b) => offsetMinutes(a, now) - offsetMinutes(b, now) || a.localeCompare(b));
}

/** Coincidencia de búsqueda (ciudad, nombre, desfase), sin acentos ni mayúsculas. */
export function matchesZone(tz: string, query: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = norm(query.trim());
  if (!q) return true;
  const off = offsetMinutes(tz);
  return [tz, cityName(tz), longZoneName(tz), formatOffsetShort(off), formatOffsetLong(off)].some((s) => norm(s).includes(q));
}
