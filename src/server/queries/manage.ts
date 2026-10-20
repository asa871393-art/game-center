import "server-only";
import type { BookingStatus, DeviceStatus } from "@/generated/prisma/client";
import type { PricingRuleInput } from "@/lib/booking/pricing";
import { getBusinessDay } from "@/lib/booking/schedule";
import { addMinutes } from "@/lib/booking/time";
import { toMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { CHECK_IN_EARLY_MINUTES, NO_SHOW_GRACE_MINUTES } from "@/server/services/pos";

/** A booking starting within this window shows its device as RESERVED. */
export const RESERVED_LEAD_MINUTES = 30;

const iso = (d: Date) => d.toISOString();

/**
 * Everything the front-desk board needs for one lounge, as plain serializable
 * data. Device status is derived from bookings (live sessions and imminent
 * reservations); MAINTENANCE/OFFLINE come from the device row.
 */
export async function getPosBoard(loungeId: string, now = new Date()) {
  const lounge = await prisma.lounge.findUnique({
    where: { id: loungeId },
    include: {
      openingHours: true,
      zones: { orderBy: { sortOrder: "asc" } },
      categories: { orderBy: { baseHourlyRate: "asc" } },
      devices: { orderBy: [{ posY: "asc" }, { posX: "asc" }] },
      pricingRules: { where: { isActive: true } },
      menuItems: { orderBy: [{ category: "asc" }, { sortOrder: "asc" }] },
    },
  });
  if (!lounge) return null;

  const day = getBusinessDay(now, lounge.openingHours, lounge.timezone);
  const { start: dayStart, end: dayEnd } = day.range;

  const [bookings, queue, payments, canteenSales] = await Promise.all([
    prisma.booking.findMany({
      where: {
        loungeId,
        // Every running session (even one overrunning past close) plus everything on today's schedule.
        OR: [{ status: "ACTIVE" }, { scheduledStart: { lt: dayEnd }, scheduledEnd: { gt: dayStart } }],
      },
      orderBy: { scheduledStart: "asc" },
      include: {
        customer: { select: { name: true, email: true, phone: true } },
        canteenOrders: {
          where: { status: { not: "CANCELLED" } },
          orderBy: { createdAt: "asc" },
          include: { items: { select: { name: true, quantity: true } } },
        },
        _count: { select: { extensions: true } },
      },
    }),
    prisma.canteenOrder.findMany({
      where: {
        loungeId,
        status: { in: ["PENDING", "PREPARING"] },
        // Pre-orders wait until the guest is seated.
        OR: [{ bookingId: null }, { booking: { status: "ACTIVE" } }],
      },
      orderBy: { createdAt: "asc" },
      include: {
        items: { select: { name: true, quantity: true } },
        booking: { select: { reference: true, device: { select: { name: true } } } },
      },
    }),
    prisma.transaction.groupBy({
      by: ["type"],
      where: { loungeId, status: "SUCCEEDED", type: { in: ["PAYMENT", "REFUND"] }, createdAt: { gte: dayStart, lt: dayEnd } },
      _sum: { amount: true },
    }),
    prisma.canteenOrder.aggregate({
      where: { loungeId, status: { not: "CANCELLED" }, createdAt: { gte: dayStart, lt: dayEnd } },
      _sum: { subtotal: true },
    }),
  ]);

  // An unpaid online hold past its expiry no longer reserves anything.
  const live = bookings.filter((b) => !(b.status === "PENDING" && b.expiresAt && b.expiresAt <= now));

  const serializeBooking = (b: (typeof bookings)[number]) => ({
    id: b.id,
    reference: b.reference,
    version: b.version,
    deviceId: b.deviceId,
    status: b.status as BookingStatus,
    source: b.source,
    paymentStatus: b.paymentStatus,
    checkoutMethod: b.checkoutMethod,
    guestLabel: b.customer?.name ?? b.guestName ?? b.customer?.email ?? null,
    phone: b.customer?.phone ?? b.guestPhone ?? null,
    players: b.players,
    scheduledStart: iso(b.scheduledStart),
    scheduledEnd: iso(b.scheduledEnd),
    actualStart: b.actualStart ? iso(b.actualStart) : null,
    actualEnd: b.actualEnd ? iso(b.actualEnd) : null,
    playSubtotal: toMinor(b.playSubtotal),
    canteenSubtotal: toMinor(b.canteenSubtotal),
    taxTotal: toMinor(b.taxTotal),
    totalPrice: toMinor(b.totalPrice),
    amountPaid: toMinor(b.amountPaid),
    notes: b.notes,
    extensions: b._count.extensions,
    orders: b.canteenOrders.map((o) => ({
      id: o.id,
      status: o.status,
      isPreOrder: o.isPreOrder,
      subtotal: toMinor(o.subtotal),
      items: o.items,
    })),
    canCheckIn: b.status === "CONFIRMED" && now >= addMinutes(b.scheduledStart, -CHECK_IN_EARLY_MINUTES) && now < b.scheduledEnd,
    canMarkNoShow: b.status === "CONFIRMED" && now >= addMinutes(b.scheduledStart, NO_SHOW_GRACE_MINUTES),
  });

  const sessions = live.map(serializeBooking);
  const reservedBefore = addMinutes(now, RESERVED_LEAD_MINUTES);

  const devices = lounge.devices.map((d) => {
    const mine = sessions.filter((s) => s.deviceId === d.id);
    const current = mine.find((s) => s.status === "ACTIVE") ?? null;
    const upcoming = mine.filter(
      (s) => (s.status === "CONFIRMED" || s.status === "PENDING") && new Date(s.scheduledEnd) > now,
    );
    const next = upcoming[0] ?? null;
    let status: DeviceStatus = d.status === "MAINTENANCE" || d.status === "OFFLINE" ? d.status : "IDLE";
    if (status === "IDLE") {
      if (current) status = "IN_USE";
      else if (next && new Date(next.scheduledStart) <= reservedBefore) status = "RESERVED";
    }
    return {
      id: d.id,
      name: d.name,
      code: d.code,
      categoryId: d.categoryId,
      zoneId: d.zoneId,
      status,
      posX: d.posX,
      posY: d.posY,
      width: d.width,
      height: d.height,
      currentBookingId: current?.id ?? null,
      nextBookingId: next?.id ?? null,
      /** Latest end for a walk-in starting now: the next booking or closing time. */
      freeUntil: next ? next.scheduledStart : day.isOpen ? iso(dayEnd) : null,
    };
  });

  const sum = (type: "PAYMENT" | "REFUND") => {
    const row = payments.find((p) => p.type === type)?._sum.amount;
    return row ? toMinor(row) : 0;
  };
  const inService = devices.filter((d) => d.status !== "MAINTENANCE" && d.status !== "OFFLINE").length;
  const activeCount = devices.filter((d) => d.status === "IN_USE").length;

  return {
    lounge: {
      id: lounge.id,
      name: lounge.name,
      slug: lounge.slug,
      timezone: lounge.timezone,
      currency: lounge.currency,
      taxRateBps: lounge.taxRateBps,
      floorPlan: { width: lounge.floorPlanWidth, height: lounge.floorPlanHeight },
    },
    businessDay: { date: day.date, start: iso(dayStart), end: iso(dayEnd), isOpen: day.isOpen },
    generatedAt: iso(now),
    zones: lounge.zones.map((z) => ({ id: z.id, name: z.name, color: z.color })),
    categories: lounge.categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      baseHourlyRate: toMinor(c.baseHourlyRate),
      capacity: c.capacity,
      isActive: c.isActive,
    })),
    pricingRules: lounge.pricingRules.map(
      (r): PricingRuleInput => ({
        id: r.id,
        categoryId: r.categoryId,
        daysOfWeek: r.daysOfWeek,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        hourlyRate: r.hourlyRate === null ? null : toMinor(r.hourlyRate),
        multiplierBps: r.multiplierBps,
        priority: r.priority,
        validFrom: r.validFrom,
        validTo: r.validTo,
        isActive: r.isActive,
      }),
    ),
    menuItems: lounge.menuItems.map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      price: toMinor(m.price),
      stock: m.stockQuantity,
      isAvailable: m.isAvailable && (m.stockQuantity === null || m.stockQuantity > 0),
    })),
    devices,
    sessions,
    queue: queue.map((o) => ({
      id: o.id,
      status: o.status,
      isPreOrder: o.isPreOrder,
      bookingId: o.bookingId,
      deviceName: o.booking?.device.name ?? null,
      reference: o.booking?.reference ?? null,
      notes: o.notes,
      total: toMinor(o.total),
      createdAt: iso(o.createdAt),
      items: o.items,
    })),
    stats: {
      revenue: sum("PAYMENT") - sum("REFUND"),
      canteenSales: canteenSales._sum.subtotal ? toMinor(canteenSales._sum.subtotal) : 0,
      activeSessions: activeCount,
      inService,
      completedToday: sessions.filter((s) => s.status === "COMPLETED").length,
      upcomingToday: sessions.filter((s) => s.status === "CONFIRMED" && new Date(s.scheduledStart) > now).length,
      noShows: sessions.filter((s) => s.status === "NO_SHOW").length,
    },
  };
}

export type PosBoardData = NonNullable<Awaited<ReturnType<typeof getPosBoard>>>;
export type PosSession = PosBoardData["sessions"][number];
export type PosDevice = PosBoardData["devices"][number];
