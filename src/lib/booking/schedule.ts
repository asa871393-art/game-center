import {
  addDays,
  addMinutes,
  dayOfWeekOf,
  diffMinutes,
  MINUTES_PER_DAY,
  overlaps,
  toLocalIsoDate,
  zonedTimeToUtc,
  type IsoDate,
} from "./time";

export interface OpeningHoursInput {
  dayOfWeek: number;
  opensAtMinute: number;
  closesAtMinute: number;
  isClosed: boolean;
}

export interface Interval {
  start: Date;
  end: Date;
}

/**
 * The opening window of a business day. A lounge that opens at 12:00 and
 * closes at 02:00 has a window from 12:00 on `date` to 02:00 the next day;
 * slots after midnight belong to the previous business day.
 */
export function getOpeningWindow(
  date: IsoDate,
  hours: readonly OpeningHoursInput[],
  timeZone: string,
): Interval | null {
  const day = hours.find((h) => h.dayOfWeek === dayOfWeekOf(date));
  if (!day || day.isClosed) return null;
  const closesNextDay = day.closesAtMinute <= day.opensAtMinute;
  const closeMinute = closesNextDay ? day.closesAtMinute + MINUTES_PER_DAY : day.closesAtMinute;
  return {
    start: zonedTimeToUtc(date, day.opensAtMinute, timeZone),
    end: zonedTimeToUtc(date, closeMinute, timeZone),
  };
}

/** The opening window that fully contains [start, end), if any. */
export function findContainingWindow(
  start: Date,
  end: Date,
  hours: readonly OpeningHoursInput[],
  timeZone: string,
): Interval | null {
  const localDate = toLocalIsoDate(start, timeZone);
  // The booking may belong to the previous business day (after-midnight slot).
  for (const date of [localDate, addDays(localDate, -1)]) {
    const window = getOpeningWindow(date, hours, timeZone);
    if (window && start >= window.start && end <= window.end) return window;
  }
  return null;
}

export interface SlotOptions {
  window: Interval;
  slotIntervalMinutes: number;
  minDurationMinutes: number;
  /** Existing bookings on the device (any order). */
  busy: readonly Interval[];
  now: Date;
  /** Earliest bookable start relative to `now`. */
  leadTimeMinutes?: number;
}

export interface Slot {
  start: Date;
  /** Longest bookable duration from this start, bounded by close and the next booking. */
  maxDurationMinutes: number;
}

/** Bookable start times for one device in one opening window. */
export function getAvailableSlots(opts: SlotOptions): Slot[] {
  const { window, slotIntervalMinutes, minDurationMinutes, busy, now } = opts;
  const earliest = addMinutes(now, opts.leadTimeMinutes ?? 0);
  const sortedBusy = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const slots: Slot[] = [];

  for (
    let start = window.start;
    addMinutes(start, minDurationMinutes) <= window.end;
    start = addMinutes(start, slotIntervalMinutes)
  ) {
    if (start < earliest) continue;
    const minEnd = addMinutes(start, minDurationMinutes);
    if (sortedBusy.some((b) => overlaps(start, minEnd, b.start, b.end))) continue;

    const nextBusy = sortedBusy.find((b) => b.start >= minEnd);
    const limit = nextBusy && nextBusy.start < window.end ? nextBusy.start : window.end;
    slots.push({ start, maxDurationMinutes: diffMinutes(limit, start) });
  }
  return slots;
}

/** Duration choices offered in the UI, stepping by `step` up to `max` (and a hard cap). */
export function getDurationOptions(
  minDurationMinutes: number,
  maxDurationMinutes: number,
  step = 30,
  hardCapMinutes = 12 * 60,
): number[] {
  const options: number[] = [];
  const max = Math.min(maxDurationMinutes, hardCapMinutes);
  for (let d = minDurationMinutes; d <= max; d += step) options.push(d);
  return options;
}

export interface BusinessDay {
  /** Local calendar date the business day is named after. */
  date: IsoDate;
  /** Reporting range: the opening window, or the whole calendar day when closed. */
  range: Interval;
  isOpen: boolean;
}

/**
 * The business day `now` falls in. Between midnight and an overnight close
 * (e.g. 01:00 when the lounge closes at 02:00) that is still yesterday.
 */
export function getBusinessDay(now: Date, hours: readonly OpeningHoursInput[], timeZone: string): BusinessDay {
  const today = toLocalIsoDate(now, timeZone);
  const yesterday = addDays(today, -1);
  const previous = getOpeningWindow(yesterday, hours, timeZone);
  if (previous && now >= previous.start && now < previous.end) {
    return { date: yesterday, range: previous, isOpen: true };
  }
  const window = getOpeningWindow(today, hours, timeZone);
  if (window) return { date: today, range: window, isOpen: now >= window.start && now < window.end };
  return {
    date: today,
    range: { start: zonedTimeToUtc(today, 0, timeZone), end: zonedTimeToUtc(today, MINUTES_PER_DAY, timeZone) },
    isOpen: false,
  };
}
