import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMinutes, toLocalIsoDate, zonedTimeToUtc } from "@/lib/booking/time";
import { toMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { BookingError, createBooking, settlePayment, type CreateBookingInput } from "../booking";

const SLUG = "nexus-downtown";
const TZ = "Asia/Baghdad";
const TEST_EMAIL = "integration-test@gamelounge.dev";

let customerId: string;
let devices: Record<string, string>;
let redBullId: string;

/** 18:00 local, three days from now: inside opening hours (12:00-02:00) and the booking horizon. */
const day = addDays(toLocalIsoDate(new Date(), TZ), 3);
const at = (hh: number, mm = 0) => zonedTimeToUtc(day, hh * 60 + mm, TZ);

function input(over: Partial<CreateBookingInput>): CreateBookingInput {
  return {
    customerId,
    loungeSlug: SLUG,
    deviceId: devices.PC01,
    start: at(18),
    durationMinutes: 60,
    players: 1,
    addOns: [],
    checkoutMethod: "PAY_AT_LOUNGE",
    locale: "ar",
    ...over,
  };
}

async function expectCode(promise: Promise<unknown>, code: BookingError["code"]) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof BookingError && e.code === code);
}

async function stockOf(id: string) {
  return (await prisma.menuItem.findUniqueOrThrow({ where: { id } })).stockQuantity;
}

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (!user) return;
  const bookings = await prisma.booking.findMany({ where: { customerId: user.id }, select: { id: true } });
  const ids = bookings.map((b) => b.id);
  await prisma.transaction.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.canteenOrder.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.delete({ where: { id: user.id } });
}

beforeAll(async () => {
  await cleanup();
  customerId = (await prisma.user.create({ data: { email: TEST_EMAIL, name: "Integration Test" } })).id;
  const lounge = await prisma.lounge.findUniqueOrThrow({
    where: { slug: SLUG },
    include: { devices: true, menuItems: true },
  });
  devices = Object.fromEntries(lounge.devices.map((d) => [d.code, d.id]));
  redBullId = lounge.menuItems.find((m) => m.sku === "DRK-RB250")!.id;
  // Known stock for assertions.
  await prisma.menuItem.update({ where: { id: redBullId }, data: { stockQuantity: 10 } });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("createBooking", () => {
  it("creates a confirmed pay-at-lounge booking with a priced pre-order", async () => {
    const result = await createBooking(input({ addOns: [{ menuItemId: redBullId, quantity: 2 }] }));
    expect(result.redirectUrl).toBe(`/ar/bookings/${result.reference}`);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { reference: result.reference },
      include: { canteenOrders: { include: { items: true } } },
    });
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.paymentStatus).toBe("UNPAID");
    expect(booking.expiresAt).toBeNull();
    // PC base rate 3,000 IQD/h; no rule applies at 18:00.
    expect(toMinor(booking.playSubtotal)).toBe(300_000);
    expect(toMinor(booking.canteenSubtotal)).toBe(500_000);
    expect(toMinor(booking.totalPrice)).toBe(800_000);
    expect(booking.canteenOrders[0].isPreOrder).toBe(true);
    expect(booking.canteenOrders[0].items[0]).toMatchObject({ quantity: 2, name: "ريد بول 250 مل" });
    expect(await stockOf(redBullId)).toBe(8);
  });

  it("rejects an overlapping booking on the same device (database constraint)", async () => {
    await expectCode(createBooking(input({ start: at(18, 30) })), "SLOT_TAKEN");
  });

  it("allows a back-to-back booking", async () => {
    await expect(createBooking(input({ start: at(19) }))).resolves.toHaveProperty("reference");
  });

  it("validates hours, alignment, timing, device state and capacity", async () => {
    await expectCode(createBooking(input({ start: at(10) })), "OUTSIDE_HOURS");
    await expectCode(createBooking(input({ start: at(1, 30), durationMinutes: 60 })), "OUTSIDE_HOURS");
    await expectCode(createBooking(input({ start: at(20, 10) })), "OUTSIDE_HOURS"); // off the 30-min grid
    await expectCode(createBooking(input({ start: addMinutes(new Date(), -60) })), "TOO_SOON");
    await expectCode(createBooking(input({ start: zonedTimeToUtc(addDays(day, 20), 18 * 60, TZ) })), "TOO_FAR");
    await expectCode(createBooking(input({ durationMinutes: 30 })), "DURATION_INVALID");
    await expectCode(createBooking(input({ deviceId: devices.PC10, start: at(21) })), "DEVICE_UNAVAILABLE");
    await expectCode(createBooking(input({ players: 2, start: at(21) })), "TOO_MANY_PLAYERS");
    await expectCode(
      createBooking(input({ start: at(21), addOns: [{ menuItemId: redBullId, quantity: 50 }] })),
      "ITEM_UNAVAILABLE",
    );
  });
});

