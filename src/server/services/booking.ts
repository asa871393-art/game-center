import "server-only";
import { randomInt } from "node:crypto";
import type { CheckoutMethod, Prisma } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/config";
import { localePath } from "@/i18n/config";
import { PRICING_STEP_MINUTES, quoteBooking, type PricingRuleInput } from "@/lib/booking/pricing";
import { findContainingWindow } from "@/lib/booking/schedule";
import { addMinutes, diffMinutes } from "@/lib/booking/time";
import { env } from "@/lib/env";
import { fromMinor, toMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getPaymentProvider, isOnlineMethod } from "@/server/payments";

export const MAX_ADVANCE_DAYS = 14;
export const MAX_DURATION_MINUTES = 12 * 60;
const MAX_ITEM_QUANTITY = 20;

export type BookingErrorCode =
  | "NOT_FOUND"
  | "DEVICE_UNAVAILABLE"
  | "TOO_MANY_PLAYERS"
  | "DURATION_INVALID"
  | "TOO_SOON"
  | "TOO_FAR"
  | "OUTSIDE_HOURS"
  | "SLOT_TAKEN"
  | "ITEM_UNAVAILABLE"
  | "PAYMENT_UNAVAILABLE";

export class BookingError extends Error {
  constructor(public readonly code: BookingErrorCode) {
    super(code);
    this.name = "BookingError";
  }
}

export interface CreateBookingInput {
  customerId: string;
  loungeSlug: string;
  deviceId: string;
  start: Date;
  durationMinutes: number;
  players: number;
  addOns: { menuItemId: string; quantity: number }[];
  checkoutMethod: CheckoutMethod;
  notes?: string;
  locale: Locale;
  now?: Date;
}

export interface CreateBookingResult {
  reference: string;
  /** Payment page for online methods, confirmation page otherwise. */
  redirectUrl: string;
}

// Unambiguous characters for references read aloud at the front desk.
const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateReference(): string {
  let ref = "GL-";
  for (let i = 0; i < 7; i++) ref += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return ref;
}

/** True when `error` is the Postgres exclusion violation from Booking_no_overlap_per_device. */
export function isOverlapViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (e: unknown): boolean => {
    if (!e || typeof e !== "object" || seen.has(e)) return false;
    seen.add(e);
    const rec = e as Record<string, unknown>;
    if (rec.code === "23P01" || rec.originalCode === "23P01") return true;
    if (typeof rec.message === "string" && rec.message.includes("Booking_no_overlap_per_device")) return true;
    return visit(rec.cause) || visit(rec.meta) || visit(rec.driverAdapterError);
  };
  return visit(error);
}

function mergeAddOns(addOns: CreateBookingInput["addOns"]) {
  const merged = new Map<string, number>();
  for (const a of addOns) merged.set(a.menuItemId, (merged.get(a.menuItemId) ?? 0) + a.quantity);
  return [...merged].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
}

/**
 * Cancels bookings, their pre-orders and pending payments, and restocks
 * tracked menu items. Used for expired payment holds and declined payments.
 */
