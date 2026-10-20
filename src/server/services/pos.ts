import "server-only";
import type { BookingStatus, Prisma } from "@/generated/prisma/client";
import { PRICING_STEP_MINUTES, quoteBooking, type PricingRuleInput } from "@/lib/booking/pricing";
import { findContainingWindow } from "@/lib/booking/schedule";
import { addMinutes, diffMinutes } from "@/lib/booking/time";
import { computeBookingTotals, paymentStatusFor } from "@/lib/booking/totals";
import { applyBps, fromMinor, toMinor, type Minor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { generateReference, isOverlapViolation, MAX_DURATION_MINUTES, releaseBookings } from "./booking";

/**
 * Front-desk operations: walk-ins, check-in, extensions, canteen orders,
 * checkout and device status. Every booking mutation is guarded by
 * Booking.version so two tablets acting on the same seat can't both win.
 * Callers must check lounge access first (see src/server/staff.ts).
 */

export type PosErrorCode =
  | "NOT_FOUND"
  | "STALE"
  | "INVALID_STATE"
  | "TOO_EARLY"
  | "DEVICE_UNAVAILABLE"
  | "DEVICE_BUSY"
  | "DURATION_INVALID"
  | "OUTSIDE_HOURS"
  | "SLOT_TAKEN"
  | "ITEM_UNAVAILABLE"
  | "TOO_MANY_PLAYERS"
  | "PAYMENT_MISMATCH"
  | "PAID_BOOKING";

export class PosError extends Error {
  constructor(public readonly code: PosErrorCode) {
    super(code);
    this.name = "PosError";
  }
}

export interface PosContext {
  loungeId: string;
  actorId: string;
  now?: Date;
}

/** A confirmed booking can be checked in this many minutes before its start. */
export const CHECK_IN_EARLY_MINUTES = 30;
/** A confirmed booking can be marked no-show this many minutes after its start. */
export const NO_SHOW_GRACE_MINUTES = 15;
export const WALK_IN_MIN_MINUTES = 15;
export const EXTENSION_MAX_MINUTES = 4 * 60;
const MAX_ITEM_QUANTITY = 20;

export type CounterPaymentMethod = "CASH" | "CARD";

export interface OrderLineInput {
  menuItemId: string;
  quantity: number;
}

type Tx = Prisma.TransactionClient;

function floorToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

async function loadLounge(loungeId: string) {
  const lounge = await prisma.lounge.findUnique({
    where: { id: loungeId },
    select: {
      id: true,
      timezone: true,
      currency: true,
      taxRateBps: true,
      openingHours: true,
      pricingRules: { where: { isActive: true } },
    },
  });
  if (!lounge) throw new PosError("NOT_FOUND");
  const rules: PricingRuleInput[] = lounge.pricingRules.map((r) => ({
    ...r,
    hourlyRate: r.hourlyRate === null ? null : toMinor(r.hourlyRate),
  }));
  return { ...lounge, rules };
}

type LoungePricing = Awaited<ReturnType<typeof loadLounge>>;

function quotePlay(
  lounge: LoungePricing,
  category: { id: string; baseHourlyRate: { toString(): string } },
  start: Date,
  minutes: number,
) {
  return quoteBooking({
    start,
    durationMinutes: minutes,
    timeZone: lounge.timezone,
    categoryId: category.id,
    baseHourlyRate: toMinor(category.baseHourlyRate),
    rules: lounge.rules,
    taxRateBps: lounge.taxRateBps,
    addOns: [],
  });
}

function audit(tx: Tx, ctx: PosContext, action: string, entityType: string, entityId: string, data?: Prisma.InputJsonValue) {
  return tx.auditLog.create({ data: { actorId: ctx.actorId, loungeId: ctx.loungeId, action, entityType, entityId, data } });
}

/** Loads a booking of this lounge and checks its state and version. */
async function getBookingFor(tx: Tx, ctx: PosContext, bookingId: string, statuses: readonly BookingStatus[], version?: number) {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, loungeId: ctx.loungeId },
    include: { device: { include: { category: true } } },
  });
  if (!booking) throw new PosError("NOT_FOUND");
  if (version !== undefined && booking.version !== version) throw new PosError("STALE");
  if (!statuses.includes(booking.status)) throw new PosError("INVALID_STATE");
  return booking;
}

