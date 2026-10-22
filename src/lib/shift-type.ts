import type { ShiftType } from "@/lib/db/types";

/** The two shifts a lounge runs. Morning covers the day; evening runs from 4 PM through the night. */
export const SHIFT_TYPES = ["MORNING", "EVENING"] as const satisfies readonly ShiftType[];

/** Local hours [start, end) that count as the morning shift; anything else is evening (late nights included). */
const MORNING_HOURS = [5, 16] as const;

export const shiftTypeEmoji: Record<ShiftType, string> = { MORNING: "🌅", EVENING: "🌙" };

function localHour(at: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(at);
  return Number(hour) % 24;
}

/** The shift a cashier would be opening at this moment in the lounge's timezone. */
export function shiftTypeAt(at: Date, timeZone: string): ShiftType {
  const h = localHour(at, timeZone);
  return h >= MORNING_HOURS[0] && h < MORNING_HOURS[1] ? "MORNING" : "EVENING";
}

/** A shift's type; shifts opened before types existed are classified by when they opened. */
export function resolveShiftType(shift: { shiftType: ShiftType | null; openedAt: Date }, timeZone: string): ShiftType {
  return shift.shiftType ?? shiftTypeAt(shift.openedAt, timeZone);
}
