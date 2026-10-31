import { describe, expect, it } from "vitest";
import { addMonths, buildMonthReport, daysOfMonth, isIsoMonth, type ReportTransaction } from "../reports";

const tx = (over: Partial<ReportTransaction>): ReportTransaction => ({
  day: "2026-10-05",
  type: "PAYMENT",
  method: "CASH",
  amount: 0,
  bookingId: null,
  canteenOrderId: null,
  ...over,
});

describe("months", () => {
  it("validates, steps and lists days", () => {
    expect(isIsoMonth("2026-10")).toBe(true);
    expect(isIsoMonth("2026-13")).toBe(false);
    expect(isIsoMonth("2026-1")).toBe(false);
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(daysOfMonth("2026-02")).toHaveLength(28);
    expect(daysOfMonth("2028-02").at(-1)).toBe("2028-02-29");
  });
});

describe("month report", () => {
  const sessions = new Map([
    ["b1", { play: 6000, canteen: 2000 }],
    ["b2", { play: 4000, canteen: 0 }],
  ]);

  it("splits session payments into gaming and canteen, and counts counter sales as canteen", () => {
    const r = buildMonthReport(
      "2026-10",
      [
        tx({ amount: 8000, bookingId: "b1" }),
        tx({ amount: 3000, method: "CARD", canteenOrderId: "o1" }),
        tx({ amount: 4000, method: "ZAINCASH", bookingId: "b2", day: "2026-10-06" }),
      ],
      [{ day: "2026-10-05", amount: 1500 }],
      sessions,
    );
    const d5 = r.days[4];
    expect(d5).toMatchObject({ collected: 11000, net: 11000, gaming: 6000, canteen: 5000, sessions: 1, counterSales: 1, expenses: 1500 });
    expect(d5.byMethod).toEqual({ CASH: 8000, CARD: 3000 });
    expect(r.totals).toMatchObject({ collected: 15000, net: 15000, gaming: 10000, canteen: 5000, sessions: 2, counterSales: 1, activeDays: 2 });
    expect(r.totals.byMethod).toEqual({ CASH: 8000, CARD: 3000, ZAINCASH: 4000 });
    expect(r.bestDay).toBe("2026-10-05");
  });

  it("subtracts refunds and ignores other months", () => {
    const r = buildMonthReport(
      "2026-10",
      [
        tx({ amount: 4000, bookingId: "b2" }),
        tx({ type: "REFUND", amount: 1000, bookingId: "b2" }),
        tx({ amount: 9999, day: "2026-11-01" }),
      ],
      [{ day: "2026-09-30", amount: 500 }],
      sessions,
    );
    expect(r.totals).toMatchObject({ collected: 4000, refunds: 1000, net: 3000, gaming: 3000, canteen: 0, sessions: 1, expenses: 0 });
    expect(r.totals.byMethod).toEqual({ CASH: 3000 });
  });

  it("has an empty month with no best day", () => {
    const r = buildMonthReport("2026-10", [], [], sessions);
    expect(r.days).toHaveLength(31);
    expect(r.totals.net).toBe(0);
    expect(r.bestDay).toBeNull();
  });
});