/** Applies `data` only if nobody changed the booking since it was read. */
async function guardedUpdate(tx: Tx, booking: { id: string; version: number }, data: Prisma.BookingUpdateManyMutationInput) {
  const res = await tx.booking.updateMany({
    where: { id: booking.id, version: booking.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count !== 1) throw new PosError("STALE");
}

function totalsData(totals: ReturnType<typeof computeBookingTotals>, amountPaid: Minor) {
  return {
    playSubtotal: fromMinor(totals.playSubtotal),
    canteenSubtotal: fromMinor(totals.canteenSubtotal),
    discountTotal: fromMinor(totals.discountTotal),
    taxTotal: fromMinor(totals.taxTotal),
    totalPrice: fromMinor(totals.totalPrice),
    paymentStatus: paymentStatusFor(totals.totalPrice, amountPaid),
  };
}

async function assertDeviceFree(tx: Tx, deviceId: string, exceptBookingId?: string) {
  const active = await tx.booking.count({
    where: { deviceId, status: "ACTIVE", ...(exceptBookingId ? { id: { not: exceptBookingId } } : {}) },
  });
  if (active > 0) throw new PosError("DEVICE_BUSY");
}

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

export interface StartWalkInInput {
  deviceId: string;
  durationMinutes: number;
  players: number;
  guestName?: string;
  guestPhone?: string;
}

/** Starts a walk-in session on an idle device, now. */
export async function startWalkIn(ctx: PosContext, input: StartWalkInInput) {
  const now = floorToMinute(ctx.now ?? new Date());
  const lounge = await loadLounge(ctx.loungeId);
  const device = await prisma.device.findFirst({
    where: { id: input.deviceId, loungeId: ctx.loungeId },
    include: { category: true },
  });
  if (!device) throw new PosError("NOT_FOUND");
  if (!device.category.isActive || device.status === "MAINTENANCE" || device.status === "OFFLINE") {
    throw new PosError("DEVICE_UNAVAILABLE");
  }
  if (!Number.isInteger(input.players) || input.players < 1 || input.players > device.category.capacity) {
    throw new PosError("TOO_MANY_PLAYERS");
  }

  const minutes = input.durationMinutes;
  if (
    !Number.isInteger(minutes) ||
    minutes < WALK_IN_MIN_MINUTES ||
    minutes > MAX_DURATION_MINUTES ||
    minutes % PRICING_STEP_MINUTES !== 0
  ) {
    throw new PosError("DURATION_INVALID");
  }
  const end = addMinutes(now, minutes);
  if (!findContainingWindow(now, end, lounge.openingHours, lounge.timezone)) throw new PosError("OUTSIDE_HOURS");

  const quote = quotePlay(lounge, device.category, now, minutes);
  const reference = generateReference();

  try {
    return await prisma.$transaction(async (tx) => {
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
      // An overrunning session no longer overlaps by schedule but still occupies the seat.
      await assertDeviceFree(tx, device.id);

      const booking = await tx.booking.create({
        data: {
          reference,
          loungeId: ctx.loungeId,
          deviceId: device.id,
          createdById: ctx.actorId,
          source: "WALK_IN",
          status: "ACTIVE",
          checkoutMethod: "PAY_AT_LOUNGE",
          guestName: input.guestName || null,
          guestPhone: input.guestPhone || null,
          players: input.players,
          scheduledStart: now,
          scheduledEnd: end,
          actualStart: now,
          currency: lounge.currency,
          hourlyRate: fromMinor(quote.effectiveHourlyRate),
          playSubtotal: fromMinor(quote.playSubtotal),
          taxTotal: fromMinor(quote.taxTotal),
          totalPrice: fromMinor(quote.total),
        },
        select: { id: true, reference: true },
      });
      await tx.device.update({ where: { id: device.id }, data: { status: "IN_USE" } });
      await audit(tx, ctx, "session.start", "Booking", booking.id, { walkIn: true, minutes });
      return booking;
    });
  } catch (error) {
    if (isOverlapViolation(error)) throw new PosError("SLOT_TAKEN");
    throw error;
  }
}

/** Seats a confirmed booking: CONFIRMED -> ACTIVE. */
export async function checkIn(ctx: PosContext, input: { bookingId: string; version: number }) {
  const now = ctx.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const booking = await getBookingFor(tx, ctx, input.bookingId, ["CONFIRMED"], input.version);
    if (now < addMinutes(booking.scheduledStart, -CHECK_IN_EARLY_MINUTES)) throw new PosError("TOO_EARLY");
    if (now >= booking.scheduledEnd) throw new PosError("INVALID_STATE");
    if (booking.device.status === "MAINTENANCE" || booking.device.status === "OFFLINE") {
      throw new PosError("DEVICE_UNAVAILABLE");
    }
    await assertDeviceFree(tx, booking.deviceId, booking.id);

    await guardedUpdate(tx, booking, { status: "ACTIVE", actualStart: now });
    await tx.device.update({ where: { id: booking.deviceId }, data: { status: "IN_USE" } });
    await audit(tx, ctx, "session.checkIn", "Booking", booking.id);
    return { reference: booking.reference };
  });
}

