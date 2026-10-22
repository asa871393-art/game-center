import "server-only";
import type { ShiftType } from "@/lib/db/types";
import { toMinor, type Minor } from "@/lib/money";
import { resolveShiftType, SHIFT_TYPES } from "@/lib/shift-type";
import { db } from "@/server/db";
import { getShiftSummary } from "@/server/services/shift";

const HISTORY_LIMIT = 60;

export interface ShiftHistoryRow {
  id: string;
  status: "OPEN" | "CLOSED";
  shiftType: ShiftType;
  cashier: string;
  openedAt: string;
  closedAt: string | null;
  collected: Minor;
  /** Revenue of the sessions and counter sales paid in this shift, as on its Z-report. */
  gaming: Minor;
  canteen: Minor;
  expensesTotal: Minor;
  expectedCash: Minor;
  countedCash: Minor | null;
  variance: Minor | null;
}

export interface ShiftTypeTotals {
  shifts: number;
  gaming: Minor;
  canteen: Minor;
}

/**
 * Recent shifts for the manager's history log, newest first. The open shift's figures are live.
 * `type` narrows the list and its totals; `byType` always compares morning with evening.
 */
export async function getShiftHistory(loungeId: string, type?: ShiftType) {
  const lounge = await db.lounge.findUnique({ where: { id: loungeId }, select: { id: true, name: true, timezone: true, currency: true } });
  if (!lounge) return null;

  const shifts = await db.shift.findMany({
    where: { loungeId },
    orderBy: { openedAt: "desc" },
    take: HISTORY_LIMIT,
    include: { cashier: { select: { name: true, email: true } } },
  });
  const ids = shifts.map((s) => s.id);
  const [collected, expenses, revenue] = await Promise.all([
    db.transaction.groupBy({
      by: ["shiftId"],
      where: { shiftId: { in: ids }, status: "SUCCEEDED", type: "PAYMENT" },
      _sum: { amount: true },
    }),
    db.shiftExpense.groupBy({ by: ["shiftId"], where: { shiftId: { in: ids }, voidedAt: null }, _sum: { amount: true } }),
    revenueByShift(ids),
  ]);
  const collectedBy = new Map(collected.map((c) => [c.shiftId, c._sum.amount ? toMinor(c._sum.amount) : 0]));
  const expensesBy = new Map(expenses.map((e) => [e.shiftId, e._sum.amount ? toMinor(e._sum.amount) : 0]));
  const open = shifts.find((s) => s.status === "OPEN");
  const live = open ? await getShiftSummary(open.id) : null;

  const all: ShiftHistoryRow[] = shifts.map((s) => ({
    id: s.id,
    status: s.status,
    shiftType: resolveShiftType(s, lounge.timezone),
    cashier: s.cashier.name ?? s.cashier.email ?? "",
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    collected: collectedBy.get(s.id) ?? 0,
    gaming: revenue.get(s.id)?.gaming ?? 0,
    canteen: revenue.get(s.id)?.canteen ?? 0,
    expensesTotal: expensesBy.get(s.id) ?? 0,
    expectedCash: s.expectedCash ? toMinor(s.expectedCash) : (live?.id === s.id ? live.expectedCash : 0),
    countedCash: s.countedCash ? toMinor(s.countedCash) : null,
    variance: s.variance ? toMinor(s.variance) : null,
  }));

  const byType = Object.fromEntries(
    SHIFT_TYPES.map((t) => {
      const of = all.filter((r) => r.shiftType === t);
      return [t, { shifts: of.length, gaming: sumOf(of, "gaming"), canteen: sumOf(of, "canteen") }];
    }),
  ) as Record<ShiftType, ShiftTypeTotals>;

  const rows = type ? all.filter((r) => r.shiftType === type) : all;
  const closed = rows.filter((r) => r.variance !== null);
  return {
    lounge,
    rows,
    byType,
    totals: {
      shortCount: closed.filter((r) => r.variance! < 0).length,
      overCount: closed.filter((r) => r.variance! > 0).length,
      netVariance: closed.reduce((s, r) => s + r.variance!, 0),
      collected: rows.reduce((s, r) => s + r.collected, 0),
    },
  };
}

const sumOf = (rows: ShiftHistoryRow[], key: "gaming" | "canteen") => rows.reduce((s, r) => s + r[key], 0);

/**
 * Gaming and canteen revenue per shift, counted the way getShiftSummary does: the play and
 * canteen subtotals of each session paid in the shift, plus its counter sales.
 */
async function revenueByShift(shiftIds: string[]): Promise<Map<string, { gaming: Minor; canteen: Minor }>> {
  const out = new Map<string, { gaming: Minor; canteen: Minor }>();
  if (shiftIds.length === 0) return out;
  const txs = await db.transaction.findMany({
    where: { shiftId: { in: shiftIds }, status: "SUCCEEDED", type: "PAYMENT" },
    select: { shiftId: true, bookingId: true, canteenOrderId: true },
  });
  const bookingsOf = new Map<string, Set<string>>();
  const ordersOf = new Map<string, Set<string>>();
  for (const t of txs) {
    if (!t.shiftId) continue;
    if (t.bookingId) bookingsOf.set(t.shiftId, (bookingsOf.get(t.shiftId) ?? new Set()).add(t.bookingId));
    if (t.canteenOrderId) ordersOf.set(t.shiftId, (ordersOf.get(t.shiftId) ?? new Set()).add(t.canteenOrderId));
  }
  const bookingIds = [...new Set([...bookingsOf.values()].flatMap((ids) => [...ids]))];
  const orderIds = [...new Set([...ordersOf.values()].flatMap((ids) => [...ids]))];
  const [bookings, orders] = await Promise.all([
    bookingIds.length
      ? db.booking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, playSubtotal: true, canteenSubtotal: true } })
      : [],
    orderIds.length ? db.canteenOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, subtotal: true } }) : [],
  ]);
  const booking = new Map(bookings.map((b) => [b.id, { play: toMinor(b.playSubtotal), canteen: toMinor(b.canteenSubtotal) }]));
  const order = new Map(orders.map((o) => [o.id, toMinor(o.subtotal)]));
  for (const id of shiftIds) {
    let gaming = 0;
    let canteen = 0;
    for (const b of bookingsOf.get(id) ?? []) {
      gaming += booking.get(b)?.play ?? 0;
      canteen += booking.get(b)?.canteen ?? 0;
    }
    for (const o of ordersOf.get(id) ?? []) canteen += order.get(o) ?? 0;
    out.set(id, { gaming, canteen });
  }
  return out;
}

export type ShiftHistory = NonNullable<Awaited<ReturnType<typeof getShiftHistory>>>;
