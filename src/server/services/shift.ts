import "server-only";
import type { PaymentMethod, ShiftType } from "@/lib/db/types";
import { fromMinor, toMinor, type Minor } from "@/lib/money";
import { resolveShiftType, SHIFT_TYPES } from "@/lib/shift-type";
import { db, isDbError, type TxClient, type DbReader } from "@/server/db";
import { getOpenShift, PosError, type PosContext } from "./pos";

/**
 * Cashier shifts and the cash drawer. A lounge has one drawer, so at most one
 * OPEN shift (enforced by a partial unique key in the data layer). Counter payments taken while
 * it is open are attached to it; closing reconciles counted cash against
 * openingFloat + cash taken.
 */

const MAX_FLOAT: Minor = 1_000_000_000; // 10,000,000.00

type Db = TxClient | DbReader;


export async function openShift(ctx: PosContext, input: { openingFloat: Minor; shiftType: ShiftType }) {
  if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0 || input.openingFloat > MAX_FLOAT) {
    throw new PosError("PAYMENT_MISMATCH");
  }
  if (!SHIFT_TYPES.includes(input.shiftType)) throw new PosError("INVALID_INPUT");
  try {
    return await db.$transaction(async (tx) => {
      const shift = await tx.shift.create({
        data: {
          loungeId: ctx.loungeId,
          cashierId: ctx.actorId,
          shiftType: input.shiftType,
          openingFloat: fromMinor(input.openingFloat),
          ...(ctx.now ? { openedAt: ctx.now } : {}),
        },
        select: { id: true, openedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: ctx.actorId,
          loungeId: ctx.loungeId,
          action: "shift.open",
          entityType: "Shift",
          entityId: shift.id,
          data: { openingFloat: input.openingFloat, shiftType: input.shiftType },
        },
      });
      return shift;
    });
  } catch (error) {
    if (isDbError(error, "P2002")) throw new PosError("SHIFT_ALREADY_OPEN");
    throw error;
  }
}

/** Net cash taken during a shift: cash payments minus cash refunds. */
export async function shiftCashNet(db: Db, shiftId: string): Promise<Minor> {
  const rows = await db.transaction.groupBy({
    by: ["type"],
    where: { shiftId, method: "CASH", status: "SUCCEEDED", type: { in: ["PAYMENT", "REFUND"] } },
    _sum: { amount: true },
  });
  return rows.reduce((sum, r) => sum + (r._sum.amount ? toMinor(r._sum.amount) : 0) * (r.type === "REFUND" ? -1 : 1), 0);
}

/** Cash paid out of the drawer during a shift (voided expenses excluded). */
export async function shiftExpensesTotal(db: Db, shiftId: string): Promise<Minor> {
  const agg = await db.shiftExpense.aggregate({ where: { shiftId, voidedAt: null }, _sum: { amount: true } });
  return agg._sum.amount ? toMinor(agg._sum.amount) : 0;
}

/** What should be in the drawer: opening float + net cash taken − cash expenses. */
async function expectedCashOf(db: Db, shift: { id: string; openingFloat: { toString(): string } }): Promise<Minor> {
  return toMinor(shift.openingFloat) + (await shiftCashNet(db, shift.id)) - (await shiftExpensesTotal(db, shift.id));
}

/** Serializes drawer changes (expenses, close) on one shift so the counted total can't race a payout. */
async function lockShift(tx: TxClient, shiftId: string) {
  await tx.$lock(`shift:${shiftId}`);
}

const MAX_REASON = 120;

/** Records cash taken out of the drawer. Needs an open shift and enough cash in the drawer. */
export async function addShiftExpense(ctx: PosContext, input: { amount: Minor; reason: string }) {
  const reason = input.reason.trim();
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > MAX_FLOAT) throw new PosError("INVALID_INPUT");
  if (!reason || reason.length > MAX_REASON) throw new PosError("INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const shift = await getOpenShift(tx, ctx.loungeId);
    if (!shift) throw new PosError("SHIFT_CLOSED");
    await lockShift(tx, shift.id);
    if (input.amount > (await expectedCashOf(tx, shift))) throw new PosError("INSUFFICIENT_CASH");
    const expense = await tx.shiftExpense.create({
      data: {
        shiftId: shift.id,
        loungeId: ctx.loungeId,
        amount: fromMinor(input.amount),
        reason,
        createdById: ctx.actorId,
        ...(ctx.now ? { createdAt: ctx.now } : {}),
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        loungeId: ctx.loungeId,
        action: "shift.expense.add",
        entityType: "ShiftExpense",
        entityId: expense.id,
        data: { shiftId: shift.id, amount: input.amount, reason },
      },
    });
    return { expenseId: expense.id, shiftId: shift.id };
  });
}