/** "Extend +N min": moves the scheduled end and bills the extra time at the rates in force then. */
export async function extendSession(ctx: PosContext, input: { bookingId: string; version: number; minutes: number }) {
  const { minutes } = input;
  if (!Number.isInteger(minutes) || minutes < PRICING_STEP_MINUTES || minutes > EXTENSION_MAX_MINUTES || minutes % PRICING_STEP_MINUTES !== 0) {
    throw new PosError("DURATION_INVALID");
  }
  const lounge = await loadLounge(ctx.loungeId);

  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await getBookingFor(tx, ctx, input.bookingId, ["ACTIVE"], input.version);
      const previousEnd = booking.scheduledEnd;
      const newEnd = addMinutes(previousEnd, minutes);
      const totalMinutes = diffMinutes(newEnd, booking.scheduledStart);
      if (totalMinutes > MAX_DURATION_MINUTES) throw new PosError("DURATION_INVALID");
      if (!findContainingWindow(booking.scheduledStart, newEnd, lounge.openingHours, lounge.timezone)) {
        throw new PosError("OUTSIDE_HOURS");
      }

      const price = quotePlay(lounge, booking.device.category, previousEnd, minutes).playSubtotal;
      const playSubtotal = toMinor(booking.playSubtotal) + price;
      const totals = computeBookingTotals({
        playSubtotal,
        canteenSubtotal: toMinor(booking.canteenSubtotal),
        discountTotal: toMinor(booking.discountTotal),
        taxRateBps: lounge.taxRateBps,
      });

      await guardedUpdate(tx, booking, {
        scheduledEnd: newEnd,
        hourlyRate: fromMinor(Math.round((playSubtotal * 60) / totalMinutes)),
        ...totalsData(totals, toMinor(booking.amountPaid)),
      });
      await tx.bookingExtension.create({
        data: { bookingId: booking.id, minutes, price: fromMinor(price), previousEnd, newEnd, addedById: ctx.actorId },
      });
      await audit(tx, ctx, "session.extend", "Booking", booking.id, { minutes, price });
      return { newEnd, price };
    });
  } catch (error) {
    if (isOverlapViolation(error)) throw new PosError("SLOT_TAKEN");
    throw error;
  }
}

