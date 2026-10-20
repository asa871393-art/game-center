import { describe, expect, it } from "vitest";
import { findContainingWindow, getAvailableSlots, getDurationOptions, getOpeningWindow } from "../schedule";
import { zonedTimeToUtc } from "../time";

const TZ = "Asia/Baghdad";
const overnight = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  opensAtMinute: 12 * 60,
  closesAtMinute: 2 * 60,
  isClosed: false,
}));
const at = (date: string, hh: number, mm = 0) => zonedTimeToUtc(date, hh * 60 + mm, TZ);

describe("opening windows", () => {
  it("extends overnight windows into the next day", () => {
    const w = getOpeningWindow("2026-10-20", overnight, TZ)!;
    expect(w.start).toEqual(at("2026-10-20", 12));
    expect(w.end).toEqual(at("2026-10-21", 2));
  });

  it("returns null on closed days", () => {
    const hours = overnight.map((h) => (h.dayOfWeek === 2 ? { ...h, isClosed: true } : h));
    expect(getOpeningWindow("2026-10-20", hours, TZ)).toBeNull(); // Tuesday
  });

  it("attributes after-midnight bookings to the previous business day", () => {
    const w = findContainingWindow(at("2026-10-21", 0, 30), at("2026-10-21", 1, 30), overnight, TZ);
    expect(w?.start).toEqual(at("2026-10-20", 12));
  });

  it("rejects bookings outside opening hours", () => {
    expect(findContainingWindow(at("2026-10-21", 1), at("2026-10-21", 3), overnight, TZ)).toBeNull();
    expect(findContainingWindow(at("2026-10-20", 10), at("2026-10-20", 13), overnight, TZ)).toBeNull();
  });
});

describe("slots", () => {
  const window = getOpeningWindow("2026-10-20", overnight, TZ)!;

  it("skips past slots and busy ranges, and caps duration at the next booking", () => {
    const slots = getAvailableSlots({
      window,
      slotIntervalMinutes: 60,
      minDurationMinutes: 60,
      busy: [{ start: at("2026-10-20", 18), end: at("2026-10-20", 20) }],
      now: at("2026-10-20", 14, 10),
    });
    const starts = slots.map((s) => s.start.getTime());
    expect(starts).not.toContain(at("2026-10-20", 14).getTime());
    expect(starts).toContain(at("2026-10-20", 15).getTime());
    expect(starts).not.toContain(at("2026-10-20", 18).getTime());
    expect(starts).not.toContain(at("2026-10-20", 19).getTime());
    expect(slots.find((s) => s.start.getTime() === at("2026-10-20", 15).getTime())!.maxDurationMinutes).toBe(180);
    // The last slot must leave room for the minimum duration before 02:00.
    expect(slots.at(-1)!.start).toEqual(at("2026-10-21", 1));
    expect(slots.at(-1)!.maxDurationMinutes).toBe(60);
  });

  it("allows starting exactly when a previous booking ends", () => {
    const slots = getAvailableSlots({
      window,
      slotIntervalMinutes: 30,
      minDurationMinutes: 60,
      busy: [{ start: at("2026-10-20", 12), end: at("2026-10-20", 13) }],
      now: at("2026-10-20", 9),
    });
    expect(slots[0].start).toEqual(at("2026-10-20", 13));
  });

  it("builds duration options", () => {
    expect(getDurationOptions(60, 150)).toEqual([60, 90, 120, 150]);
    expect(getDurationOptions(120, 90)).toEqual([]);
  });
});