describe("online checkout", () => {
  it("holds the slot, then confirms and marks paid on approval (idempotently)", async () => {
    const result = await createBooking(input({ deviceId: devices.PC02, checkoutMethod: "ZAINCASH" }));
    expect(result.redirectUrl).toMatch(/^\/ar\/checkout\/.+/);

    const pending = await prisma.booking.findUniqueOrThrow({
      where: { reference: result.reference },
      include: { transactions: true },
    });
    expect(pending.status).toBe("PENDING");
    expect(pending.expiresAt).not.toBeNull();
    expect(pending.transactions[0]).toMatchObject({ status: "PENDING", provider: "zaincash", method: "ONLINE" });
    expect(pending.transactions[0].providerRef).toMatch(/^sandbox_zaincash_/);

    const txId = pending.transactions[0].id;
    await expect(settlePayment(txId, "approved")).resolves.toMatchObject({ result: "PAID" });
    await expect(settlePayment(txId, "approved")).resolves.toMatchObject({ result: "ALREADY_PROCESSED" });

    const paid = await prisma.booking.findUniqueOrThrow({ where: { id: pending.id } });
    expect(paid).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID", expiresAt: null });
    expect(toMinor(paid.amountPaid)).toBe(toMinor(paid.totalPrice));
  });

  it("cancels, restocks and frees the slot on decline", async () => {
    const before = await stockOf(redBullId);
    const result = await createBooking(
      input({ deviceId: devices.PC03, checkoutMethod: "FASTPAY", addOns: [{ menuItemId: redBullId, quantity: 3 }] }),
    );
    expect(await stockOf(redBullId)).toBe(before! - 3);

    const tx = await prisma.transaction.findFirstOrThrow({ where: { booking: { reference: result.reference } } });
    await expect(settlePayment(tx.id, "declined")).resolves.toMatchObject({ result: "DECLINED" });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { reference: result.reference },
      include: { canteenOrders: true },
    });
    expect(booking).toMatchObject({ status: "CANCELLED", cancelReason: "PAYMENT_DECLINED" });
    expect(booking.canteenOrders[0].status).toBe("CANCELLED");
    expect(await stockOf(redBullId)).toBe(before);

    // Same slot is bookable again.
    await expect(createBooking(input({ deviceId: devices.PC03 }))).resolves.toHaveProperty("reference");
  });

  it("releases an expired hold when someone else books the slot", async () => {
    // Created "20 minutes ago" with a 15-minute hold, so it's already expired.
    const stale = await createBooking(
      input({ deviceId: devices.PC04, checkoutMethod: "ZAINCASH", now: addMinutes(new Date(), -20) }),
    );
    const fresh = await createBooking(input({ deviceId: devices.PC04 }));
    expect(fresh.reference).not.toBe(stale.reference);

    const released = await prisma.booking.findUniqueOrThrow({
      where: { reference: stale.reference },
      include: { transactions: true },
    });
    expect(released).toMatchObject({ status: "CANCELLED", cancelReason: "PAYMENT_EXPIRED" });
    expect(released.transactions[0].status).toBe("CANCELLED");

    // A late gateway callback can't revive it.
    await expect(settlePayment(released.transactions[0].id, "approved")).resolves.toMatchObject({
      result: "ALREADY_PROCESSED",
    });
  });
});