export interface EndSessionInput {
  bookingId: string;
  version: number;
  /** Required when a balance is due; must equal it exactly. */
  payment?: { method: CounterPaymentMethod; amount: Minor } | null;
}

/** Checkout: collects the balance, completes the booking and frees the device. */
export async function endSession(ctx: PosContext, input: EndSessionInput) {
  const now = ctx.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const booking = await getBookingFor(tx, ctx, input.bookingId, ["ACTIVE"], input.version);
    const total = toMinor(booking.totalPrice);
    const due = total - toMinor(booking.amountPaid);
    const amount = input.payment?.amount ?? 0;
    if (due > 0 ? !input.payment || amount !== due : amount !== 0) throw new PosError("PAYMENT_MISMATCH");

    await guardedUpdate(tx, booking, {
      status: "COMPLETED",
      actualEnd: now,
      amountPaid: fromMinor(Math.max(total, toMinor(booking.amountPaid))),
      paymentStatus: "PAID",
    });
    if (due > 0 && input.payment) {
      await tx.transaction.create({
        data: {
          loungeId: ctx.loungeId,
          bookingId: booking.id,
          userId: booking.customerId,
          processedById: ctx.actorId,
          type: "PAYMENT",
          method: input.payment.method,
          status: "SUCCEEDED",
          amount: fromMinor(due),
          currency: booking.currency,
        },
      });
    }
    // Leave MAINTENANCE/OFFLINE alone; only a seat we marked busy goes back to idle.
    await tx.device.updateMany({ where: { id: booking.deviceId, status: "IN_USE" }, data: { status: "IDLE" } });
    await audit(tx, ctx, "session.end", "Booking", booking.id, { collected: due, method: input.payment?.method ?? null });
    return { reference: booking.reference, collected: due };
  });
}

/** Confirmed booking whose guest never came. Pre-orders are restocked; payments are kept. */
export async function markNoShow(ctx: PosContext, input: { bookingId: string; version: number }) {
  const now = ctx.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const booking = await getBookingFor(tx, ctx, input.bookingId, ["CONFIRMED"], input.version);
    if (now < addMinutes(booking.scheduledStart, NO_SHOW_GRACE_MINUTES)) throw new PosError("TOO_EARLY");
    await guardedUpdate(tx, booking, {});
    await releaseBookings(tx, [booking.id], "NO_SHOW", now);
    await tx.booking.update({ where: { id: booking.id }, data: { status: "NO_SHOW", cancelledAt: null } });
    await audit(tx, ctx, "booking.noShow", "Booking", booking.id);
  });
}

/** Staff cancellation of an unpaid upcoming booking. Paid bookings need a refund first. */
export async function cancelBooking(ctx: PosContext, input: { bookingId: string; version: number }) {
  const now = ctx.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const booking = await getBookingFor(tx, ctx, input.bookingId, ["PENDING", "CONFIRMED"], input.version);
    if (toMinor(booking.amountPaid) > 0) throw new PosError("PAID_BOOKING");
    await guardedUpdate(tx, booking, {});
    await releaseBookings(tx, [booking.id], "STAFF_CANCELLED", now);
    await audit(tx, ctx, "booking.cancel", "Booking", booking.id);
  });
}

// -----------------------------------------------------------------------------
// Canteen
// -----------------------------------------------------------------------------