/** Cancels a mistaken expense while its shift is still open; it stays on record as voided. */
export async function voidShiftExpense(ctx: PosContext, input: { expenseId: string }) {
  const now = ctx.now ?? new Date();
  return db.$transaction(async (tx) => {
    const expense = await tx.shiftExpense.findFirst({
      where: { id: input.expenseId, loungeId: ctx.loungeId },
      include: { shift: { select: { status: true } } },
    });
    if (!expense) throw new PosError("NOT_FOUND");
    await lockShift(tx, expense.shiftId);
    if (expense.shift.status !== "OPEN") throw new PosError("SHIFT_CLOSED");
    const res = await tx.shiftExpense.updateMany({
      where: { id: expense.id, voidedAt: null },
      data: { voidedAt: now, voidedById: ctx.actorId },
    });
    if (res.count !== 1) throw new PosError("STALE");
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        loungeId: ctx.loungeId,
        action: "shift.expense.void",
        entityType: "ShiftExpense",
        entityId: expense.id,
        data: { shiftId: expense.shiftId, amount: toMinor(expense.amount) },
      },
    });
    return { expenseId: expense.id };
  });
}

export async function closeShift(ctx: PosContext, input: { shiftId: string; countedCash: Minor; notes?: string }) {
  const now = ctx.now ?? new Date();
  if (!Number.isInteger(input.countedCash) || input.countedCash < 0 || input.countedCash > MAX_FLOAT * 10) {
    throw new PosError("PAYMENT_MISMATCH");
  }
  return db.$transaction(async (tx) => {
    const shift = await tx.shift.findFirst({ where: { id: input.shiftId, loungeId: ctx.loungeId } });
    if (!shift) throw new PosError("NOT_FOUND");
    await lockShift(tx, shift.id);
    if (shift.status !== "OPEN") throw new PosError("SHIFT_CLOSED");

    const expected = await expectedCashOf(tx, shift);
    const variance = input.countedCash - expected;
    const res = await tx.shift.updateMany({
      where: { id: shift.id, status: "OPEN" },
      data: {
        status: "CLOSED",
        closedAt: now,
        closedById: ctx.actorId,
        expectedCash: fromMinor(expected),
        countedCash: fromMinor(input.countedCash),
        variance: fromMinor(variance),
        notes: input.notes || null,
      },
    });
    if (res.count !== 1) throw new PosError("STALE");
    await tx.auditLog.create({
      data: {
        actorId: ctx.actorId,
        loungeId: ctx.loungeId,
        action: "shift.close",
        entityType: "Shift",
        entityId: shift.id,
        data: { expected, counted: input.countedCash, variance },
      },
    });
    return { shiftId: shift.id, expected, counted: input.countedCash, variance };
  });
}

export interface ShiftSummary {
  id: string;
  loungeId: string;
  lounge: { name: string; timezone: string; currency: string };
  status: "OPEN" | "CLOSED";
  shiftType: ShiftType;
  cashier: string;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  openingFloat: Minor;
  cashNet: Minor;
  /** cashNet split by what the cash paid for; a session's payment is shared by its play/canteen subtotals. */
  cashGaming: Minor;
  cashCanteen: Minor;
  expensesTotal: Minor;
  expenses: { id: string; amount: Minor; reason: string; by: string; at: string; voided: boolean }[];
  /** openingFloat + cashNet − expensesTotal (snapshot once closed). */
  expectedCash: Minor;
  countedCash: Minor | null;
  variance: Minor | null;
  notes: string | null;
  byMethod: { method: PaymentMethod; count: number; amount: Minor }[];
  totalCollected: Minor;
  sessions: number;
  counterSales: number;
  gaming: Minor;
  canteen: Minor;
  discounts: Minor;
  tax: Minor;
}

