import { describe, expect, it } from "vitest";
import { addDays, getOffsetMinutes, getZonedParts, toLocalIsoDate, zonedTimeToUtc } from "../time";

describe("time", () => {
  it("converts Baghdad wall time to UTC (+03:00, no DST)", () => {
    expect(zonedTimeToUtc("2026-10-20", 18 * 60, "Asia/Baghdad").toISOString()).toBe("2026-10-20T15:00:00.000Z");
  });

  it("handles minutes past midnight as the next day", () => {
    expect(zonedTimeToUtc("2026-10-20", 26 * 60, "Asia/Baghdad").toISOString()).toBe("2026-10-20T23:00:00.000Z");
  });

  it("handles DST zones on both sides of a transition", () => {
    // Europe/Berlin switches to CET on 2026-10-25 at 03:00 CEST.
    expect(zonedTimeToUtc("2026-10-24", 12 * 60, "Europe/Berlin").toISOString()).toBe("2026-10-24T10:00:00.000Z");
    expect(zonedTimeToUtc("2026-10-26", 12 * 60, "Europe/Berlin").toISOString()).toBe("2026-10-26T11:00:00.000Z");
  });

  it("reads local parts and offsets", () => {
    const instant = new Date("2026-10-20T22:30:00Z"); // 01:30 Wednesday in Baghdad
    expect(getZonedParts(instant, "Asia/Baghdad")).toMatchObject({ dayOfWeek: 3, minuteOfDay: 90, day: 21 });
    expect(getOffsetMinutes(instant, "Asia/Baghdad")).toBe(180);
    expect(toLocalIsoDate(instant, "Asia/Baghdad")).toBe("2026-10-21");
  });

  it("adds days across month boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