/** Validates order lines against this lounge's menu and decrements tracked stock. */
async function reserveLines(tx: Tx, loungeId: string, items: readonly OrderLineInput[]) {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.menuItemId, (merged.get(i.menuItemId) ?? 0) + i.quantity);
  if (merged.size === 0) throw new PosError("ITEM_UNAVAILABLE");
  for (const quantity of merged.values()) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) throw new PosError("ITEM_UNAVAILABLE");
  }

  const menu = await tx.menuItem.findMany({ where: { loungeId, id: { in: [...merged.keys()] }, isAvailable: true } });
  if (menu.length !== merged.size) throw new PosError("ITEM_UNAVAILABLE");

  const lines = menu.map((item) => {
    const quantity = merged.get(item.id)!;
    const unitPrice = toMinor(item.price);
    return { item, quantity, unitPrice, lineTotal: unitPrice * quantity };
  });
  for (const line of lines) {
    if (line.item.stockQuantity === null) continue;
    const res = await tx.menuItem.updateMany({
      where: { id: line.item.id, stockQuantity: { gte: line.quantity } },
      data: { stockQuantity: { decrement: line.quantity } },
    });
    if (res.count !== 1) throw new PosError("ITEM_UNAVAILABLE");
  }
  return { lines, subtotal: lines.reduce((s, l) => s + l.lineTotal, 0) };
}

function orderItemsData(lines: Awaited<ReturnType<typeof reserveLines>>["lines"]) {
  return lines.map((l) => ({
    menuItemId: l.item.id,
    name: l.item.name,
    unitPrice: fromMinor(l.unitPrice),
    quantity: l.quantity,
    lineTotal: fromMinor(l.lineTotal),
  }));
}

/** Adds snacks/drinks to a running session's bill. */
export async function addSessionOrder(ctx: PosContext, input: { bookingId: string; items: OrderLineInput[]; notes?: string }) {
  const lounge = await loadLounge(ctx.loungeId);
  return prisma.$transaction(async (tx) => {
    const booking = await getBookingFor(tx, ctx, input.bookingId, ["ACTIVE"]);
    const { lines, subtotal } = await reserveLines(tx, ctx.loungeId, input.items);
    const orderTax = applyBps(subtotal, lounge.taxRateBps);

    const order = await tx.canteenOrder.create({
      data: {
        loungeId: ctx.loungeId,
        bookingId: booking.id,
        customerId: booking.customerId,
        createdById: ctx.actorId,
        subtotal: fromMinor(subtotal),
        taxTotal: fromMinor(orderTax),
        total: fromMinor(subtotal + orderTax),
        notes: input.notes || null,
        items: { create: orderItemsData(lines) },
      },
      select: { id: true },
    });
    const totals = computeBookingTotals({
      playSubtotal: toMinor(booking.playSubtotal),
      canteenSubtotal: toMinor(booking.canteenSubtotal) + subtotal,
      discountTotal: toMinor(booking.discountTotal),
      taxRateBps: lounge.taxRateBps,
    });
    await guardedUpdate(tx, booking, totalsData(totals, toMinor(booking.amountPaid)));
    await audit(tx, ctx, "canteen.order", "CanteenOrder", order.id, { bookingId: booking.id, subtotal });
    return { orderId: order.id, subtotal };
  });
}

/** Walk-up counter sale with no seat, paid on the spot. */
export async function counterSale(ctx: PosContext, input: { items: OrderLineInput[]; method: CounterPaymentMethod; notes?: string }) {
  const lounge = await loadLounge(ctx.loungeId);
  return prisma.$transaction(async (tx) => {
    const { lines, subtotal } = await reserveLines(tx, ctx.loungeId, input.items);
    const tax = applyBps(subtotal, lounge.taxRateBps);
    const total = subtotal + tax;
    const order = await tx.canteenOrder.create({
      data: {
        loungeId: ctx.loungeId,
        createdById: ctx.actorId,
        subtotal: fromMinor(subtotal),
        taxTotal: fromMinor(tax),
        total: fromMinor(total),
        notes: input.notes || null,
        items: { create: orderItemsData(lines) },
      },
      select: { id: true },
    });
    if (total > 0) {
      await tx.transaction.create({
        data: {
          loungeId: ctx.loungeId,
          canteenOrderId: order.id,
          processedById: ctx.actorId,
          type: "PAYMENT",
          method: input.method,
          status: "SUCCEEDED",
          amount: fromMinor(total),
          currency: lounge.currency,
        },
      });
    }
    await audit(tx, ctx, "canteen.counterSale", "CanteenOrder", order.id, { total, method: input.method });
    return { orderId: order.id, total };
  });
}

