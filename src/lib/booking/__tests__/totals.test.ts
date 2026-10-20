import { describe, expect, it } from "vitest";
import { getBusinessDay } from "../schedule";
import { zonedTimeToUtc } from "../time";
import { computeBookingTotals, paymentStatusFor } from "../totals";

describe("computeBookingTotals", () => {
  it("adds tax on play + canteen", () => {
    expect(computeBookingTotals({ playSubtotal: 10_000, canteenSubtotal: 2_000, discountTotal: 0, taxRateBps: 1500 })).toEqual({
      playSubtotal: 10_000,
      canteenSubtotal: 2_000,
      discountTotal: 0,
      taxTotal: 1_800,
      totalPrice: 13_800,
    });
  });

  it("taxes the discounted amount and never discounts below zero", () => {
    expect(computeBookingTotals({ playSubtotal: 1_000, canteenSubtotal: 0, discountTotal: 400, taxRateBps: 1000 }).totalPrice).toBe(660);
    expect(computeBookingTotals({ playSubtotal: 1_000, canteenSubtotal: 0, discountTotal: 5_000, taxRateBps: 1000 })).toMatchObject({
      discountTotal: 1_000,
      totalPrice: 0,
    });
  });
});

describe("paymentStatusFor", () => {
  it("derives the status from total and amount paid", () => {
    expect(paymentStatusFor(1_000, 0)).toBe("UNPAID");
    expect(paymentStatusFor(1_000, 400)).toBe("PARTIALLY_PAID");
    expect(paymentStatusFor(1_000, 1_000)).toBe("PAID");
    expect(paymentStatusFor(0, 0)).toBe("PAID");
  });
});

describe("getBusinessDay", () => {
  const TZ = "Asia/Baghdad";
  const overnight = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    opensAtMinute: 12 * 60,
    closesAtMinute: 2 * 60,
    isClosed: false,
  }));
  const at = (date: string, hh: number, mm = 0) => zonedTimeToUtc(date, hh * 60 + mm, TZ);

  it("keeps after-midnight hours on the previous business day", () => {
    const day = getBusinessDay(at("2026-10-21", 1, 15), overnight, TZ);
    expect(day).toMatchObject({ date: "2026-10-20", isOpen: true });
    expect(day.range.end).toEqual(at("2026-10-21", 2));
  });

  it("uses today's window before opening and while open", () => {
    expect(getBusinessDay(at("2026-10-21", 9), overnight, TZ)).toMatchObject({ date: "2026-10-21", isOpen: false });
    expect(getBusinessDay(at("2026-10-21", 15), overnight, TZ)).toMatchObject({ date: "2026-10-21", isOpen: true });
  });

  it("falls back to the calendar day when closed", () => {
    const closed = overnight.map((h) => ({ ...h, isClosed: true }));
    const day = getBusinessDay(at("2026-10-21", 15), closed, TZ);
    expect(day).toMatchObject({ date: "2026-10-21", isOpen: false });
    expect(day.range.start).toEqual(at("2026-10-21", 0));
  });
});