/** Figures for the open-shift bar, the close dialog and the printed report. Live for an open shift. */
export async function getShiftSummary(shiftId: string): Promise<ShiftSummary | null> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    include: {
      lounge: { select: { name: true, timezone: true, currency: true } },
      cashier: { select: { name: true, email: true } },
      closedBy: { select: { name: true, email: true } },
    },
  });
  if (!shift) return null;

  const txs = await db.transaction.findMany({
    where: { shiftId, status: "SUCCEEDED", type: "PAYMENT" },
    select: { method: true, amount: true, bookingId: true, canteenOrderId: true },
  });
  const byMethod = new Map<PaymentMethod, { count: number; amount: Minor }>();
  for (const t of txs) {
    const row = byMethod.get(t.method) ?? { count: 0, amount: 0 };
    row.count += 1;
    row.amount += toMinor(t.amount);
    byMethod.set(t.method, row);
  }

  const bookingIds = [...new Set(txs.flatMap((t) => (t.bookingId ? [t.bookingId] : [])))];
  const orderIds = [...new Set(txs.flatMap((t) => (t.canteenOrderId ? [t.canteenOrderId] : [])))];
  const [bookings, orders] = await Promise.all([
    db.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { playSubtotal: true, canteenSubtotal: true, discountTotal: true, taxTotal: true },
    }),
    db.canteenOrder.findMany({ where: { id: { in: orderIds } }, select: { subtotal: true, taxTotal: true } }),
  ]);
  const sum = <T,>(rows: T[], pick: (r: T) => { toString(): string }) => rows.reduce((s, r) => s + toMinor(pick(r)), 0);

  const [cash, expenseRows] = await Promise.all([
    cashByPurpose(shift.id),
    db.shiftExpense.findMany({
      where: { shiftId: shift.id },
      orderBy: { createdAt: "asc" },
      include: { createdBy: { select: { name: true, email: true } } },
    }),
  ]);
  const cashNet = cash.gaming + cash.canteen;
  const expenses = expenseRows.map((e) => ({
    id: e.id,
    amount: toMinor(e.amount),
    reason: e.reason,
    by: e.createdBy.name ?? e.createdBy.email ?? "",
    at: e.createdAt.toISOString(),
    voided: e.voidedAt !== null,
  }));
  const expensesTotal = expenses.reduce((s, e) => s + (e.voided ? 0 : e.amount), 0);
  const openingFloat = toMinor(shift.openingFloat);
  return {
    id: shift.id,
    loungeId: shift.loungeId,
    lounge: shift.lounge,
    status: shift.status,
    shiftType: resolveShiftType(shift, shift.lounge.timezone),
    cashier: shift.cashier.name ?? shift.cashier.email ?? "",
    closedBy: shift.closedBy ? (shift.closedBy.name ?? shift.closedBy.email ?? "") : null,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
    openingFloat,
    cashNet,
    cashGaming: cash.gaming,
    cashCanteen: cash.canteen,
    expensesTotal,
    expenses,
    expectedCash: shift.expectedCash ? toMinor(shift.expectedCash) : openingFloat + cashNet - expensesTotal,
    countedCash: shift.countedCash ? toMinor(shift.countedCash) : null,
    variance: shift.variance ? toMinor(shift.variance) : null,
    notes: shift.notes,
    byMethod: [...byMethod].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount),
    totalCollected: txs.reduce((s, t) => s + toMinor(t.amount), 0),
    sessions: bookingIds.length,
    counterSales: orderIds.length,
    gaming: sum(bookings, (b) => b.playSubtotal),
    canteen: sum(bookings, (b) => b.canteenSubtotal) + sum(orders, (o) => o.subtotal),
    discounts: sum(bookings, (b) => b.discountTotal),
    tax: sum(bookings, (b) => b.taxTotal) + sum(orders, (o) => o.taxTotal),
  };
}

/**
 * Net cash (payments − refunds) split into gaming and canteen. Counter sales are canteen;
 * a session payment covers both, so it is shared in proportion to the session's play and
 * canteen subtotals. Anything else (no booking or order) counts as gaming. Sums to shiftCashNet.
 */
async function cashByPurpose(shiftId: string): Promise<{ gaming: Minor; canteen: Minor }> {
  const txs = await db.transaction.findMany({
    where: { shiftId, method: "CASH", status: "SUCCEEDED", type: { in: ["PAYMENT", "REFUND"] } },
    select: { type: true, amount: true, bookingId: true, canteenOrderId: true },
  });
  const bookingIds = [...new Set(txs.flatMap((t) => (t.bookingId && !t.canteenOrderId ? [t.bookingId] : [])))];
  const bookings = new Map(
    (
      await db.booking.findMany({
        where: { id: { in: bookingIds } },
        select: { id: true, playSubtotal: true, canteenSubtotal: true },
      })
    ).map((b) => [b.id, { play: toMinor(b.playSubtotal), canteen: toMinor(b.canteenSubtotal) }]),
  );
  let gaming = 0;
  let canteen = 0;
  for (const t of txs) {
    const amount = toMinor(t.amount) * (t.type === "REFUND" ? -1 : 1);
    const booking = t.bookingId ? bookings.get(t.bookingId) : undefined;
    if (t.canteenOrderId) canteen += amount;
    else if (booking && booking.play + booking.canteen > 0) {
      const share = Math.round((amount * booking.canteen) / (booking.play + booking.canteen));
      canteen += share;
      gaming += amount - share;
    } else gaming += amount;
  }
  return { gaming, canteen };
}

export { getOpenShift };
