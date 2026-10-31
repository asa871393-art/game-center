import "server-only";
import { getBusinessDay } from "@/lib/booking/schedule";
import { addDays, zonedTimeToUtc } from "@/lib/booking/time";
import { toMinor } from "@/lib/money";
import { addMonths, buildMonthReport, monthOf, type IsoMonth, type ReportTransaction } from "@/lib/reports";
import { db } from "@/server/db";

/**
 * The branch's revenue for one month, day by day. Reads every successful payment and refund
 * (whatever shift took it) and the drawer expenses, and buckets them by business day.
 * `month` defaults to the current one in the lounge's timezone.
 */
export async function getMonthReport(loungeId: string, month?: IsoMonth, now = new Date()) {
  const lounge = await db.lounge.findUnique({ where: { id: loungeId }, include: { openingHours: true } });
  if (!lounge) return null;
  // Business day, not calendar date: at 01:00 before an overnight close it is still yesterday.
  const today = getBusinessDay(now, lounge.openingHours, lounge.timezone).date;
  const current = monthOf(today);
  const target = month ?? current;

  // From midnight on the 1st to a day past the month: sales after midnight before an overnight
  // close still belong to the month's last business day. Out-of-month days are dropped later.
  const start = zonedTimeToUtc(`${target}-01`, 0, lounge.timezone);
  const end = zonedTimeToUtc(addDays(`${addMonths(target, 1)}-01`, 1), 0, lounge.timezone);
  const [txs, expenses] = await Promise.all([
    db.transaction.findMany({
      where: { loungeId, status: "SUCCEEDED", type: { in: ["PAYMENT", "REFUND"] }, createdAt: { gte: start, lt: end } },
      select: { type: true, method: true, amount: true, bookingId: true, canteenOrderId: true, createdAt: true },
    }),
    db.shiftExpense.findMany({
      where: { loungeId, createdAt: { gte: start, lt: end } },
      select: { amount: true, createdAt: true, voidedAt: true },
    }),
  ]);

  const dayOf = (at: Date) => getBusinessDay(at, lounge.openingHours, lounge.timezone).date;
  const bookingIds = [...new Set(txs.flatMap((t) => (t.bookingId && !t.canteenOrderId ? [t.bookingId] : [])))];
  const bookings = bookingIds.length
    ? await db.booking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, playSubtotal: true, canteenSubtotal: true } })
    : [];

  const report = buildMonthReport(
    target,
    txs.map(
      (t): ReportTransaction => ({
        day: dayOf(t.createdAt),
        type: t.type === "REFUND" ? "REFUND" : "PAYMENT",
        method: t.method,
        amount: toMinor(t.amount),
        bookingId: t.bookingId,
        canteenOrderId: t.canteenOrderId,
      }),
    ),
    expenses.filter((e) => !e.voidedAt).map((e) => ({ day: dayOf(e.createdAt), amount: toMinor(e.amount) })),
    new Map(bookings.map((b) => [b.id, { play: toMinor(b.playSubtotal), canteen: toMinor(b.canteenSubtotal) }])),
  );
  return {
    lounge: { id: lounge.id, name: lounge.name, timezone: lounge.timezone, currency: lounge.currency },
    report,
    currentMonth: current,
    today,
  };
}

export type MonthReportData = NonNullable<Awaited<ReturnType<typeof getMonthReport>>>;
