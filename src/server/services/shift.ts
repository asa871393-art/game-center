import "server-only";
import type { PaymentMethod, Prisma } from "@/generated/prisma/client";
import { fromMinor, toMinor, type Minor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getOpenShift, PosError, type PosContext } from "./pos";

/**
 * Cashier shifts and the cash drawer. A lounge has one drawer, so at most one
 * OPEN shift (enforced by a partial unique index). Counter payments taken while
 * it is open are attached to it; closing reconciles counted cash against
 * openingFloat + cash taken.
 */

const MAX_FLOAT: Minor = 1_000_000_000; // 10,000,000.00

type Db = Prisma.TransactionClient | typeof prisma;

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } } | null;
  return e?.code === "P2002" || e?.meta?.driverAdapterError?.cause?.originalCode === "23505" || String(error).includes("Shift_one_open_per_lounge");
}

export async function openShift(ctx: PosContext, input: { openingFloat: Minor }) {
  if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0 || input.openingFloat > MAX_FLOAT) {
    throw new PosError("PAYMENT_MISMATCH");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const shift = await tx.shift.create({
        data: {
          loungeId: ctx.loungeId,
          cashierId: ctx.actorId,
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
          data: { openingFloat: input.openingFloat },
        },
      });
      return shift;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PosError("SHIFT_ALREADY_OPEN");
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

export async function closeShift(ctx: PosContext, input: { shiftId: string; countedCash: Minor; notes?: string }) {
  const now = ctx.now ?? new Date();
  if (!Number.isInteger(input.countedCash) || input.countedCash < 0 || input.countedCash > MAX_FLOAT * 10) {
    throw new PosError("PAYMENT_MISMATCH");
  }
  return prisma.$transaction(async (tx) => {
    const shift = await tx.shift.findFirst({ where: { id: input.shiftId, loungeId: ctx.loungeId } });
    if (!shift) throw new PosError("NOT_FOUND");
    if (shift.status !== "OPEN") throw new PosError("SHIFT_CLOSED");

    const expected = toMinor(shift.openingFloat) + (await shiftCashNet(tx, shift.id));
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
  cashier: string;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  openingFloat: Minor;
  cashNet: Minor;
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
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      lounge: { select: { name: true, timezone: true, currency: true } },
      cashier: { select: { name: true, email: true } },
      closedBy: { select: { name: true, email: true } },
    },
  });
  if (!shift) return null;

  const txs = await prisma.transaction.findMany({
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
    prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { playSubtotal: true, canteenSubtotal: true, discountTotal: true, taxTotal: true },
    }),
    prisma.canteenOrder.findMany({ where: { id: { in: orderIds } }, select: { subtotal: true, taxTotal: true } }),
  ]);
  const sum = <T,>(rows: T[], pick: (r: T) => { toString(): string }) => rows.reduce((s, r) => s + toMinor(pick(r)), 0);

  const cashNet = await shiftCashNet(prisma, shift.id);
  const openingFloat = toMinor(shift.openingFloat);
  return {
    id: shift.id,
    loungeId: shift.loungeId,
    lounge: shift.lounge,
    status: shift.status,
    cashier: shift.cashier.name ?? shift.cashier.email ?? "",
    closedBy: shift.closedBy ? (shift.closedBy.name ?? shift.closedBy.email ?? "") : null,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
    openingFloat,
    cashNet,
    expectedCash: shift.expectedCash ? toMinor(shift.expectedCash) : openingFloat + cashNet,
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

export { getOpenShift };
