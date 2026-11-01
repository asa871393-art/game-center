import "server-only";
import type { BookingStatus, PriceTier, InputJsonValue } from "@/lib/db/types";
import { WALK_IN_MIN_MINUTES } from "@/lib/booking/duration-input";
import { PRICING_STEP_MINUTES, type PricingRuleInput } from "@/lib/booking/pricing";
import { findContainingWindow, type Interval } from "@/lib/booking/schedule";
import { billableMinutes, pricePlay, tierBps, withDeviceRates, type PlayPricing, type PricedCategory } from "@/lib/booking/session-billing";
import { addMinutes, diffMinutes } from "@/lib/booking/time";
import { computeBookingTotals, paymentStatusFor } from "@/lib/booking/totals";
import { applyBps, fromMinor, toMinor, type Minor } from "@/lib/money";
import { db, type TxClient, type DbReader, type UpdateData } from "@/server/db";
import { BLOCKING_STATUSES } from "@/lib/db/types";
import { isPaidRequest } from "@/server/payments/zaincash-request";
import { zainCashConfig } from "@/server/payments/zaincash";
import { generateReference, isOverlapViolation, MAX_DURATION_MINUTES, releaseBookings } from "./booking";

/**
 * Front-desk operations: walk-ins (open or fixed time, price tiers), check-in,
 * extensions, pause/resume, transfers, canteen orders, split-payment checkout
 * and device status. Every booking mutation is guarded by Booking.version so
 * two tablets acting on the same seat can't both win.
 * Callers must check lounge access first (see src/server/staff.ts).
 *
 * Billing:
 * - FIXED sessions carry a price snapshot (playSubtotal) for the booked time;
 *   extensions, tier changes and transfers adjust it by the difference.
 * - OPEN sessions are billed from SessionSegment rows (time actually played,
 *   per device and tier, pauses excluded) and settled at checkout.
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
  | "TIER_UNAVAILABLE"
  | "PAYMENT_MISMATCH"
  | "DISCOUNT_INVALID"
  | "SHIFT_CLOSED"
  | "SHIFT_ALREADY_OPEN"
  | "INSUFFICIENT_CASH"
  | "NAME_TAKEN"
  | "CODE_TAKEN"
  | "HAS_UPCOMING_BOOKINGS"
  | "CATEGORY_IN_USE"
  | "INVALID_INPUT"
  | "PAID_BOOKING"
  | "FORBIDDEN"
  | "ACCOUNT_DISABLED"
  | "CANNOT_REMOVE_SELF"
  | "WEAK_PIN"
  | "EMAIL_TAKEN"
  | "PHONE_TAKEN"
  | "PIN_TAKEN"
  | "ZAINCASH_UNPAID"
  | "ZAINCASH_AMOUNT"
  | "GATEWAY_ERROR";

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
/** Shared with the start-session screen, which validates typed durations against it. */
export { WALK_IN_MIN_MINUTES };
export const EXTENSION_MAX_MINUTES = 4 * 60;
/** How far back a checkout may freeze an open session's bill (the moment the cashier opened checkout). */
export const BILL_UNTIL_MAX_AGE_MINUTES = 10;
const MAX_ITEM_QUANTITY = 20;

export type CounterPaymentMethod = "CASH" | "CARD" | "ZAINCASH" | "FASTPAY";

export interface PaymentPart {
  method: CounterPaymentMethod;
  amount: Minor;
  /** Cash handed over, for the change line on the receipt. */
  tendered?: Minor;
  /** ZAINCASH only, when the gateway is connected: the paid ZainCash request this part uses. */
  zainCashPaymentId?: string;
}

export interface OrderLineInput {
  menuItemId: string;
  quantity: number;
}

type Tx = TxClient;

/** The lounge's open cashier shift (its cash drawer), if any. */
export function getOpenShift(db: Tx | DbReader, loungeId: string) {
  return db.shift.findFirst({ where: { loungeId, status: "OPEN" } });
}

/** Counter payments need an open shift so every dinar lands in a drawer that gets counted. */
async function requireShiftFor(tx: Tx, loungeId: string, payments: readonly PaymentPart[]) {
  if (payments.length === 0) return null;
  const shift = await getOpenShift(tx, loungeId);
  if (!shift) throw new PosError("SHIFT_CLOSED");
  return shift.id;
}

function floorToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

async function loadLounge(loungeId: string) {
  const lounge = await db.lounge.findUnique({
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
  const pricing: PlayPricing = { timeZone: lounge.timezone, rules };
  return { ...lounge, rules, pricing };
}

type LoungePricing = Awaited<ReturnType<typeof loadLounge>>;

/** Effective pricing of a device: its own rate overrides, else its category's. */
export function pricedDevice(device: {
  hourlyRateOverride: { toString(): string } | null;
  multiTierBpsOverride: number | null;
  vipTierBpsOverride: number | null;
  category: { id: string; baseHourlyRate: { toString(): string }; multiTierBps: number | null; vipTierBps: number | null };
}): PricedCategory {
  return withDeviceRates(
    {
      id: device.category.id,
      baseHourlyRate: toMinor(device.category.baseHourlyRate),
      multiTierBps: device.category.multiTierBps,
      vipTierBps: device.category.vipTierBps,
    },
    {
      hourlyRateOverride: device.hourlyRateOverride === null ? null : toMinor(device.hourlyRateOverride),
      multiTierBpsOverride: device.multiTierBpsOverride,
      vipTierBpsOverride: device.vipTierBpsOverride,
    },
  );
}

function audit(tx: Tx, ctx: PosContext, action: string, entityType: string, entityId: string, data?: InputJsonValue) {
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
async function guardedUpdate(tx: Tx, booking: { id: string; version: number }, data: UpdateData<"Booking">) {
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

function rebill(
  booking: { canteenSubtotal: { toString(): string }; discountTotal: { toString(): string }; amountPaid: { toString(): string } },
  playSubtotal: Minor,
  taxRateBps: number,
  discountTotal: Minor = toMinor(booking.discountTotal),
) {
  const totals = computeBookingTotals({
    playSubtotal: Math.max(0, playSubtotal),
    canteenSubtotal: toMinor(booking.canteenSubtotal),
    discountTotal,
    taxRateBps,
  });
  return totalsData(totals, toMinor(booking.amountPaid));
}

async function assertDeviceFree(tx: Tx, deviceId: string, exceptBookingId?: string) {
  const active = await tx.booking.count({
    where: { deviceId, status: "ACTIVE", ...(exceptBookingId ? { id: { not: exceptBookingId } } : {}) },
  });
  if (active > 0) throw new PosError("DEVICE_BUSY");
}

function requireTier(category: PricedCategory, tier: PriceTier) {
  if (tierBps(category, tier) === null) throw new PosError("TIER_UNAVAILABLE");
}

/**
 * Latest end for a session on `deviceId` starting at `from`: the next live
 * booking's start or the window's close, whichever is first.
 */
async function reservationHorizon(tx: Tx, deviceId: string, from: Date, window: Interval, exceptBookingId?: string, now = from) {
  const next = await tx.booking.findFirst({
    where: {
      deviceId,
      status: { in: [...BLOCKING_STATUSES] },
      scheduledStart: { gte: from },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(exceptBookingId ? { id: { not: exceptBookingId } } : {}),
    },
    orderBy: { scheduledStart: "asc" },
    select: { scheduledStart: true },
  });
  return next && next.scheduledStart < window.end ? next.scheduledStart : window.end;
}

/** The opening window `at` falls in, given at least `minutes` of it remain. */
function windowAt(lounge: LoungePricing, at: Date, minutes = 1) {
  return findContainingWindow(at, addMinutes(at, minutes), lounge.openingHours, lounge.timezone);
}

async function openSegment(tx: Tx, bookingId: string, deviceId: string, priceTier: PriceTier, at: Date) {
  await tx.sessionSegment.create({ data: { bookingId, deviceId, priceTier, startedAt: at } });
}

/**
 * Ends the running segment at `until`. OPEN sessions get the segment priced
 * (that is what they pay); FIXED segments are history only.
 */
async function closeSegment(tx: Tx, lounge: LoungePricing, bookingId: string, mode: "FIXED" | "OPEN", until: Date) {
  const running = await tx.sessionSegment.findFirst({
    where: { bookingId, endedAt: null },
    include: { device: { include: { category: true } } },
  });
  if (!running) return 0;
  const end = until < running.startedAt ? running.startedAt : until;
  const minutes = billableMinutes(running.startedAt, end);
  const amount =
    mode === "OPEN" ? pricePlay(lounge.pricing, pricedDevice(running.device), running.priceTier, running.startedAt, minutes) : null;
  await tx.sessionSegment.update({
    where: { id: running.id },
    data: { endedAt: end, minutes, amount: amount === null ? null : fromMinor(amount) },
  });
  return amount ?? 0;
}

/**
 * Call BEFORE changing a device's rates: running open sessions on it are billed
 * up to `now` at the old rates and continue in a new segment, so a price
 * change never applies retroactively.
 */
export async function splitOpenSegmentsOnDevice(tx: Tx, loungeId: string, deviceId: string, now: Date) {
  const sessions = await tx.booking.findMany({
    where: { deviceId, loungeId, status: "ACTIVE", mode: "OPEN", pausedAt: null },
    select: { id: true, priceTier: true },
  });
  if (sessions.length === 0) return;
  const lounge = await loadLounge(loungeId);
  for (const s of sessions) {
    await closeSegment(tx, lounge, s.id, "OPEN", now);
    await openSegment(tx, s.id, deviceId, s.priceTier, now);
  }
}

async function openPlayTotal(tx: Tx, bookingId: string): Promise<Minor> {
  const rows = await tx.sessionSegment.findMany({ where: { bookingId }, select: { amount: true } });
  return rows.reduce((sum, r) => sum + (r.amount ? toMinor(r.amount) : 0), 0);
}

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

export interface StartWalkInInput {
  deviceId: string;
  mode?: "FIXED" | "OPEN";
  priceTier?: PriceTier;
  /** Required for FIXED sessions. */
  durationMinutes?: number;
  players: number;
  guestName?: string;
  guestPhone?: string;
}

/** Starts a walk-in session on an idle device, now: a fixed duration, or open until checkout. */
export async function startWalkIn(ctx: PosContext, input: StartWalkInInput) {
  const now = floorToMinute(ctx.now ?? new Date());
  const mode = input.mode ?? "FIXED";
  const tier = input.priceTier ?? "SINGLE";
  const lounge = await loadLounge(ctx.loungeId);
  const device = await db.device.findFirst({
    where: { id: input.deviceId, loungeId: ctx.loungeId, archivedAt: null },
    include: { category: true },
  });
  if (!device) throw new PosError("NOT_FOUND");
  if (!device.category.isActive || device.status === "MAINTENANCE" || device.status === "OFFLINE") {
    throw new PosError("DEVICE_UNAVAILABLE");
  }
  if (!Number.isInteger(input.players) || input.players < 1 || input.players > device.category.capacity) {
    throw new PosError("TOO_MANY_PLAYERS");
  }
  const category = pricedDevice(device);
  requireTier(category, tier);

  let fixedEnd: Date | null = null;
  let playSubtotal = 0;
  if (mode === "FIXED") {
    const minutes = input.durationMinutes ?? 0;
    if (
      !Number.isInteger(minutes) ||
      minutes < WALK_IN_MIN_MINUTES ||
      minutes > MAX_DURATION_MINUTES ||
      minutes % PRICING_STEP_MINUTES !== 0
    ) {
      throw new PosError("DURATION_INVALID");
    }
    fixedEnd = addMinutes(now, minutes);
    if (!findContainingWindow(now, fixedEnd, lounge.openingHours, lounge.timezone)) throw new PosError("OUTSIDE_HOURS");
    playSubtotal = pricePlay(lounge.pricing, category, tier, now, minutes);
  }
  const window = windowAt(lounge, now, WALK_IN_MIN_MINUTES);
  if (!window) throw new PosError("OUTSIDE_HOURS");

  const totals = computeBookingTotals({ playSubtotal, canteenSubtotal: 0, discountTotal: 0, taxRateBps: lounge.taxRateBps });
  const reference = generateReference();

  try {
    return await db.$transaction(async (tx) => {
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

      // An open session reserves the seat until the next booking or closing time.
      const end = fixedEnd ?? (await reservationHorizon(tx, device.id, now, window));
      if (diffMinutes(end, now) < WALK_IN_MIN_MINUTES) throw new PosError("SLOT_TAKEN");

      const booking = await tx.booking.create({
        data: {
          reference,
          loungeId: ctx.loungeId,
          deviceId: device.id,
          createdById: ctx.actorId,
          source: "WALK_IN",
          status: "ACTIVE",
          mode,
          priceTier: tier,
          checkoutMethod: "PAY_AT_LOUNGE",
          guestName: input.guestName || null,
          guestPhone: input.guestPhone || null,
          players: input.players,
          scheduledStart: now,
          scheduledEnd: end,
          actualStart: now,
          currency: lounge.currency,
          hourlyRate: fromMinor(applyBps(category.baseHourlyRate, tierBps(category, tier)!)),
          playSubtotal: fromMinor(totals.playSubtotal),
          taxTotal: fromMinor(totals.taxTotal),
          totalPrice: fromMinor(totals.totalPrice),
        },
        select: { id: true, reference: true },
      });
      await openSegment(tx, booking.id, device.id, tier, now);
      await tx.device.update({ where: { id: device.id }, data: { status: "IN_USE" } });
      await audit(tx, ctx, "session.start", "Booking", booking.id, { walkIn: true, mode, tier, minutes: input.durationMinutes ?? null });
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
  return db.$transaction(async (tx) => {
    const booking = await getBookingFor(tx, ctx, input.bookingId, ["CONFIRMED"], input.version);
    if (now < addMinutes(booking.scheduledStart, -CHECK_IN_EARLY_MINUTES)) throw new PosError("TOO_EARLY");
    if (now >= booking.scheduledEnd) throw new PosError("INVALID_STATE");
    if (booking.device.status === "MAINTENANCE" || booking.device.status === "OFFLINE") {
      throw new PosError("DEVICE_UNAVAILABLE");
    }
    await assertDeviceFree(tx, booking.deviceId, booking.id);

    await guardedUpdate(tx, booking, { status: "ACTIVE", actualStart: now });
    await openSegment(tx, booking.id, booking.deviceId, booking.priceTier, now);
    await tx.device.update({ where: { id: booking.deviceId }, data: { status: "IN_USE" } });
    await audit(tx, ctx, "session.checkIn", "Booking", booking.id);
    return { reference: booking.reference };
  });
}

/** "Extend +N min" on a fixed session: moves the scheduled end and bills the extra time at the rates in force then. */
export async function extendSession(ctx: PosContext, input: { bookingId: string; version: number; minutes: number }) {
  const { minutes } = input;
  if (!Number.isInteger(minutes) || minutes < PRICING_STEP_MINUTES || minutes > EXTENSION_MAX_MINUTES || minutes % PRICING_STEP_MINUTES !== 0) {
    throw new PosError("DURATION_INVALID");
  }
  const lounge = await loadLounge(ctx.loungeId);

  try {
    return await db.$transaction(async (tx) => {
      const booking = await getBookingFor(tx, ctx, input.bookingId, ["ACTIVE"], input.version);
      // Open sessions have no end to extend.
      if (booking.mode !== "FIXED") throw new PosError("INVALID_STATE");
      const previousEnd = booking.scheduledEnd;
      const newEnd = addMinutes(previousEnd, minutes);
      const totalMinutes = diffMinutes(newEnd, booking.scheduledStart);
      if (totalMinutes > MAX_DURATION_MINUTES) throw new PosError("DURATION_INVALID");
      if (!findContainingWindow(booking.scheduledStart, newEnd, lounge.openingHours, lounge.timezone)) {
        throw new PosError("OUTSIDE_HOURS");
      }

      const price = pricePlay(lounge.pricing, pricedDevice(booking.device), booking.priceTier, previousEnd, minutes);
      const playSubtotal = toMinor(booking.playSubtotal) + price;
      await guardedUpdate(tx, booking, {
        scheduledEnd: newEnd,
        hourlyRate: fromMinor(Math.round((playSubtotal * 60) / totalMinutes)),
        ...rebill(booking, playSubtotal, lounge.taxRateBps),
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

/**
 * Switches the price tier from now on. OPEN: a new segment starts at the new
 * rate. FIXED: the remaining booked time is repriced (difference added or refunded to the bill).
 */
export async function changeTier(ctx: PosContext, input: { bookingId: string; version: number; tier: PriceTier }) {
  const now = ctx.now ?? new Date();
  const lounge = await loadLounge(ctx.loungeId);
  return db.$transaction(async (tx) => {
    const booking = await getBookingFor(tx, ctx, input.bookingId, ["ACTIVE"], input.version);
    const category = pricedDevice(booking.device);
    requireTier(category, input.tier);
    if (booking.priceTier === input.tier) return { delta: 0 };

    let playSubtotal = toMinor(booking.playSubtotal);
    let delta = 0;
    if (booking.mode === "FIXED") {
      const from = booking.pausedAt ?? now;
      const remaining = Math.max(0, diffMinutes(booking.scheduledEnd, from));
      delta =
        pricePlay(lounge.pricing, category, input.tier, now, remaining) -
        pricePlay(lounge.pricing, category, booking.priceTier, now, remaining);
      playSubtotal += delta;
    }
    if (!booking.pausedAt) {
      await closeSegment(tx, lounge, booking.id, booking.mode, now);
      await openSegment(tx, booking.id, booking.deviceId, input.tier, now);
    }
    await guardedUpdate(tx, booking, {
      priceTier: input.tier,
      hourlyRate: fromMinor(applyBps(category.baseHourlyRate, tierBps(category, input.tier)!)),
      ...(booking.mode === "FIXED" ? rebill(booking, playSubtotal, lounge.taxRateBps) : {}),
    });
    await audit(tx, ctx, "session.tier", "Booking", booking.id, { from: booking.priceTier, to: input.tier, delta });
    return { delta };
  });
}

/** Stops the clock. The seat stays reserved for the guest. */
export async function pauseSession(ctx: PosContext, input: { bookingId: string; version: number }) {
  const now = ctx.now ?? new Date();
  const lounge = await loadLounge(ctx.loungeId);
  return db.$transaction(async (tx) => {
    const booking = await getBookingFor(tx, ctx, input.bookingId, ["ACTIVE"], input.version);
    if (booking.pausedAt) throw new PosError("INVALID_STATE");
    await closeSegment(tx, lounge, booking.id, booking.mode, now);
    await guardedUpdate(tx, booking, { pausedAt: now });
    await audit(tx, ctx, "session.pause", "Booking", booking.id);
  });
}

/**
 * Restarts the clock. A FIXED session's end moves out by the paused time, as
 * far as the next booking or closing time allows; `lostMinutes` reports any shortfall.
 */
export async function resumeSession(ctx: PosContext, input: { bookingId: string; version: number }) {
  const now = ctx.now ?? new Date();
  const lounge = await loadLounge(ctx.loungeId);
  try {
    return await db.$transaction(async (tx) => {
      const booking = await getBookingFor(tx, ctx, input.bookingId, ["ACTIVE"], input.version);
      if (!booking.pausedAt) throw new PosError("INVALID_STATE");
      const paused = billableMinutes(booking.pausedAt, now);

      let scheduledEnd = booking.scheduledEnd;
      let lostMinutes = 0;
      if (booking.mode === "FIXED" && paused > 0) {
        const wanted = addMinutes(booking.scheduledEnd, paused);
        const window = findContainingWindow(booking.scheduledStart, booking.scheduledEnd, lounge.openingHours, lounge.timezone);
        const limit = window
          ? await reservationHorizon(tx, booking.deviceId, booking.scheduledEnd, window, booking.id, now)
          : booking.scheduledEnd;
        scheduledEnd = wanted < limit ? wanted : limit;
        if (scheduledEnd < booking.scheduledEnd) scheduledEnd = booking.scheduledEnd;
        lostMinutes = Math.max(0, diffMinutes(wanted, scheduledEnd));
      }

      await guardedUpdate(tx, booking, { pausedAt: null, pausedMinutes: booking.pausedMinutes + paused, scheduledEnd });
      await openSegment(tx, booking.id, booking.deviceId, booking.priceTier, now);
      await audit(tx, ctx, "session.resume", "Booking", booking.id, { paused, lostMinutes });
      return { pausedMinutes: paused, lostMinutes, scheduledEnd };
    });
  } catch (error) {
    if (isOverlapViolation(error)) throw new PosError("SLOT_TAKEN");
    throw error;
  }
}

/**
 * Moves a running session to another free device (e.g. PC-03 -> PS5-B). Time
 * played so far stays on the old device's rate; FIXED sessions have the
 * remaining time repriced at the new device's rate.
 */
export async function transferSession(ctx: PosContext, input: { bookingId: string; version: number; targetDeviceId: string }) {
  const now = ctx.now ?? new Date();
  const start = floorToMinute(now);
  const lounge = await loadLounge(ctx.loungeId);
  try {
    return await db.$transaction(async (tx) => {
      const booking = await getBookingFor(tx, ctx, input.bookingId, ["ACTIVE"], input.version);
      if (booking.pausedAt) throw new PosError("INVALID_STATE");
      if (booking.deviceId === input.targetDeviceId) throw new PosError("INVALID_STATE");

      const target = await tx.device.findFirst({
        where: { id: input.targetDeviceId, loungeId: ctx.loungeId, archivedAt: null },
        include: { category: true },
      });
      if (!target) throw new PosError("NOT_FOUND");
      if (!target.category.isActive || target.status === "MAINTENANCE" || target.status === "OFFLINE") {
        throw new PosError("DEVICE_UNAVAILABLE");
      }
      if (booking.players > target.category.capacity) throw new PosError("TOO_MANY_PLAYERS");
      const fromCategory = pricedDevice(booking.device);
      const toCategory = pricedDevice(target);
      requireTier(toCategory, booking.priceTier);
      await assertDeviceFree(tx, target.id);

      const window = windowAt(lounge, start);
      if (!window) throw new PosError("OUTSIDE_HOURS");

      let scheduledEnd: Date;
      let playSubtotal = toMinor(booking.playSubtotal);
      if (booking.mode === "FIXED") {
        // The guest keeps the time they bought; an overrunning session gets a short grace slot.
        scheduledEnd = booking.scheduledEnd > addMinutes(start, 1) ? booking.scheduledEnd : addMinutes(start, PRICING_STEP_MINUTES);
        const remaining = Math.max(0, diffMinutes(booking.scheduledEnd, now));
        playSubtotal +=
          pricePlay(lounge.pricing, toCategory, booking.priceTier, now, remaining) -
          pricePlay(lounge.pricing, fromCategory, booking.priceTier, now, remaining);
      } else {
        scheduledEnd = await reservationHorizon(tx, target.id, start, window, booking.id, now);
        if (diffMinutes(scheduledEnd, start) < 1) throw new PosError("SLOT_TAKEN");
      }

      await closeSegment(tx, lounge, booking.id, booking.mode, now);
      // The booking's range moves to the new device from now on; actualStart keeps the real start.
      await guardedUpdate(tx, booking, {
        deviceId: target.id,
        scheduledStart: start,
        scheduledEnd,
        ...(booking.mode === "FIXED" ? rebill(booking, playSubtotal, lounge.taxRateBps) : {}),
      });
      await openSegment(tx, booking.id, target.id, booking.priceTier, now);
      await tx.device.updateMany({ where: { id: booking.deviceId, status: "IN_USE" }, data: { status: "IDLE" } });
      await tx.device.update({ where: { id: target.id }, data: { status: "IN_USE" } });
      await audit(tx, ctx, "session.transfer", "Booking", booking.id, { from: booking.deviceId, to: target.id });
      return { deviceId: target.id, deviceName: target.name };
    });
  } catch (error) {
    if (isOverlapViolation(error)) throw new PosError("SLOT_TAKEN");
    throw error;
  }
}

function validatePayments(payments: readonly PaymentPart[], due: Minor) {
  const sum = payments.reduce((s, p) => s + p.amount, 0);
  const valid = payments.every(
    (p) =>
      Number.isInteger(p.amount) &&
      p.amount > 0 &&
      (p.tendered === undefined || (p.method === "CASH" && p.tendered >= p.amount)) &&
      (p.zainCashPaymentId === undefined || p.method === "ZAINCASH"),
  );
  if (!valid || sum !== Math.max(0, due)) throw new PosError("PAYMENT_MISMATCH");
  // With the gateway connected, ZainCash is taken through it, never confirmed by hand.
  if (zainCashConfig() && payments.some((p) => p.method === "ZAINCASH" && !p.zainCashPaymentId)) throw new PosError("ZAINCASH_UNPAID");
  const ids = payments.flatMap((p) => (p.zainCashPaymentId ? [p.zainCashPaymentId] : []));
  if (new Set(ids).size !== ids.length) throw new PosError("PAYMENT_MISMATCH");
}

interface PaymentLink {
  loungeId: string;
  shiftId: string | null;
  processedById: string;
  currency: string;
  bookingId?: string;
  canteenOrderId?: string;
  userId?: string | null;
}

/**
 * Loads the paid ZainCash requests a payment uses, checking they belong to this lounge, are paid,
 * unused and for the same amount. Call before any write in the transaction.
 */
async function loadZainCashParts(tx: Tx, loungeId: string, payments: readonly PaymentPart[]) {
  const parts = payments.filter((p) => p.zainCashPaymentId);
  for (const p of parts) {
    const row = await tx.transaction.findUnique({
      where: { id: p.zainCashPaymentId! },
      select: { loungeId: true, status: true, provider: true, metadata: true, amount: true },
    });
    if (!row || row.loungeId !== loungeId || !isPaidRequest(row)) throw new PosError("ZAINCASH_UNPAID");
    if (toMinor(row.amount) !== p.amount) throw new PosError("PAYMENT_MISMATCH");
  }
}

/** Records a checkout's payments: new rows, plus the paid ZainCash requests turned into settled payments. */
async function recordPayments(tx: Tx, payments: readonly PaymentPart[], link: PaymentLink) {
  const owner = {
    shiftId: link.shiftId,
    ...(link.bookingId ? { bookingId: link.bookingId } : {}),
    ...(link.canteenOrderId ? { canteenOrderId: link.canteenOrderId } : {}),
    ...(link.userId !== undefined ? { userId: link.userId } : {}),
  };
  for (const p of payments) {
    if (p.zainCashPaymentId) await tx.transaction.update({ where: { id: p.zainCashPaymentId }, data: { ...owner, status: "SUCCEEDED" } });
  }
  const fresh = payments.filter((p) => !p.zainCashPaymentId);
  if (!fresh.length) return;
  await tx.transaction.createMany({
    data: fresh.map((p) => ({
      ...owner,
      loungeId: link.loungeId,
      processedById: link.processedById,
      type: "PAYMENT" as const,
      currency: link.currency,
      method: p.method,
      status: "SUCCEEDED" as const,
      amount: fromMinor(p.amount),
      ...(p.tendered !== undefined ? { metadata: { tendered: p.tendered, change: p.tendered - p.amount } } : {}),
    })),
  });
}

export interface EndSessionInput {
  bookingId: string;
  version: number;
  /** Must add up exactly to the balance due (empty when nothing is due). Split across methods freely. */
  payments: PaymentPart[];
  /**
   * OPEN sessions: bill up to this instant (when checkout was opened), so the
   * amount on the cashier's screen is the amount charged. Defaults to now.
   */
  billUntil?: Date;
  /** Discount on the whole bill (before tax), replacing any earlier discount. Omitted = keep. */
  discount?: Minor;
  discountReason?: string;
}

/** Checkout: settles the bill (split payments allowed), completes the booking and frees the device. */
export async function endSession(ctx: PosContext, input: EndSessionInput) {
  const now = ctx.now ?? new Date();
  const lounge = await loadLounge(ctx.loungeId);
  try {
    return await db.$transaction(async (tx) => {
      const booking = await getBookingFor(tx, ctx, input.bookingId, ["ACTIVE"], input.version);
      const started = booking.actualStart ?? booking.scheduledStart;
      let until = now;
      if (input.billUntil) {
        if (input.billUntil > now || input.billUntil < addMinutes(now, -BILL_UNTIL_MAX_AGE_MINUTES)) {
          throw new PosError("PAYMENT_MISMATCH");
        }
        until = input.billUntil < started ? started : input.billUntil;
      }

      await closeSegment(tx, lounge, booking.id, booking.mode, until);
      const play = booking.mode === "OPEN" ? await openPlayTotal(tx, booking.id) : toMinor(booking.playSubtotal);
      const discount = input.discount ?? toMinor(booking.discountTotal);
      if (!Number.isInteger(discount) || discount < 0 || discount > play + toMinor(booking.canteenSubtotal)) {
        throw new PosError("DISCOUNT_INVALID");
      }
      const billing = rebill(booking, play, lounge.taxRateBps, discount);
      const total = toMinor(billing.totalPrice);
      const due = total - toMinor(booking.amountPaid);
      // There's no refund flow at the counter, so a discount can't go below what's already paid.
      if (input.discount !== undefined && due < 0) throw new PosError("DISCOUNT_INVALID");
      validatePayments(input.payments, due);
      const shiftId = await requireShiftFor(tx, ctx.loungeId, input.payments);
      await loadZainCashParts(tx, ctx.loungeId, input.payments);

      const pausedExtra = booking.pausedAt ? billableMinutes(booking.pausedAt, until) : 0;
      await guardedUpdate(tx, booking, {
        ...billing,
        status: "COMPLETED",
        actualEnd: until,
        pausedAt: null,
        pausedMinutes: booking.pausedMinutes + pausedExtra,
        amountPaid: fromMinor(Math.max(total, toMinor(booking.amountPaid))),
        paymentStatus: "PAID",
        // An open session's reservation ends when the guest leaves.
        ...(booking.mode === "OPEN"
          ? { scheduledEnd: until > booking.scheduledStart ? until : addMinutes(booking.scheduledStart, 1) }
          : {}),
      });
      if (input.payments.length) {
        await recordPayments(tx, input.payments, {
          loungeId: ctx.loungeId,
          shiftId,
          processedById: ctx.actorId,
          currency: booking.currency,
          bookingId: booking.id,
          userId: booking.customerId,
        });
      }
      // Leave MAINTENANCE/OFFLINE alone; only a seat we marked busy goes back to idle.
      await tx.device.updateMany({ where: { id: booking.deviceId, status: "IN_USE" }, data: { status: "IDLE" } });
      await audit(tx, ctx, "session.end", "Booking", booking.id, {
        collected: Math.max(0, due),
        methods: input.payments.map((p) => p.method),
        ...(discount > 0 ? { discount, discountReason: input.discountReason ?? null } : {}),
      });
      return { reference: booking.reference, bookingId: booking.id, collected: Math.max(0, due), total };
    });
  } catch (error) {
    if (isOverlapViolation(error)) throw new PosError("SLOT_TAKEN");
    throw error;
  }
}

/** Confirmed booking whose guest never came. Pre-orders are restocked; payments are kept. */
export async function markNoShow(ctx: PosContext, input: { bookingId: string; version: number }) {
  const now = ctx.now ?? new Date();
  return db.$transaction(async (tx) => {
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
  return db.$transaction(async (tx) => {
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

  const menu = await tx.menuItem.findMany({ where: { loungeId, id: { in: [...merged.keys()] }, isAvailable: true, archivedAt: null } });
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
  return db.$transaction(async (tx) => {
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

/** Walk-up counter sale with no seat, paid on the spot (split payments allowed). */
export async function counterSale(ctx: PosContext, input: { items: OrderLineInput[]; payments: PaymentPart[]; notes?: string }) {
  const lounge = await loadLounge(ctx.loungeId);
  return db.$transaction(async (tx) => {
    const { lines, subtotal } = await reserveLines(tx, ctx.loungeId, input.items);
    const tax = applyBps(subtotal, lounge.taxRateBps);
    const total = subtotal + tax;
    validatePayments(input.payments, total);
    const shiftId = await requireShiftFor(tx, ctx.loungeId, input.payments);
    await loadZainCashParts(tx, ctx.loungeId, input.payments);
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
    if (input.payments.length) {
      await recordPayments(tx, input.payments, {
        loungeId: ctx.loungeId,
        shiftId,
        processedById: ctx.actorId,
        currency: lounge.currency,
        canteenOrderId: order.id,
      });
    }
    await audit(tx, ctx, "canteen.counterSale", "CanteenOrder", order.id, { total, methods: input.payments.map((p) => p.method) });
    return { orderId: order.id, total };
  });
}

export async function markOrderServed(ctx: PosContext, input: { orderId: string }) {
  const now = ctx.now ?? new Date();
  return db.$transaction(async (tx) => {
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
  return db.$transaction(async (tx) => {
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
  return db.$transaction(async (tx) => {
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
