import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMinutes, toLocalIsoDate, zonedTimeToUtc } from "@/lib/booking/time";
import { toMinor } from "@/lib/money";
import { db } from "@/server/db";
import type { PriceTier } from "@/lib/db/types";
import { pricePlay } from "@/lib/booking/session-billing";
import { getReceipt } from "@/server/queries/receipt";
import { getLoungeAccess, hasLoungeRole } from "@/server/staff";
import { createBooking } from "../booking";
import { addShiftExpense, closeShift, getShiftSummary, openShift, shiftCashNet, voidShiftExpense } from "../shift";
import {
  addSessionOrder,
  cancelBooking,
  cancelSessionOrder,
  changeTier,
  checkIn,
  counterSale,
  endSession,
  extendSession,
  markNoShow,
  markOrderServed,
  pauseSession,
  PosError,
  resumeSession,
  setDeviceStatus,
  startWalkIn,
  transferSession,
  type PosContext,
} from "../pos";

const SLUG = "nexus-downtown";
const TZ = "Asia/Baghdad";
const TEST_EMAIL = "pos-integration-test@gamelounge.dev";
const TEST_DEVICES = ["PC02", "PC03", "PC04", "PC05", "PC06", "PS5A", "PS5B"];

let loungeId: string;
let staffId: string;
let customerId: string;
let devices: Record<string, string>;
let redBullId: string;

/** Five days out, so the scenario never collides with real "now" or the booking tests (day +3). */
const day = addDays(toLocalIsoDate(new Date(), TZ), 5);
const at = (hh: number, mm = 0) => zonedTimeToUtc(day, hh * 60 + mm, TZ);
const ctxAt = (now: Date): PosContext => ({ loungeId, actorId: staffId, now });

async function expectCode(promise: Promise<unknown>, code: PosError["code"]) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof PosError && e.code === code);
}

const stockOf = async (id: string) => (await db.menuItem.findUniqueOrThrow({ where: { id } })).stockQuantity;
const bookingOf = (id: string) => db.booking.findUniqueOrThrow({ where: { id } });
const deviceStatusOf = async (id: string) => (await db.device.findUniqueOrThrow({ where: { id } })).status;

function expectConsistentTotals(b: Awaited<ReturnType<typeof bookingOf>>) {
  expect(toMinor(b.totalPrice)).toBe(
    toMinor(b.playSubtotal) + toMinor(b.canteenSubtotal) - toMinor(b.discountTotal) + toMinor(b.taxTotal),
  );
}

async function cleanup() {
  const lounge = await db.lounge.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const staff = await db.user.findUnique({ where: { email: "staff@gamelounge.dev" }, select: { id: true } });
  const customer = await db.user.findUnique({ where: { email: TEST_EMAIL }, select: { id: true } });
  if (!lounge || !staff) return;

  const bookings = await db.booking.findMany({
    where: { loungeId: lounge.id, OR: [{ createdById: staff.id }, ...(customer ? [{ customerId: customer.id }] : [])] },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);
  const counterOrders = await db.canteenOrder.findMany({
    where: { loungeId: lounge.id, createdById: staff.id, bookingId: null },
    select: { id: true },
  });
  const orderIds = counterOrders.map((o) => o.id);

  await db.transaction.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { canteenOrderId: { in: orderIds } }] } });
  await db.canteenOrder.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { id: { in: orderIds } }] } });
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await db.auditLog.deleteMany({ where: { loungeId: lounge.id, actorId: staff.id } });
  await db.shift.deleteMany({ where: { loungeId: lounge.id } });
  await db.device.updateMany({ where: { loungeId: lounge.id, code: { in: TEST_DEVICES } }, data: { status: "IDLE" } });
  if (customer) await db.user.delete({ where: { id: customer.id } });
}

let shiftId: string;
const OPENING_FLOAT = 5_000_000; // 50,000 IQD

