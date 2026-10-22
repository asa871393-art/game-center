import { describe, expect, it } from "vitest";
import { resolveShiftType, shiftTypeAt } from "../shift-type";

const TZ = "Asia/Baghdad"; // UTC+3, no DST

/** A Baghdad wall-clock hour on a fixed day, as an instant. */
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 22, hour - 3, minute));

describe("shiftTypeAt", () => {
  it("suggests morning from 05:00 until just before 16:00 local time", () => {
    expect(shiftTypeAt(at(5), TZ)).toBe("MORNING");
    expect(shiftTypeAt(at(9, 30), TZ)).toBe("MORNING");
    expect(shiftTypeAt(at(15, 59), TZ)).toBe("MORNING");
  });

  it("suggests evening from 16:00 and through the night", () => {
    expect(shiftTypeAt(at(16), TZ)).toBe("EVENING");
    expect(shiftTypeAt(at(23, 30), TZ)).toBe("EVENING");
    expect(shiftTypeAt(at(2), TZ)).toBe("EVENING");
  });

  it("uses the lounge's timezone, not UTC", () => {
    // 14:00 UTC is 17:00 in Baghdad.
    expect(shiftTypeAt(new Date(Date.UTC(2026, 9, 22, 14)), TZ)).toBe("EVENING");
    expect(shiftTypeAt(new Date(Date.UTC(2026, 9, 22, 14)), "UTC")).toBe("MORNING");
  });
});

describe("resolveShiftType", () => {
  it("keeps a stored type and classifies older shifts by when they opened", () => {
    expect(resolveShiftType({ shiftType: "EVENING", openedAt: at(9) }, TZ)).toBe("EVENING");
    expect(resolveShiftType({ shiftType: null, openedAt: at(9) }, TZ)).toBe("MORNING");
    expect(resolveShiftType({ shiftType: null, openedAt: at(20) }, TZ)).toBe("EVENING");
  });
});
