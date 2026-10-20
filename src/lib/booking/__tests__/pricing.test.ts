import { describe, expect, it } from "vitest";
import { quoteBooking, type PricingRuleInput } from "../pricing";
import { zonedTimeToUtc } from "../time";

const TZ = "Asia/Baghdad";
const rule = (over: Partial<PricingRuleInput>): PricingRuleInput => ({
  id: "r",
  categoryId: null,
  daysOfWeek: [],
  startMinute: 0,
  endMinute: 1440,
  hourlyRate: null,
  multiplierBps: null,
  priority: 0,
  validFrom: null,
  validTo: null,
  isActive: true,
  ...over,
});
const base = {
  timeZone: TZ,
  categoryId: "pc",
  baseHourlyRate: 300_000, // 3,000.00
  taxRateBps: 0,
  addOns: [],
};

describe("quoteBooking", () => {
  it("charges the base rate with no rules", () => {
    const q = quoteBooking({ ...base, start: zonedTimeToUtc("2026-10-20", 18 * 60, TZ), durationMinutes: 90, rules: [] });
    expect(q.playSubtotal).toBe(450_000);
    expect(q.total).toBe(450_000);
    expect(q.segments).toHaveLength(1);
  });

  it("splits a booking across a rule boundary", () => {
    const peak = rule({ id: "peak", startMinute: 20 * 60, endMinute: 24 * 60, hourlyRate: 400_000, priority: 5 });
    const q = quoteBooking({ ...base, start: zonedTimeToUtc("2026-10-20", 19 * 60, TZ), durationMinutes: 120, rules: [peak] });
    expect(q.segments.map((s) => [s.hourlyRate, s.minutes])).toEqual([
      [300_000, 60],
      [400_000, 60],
    ]);
    expect(q.playSubtotal).toBe(700_000);
    expect(q.effectiveHourlyRate).toBe(350_000);
  });

  it("applies multipliers, priorities, categories and day filters", () => {
    const tuesday = zonedTimeToUtc("2026-10-20", 13 * 60, TZ); // Tuesday = 2
    const discount = rule({ id: "a", multiplierBps: 8000, priority: 1, daysOfWeek: [2] });
    const otherCategory = rule({ id: "b", categoryId: "ps5", hourlyRate: 1, priority: 99 });
    const wrongDay = rule({ id: "c", hourlyRate: 1, priority: 50, daysOfWeek: [5] });
    const inactive = rule({ id: "d", hourlyRate: 1, priority: 60, isActive: false });
    const q = quoteBooking({
      ...base,
      start: tuesday,
      durationMinutes: 60,
      rules: [discount, otherCategory, wrongDay, inactive],
    });
    expect(q.playSubtotal).toBe(240_000);
  });

  it("prefers a category-specific rule on equal priority", () => {
    const loungeWide = rule({ id: "a", hourlyRate: 100, priority: 5 });
    const pcOnly = rule({ id: "z", categoryId: "pc", hourlyRate: 200, priority: 5 });
    const q = quoteBooking({ ...base, start: new Date("2026-10-20T12:00:00Z"), durationMinutes: 60, rules: [loungeWide, pcOnly] });
    expect(q.playSubtotal).toBe(200);
  });

  it("handles rules that wrap past midnight", () => {
    const night = rule({ id: "n", startMinute: 22 * 60, endMinute: 2 * 60, hourlyRate: 500_000 });
    const q = quoteBooking({ ...base, start: zonedTimeToUtc("2026-10-20", 25 * 60, TZ), durationMinutes: 60, rules: [night] });
    expect(q.playSubtotal).toBe(500_000);
  });

  it("adds canteen items and tax", () => {
    const q = quoteBooking({
      ...base,
      taxRateBps: 1000,
      start: zonedTimeToUtc("2026-10-20", 18 * 60, TZ),
      durationMinutes: 60,
      rules: [],
      addOns: [{ unitPrice: 250_000, quantity: 2 }],
    });
    expect(q.canteenSubtotal).toBe(500_000);
    expect(q.taxTotal).toBe(80_000);
    expect(q.total).toBe(880_000);
  });

  it("rejects invalid durations", () => {
    expect(() => quoteBooking({ ...base, start: new Date(), durationMinutes: 0, rules: [] })).toThrow();
  });
});
