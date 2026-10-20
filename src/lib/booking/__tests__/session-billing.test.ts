import { describe, expect, it } from "vitest";
import { liveBill, type LiveBillContext, type LiveSessionInput } from "../live-bill";
import { accruedPlay, availableTiers, billableMinutes, pricePlay, tierBps, type PricedCategory } from "../session-billing";
import { zonedTimeToUtc } from "../time";

const TZ = "Asia/Baghdad";
const DAY = "2026-10-22"; // a Thursday
const at = (hh: number, mm = 0, ss = 0) => new Date(zonedTimeToUtc(DAY, hh * 60 + mm, TZ).getTime() + ss * 1000);
const ps5: PricedCategory = { id: "ps5", baseHourlyRate: 400_000, multiTierBps: 15_000, vipTierBps: 20_000 };
const pc: PricedCategory = { id: "pc", baseHourlyRate: 300_000, multiTierBps: null, vipTierBps: null };
const pricing = { timeZone: TZ, rules: [] };

describe("tiers", () => {
  it("maps tiers to multipliers and hides unoffered ones", () => {
    expect(tierBps(ps5, "SINGLE")).toBe(10_000);
    expect(tierBps(ps5, "MULTI")).toBe(15_000);
    expect(tierBps(pc, "VIP")).toBeNull();
    expect(availableTiers(ps5)).toEqual(["SINGLE", "MULTI", "VIP"]);
    expect(availableTiers(pc)).toEqual(["SINGLE"]);
  });
});

describe("billableMinutes", () => {
  it("bills every started minute", () => {
    expect(billableMinutes(at(18), at(18))).toBe(0);
    expect(billableMinutes(at(18), at(18, 0, 1))).toBe(1);
    expect(billableMinutes(at(18), at(18, 30))).toBe(30);
    expect(billableMinutes(at(18), at(18, 30, 5))).toBe(31);
    expect(billableMinutes(at(18, 30), at(18))).toBe(0);
  });
});

describe("pricePlay", () => {
  it("applies the tier multiplier on top of the hourly rate", () => {
    expect(pricePlay(pricing, ps5, "SINGLE", at(18), 60)).toBe(400_000);
    expect(pricePlay(pricing, ps5, "MULTI", at(18), 60)).toBe(600_000);
    expect(pricePlay(pricing, ps5, "VIP", at(18), 30)).toBe(400_000);
    expect(pricePlay(pricing, ps5, "SINGLE", at(18), 0)).toBe(0);
  });

  it("applies time-of-day rules before the tier", () => {
    const happyHour = {
      id: "r1",
      categoryId: null,
      daysOfWeek: [],
      startMinute: 18 * 60,
      endMinute: 19 * 60,
      hourlyRate: null,
      multiplierBps: 5_000,
      priority: 1,
      validFrom: null,
      validTo: null,
      isActive: true,
    };
    // 30 min at half price, then 30 min full, all x1.5.
    expect(pricePlay({ timeZone: TZ, rules: [happyHour] }, ps5, "MULTI", at(18, 30), 60)).toBe(450_000);
  });
});

describe("accruedPlay", () => {
  it("adds closed segments at their recorded price and prices the running one to `until`", () => {
    const segments = [
      { startedAt: at(18), endedAt: at(18, 30), priceTier: "MULTI" as const, amount: 123_400, category: ps5 },
      { startedAt: at(18, 40), endedAt: null, priceTier: "SINGLE" as const, amount: null, category: ps5 },
    ];
    expect(accruedPlay(pricing, segments, at(19, 10))).toBe(123_400 + 200_000);
  });
});

describe("liveBill", () => {
  const ctx: LiveBillContext = {
    timeZone: TZ,
    taxRateBps: 1_000,
    rules: [],
    categoryOf: (id) => (id === "dev-ps5" ? ps5 : undefined),
  };
  const base: LiveSessionInput = {
    mode: "OPEN",
    scheduledEnd: at(23).toISOString(),
    pausedAt: null,
    playSubtotal: 0,
    canteenSubtotal: 50_000,
    discountTotal: 0,
    amountPaid: 0,
    segments: [{ deviceId: "dev-ps5", priceTier: "SINGLE", startedAt: at(18).toISOString(), endedAt: null, amount: null }],
  };

  it("accrues an open session with canteen and tax", () => {
    const bill = liveBill(base, ctx, at(18, 30));
    expect(bill.play).toBe(200_000);
    expect(bill.tax).toBe(25_000);
    expect(bill.total).toBe(275_000);
    expect(bill.elapsedMs).toBe(30 * 60_000);
    expect(bill.remainingMs).toBeNull();
  });

  it("freezes the clock while paused", () => {
    const paused: LiveSessionInput = {
      ...base,
      pausedAt: at(18, 20).toISOString(),
      segments: [{ deviceId: "dev-ps5", priceTier: "SINGLE", startedAt: at(18).toISOString(), endedAt: at(18, 20).toISOString(), amount: 133_333 }],
    };
    const later = liveBill(paused, ctx, at(19));
    expect(later.paused).toBe(true);
    expect(later.play).toBe(133_333);
    expect(later.elapsedMs).toBe(20 * 60_000);
  });

  it("counts a fixed session down from its booked end, net of what's paid", () => {
    const fixed: LiveSessionInput = { ...base, mode: "FIXED", playSubtotal: 400_000, canteenSubtotal: 0, amountPaid: 440_000, scheduledEnd: at(19).toISOString() };
    const bill = liveBill(fixed, ctx, at(19, 5));
    expect(bill.remainingMs).toBe(-5 * 60_000);
    expect(bill.total).toBe(440_000);
    expect(bill.due).toBe(0);
  });
});
