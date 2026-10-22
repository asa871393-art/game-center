import "server-only";
import type { PaymentMethod, PriceTier, SessionMode } from "@/lib/db/types";
import { toMinor, type Minor } from "@/lib/money";
import { db } from "@/server/db";

export interface ReceiptLine {
  kind: "play" | "extension" | "item";
  /** Device name for play lines, item name for canteen lines. */
  label: string;
  quantity?: number;
  unitPrice?: Minor;
  minutes?: number;
  priceTier?: PriceTier;
  amount: Minor;
}

export interface Receipt {
  kind: "session" | "order";
  id: string;
  reference: string;
  loungeId: string;
  lounge: { name: string; slug: string; addressLine: string; city: string; phone: string | null; timezone: string; currency: string };
  issuedAt: string;
  cashier: string | null;
  guest: string | null;
  mode: SessionMode | null;
  startedAt: string | null;
  endedAt: string | null;
  pausedMinutes: number;
  play: ReceiptLine[];
  items: ReceiptLine[];
  playSubtotal: Minor;
  canteenSubtotal: Minor;
  discount: Minor;
  tax: Minor;
  total: Minor;
  paid: Minor;
  payments: { method: PaymentMethod; amount: Minor; tendered: Minor | null; change: Minor | null; at: string }[];
  /** False while the session is still running (a provisional bill). */
  isFinal: boolean;
}

const loungeSelect = { name: true, slug: true, addressLine: true, city: true, phone: true, timezone: true, currency: true } as const;

function paymentsOf(rows: { method: PaymentMethod; amount: { toString(): string }; metadata: unknown; createdAt: Date }[]) {
  return rows.map((t) => {
    const meta = (t.metadata ?? {}) as { tendered?: number; change?: number };
    return {
      method: t.method,
      amount: toMinor(t.amount),
      tendered: typeof meta.tendered === "number" ? meta.tendered : null,
      change: typeof meta.change === "number" ? meta.change : null,
      at: t.createdAt.toISOString(),
    };
  });
}

/** Itemized receipt for a session (booking id) or a counter sale (canteen order id). Caller checks lounge access. */
export async function getReceipt(id: string): Promise<Receipt | null> {
  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      lounge: { select: loungeSelect },
      device: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      segments: { orderBy: { startedAt: "asc" }, include: { device: { select: { name: true } } } },
      extensions: { orderBy: { createdAt: "asc" } },
      canteenOrders: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, include: { items: true } },
      transactions: { where: { type: "PAYMENT", status: "SUCCEEDED" }, orderBy: { createdAt: "asc" } },
    },
  });

  if (booking) {
    const playSubtotal = toMinor(booking.playSubtotal);
    let play: ReceiptLine[];
    if (booking.mode === "OPEN") {
      play = booking.segments.map((s) => ({
        kind: "play",
        label: s.device.name,
        minutes: s.minutes ?? 0,
        priceTier: s.priceTier,
        amount: s.amount ? toMinor(s.amount) : 0,
      }));
    } else {
      const extensions = booking.extensions.map(
        (e): ReceiptLine => ({ kind: "extension", label: booking.device.name, minutes: e.minutes, amount: toMinor(e.price) }),
      );
      const booked =
        Math.round((booking.scheduledEnd.getTime() - booking.scheduledStart.getTime()) / 60_000) -
        extensions.reduce((m, e) => m + (e.minutes ?? 0), 0);
      play = [
        {
          kind: "play",
          label: booking.device.name,
          minutes: Math.max(0, booked),
          priceTier: booking.priceTier,
          // Tier changes and transfers are folded into the main play line.
          amount: playSubtotal - extensions.reduce((s, e) => s + e.amount, 0),
        },
        ...extensions,
      ];
    }
    const items = booking.canteenOrders.flatMap((o) =>
      o.items.map(
        (i): ReceiptLine => ({
          kind: "item",
          label: i.name,
          quantity: i.quantity,
          unitPrice: toMinor(i.unitPrice),
          amount: toMinor(i.lineTotal),
        }),
      ),
    );
    const cashierId = booking.transactions.at(-1)?.processedById ?? booking.createdById;
    const cashier = cashierId ? await db.user.findUnique({ where: { id: cashierId }, select: { name: true } }) : null;
    return {
      kind: "session",
      id: booking.id,
      reference: booking.reference,
      loungeId: booking.loungeId,
      lounge: booking.lounge,
      issuedAt: (booking.actualEnd ?? new Date()).toISOString(),
      cashier: cashier?.name ?? null,
      guest: booking.customer?.name ?? booking.guestName ?? booking.customer?.email ?? null,
      mode: booking.mode,
      startedAt: (booking.actualStart ?? booking.scheduledStart).toISOString(),
      endedAt: booking.actualEnd?.toISOString() ?? null,
      pausedMinutes: booking.pausedMinutes,
      play,
      items,
      playSubtotal,
      canteenSubtotal: toMinor(booking.canteenSubtotal),
      discount: toMinor(booking.discountTotal),
      tax: toMinor(booking.taxTotal),
      total: toMinor(booking.totalPrice),
      paid: toMinor(booking.amountPaid),
      payments: paymentsOf(booking.transactions),
      isFinal: booking.status === "COMPLETED",
    };
  }

  const order = await db.canteenOrder.findUnique({
    where: { id },
    include: {
      lounge: { select: loungeSelect },
      items: true,
      createdBy: { select: { name: true } },
      transactions: { where: { type: "PAYMENT", status: "SUCCEEDED" }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order || order.bookingId) return null;
  const subtotal = toMinor(order.subtotal);
  return {
    kind: "order",
    id: order.id,
    reference: `C-${order.id.slice(-6).toUpperCase()}`,
    loungeId: order.loungeId,
    lounge: order.lounge,
    issuedAt: order.createdAt.toISOString(),
    cashier: order.createdBy?.name ?? null,
    guest: null,
    mode: null,
    startedAt: null,
    endedAt: null,
    pausedMinutes: 0,
    play: [],
    items: order.items.map((i) => ({
      kind: "item",
      label: i.name,
      quantity: i.quantity,
      unitPrice: toMinor(i.unitPrice),
      amount: toMinor(i.lineTotal),
    })),
    playSubtotal: 0,
    canteenSubtotal: subtotal,
    discount: 0,
    tax: toMinor(order.taxTotal),
    total: toMinor(order.total),
    paid: order.transactions.reduce((s, t) => s + toMinor(t.amount), 0),
    payments: paymentsOf(order.transactions),
    isFinal: true,
  };
}