export async function releaseBookings(
  tx: Prisma.TransactionClient,
  bookingIds: string[],
  reason: string,
  now = new Date(),
): Promise<void> {
  if (bookingIds.length === 0) return;

  const orders = await tx.canteenOrder.findMany({
    where: { bookingId: { in: bookingIds }, status: { not: "CANCELLED" } },
    select: { id: true, items: { select: { menuItemId: true, quantity: true } } },
  });
  for (const item of orders.flatMap((o) => o.items)) {
    await tx.menuItem.updateMany({
      where: { id: item.menuItemId, stockQuantity: { not: null } },
      data: { stockQuantity: { increment: item.quantity } },
    });
  }
  await tx.canteenOrder.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { status: "CANCELLED" } });
  await tx.transaction.updateMany({
    where: { bookingId: { in: bookingIds }, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  await tx.booking.updateMany({
    where: { id: { in: bookingIds } },
    data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason, expiresAt: null, version: { increment: 1 } },
  });
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const now = input.now ?? new Date();

  const lounge = await prisma.lounge.findFirst({
    where: { slug: input.loungeSlug, status: "ACTIVE" },
    include: {
      openingHours: true,
      pricingRules: { where: { isActive: true } },
      devices: { where: { id: input.deviceId }, include: { category: true } },
    },
  });
  const device = lounge?.devices[0];
  if (!lounge || !device) throw new BookingError("NOT_FOUND");

  const category = device.category;
  if (!category.isActive || !device.isBookableOnline || device.status === "MAINTENANCE" || device.status === "OFFLINE") {
    throw new BookingError("DEVICE_UNAVAILABLE");
  }
  if (input.players < 1 || input.players > category.capacity) throw new BookingError("TOO_MANY_PLAYERS");

  const { durationMinutes } = input;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < category.minBookingMinutes ||
    durationMinutes > MAX_DURATION_MINUTES ||
    durationMinutes % PRICING_STEP_MINUTES !== 0
  ) {
    throw new BookingError("DURATION_INVALID");
  }

  const start = input.start;
  const end = addMinutes(start, durationMinutes);
  if (start < now) throw new BookingError("TOO_SOON");
  if (start > addMinutes(now, MAX_ADVANCE_DAYS * 24 * 60)) throw new BookingError("TOO_FAR");

  const window = findContainingWindow(start, end, lounge.openingHours, lounge.timezone);
  if (!window) throw new BookingError("OUTSIDE_HOURS");
  if (diffMinutes(start, window.start) % category.slotIntervalMinutes !== 0) throw new BookingError("OUTSIDE_HOURS");

  // Add-ons: must belong to this lounge, be available, and be in stock.
  const addOns = mergeAddOns(input.addOns);
  if (addOns.some((a) => !Number.isInteger(a.quantity) || a.quantity < 1 || a.quantity > MAX_ITEM_QUANTITY)) {
    throw new BookingError("ITEM_UNAVAILABLE");
  }
  const menuItems = addOns.length
    ? await prisma.menuItem.findMany({
        where: { loungeId: lounge.id, id: { in: addOns.map((a) => a.menuItemId) }, isAvailable: true },
      })
    : [];
  if (menuItems.length !== addOns.length) throw new BookingError("ITEM_UNAVAILABLE");
  const lines = addOns.map((a) => {
    const item = menuItems.find((m) => m.id === a.menuItemId)!;
    if (item.stockQuantity !== null && item.stockQuantity < a.quantity) throw new BookingError("ITEM_UNAVAILABLE");
    return { item, quantity: a.quantity, unitPrice: toMinor(item.price) };
  });

  const rules: PricingRuleInput[] = lounge.pricingRules.map((r) => ({
    ...r,
    hourlyRate: r.hourlyRate === null ? null : toMinor(r.hourlyRate),
  }));
  const quote = quoteBooking({
    start,
    durationMinutes,
    timeZone: lounge.timezone,
    categoryId: category.id,
    baseHourlyRate: toMinor(category.baseHourlyRate),
    rules,
    taxRateBps: lounge.taxRateBps,
    addOns: lines,
  });

  const online = isOnlineMethod(input.checkoutMethod);
  const provider = online ? getPaymentProvider(input.checkoutMethod as "ZAINCASH" | "FASTPAY") : null;
  if (online && !provider) throw new BookingError("PAYMENT_UNAVAILABLE");

  const reference = generateReference();
  const canteenTaxTotal = Math.round((quote.taxTotal * quote.canteenSubtotal) / Math.max(1, quote.playSubtotal + quote.canteenSubtotal));

  let created: { bookingId: string; transactionId: string | null };
  try {
    created = await prisma.$transaction(async (tx) => {
      // Free this device's expired payment holds so they don't trip the overlap constraint.
      const expired = await tx.booking.findMany({
        where: { deviceId: device.id, status: "PENDING", expiresAt: { lte: now } },
        select: { id: true },
      });
      await releaseBookings(
        tx,
        expired.map((b) => b.id),
        "PAYMENT_EXPIRED",
        now,
      );

      for (const line of lines) {
        if (line.item.stockQuantity === null) continue;
        const res = await tx.menuItem.updateMany({
          where: { id: line.item.id, stockQuantity: { gte: line.quantity } },
          data: { stockQuantity: { decrement: line.quantity } },
        });
        if (res.count !== 1) throw new BookingError("ITEM_UNAVAILABLE");
      }

      const booking = await tx.booking.create({
        data: {
          reference,
          loungeId: lounge.id,
          deviceId: device.id,
          customerId: input.customerId,
          source: "ONLINE",
          status: online ? "PENDING" : "CONFIRMED",
          checkoutMethod: input.checkoutMethod,
          expiresAt: online ? addMinutes(now, env.PAYMENT_HOLD_MINUTES) : null,
          players: input.players,
          scheduledStart: start,
          scheduledEnd: end,
          currency: lounge.currency,
          hourlyRate: fromMinor(quote.effectiveHourlyRate),
          playSubtotal: fromMinor(quote.playSubtotal),
          canteenSubtotal: fromMinor(quote.canteenSubtotal),
          taxTotal: fromMinor(quote.taxTotal),
          totalPrice: fromMinor(quote.total),
          notes: input.notes || null,
          ...(lines.length
            ? {
                canteenOrders: {
                  create: {
                    loungeId: lounge.id,
                    customerId: input.customerId,
                    isPreOrder: true,
                    subtotal: fromMinor(quote.canteenSubtotal),
                    taxTotal: fromMinor(canteenTaxTotal),
                    total: fromMinor(quote.canteenSubtotal + canteenTaxTotal),
                    items: {
                      create: lines.map((l) => ({
                        menuItemId: l.item.id,
                        name: l.item.name,
                        unitPrice: fromMinor(l.unitPrice),
                        quantity: l.quantity,
                        lineTotal: fromMinor(l.unitPrice * l.quantity),
                      })),
                    },
                  },
                },
              }
            : {}),
        },
        select: { id: true },
      });

      const transaction =
        online && provider
          ? await tx.transaction.create({
              data: {
                loungeId: lounge.id,
                bookingId: booking.id,
                userId: input.customerId,
                type: "PAYMENT",
                method: "ONLINE",
                status: "PENDING",
                amount: fromMinor(quote.total),
                currency: lounge.currency,
                provider: provider.name,
              },
              select: { id: true },
            })
          : null;

      return { bookingId: booking.id, transactionId: transaction?.id ?? null };
    });
  } catch (error) {
    if (isOverlapViolation(error)) throw new BookingError("SLOT_TAKEN");
    throw error;
  }

  if (!provider || !created.transactionId) {
    return { reference, redirectUrl: localePath(input.locale, `/bookings/${reference}`) };
  }

  try {
    const payment = await provider.createPayment({
      transactionId: created.transactionId,
      amount: quote.total,
      currency: lounge.currency,
      description: `${lounge.name} · ${device.name} · ${reference}`,
      locale: input.locale,
    });
    await prisma.transaction.update({ where: { id: created.transactionId }, data: { providerRef: payment.providerRef } });
    return { reference, redirectUrl: payment.redirectUrl };
  } catch (error) {
    // The gateway failed: release the hold rather than leave a dead booking.
    await prisma.$transaction((tx) => releaseBookings(tx, [created.bookingId], "PAYMENT_INIT_FAILED"));
    console.error("Payment init failed", error);
    throw new BookingError("PAYMENT_UNAVAILABLE");
  }
}

