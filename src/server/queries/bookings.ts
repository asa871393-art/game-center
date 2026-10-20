import "server-only";
import { toMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";

const bookingInclude = {
  lounge: { select: { name: true, slug: true, timezone: true, addressLine: true, city: true } },
  device: { select: { name: true, category: { select: { name: true, type: true } } } },
  canteenOrders: { where: { status: { not: "CANCELLED" as const } }, include: { items: true } },
  transactions: {
    where: { type: "PAYMENT" as const },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true, status: true, provider: true },
  },
};

/** A customer's own booking by reference; null if missing or owned by someone else. */
export async function getCustomerBooking(reference: string, customerId: string, now = new Date()) {
  const b = await prisma.booking.findFirst({ where: { reference, customerId }, include: bookingInclude });
  if (!b) return null;
  // An unpaid hold past its expiry no longer reserves the slot; show it as cancelled
  // even before the next booking on that device cleans it up.
  const holdExpired = b.status === "PENDING" && b.expiresAt !== null && b.expiresAt <= now;
  return {
    reference: b.reference,
    status: holdExpired ? ("CANCELLED" as const) : b.status,
    holdExpired,
    paymentStatus: b.paymentStatus,
    checkoutMethod: b.checkoutMethod,
    expiresAt: b.expiresAt,
    scheduledStart: b.scheduledStart,
    scheduledEnd: b.scheduledEnd,
    players: b.players,
    currency: b.currency,
    playSubtotal: toMinor(b.playSubtotal),
    canteenSubtotal: toMinor(b.canteenSubtotal),
    taxTotal: toMinor(b.taxTotal),
    totalPrice: toMinor(b.totalPrice),
    notes: b.notes,
    lounge: b.lounge,
    device: { name: b.device.name, categoryName: b.device.category.name, type: b.device.category.type },
    items: b.canteenOrders.flatMap((o) =>
      o.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, lineTotal: toMinor(i.lineTotal) })),
    ),
    pendingTransactionId:
      !holdExpired && b.status === "PENDING" && b.transactions[0]?.status === "PENDING" ? b.transactions[0].id : null,
  };
}

export async function listCustomerBookings(customerId: string) {
  const rows = await prisma.booking.findMany({
    where: { customerId },
    orderBy: { scheduledStart: "desc" },
    take: 50,
    include: {
      lounge: { select: { name: true, slug: true, timezone: true } },
      device: { select: { name: true } },
    },
  });
  return rows.map((b) => ({
    reference: b.reference,
    status: b.status,
    paymentStatus: b.paymentStatus,
    scheduledStart: b.scheduledStart,
    scheduledEnd: b.scheduledEnd,
    currency: b.currency,
    totalPrice: toMinor(b.totalPrice),
    lounge: b.lounge,
    deviceName: b.device.name,
  }));
}

/** Pending sandbox checkout, visible only to the payer. */
export async function getCheckoutTransaction(transactionId: string, userId: string) {
  const t = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    include: {
      booking: {
        select: {
          reference: true,
          status: true,
          expiresAt: true,
          checkoutMethod: true,
          scheduledStart: true,
          lounge: { select: { name: true, timezone: true } },
          device: { select: { name: true } },
        },
      },
    },
  });
  if (!t?.booking) return null;
  return {
    id: t.id,
    status: t.status,
    amount: toMinor(t.amount),
    currency: t.currency,
    isSandbox: t.providerRef?.startsWith("sandbox_") ?? false,
    booking: t.booking,
  };
}
