import type { PaymentMethod } from "@/lib/db/types";
import type { Minor } from "@/lib/money";
import { addDays, type IsoDate } from "@/lib/booking/time";

/**
 * Daily and monthly revenue: every successful payment and refund of the branch, bucketed by
 * business day (a sale at 01:00 before an overnight close counts for the day before).
 */

/** "2026-10": a calendar month. */
export type IsoMonth = string;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isIsoMonth(value: unknown): value is IsoMonth {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

export function addMonths(month: IsoMonth, months: number): IsoMonth {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

/** Every date of a month, in order. */
export function daysOfMonth(month: IsoMonth): IsoDate[] {
  const days: IsoDate[] = [];
  for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) days.push(d);
  return days;
}

export interface ReportTransaction {
  /** Business day the money changed hands. */
  day: IsoDate;
  type: "PAYMENT" | "REFUND";
  method: PaymentMethod;
  amount: Minor;
  bookingId: string | null;
  canteenOrderId: string | null;
}

export interface ReportExpense {
  day: IsoDate;
  amount: Minor;
}

export interface DayReport {
  date: IsoDate;
  /** Payments taken, before refunds. */
  collected: Minor;
  refunds: Minor;
  /** collected - refunds, split into gaming + canteen. */
  net: Minor;
  gaming: Minor;
  canteen: Minor;
  /** Net by payment method (payments - refunds). */
  byMethod: Partial<Record<PaymentMethod, Minor>>;
  /** Sessions and counter sales paid that day. */
  sessions: number;
  counterSales: number;
  /** Cash paid out of the drawer (not voided). */
  expenses: Minor;
}

export interface MonthReport {
  month: IsoMonth;
  days: DayReport[];
  totals: Omit<DayReport, "date"> & { activeDays: number };
  /** The day with the highest net revenue, or null when nothing was sold. */
  bestDay: IsoDate | null;
}

const emptyTotals = (): Omit<DayReport, "date"> => ({
  collected: 0,
  refunds: 0,
  net: 0,
  gaming: 0,
  canteen: 0,
  byMethod: {},
  sessions: 0,
  counterSales: 0,
  expenses: 0,
});
const emptyDay = (date: IsoDate): DayReport => ({ date, ...emptyTotals() });

/**
 * Builds the month's report. A counter sale is canteen; a session payment covers play and canteen,
 * so it is shared in proportion to the session's play and canteen subtotals (as on the Z-report);
 * anything else counts as gaming. Transactions and expenses outside the month are ignored.
 */
export function buildMonthReport(
  month: IsoMonth,
  transactions: readonly ReportTransaction[],
  expenses: readonly ReportExpense[],
  sessionSubtotals: ReadonlyMap<string, { play: Minor; canteen: Minor }>,
): MonthReport {
  const days = new Map(daysOfMonth(month).map((d) => [d, emptyDay(d)]));
  const sessionsOf = new Map<IsoDate, Set<string>>();
  const ordersOf = new Map<IsoDate, Set<string>>();

  for (const t of transactions) {
    const day = days.get(t.day);
    if (!day) continue;
    const sign = t.type === "REFUND" ? -1 : 1;
    const amount = t.amount * sign;
    if (t.type === "REFUND") day.refunds += t.amount;
    else day.collected += t.amount;
    day.net += amount;
    day.byMethod[t.method] = (day.byMethod[t.method] ?? 0) + amount;

    const session = t.bookingId ? sessionSubtotals.get(t.bookingId) : undefined;
    if (t.canteenOrderId) day.canteen += amount;
    else if (session && session.play + session.canteen > 0) {
      const share = Math.round((amount * session.canteen) / (session.play + session.canteen));
      day.canteen += share;
      day.gaming += amount - share;
    } else day.gaming += amount;

    if (t.type === "PAYMENT") {
      if (t.canteenOrderId) ordersOf.set(t.day, (ordersOf.get(t.day) ?? new Set()).add(t.canteenOrderId));
      else if (t.bookingId) sessionsOf.set(t.day, (sessionsOf.get(t.day) ?? new Set()).add(t.bookingId));
    }
  }
  for (const e of expenses) {
    const day = days.get(e.day);
    if (day) day.expenses += e.amount;
  }
  for (const [date, day] of days) {
    day.sessions = sessionsOf.get(date)?.size ?? 0;
    day.counterSales = ordersOf.get(date)?.size ?? 0;
  }

  const list = [...days.values()];
  const totals: MonthReport["totals"] = { ...emptyTotals(), activeDays: 0 };
  let bestDay: DayReport | null = null;
  for (const d of list) {
    totals.collected += d.collected;
    totals.refunds += d.refunds;
    totals.net += d.net;
    totals.gaming += d.gaming;
    totals.canteen += d.canteen;
    totals.sessions += d.sessions;
    totals.counterSales += d.counterSales;
    totals.expenses += d.expenses;
    for (const [method, v] of Object.entries(d.byMethod) as [PaymentMethod, Minor][]) {
      totals.byMethod[method] = (totals.byMethod[method] ?? 0) + v;
    }
    if (d.collected > 0 || d.refunds > 0) totals.activeDays += 1;
    if (d.net > 0 && (!bestDay || d.net > bestDay.net)) bestDay = d;
  }
  return { month, days: list, totals, bestDay: bestDay?.date ?? null };
}
