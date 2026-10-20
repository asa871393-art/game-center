import "server-only";
import { addMinutes } from "@/lib/booking/time";
import { applyBps, toMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export const ADMIN_PERIOD_DAYS = 30;

/**
 * Platform overview for super admins: tenants, their lounges, and money over
 * the last 30 days. Amounts are summed per currency (all demo lounges use IQD).
 * Commission applies to online payments only; pay-at-lounge cash never touches
 * the platform.
 */
export async function getPlatformOverview(now = new Date()) {
  const since = addMinutes(now, -ADMIN_PERIOD_DAYS * 24 * 60);

  const [organizations, payments, activeSessions, bookings30d] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { name: "asc" },
      include: {
        owner: { select: { name: true, email: true } },
        subscriptions: { orderBy: { currentPeriodEnd: "desc" }, take: 1 },
        lounges: {
          orderBy: [{ city: "asc" }, { name: "asc" }],
          select: { id: true, name: true, slug: true, city: true, status: true, currency: true, _count: { select: { devices: true } } },
        },
      },
    }),
    prisma.transaction.groupBy({
      by: ["loungeId", "method", "type"],
      where: { status: "SUCCEEDED", type: { in: ["PAYMENT", "REFUND"] }, createdAt: { gte: since }, loungeId: { not: null } },
      _sum: { amount: true },
    }),
    prisma.booking.groupBy({ by: ["loungeId"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    prisma.booking.groupBy({
      by: ["loungeId"],
      where: { createdAt: { gte: since }, status: { notIn: ["CANCELLED"] } },
      _count: { _all: true },
    }),
  ]);

  const money = (loungeId: string, filter: (p: (typeof payments)[number]) => boolean) =>
    payments
      .filter((p) => p.loungeId === loungeId && filter(p))
      .reduce((sum, p) => sum + (p._sum.amount ? toMinor(p._sum.amount) : 0) * (p.type === "REFUND" ? -1 : 1), 0);
  const countFor = (rows: { loungeId: string; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.loungeId === id)?._count._all ?? 0;

  const orgs = organizations.map((org) => {
    const lounges = org.lounges.map((l) => {
      const revenue = money(l.id, () => true);
      const online = money(l.id, (p) => p.method === "ONLINE");
      return {
        id: l.id,
        name: l.name,
        slug: l.slug,
        city: l.city,
        status: l.status,
        currency: l.currency,
        deviceCount: l._count.devices,
        activeSessions: countFor(activeSessions, l.id),
        bookings: countFor(bookings30d, l.id),
        revenue,
        online,
        commission: applyBps(Math.max(0, online), org.commissionRateBps),
      };
    });
    const sub = org.subscriptions[0] ?? null;
    return {
      id: org.id,
      name: org.name,
      status: org.status,
      owner: org.owner.name ?? org.owner.email,
      commissionRateBps: org.commissionRateBps,
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            priceMonthly: toMinor(sub.priceMonthly),
            currency: sub.currency,
            maxLounges: sub.maxLounges,
            maxDevices: sub.maxDevices,
            currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
          }
        : null,
      lounges,
    };
  });

  const allLounges = orgs.flatMap((o) => o.lounges);
  return {
    periodDays: ADMIN_PERIOD_DAYS,
    generatedAt: now.toISOString(),
    // Totals assume a single currency; the UI shows the first lounge's.
    currency: allLounges[0]?.currency ?? "IQD",
    totals: {
      organizations: orgs.length,
      lounges: allLounges.length,
      activeLounges: allLounges.filter((l) => l.status === "ACTIVE").length,
      devices: allLounges.reduce((n, l) => n + l.deviceCount, 0),
      activeSessions: allLounges.reduce((n, l) => n + l.activeSessions, 0),
      bookings: allLounges.reduce((n, l) => n + l.bookings, 0),
      revenue: allLounges.reduce((n, l) => n + l.revenue, 0),
      online: allLounges.reduce((n, l) => n + l.online, 0),
      commission: allLounges.reduce((n, l) => n + l.commission, 0),
    },
    organizations: orgs,
  };
}

export type PlatformOverview = Awaited<ReturnType<typeof getPlatformOverview>>;