export async function markOrderServed(ctx: PosContext, input: { orderId: string }) {
  const now = ctx.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const res = await tx.canteenOrder.updateMany({
      where: { id: input.orderId, loungeId: ctx.loungeId, status: { in: ["PENDING", "PREPARING"] } },
      data: { status: "SERVED", servedAt: now },
    });
    if (res.count !== 1) {
      const exists = await tx.canteenOrder.count({ where: { id: input.orderId, loungeId: ctx.loungeId } });
      throw new PosError(exists ? "INVALID_STATE" : "NOT_FOUND");
    }
    await audit(tx, ctx, "canteen.served", "CanteenOrder", input.orderId);
  });
}

/** Voids an unserved order on a seat's bill and restocks it. Counter sales are already paid and can't be voided here. */
export async function cancelSessionOrder(ctx: PosContext, input: { orderId: string }) {
  const lounge = await loadLounge(ctx.loungeId);
  return prisma.$transaction(async (tx) => {
    const order = await tx.canteenOrder.findFirst({
      where: { id: input.orderId, loungeId: ctx.loungeId },
      include: { items: true },
    });
    if (!order) throw new PosError("NOT_FOUND");
    if (!order.bookingId || (order.status !== "PENDING" && order.status !== "PREPARING")) {
      throw new PosError("INVALID_STATE");
    }
    const booking = await getBookingFor(tx, ctx, order.bookingId, ["PENDING", "CONFIRMED", "ACTIVE"]);

    const claimed = await tx.canteenOrder.updateMany({
      where: { id: order.id, status: { in: ["PENDING", "PREPARING"] } },
      data: { status: "CANCELLED" },
    });
    if (claimed.count !== 1) throw new PosError("STALE");
    for (const item of order.items) {
      await tx.menuItem.updateMany({
        where: { id: item.menuItemId, stockQuantity: { not: null } },
        data: { stockQuantity: { increment: item.quantity } },
      });
    }

    const totals = computeBookingTotals({
      playSubtotal: toMinor(booking.playSubtotal),
      canteenSubtotal: Math.max(0, toMinor(booking.canteenSubtotal) - toMinor(order.subtotal)),
      discountTotal: toMinor(booking.discountTotal),
      taxRateBps: lounge.taxRateBps,
    });
    await guardedUpdate(tx, booking, totalsData(totals, toMinor(booking.amountPaid)));
    await audit(tx, ctx, "canteen.cancel", "CanteenOrder", order.id, { bookingId: booking.id });
  });
}

// -----------------------------------------------------------------------------
// Devices
// -----------------------------------------------------------------------------

export type SettableDeviceStatus = "IDLE" | "MAINTENANCE" | "OFFLINE";

/** Takes a device out of service or back in. A seat with a running session can't be taken out. */
export async function setDeviceStatus(ctx: PosContext, input: { deviceId: string; status: SettableDeviceStatus }) {
  return prisma.$transaction(async (tx) => {
    const device = await tx.device.findFirst({ where: { id: input.deviceId, loungeId: ctx.loungeId } });
    if (!device) throw new PosError("NOT_FOUND");
    const active = await tx.booking.count({ where: { deviceId: device.id, status: "ACTIVE" } });
    if (input.status !== "IDLE" && active > 0) throw new PosError("DEVICE_BUSY");
    const status = input.status === "IDLE" && active > 0 ? "IN_USE" : input.status;
    await tx.device.update({ where: { id: device.id }, data: { status } });
    await audit(tx, ctx, "device.status", "Device", device.id, { from: device.status, to: status });
    return { status };
  });
}