beforeAll(async () => {
  await cleanup();
  const lounge = await db.lounge.findUniqueOrThrow({
    where: { slug: SLUG },
    include: { devices: true, menuItems: true },
  });
  loungeId = lounge.id;
  devices = Object.fromEntries(lounge.devices.map((d) => [d.code, d.id]));
  redBullId = lounge.menuItems.find((m) => m.sku === "DRK-RB250")!.id;
  staffId = (await db.user.findUniqueOrThrow({ where: { email: "staff@gamelounge.dev" } })).id;
  customerId = (await db.user.create({ data: { email: TEST_EMAIL, name: "POS Test Guest" } })).id;
  await db.menuItem.update({ where: { id: redBullId }, data: { stockQuantity: 10 } });
  // Counter payments need an open shift (the cash drawer).
  shiftId = (await openShift({ loungeId, actorId: staffId }, { openingFloat: OPENING_FLOAT })).id;
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

/** A confirmed pay-at-lounge online booking for the test customer. */
async function onlineBooking(deviceCode: string, start: Date, minutes = 60, addOns: { menuItemId: string; quantity: number }[] = []) {
  const { reference } = await createBooking({
    customerId,
    loungeSlug: SLUG,
    deviceId: devices[deviceCode],
    start,
    durationMinutes: minutes,
    players: 1,
    addOns,
    checkoutMethod: "PAY_AT_LOUNGE",
    locale: "en",
  });
  return db.booking.findUniqueOrThrow({ where: { reference } });
}

describe("lounge access", () => {
  it("derives lounge roles from memberships, with super admins acting as owner", async () => {
    const staff = await getLoungeAccess(staffId, loungeId);
    expect(staff?.role).toBe("STAFF");
    expect(hasLoungeRole(staff!, "STAFF")).toBe(true);
    expect(hasLoungeRole(staff!, "MANAGER")).toBe(false);

    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@gamelounge.dev" } });
    expect((await getLoungeAccess(admin.id, loungeId))?.role).toBe("OWNER");
    expect(await getLoungeAccess(customerId, loungeId)).toBeNull();
  });
});

describe("walk-in session lifecycle", () => {
  let bookingId: string;

  it("starts an active walk-in and marks the device in use", async () => {
    const res = await startWalkIn(ctxAt(at(18)), { deviceId: devices.PC02, durationMinutes: 60, players: 1, guestName: "Ali" });
    bookingId = res.id;
    const b = await bookingOf(bookingId);
    expect(b).toMatchObject({ status: "ACTIVE", source: "WALK_IN", guestName: "Ali", createdById: staffId });
    expect(b.scheduledEnd).toEqual(at(19));
    expect(toMinor(b.playSubtotal)).toBeGreaterThan(0);
    expectConsistentTotals(b);
    expect(await deviceStatusOf(devices.PC02)).toBe("IN_USE");
  });

  it("refuses a second session on a busy seat", async () => {
    await expectCode(startWalkIn(ctxAt(at(18, 5)), { deviceId: devices.PC02, durationMinutes: 30, players: 1 }), "DEVICE_BUSY");
  });

  it("extends, bills the extra time and rejects a stale version", async () => {
    const before = await bookingOf(bookingId);
    const { price } = await extendSession(ctxAt(at(18, 30)), { bookingId, version: before.version, minutes: 30 });
    const after = await bookingOf(bookingId);
    expect(after.scheduledEnd).toEqual(at(19, 30));
    expect(toMinor(after.playSubtotal)).toBe(toMinor(before.playSubtotal) + price);
    expect(after.version).toBe(before.version + 1);
    expectConsistentTotals(after);
    expect(await db.bookingExtension.count({ where: { bookingId } })).toBe(1);

    await expectCode(extendSession(ctxAt(at(18, 31)), { bookingId, version: before.version, minutes: 30 }), "STALE");
  });

  it("won't extend into the next booking on the same device", async () => {
    await onlineBooking("PC02", at(19, 30));
    const b = await bookingOf(bookingId);
    await expectCode(extendSession(ctxAt(at(18, 40)), { bookingId, version: b.version, minutes: 30 }), "SLOT_TAKEN");
  });

  it("adds a canteen order to the bill and voids it with a restock", async () => {
    const { orderId, subtotal } = await addSessionOrder(ctxAt(at(18, 45)), {
      bookingId,
      items: [{ menuItemId: redBullId, quantity: 2 }],
    });
    expect(subtotal).toBe(2 * 2500 * 100);
    expect(await stockOf(redBullId)).toBe(8);
    let b = await bookingOf(bookingId);
    expect(toMinor(b.canteenSubtotal)).toBe(subtotal);
    expectConsistentTotals(b);

    await cancelSessionOrder(ctxAt(at(18, 46)), { orderId });
    expect(await stockOf(redBullId)).toBe(10);
    b = await bookingOf(bookingId);
    expect(toMinor(b.canteenSubtotal)).toBe(0);
    expectConsistentTotals(b);

    await expectCode(
      addSessionOrder(ctxAt(at(18, 47)), { bookingId, items: [{ menuItemId: redBullId, quantity: 11 }] }),
      "ITEM_UNAVAILABLE",
    );
    expect(await stockOf(redBullId)).toBe(10);
  });

  it("checks out only for the exact balance, then frees the device", async () => {
    const b = await bookingOf(bookingId);
    const due = toMinor(b.totalPrice);
    await expectCode(
      endSession(ctxAt(at(19, 30)), { bookingId, version: b.version, payments: [{ method: "CASH", amount: due - 1 }] }),
      "PAYMENT_MISMATCH",
    );
    await expectCode(endSession(ctxAt(at(19, 30)), { bookingId, version: b.version, payments: [] }), "PAYMENT_MISMATCH");

    const res = await endSession(ctxAt(at(19, 30)), { bookingId, version: b.version, payments: [{ method: "CARD", amount: due }] });
    expect(res.collected).toBe(due);
    const done = await bookingOf(bookingId);
    expect(done).toMatchObject({ status: "COMPLETED", paymentStatus: "PAID" });
    expect(toMinor(done.amountPaid)).toBe(due);
    const tx = await db.transaction.findFirstOrThrow({ where: { bookingId } });
    expect(tx).toMatchObject({ method: "CARD", status: "SUCCEEDED", processedById: staffId });
    expect(await deviceStatusOf(devices.PC02)).toBe("IDLE");
    expect(await db.auditLog.count({ where: { entityId: bookingId } })).toBeGreaterThanOrEqual(3);
  });
});

describe("reservations at the front desk", () => {
  it("checks a confirmed booking in, but not too early", async () => {
    const b = await onlineBooking("PC03", at(20));
    await expectCode(checkIn(ctxAt(at(19)), { bookingId: b.id, version: b.version }), "TOO_EARLY");
    await checkIn(ctxAt(at(19, 45)), { bookingId: b.id, version: b.version });
    const active = await bookingOf(b.id);
    expect(active.status).toBe("ACTIVE");
    expect(active.actualStart).toEqual(at(19, 45));
    expect(await deviceStatusOf(devices.PC03)).toBe("IN_USE");

    await endSession(ctxAt(at(21)), {
      bookingId: b.id,
      version: active.version,
      payments: [{ method: "CASH", amount: toMinor(active.totalPrice) }],
    });
  });

  it("marks a no-show after the grace period and restocks the pre-order", async () => {
    const b = await onlineBooking("PC04", at(20), 60, [{ menuItemId: redBullId, quantity: 3 }]);
    expect(await stockOf(redBullId)).toBe(7);
    await expectCode(markNoShow(ctxAt(at(20, 5)), { bookingId: b.id, version: b.version }), "TOO_EARLY");
    await markNoShow(ctxAt(at(20, 20)), { bookingId: b.id, version: b.version });
    expect((await bookingOf(b.id)).status).toBe("NO_SHOW");
    expect(await stockOf(redBullId)).toBe(10);
  });

  it("cancels an unpaid booking and frees the slot", async () => {
    const b = await onlineBooking("PC05", at(21));
    await cancelBooking(ctxAt(at(18)), { bookingId: b.id, version: b.version });
    expect((await bookingOf(b.id)).status).toBe("CANCELLED");
    await expect(onlineBooking("PC05", at(21))).resolves.toBeTruthy();
  });
});

describe("canteen counter", () => {
  it("records a paid counter sale and serves it once", async () => {
    const { orderId, total } = await counterSale(ctxAt(at(18)), {
      items: [{ menuItemId: redBullId, quantity: 1 }],
      payments: [{ method: "CASH", amount: 2500 * 100 }],
    });
    expect(total).toBeGreaterThanOrEqual(2500 * 100);
    const tx = await db.transaction.findFirstOrThrow({ where: { canteenOrderId: orderId } });
    expect(toMinor(tx.amount)).toBe(total);

    await markOrderServed(ctxAt(at(18, 5)), { orderId });
    expect((await db.canteenOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("SERVED");
    await expectCode(markOrderServed(ctxAt(at(18, 6)), { orderId }), "INVALID_STATE");
    await expectCode(cancelSessionOrder(ctxAt(at(18, 6)), { orderId }), "INVALID_STATE");
  });
});

describe("device status", () => {
  it("can't take a busy seat out of service; an out-of-service seat can't start sessions", async () => {
    const s = await startWalkIn(ctxAt(at(22)), { deviceId: devices.PC03, durationMinutes: 30, players: 1 });
    await expectCode(setDeviceStatus(ctxAt(at(22)), { deviceId: devices.PC03, status: "MAINTENANCE" }), "DEVICE_BUSY");
    const b = await bookingOf(s.id);
    await endSession(ctxAt(addMinutes(at(22), 30)), {
      bookingId: s.id,
      version: b.version,
      payments: [{ method: "CASH", amount: toMinor(b.totalPrice) }],
    });

    await setDeviceStatus(ctxAt(at(23)), { deviceId: devices.PC03, status: "MAINTENANCE" });
    await expectCode(startWalkIn(ctxAt(at(23)), { deviceId: devices.PC03, durationMinutes: 30, players: 1 }), "DEVICE_UNAVAILABLE");
    await setDeviceStatus(ctxAt(at(23)), { deviceId: devices.PC03, status: "IDLE" });
    expect(await deviceStatusOf(devices.PC03)).toBe("IDLE");
  });
});

/** Expected price of play on a device code, using the same pricing function the server uses. */
async function priceOf(code: string, tier: PriceTier, start: Date, minutes: number) {
  const device = await db.device.findUniqueOrThrow({ where: { id: devices[code] }, include: { category: true } });
  const lounge = await db.lounge.findUniqueOrThrow({ where: { id: loungeId }, include: { pricingRules: { where: { isActive: true } } } });
  const rules = lounge.pricingRules.map((r) => ({ ...r, hourlyRate: r.hourlyRate === null ? null : toMinor(r.hourlyRate) }));
  const c = device.category;
  return pricePlay(
    { timeZone: TZ, rules },
    { id: c.id, baseHourlyRate: toMinor(c.baseHourlyRate), multiTierBps: c.multiTierBps, vipTierBps: c.vipTierBps },
    tier,
    start,
    minutes,
  );
}

const segmentsOf = (bookingId: string) => db.sessionSegment.findMany({ where: { bookingId }, orderBy: { startedAt: "asc" } });

describe("POS terminal: open sessions, tiers, pause, transfer, split payment", () => {
  let bookingId: string;
  let expectedPlay = 0;

  it("only offers tiers the category has", async () => {
    await expectCode(
      startWalkIn(ctxAt(at(18)), { deviceId: devices.PC06, mode: "OPEN", priceTier: "MULTI", players: 1 }),
      "TIER_UNAVAILABLE",
    );
  });

  it("starts an open session that holds the seat until closing and bills nothing yet", async () => {
    const res = await startWalkIn(ctxAt(at(18)), { deviceId: devices.PS5A, mode: "OPEN", priceTier: "MULTI", players: 3 });
    bookingId = res.id;
    const b = await bookingOf(bookingId);
    expect(b).toMatchObject({ status: "ACTIVE", mode: "OPEN", priceTier: "MULTI" });
    expect(toMinor(b.totalPrice)).toBe(0);
    // Lounge closes 02:00; nothing else is booked on PS5-A that evening.
    expect(b.scheduledEnd).toEqual(zonedTimeToUtc(addDays(day, 1), 2 * 60, TZ));
    const segs = await segmentsOf(bookingId);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ deviceId: devices.PS5A, priceTier: "MULTI", endedAt: null });
  });

  it("can't extend an open session", async () => {
    const b = await bookingOf(bookingId);
    await expectCode(extendSession(ctxAt(at(18, 10)), { bookingId, version: b.version, minutes: 30 }), "INVALID_STATE");
  });

  it("pause closes and prices the running segment; resume starts a new one", async () => {
    let b = await bookingOf(bookingId);
    await pauseSession(ctxAt(at(18, 30)), { bookingId, version: b.version });
    b = await bookingOf(bookingId);
    expect(b.pausedAt).toEqual(at(18, 30));
    await expectCode(pauseSession(ctxAt(at(18, 31)), { bookingId, version: b.version }), "INVALID_STATE");

    let segs = await segmentsOf(bookingId);
    const first = await priceOf("PS5A", "MULTI", at(18), 30);
    expect(segs[0]).toMatchObject({ endedAt: at(18, 30), minutes: 30 });
    expect(toMinor(segs[0].amount!)).toBe(first);
    expectedPlay += first;
    expect(await deviceStatusOf(devices.PS5A)).toBe("IN_USE");

    await resumeSession(ctxAt(at(18, 40)), { bookingId, version: b.version });
    b = await bookingOf(bookingId);
    expect(b).toMatchObject({ pausedAt: null, pausedMinutes: 10 });
    segs = await segmentsOf(bookingId);
    expect(segs).toHaveLength(2);
    expect(segs[1]).toMatchObject({ startedAt: at(18, 40), endedAt: null });
  });

  it("changing tier bills the time so far at the old tier", async () => {
    const b = await bookingOf(bookingId);
    await changeTier(ctxAt(at(19)), { bookingId, version: b.version, tier: "VIP" });
    const segs = await segmentsOf(bookingId);
    const second = await priceOf("PS5A", "MULTI", at(18, 40), 20);
    expect(toMinor(segs[1].amount!)).toBe(second);
    expectedPlay += second;
    expect(segs[2]).toMatchObject({ priceTier: "VIP", endedAt: null });
    expect((await bookingOf(bookingId)).priceTier).toBe("VIP");
  });

  it("transfers to another free device and frees the old one", async () => {
    const b = await bookingOf(bookingId);
    // Three players don't fit a one-seat PC.
    await expectCode(
      transferSession(ctxAt(at(19, 15)), { bookingId, version: b.version, targetDeviceId: devices.PC06 }),
      "TOO_MANY_PLAYERS",
    );
    const res = await transferSession(ctxAt(at(19, 15)), { bookingId, version: b.version, targetDeviceId: devices.PS5B });
    expect(res.deviceId).toBe(devices.PS5B);
    const moved = await bookingOf(bookingId);
    expect(moved.deviceId).toBe(devices.PS5B);
    expect(moved.actualStart).toEqual(at(18));
    expect(await deviceStatusOf(devices.PS5A)).toBe("IDLE");
    expect(await deviceStatusOf(devices.PS5B)).toBe("IN_USE");
    const segs = await segmentsOf(bookingId);
    const third = await priceOf("PS5A", "VIP", at(19), 15);
    expect(toMinor(segs[2].amount!)).toBe(third);
    expectedPlay += third;
    expect(segs[3]).toMatchObject({ deviceId: devices.PS5B, priceTier: "VIP", endedAt: null });
  });

  it("checks out up to the frozen bill time with a split payment and change", async () => {
    const b = await bookingOf(bookingId);
    const last = await priceOf("PS5B", "VIP", at(19, 15), 30);
    expectedPlay += last;
    const ctx = ctxAt(at(19, 47));
    const billUntil = at(19, 45);

    await expectCode(
      endSession(ctx, { bookingId, version: b.version, billUntil, payments: [{ method: "CASH", amount: expectedPlay - 100 }] }),
      "PAYMENT_MISMATCH",
    );
    // A bill frozen too long ago is refused rather than undercharging.
    await expectCode(
      endSession(ctx, { bookingId, version: b.version, billUntil: at(19, 30), payments: [{ method: "CASH", amount: expectedPlay }] }),
      "PAYMENT_MISMATCH",
    );

    const cash = 1_000_000; // 10,000 IQD
    const res = await endSession(ctx, {
      bookingId,
      version: b.version,
      billUntil,
      payments: [
        { method: "CASH", amount: cash, tendered: 1_500_000 },
        { method: "ZAINCASH", amount: expectedPlay - cash },
      ],
    });
    expect(res.total).toBe(expectedPlay);

    const done = await bookingOf(bookingId);
    expect(done).toMatchObject({ status: "COMPLETED", paymentStatus: "PAID" });
    expect(toMinor(done.playSubtotal)).toBe(expectedPlay);
    expect(done.actualEnd).toEqual(billUntil);
    // The open reservation ends when the guest leaves, so the seat is bookable again.
    expect(done.scheduledEnd).toEqual(billUntil);
    expect(await deviceStatusOf(devices.PS5B)).toBe("IDLE");

    const txs = await db.transaction.findMany({ where: { bookingId }, orderBy: { method: "asc" } });
    expect(txs.map((t) => t.method).sort()).toEqual(["CASH", "ZAINCASH"]);
    expect(txs.find((t) => t.method === "CASH")!.metadata).toEqual({ tendered: 1_500_000, change: 500_000 });

    const receipt = await getReceipt(bookingId);
    expect(receipt).toMatchObject({ kind: "session", isFinal: true, total: expectedPlay, paid: expectedPlay, pausedMinutes: 10 });
    expect(receipt!.play).toHaveLength(4);
    expect(receipt!.play.reduce((s, l) => s + l.amount, 0)).toBe(expectedPlay);
    expect(receipt!.payments.find((p) => p.method === "CASH")).toMatchObject({ tendered: 1_500_000, change: 500_000 });
  });
});

describe("POS terminal: fixed sessions", () => {
  it("reprices the remaining time on a tier change and pushes the end out after a pause", async () => {
    const { id } = await startWalkIn(ctxAt(at(20)), { deviceId: devices.PS5A, mode: "FIXED", durationMinutes: 60, players: 2 });
    let b = await bookingOf(id);
    const base = toMinor(b.playSubtotal);
    expect(base).toBe(await priceOf("PS5A", "SINGLE", at(20), 60));

    await changeTier(ctxAt(at(20, 30)), { bookingId: id, version: b.version, tier: "MULTI" });
    b = await bookingOf(id);
    const delta = (await priceOf("PS5A", "MULTI", at(20, 30), 30)) - (await priceOf("PS5A", "SINGLE", at(20, 30), 30));
    expect(delta).toBeGreaterThan(0);
    expect(toMinor(b.playSubtotal)).toBe(base + delta);
    expectConsistentTotals(b);

    await pauseSession(ctxAt(at(20, 40)), { bookingId: id, version: b.version });
    b = await bookingOf(id);
    const { lostMinutes } = await resumeSession(ctxAt(at(20, 50)), { bookingId: id, version: b.version });
    expect(lostMinutes).toBe(0);
    b = await bookingOf(id);
    expect(b.scheduledEnd).toEqual(at(21, 10));
    // Pausing doesn't change what a fixed session costs.
    expect(toMinor(b.playSubtotal)).toBe(base + delta);

    await endSession(ctxAt(at(21, 10)), {
      bookingId: id,
      version: b.version,
      payments: [{ method: "CARD", amount: toMinor(b.totalPrice) }],
    });
  });

  it("caps a resumed fixed session at the next booking", async () => {
    const { id } = await startWalkIn(ctxAt(at(21, 20)), { deviceId: devices.PS5B, mode: "FIXED", durationMinutes: 30, players: 1 });
    await onlineBooking("PS5B", at(22));
    let b = await bookingOf(id);
    await pauseSession(ctxAt(at(21, 30)), { bookingId: id, version: b.version });
    b = await bookingOf(id);
    const res = await resumeSession(ctxAt(at(21, 50)), { bookingId: id, version: b.version });
    // Wanted 21:50 + 20 = 22:10, but the next booking starts at 22:00.
    expect(res.lostMinutes).toBe(10);
    expect((await bookingOf(id)).scheduledEnd).toEqual(at(22));
    b = await bookingOf(id);
    await endSession(ctxAt(at(22)), {
      bookingId: id,
      version: b.version,
      payments: [{ method: "CASH", amount: toMinor(b.totalPrice) }],
    });
  });
});

describe("counter sale receipt", () => {
  it("splits payment and produces an itemized sales receipt", async () => {
    const { orderId, total } = await counterSale(ctxAt(at(18)), {
      items: [{ menuItemId: redBullId, quantity: 2 }],
      payments: [
        { method: "CARD", amount: 2500 * 100 },
        { method: "CASH", amount: 2500 * 100, tendered: 5000 * 100 },
      ],
    });
    expect(total).toBe(5000 * 100);
    await expectCode(
      counterSale(ctxAt(at(18)), { items: [{ menuItemId: redBullId, quantity: 1 }], payments: [{ method: "CARD", amount: 1 }] }),
      "PAYMENT_MISMATCH",
    );
    const receipt = await getReceipt(orderId);
    expect(receipt).toMatchObject({ kind: "order", total, paid: total });
    expect(receipt!.items).toEqual([expect.objectContaining({ quantity: 2, amount: 5000 * 100 })]);
    expect(receipt!.payments).toHaveLength(2);
  });
});

describe("discounts and FastPay at checkout", () => {
  it("applies a bill discount before tax and takes FastPay", async () => {
    const { id } = await startWalkIn(ctxAt(at(23, 0)), { deviceId: devices.PC05, mode: "FIXED", durationMinutes: 60, players: 1 });
    const b = await bookingOf(id);
    const gross = toMinor(b.playSubtotal);
    await expectCode(
      endSession(ctxAt(at(23, 30)), { bookingId: id, version: b.version, discount: gross + 1, payments: [] }),
      "DISCOUNT_INVALID",
    );
    const discount = Math.round(gross / 10);
    const res = await endSession(ctxAt(at(23, 30)), {
      bookingId: id,
      version: b.version,
      discount,
      discountReason: "loyal guest",
      payments: [{ method: "FASTPAY", amount: gross - discount }],
    });
    expect(res.total).toBe(gross - discount);
    const done = await bookingOf(id);
    expect(toMinor(done.discountTotal)).toBe(discount);
    expectConsistentTotals(done);
    const tx = await db.transaction.findFirstOrThrow({ where: { bookingId: id } });
    expect(tx).toMatchObject({ method: "FASTPAY", shiftId });
    expect((await getReceipt(id))!.discount).toBe(discount);
  });
});

describe("cashier shift and cash drawer", () => {
  it("allows only one open shift per lounge", async () => {
    await expectCode(openShift({ loungeId, actorId: staffId }, { openingFloat: 0 }), "SHIFT_ALREADY_OPEN");
  });

  it("attaches every counter payment to the open shift and sums the drawer", async () => {
    const untagged = await db.transaction.count({
      where: { loungeId, processedById: staffId, status: "SUCCEEDED", shiftId: null, method: { not: "ONLINE" } },
    });
    expect(untagged).toBe(0);

    const cashRows = await db.transaction.findMany({ where: { shiftId, method: "CASH", type: "PAYMENT", status: "SUCCEEDED" } });
    const cash = cashRows.reduce((s, t) => s + toMinor(t.amount), 0);
    expect(cash).toBeGreaterThan(0);
    expect(await shiftCashNet(db, shiftId)).toBe(cash);

    const summary = (await getShiftSummary(shiftId))!;
    expect(summary).toMatchObject({ status: "OPEN", openingFloat: OPENING_FLOAT, cashNet: cash, expectedCash: OPENING_FLOAT + cash });
    expect(summary.byMethod.map((m) => m.method).sort()).toEqual(["CARD", "CASH", "FASTPAY", "ZAINCASH"]);
    expect(summary.totalCollected).toBe(summary.byMethod.reduce((s, m) => s + m.amount, 0));
    expect(summary.sessions).toBeGreaterThan(0);
    expect(summary.counterSales).toBeGreaterThan(0);
    expect(summary.discounts).toBeGreaterThan(0);
  });

  it("splits drawer cash into gaming and canteen", async () => {
    const s = (await getShiftSummary(shiftId))!;
    expect(s.cashGaming + s.cashCanteen).toBe(s.cashNet);
    expect(s.cashGaming).toBeGreaterThan(0);
    // Counter sales were paid in cash earlier in this suite.
    expect(s.cashCanteen).toBeGreaterThan(0);
  });

  it("records cash expenses, refuses more than the drawer holds, and voids mistakes", async () => {
    const before = (await getShiftSummary(shiftId))!;
    const ctx = ctxAt(at(22));
    await expectCode(addShiftExpense(ctx, { amount: 0, reason: "ice" }), "INVALID_INPUT");
    await expectCode(addShiftExpense(ctx, { amount: 100_000, reason: "   " }), "INVALID_INPUT");
    await expectCode(addShiftExpense(ctx, { amount: before.expectedCash + 1, reason: "too much" }), "INSUFFICIENT_CASH");

    const ice = 200_000; // 2,000 IQD
    await addShiftExpense(ctx, { amount: ice, reason: "  Ice  " });
    const mistake = await addShiftExpense(ctx, { amount: 50_000, reason: "typo" });
    await voidShiftExpense(ctx, { expenseId: mistake.expenseId });
    await expectCode(voidShiftExpense(ctx, { expenseId: mistake.expenseId }), "STALE");

    const after = (await getShiftSummary(shiftId))!;
    expect(after.expensesTotal).toBe(ice);
    expect(after.expectedCash).toBe(before.openingFloat + before.cashNet - ice);
    expect(after.expenses.map((e) => [e.reason, e.amount, e.voided])).toEqual([
      ["Ice", ice, false],
      ["typo", 50_000, true],
    ]);
  });

  it("closes with the counted cash and records the variance", async () => {
    const before = (await getShiftSummary(shiftId))!;
    expect(before.expectedCash).toBe(before.openingFloat + before.cashNet - before.expensesTotal);
    const counted = before.expectedCash - 100_000; // 1,000 IQD short
    const res = await closeShift(ctxAt(at(23, 59)), { shiftId, countedCash: counted, notes: "short by a note" });
    expect(res).toMatchObject({ expected: before.expectedCash, counted, variance: -100_000 });

    const after = (await getShiftSummary(shiftId))!;
    expect(after).toMatchObject({ status: "CLOSED", countedCash: counted, variance: -100_000, notes: "short by a note" });
    await expectCode(closeShift(ctxAt(at(23, 59)), { shiftId, countedCash: counted }), "SHIFT_CLOSED");

    // A closed drawer is final: no new expenses and no voids.
    await expectCode(addShiftExpense(ctxAt(at(23, 59)), { amount: 1_000, reason: "late" }), "SHIFT_CLOSED");
    await expectCode(voidShiftExpense(ctxAt(at(23, 59)), { expenseId: after.expenses[0].id }), "SHIFT_CLOSED");
  });

  it("refuses to take payments with no open shift", async () => {
    const stockBefore = await stockOf(redBullId);
    await expectCode(
      counterSale(ctxAt(at(18)), { items: [{ menuItemId: redBullId, quantity: 1 }], payments: [{ method: "CASH", amount: 2500 * 100 }] }),
      "SHIFT_CLOSED",
    );
    // Nothing was sold: the stock decrement rolled back with the transaction.
    expect(await stockOf(redBullId)).toBe(stockBefore);
  });
});
