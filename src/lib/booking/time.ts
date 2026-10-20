/**
 * Timezone helpers built on Intl only (no tz database dependency).
 * "Local" always means the lounge's IANA timezone, never the browser's.
 */

export const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  /** 0 = Sunday ... 6 = Saturday */
  dayOfWeek: number;
  /** Minutes since local midnight, 0-1439 */
  minuteOfDay: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let fmt = partFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    partFormatters.set(timeZone, fmt);
  }
  return fmt;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dayOfWeek: WEEKDAYS[parts.weekday],
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Baghdad = +180). */
export function getOffsetMinutes(instant: Date, timeZone: string): number {
  const p = getZonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minuteOfDay);
  const truncated = Math.floor(instant.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
  return Math.round((asUtc - truncated) / MS_PER_MINUTE);
}

/** A calendar date in "YYYY-MM-DD" form. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(date: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error(`Invalid date: ${date}`);
  return { year, month, day };
}

export function isIsoDate(value: string): value is IsoDate {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a local wall-clock time in `timeZone` to a UTC instant.
 * `minuteOfDay` may exceed 1439 to express times after midnight of the next day.
 */
export function zonedTimeToUtc(date: IsoDate, minuteOfDay: number, timeZone: string): Date {
  const { year, month, day } = parseIsoDate(date);
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  // Two passes settle DST transitions: guess with the offset at the wall time,
  // then correct with the offset at the resulting instant.
  let guess = wallAsUtc - getOffsetMinutes(new Date(wallAsUtc), timeZone) * MS_PER_MINUTE;
  guess = wallAsUtc - getOffsetMinutes(new Date(guess), timeZone) * MS_PER_MINUTE;
  return new Date(guess);
}

/** Local calendar date of `instant` in `timeZone`. */
export function toLocalIsoDate(instant: Date, timeZone: string): IsoDate {
  const p = getZonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) of a calendar date, independent of any timezone. */
export function dayOfWeekOf(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MS_PER_MINUTE);
}

export function diffMinutes(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_MINUTE);
}

/** Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅ */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}