export type SettleOutcome = "approved" | "declined";
export type SettleResult = "PAID" | "DECLINED" | "EXPIRED" | "ALREADY_PROCESSED";

/**
 * Applies a verified gateway result to a pending online payment. Idempotent:
 * only the first call for a PENDING transaction has an effect.
 */
export async function settlePayment(
  transactionId: string,
  outcome: SettleOutcome,
  now = new Date(),
): Promise<{ result: SettleResult; reference: string }> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { booking: { select: { id: true, reference: true, status: true, expiresAt: true, totalPrice: true } } },
    });
    if (!payment?.booking) throw new BookingError("NOT_FOUND");
    const { booking } = payment;

    // Claim the transaction; a concurrent call sees count 0 and backs off.
    const claimed = await tx.transaction.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: outcome === "approved" ? "SUCCEEDED" : "FAILED" },
    });
    if (claimed.count === 0 || booking.status !== "PENDING") {
      return { result: "ALREADY_PROCESSED", reference: booking.reference };
    }

    if (booking.expiresAt && booking.expiresAt <= now) {
      await tx.transaction.update({ where: { id: payment.id }, data: { status: "FAILED", metadata: { reason: "EXPIRED" } } });
      await releaseBookings(tx, [booking.id], "PAYMENT_EXPIRED", now);
      return { result: "EXPIRED", reference: booking.reference };
    }

    if (outcome === "declined") {
      await releaseBookings(tx, [booking.id], "PAYMENT_DECLINED", now);
      return { result: "DECLINED", reference: booking.reference };
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "CONFIRMED",
        paymentStatus: "PAID",
        amountPaid: booking.totalPrice,
        expiresAt: null,
        version: { increment: 1 },
      },
    });
    return { result: "PAID", reference: booking.reference };
  });
}
