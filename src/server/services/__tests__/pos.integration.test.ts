import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMinutes, toLocalIsoDate, zonedTimeToUtc } from "@/lib/booking/time";
import { toMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getLoungeAccess, hasLoungeRole } from "@/server/staff";
import { createBooking } from "../booking";
import {
  addSessionOrder,
  cancelBooking,
  cancelSessionOrder,
  checkIn,
  counterSale,
  endSession,
  extendSession,
  markNoShow,
  markOrderServed,
  PosError,
  setDeviceStatus,
  startWalkIn,
  type PosContext,
} from "../pos";

const SLUG = "nexus-downtown";
const TZ = "Asia/Baghdad";
const TEST_EMAIL = "pos-integration-test@gamelounge.dev";
const TEST_DEVICES = ["PC02", "PC03", "PC04", "PC05"];

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

const stockOf = async (id: string) => (await prisma.menuItem.findUniqueOrThrow({ where: { id } })).stockQuantity;
const bookingOf = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
const deviceStatusOf = async (id: string) => (await prisma.device.findUniqueOrThrow({ where: { id } })).status;

function expectConsistentTotals(b: Awaited<ReturnType<typeof bookingOf>>) {
  expect(toMinor(b.totalPrice)).toBe(
    toMinor(b.playSubtotal) + toMinor(b.canteenSubtotal) - toMinor(b.discountTotal) + toMinor(b.taxTotal),
  );
}

async function cleanup() {
  const lounge = await prisma.lounge.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const staff = await prisma.user.findUnique({ where: { email: "staff@gamelounge.dev" }, select: { id: true } });
  const customer = await prisma.user.findUnique({ where: { email: TEST_EMAIL }, select: { id: true } });
  if (!lounge || !staff) return;

  const bookings = await prisma.booking.findMany({
    where: { loungeId: lounge.id, OR: [{ createdById: staff.id }, ...(customer ? [{ customerId: customer.id }] : [])] },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);
  const counterOrders = await prisma.canteenOrder.findMany({
    where: { loungeId: lounge.id, createdById: staff.id, bookingId: null },
    select: { id: true },
  });
  const orderIds = counterOrders.map((o) => o.id);

  await prisma.transaction.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { canteenOrderId: { in: orderIds } }] } });
  await prisma.canteenOrder.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { id: { in: orderIds } }] } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.auditLog.deleteMany({ where: { loungeId: lounge.id, actorId: staff.id } });
  await prisma.device.updateMany({ where: { loungeId: lounge.id, code: { in: TEST_DEVICES } }, data: { status: "IDLE" } });
  if (customer) await prisma.user.delete({ where: { id: customer.id } });
}

beforeAll(async () => {
  await cleanup();
  const lounge = await prisma.lounge.findUniqueOrThrow({
    where: { slug: SLUG },
    include: { devices: true, menuItems: true },
  });
  loungeId = lounge.id;
  devices = Object.fromEntries(lounge.devices.map((d) => [d.code, d.id]));
  redBullId = lounge.menuItems.find((m) => m.sku === "DRK-RB250")!.id;
  staffId = (await prisma.user.findUniqueOrThrow({ where: { email: "staff@gamelounge.dev" } })).id;
  customerId = (await prisma.user.create({ data: { email: TEST_EMAIL, name: "POS Test Guest" } })).id;
  await prisma.menuItem.update({ where: { id: redBullId }, data: { stockQuantity: 10 } });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
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
  return prisma.booking.findUniqueOrThrow({ where: { reference } });
}

describe("lounge access", () => {
  it("derives lounge roles from memberships, with super admins acting as owner", async () => {
    const staff = await getLoungeAccess(staffId, loungeId);
    expect(staff?.role).toBe("STAFF");
    expect(hasLoungeRole(staff!, "STAFF")).toBe(true);
    expect(hasLoungeRole(staff!, "MANAGER")).toBe(false);

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@gamelounge.dev" } });
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
    expect(await prisma.bookingExtension.count({ where: { bookingId } })).toBe(1);

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
      endSession(ctxAt(at(19, 30)), { bookingId, version: b.version, payment: { method: "CASH", amount: due - 1 } }),
      "PAYMENT_MISMATCH",
    );
    await expectCode(endSession(ctxAt(at(19, 30)), { bookingId, version: b.version, payment: null }), "PAYMENT_MISMATCH");

    const res = await endSession(ctxAt(at(19, 30)), { bookingId, version: b.version, payment: { method: "CARD", amount: due } });
    expect(res.collected).toBe(due);
    const done = await bookingOf(bookingId);
    expect(done).toMatchObject({ status: "COMPLETED", paymentStatus: "PAID" });
    expect(toMinor(done.amountPaid)).toBe(due);
    const tx = await prisma.transaction.findFirstOrThrow({ where: { bookingId } });
    expect(tx).toMatchObject({ method: "CARD", status: "SUCCEEDED", processedById: staffId });
    expect(await deviceStatusOf(devices.PC02)).toBe("IDLE");
    expect(await prisma.auditLog.count({ where: { entityId: bookingId } })).toBeGreaterThanOrEqual(3);
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
      payment: { method: "CASH", amount: toMinor(active.totalPrice) },
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
      method: "CASH",
    });
    expect(total).toBeGreaterThanOrEqual(2500 * 100);
    const tx = await prisma.transaction.findFirstOrThrow({ where: { canteenOrderId: orderId } });
    expect(toMinor(tx.amount)).toBe(total);

    await markOrderServed(ctxAt(at(18, 5)), { orderId });
    expect((await prisma.canteenOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("SERVED");
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
      payment: { method: "CASH", amount: toMinor(b.totalPrice) },
    });

    await setDeviceStatus(ctxAt(at(23)), { deviceId: devices.PC03, status: "MAINTENANCE" });
    await expectCode(startWalkIn(ctxAt(at(23)), { deviceId: devices.PC03, durationMinutes: 30, players: 1 }), "DEVICE_UNAVAILABLE");
    await setDeviceStatus(ctxAt(at(23)), { deviceId: devices.PC03, status: "IDLE" });
    expect(await deviceStatusOf(devices.PC03)).toBe("IDLE");
  });
});
