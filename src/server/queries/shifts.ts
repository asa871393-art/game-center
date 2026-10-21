import "server-only";
import { toMinor, type Minor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getShiftSummary } from "@/server/services/shift";

const HISTORY_LIMIT = 60;

export interface ShiftHistoryRow {
  id: string;
  status: "OPEN" | "CLOSED";
  cashier: string;
  openedAt: string;
  closedAt: string | null;
  collected: Minor;
  expensesTotal: Minor;
  expectedCash: Minor;
  countedCash: Minor | null;
  variance: Minor | null;
}

/** Recent shifts for the manager's history log, newest first. The open shift's figures are live. */
export async function getShiftHistory(loungeId: string) {
  const lounge = await prisma.lounge.findUnique({ where: { id: loungeId }, select: { id: true, name: true, timezone: true, currency: true } });
  if (!lounge) return null;

  const shifts = await prisma.shift.findMany({
    where: { loungeId },
    orderBy: { openedAt: "desc" },
    take: HISTORY_LIMIT,
    include: { cashier: { select: { name: true, email: true } } },
  });
  const ids = shifts.map((s) => s.id);
  const [collected, expenses] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["shiftId"],
      where: { shiftId: { in: ids }, status: "SUCCEEDED", type: "PAYMENT" },
      _sum: { amount: true },
    }),
    prisma.shiftExpense.groupBy({ by: ["shiftId"], where: { shiftId: { in: ids }, voidedAt: null }, _sum: { amount: true } }),
  ]);
  const collectedBy = new Map(collected.map((c) => [c.shiftId, c._sum.amount ? toMinor(c._sum.amount) : 0]));
  const expensesBy = new Map(expenses.map((e) => [e.shiftId, e._sum.amount ? toMinor(e._sum.amount) : 0]));
  const open = shifts.find((s) => s.status === "OPEN");
  const live = open ? await getShiftSummary(open.id) : null;

  const rows: ShiftHistoryRow[] = shifts.map((s) => ({
    id: s.id,
    status: s.status,
    cashier: s.cashier.name ?? s.cashier.email ?? "",
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    collected: collectedBy.get(s.id) ?? 0,
    expensesTotal: expensesBy.get(s.id) ?? 0,
    expectedCash: s.expectedCash ? toMinor(s.expectedCash) : (live?.id === s.id ? live.expectedCash : 0),
    countedCash: s.countedCash ? toMinor(s.countedCash) : null,
    variance: s.variance ? toMinor(s.variance) : null,
  }));

  const closed = rows.filter((r) => r.variance !== null);
  return {
    lounge,
    rows,
    totals: {
      shortCount: closed.filter((r) => r.variance! < 0).length,
      overCount: closed.filter((r) => r.variance! > 0).length,
      netVariance: closed.reduce((s, r) => s + r.variance!, 0),
      collected: rows.reduce((s, r) => s + r.collected, 0),
    },
  };
}

export type ShiftHistory = NonNullable<Awaited<ReturnType<typeof getShiftHistory>>>;
