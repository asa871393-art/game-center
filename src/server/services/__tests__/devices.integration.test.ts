import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, toLocalIsoDate, zonedTimeToUtc } from "@/lib/booking/time";
import { toMinor } from "@/lib/money";
import { db } from "@/server/db";
import { getPosBoard } from "@/server/queries/manage";
import { createBooking } from "../booking";
import {
  createCategory,
  createDevice,
  deleteCategory,
  deriveCode,
  findFreeSpot,
  normalizeMac,
  removeDevice,
  restoreDevice,
  tierBpsFromRates,
  updateCategory,
  updateDevice,
  type CategoryInput,
  type DeviceInput,
} from "../devices";
import { endSession, PosError, startWalkIn, type PosContext } from "../pos";
import { openShift } from "../shift";

const SLUG = "nexus-downtown";
const TZ = "Asia/Baghdad";
const PREFIX = "ZZ Test";
const CUSTOMER = "devices-integration-test@gamelounge.dev";

let loungeId: string;
let ownerId: string;
let customerId: string;
let floorHeight: number;
let categoryId: string;
let deviceId: string;

/** Six days out: clear of the other integration suites. 18:00 has no lounge-wide pricing rule. */
const day = addDays(toLocalIsoDate(new Date(), TZ), 6);
const at = (hh: number, mm = 0) => zonedTimeToUtc(day, hh * 60 + mm, TZ);
const ctxAt = (now?: Date): PosContext => ({ loungeId, actorId: ownerId, now });

async function expectCode(promise: Promise<unknown>, code: PosError["code"]) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof PosError && e.code === code);
}

const category = (over: Partial<CategoryInput> = {}): CategoryInput => ({
  name: `${PREFIX} Sim`,
  type: "SIMULATOR",
  baseRate: 500_000, // 5,000 IQD/hr
  multiRate: 750_000,
  vipRate: null,
  capacity: 2,
  minBookingMinutes: 60,
  slotIntervalMinutes: 30,
  isActive: true,
  ...over,
});

const device = (over: Partial<DeviceInput> = {}): DeviceInput => ({
  name: `${PREFIX} Rig 1`,
  categoryId,
  status: "ACTIVE",
  isBookableOnline: true,
  ...over,
});

async function cleanup() {
  const lounge = await db.lounge.findUnique({ where: { slug: SLUG } });
  if (!lounge) return;
  const devices = await db.device.findMany({ where: { loungeId: lounge.id, name: { startsWith: PREFIX } }, select: { id: true } });
  const ids = devices.map((d) => d.id);
  const bookings = await db.booking.findMany({ where: { deviceId: { in: ids } }, select: { id: true } });
  const bookingIds = bookings.map((b) => b.id);
  await db.transaction.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await db.canteenOrder.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await db.sessionSegment.deleteMany({ where: { deviceId: { in: ids } } });
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await db.device.deleteMany({ where: { id: { in: ids } } });
  await db.deviceCategory.deleteMany({ where: { loungeId: lounge.id, name: { startsWith: PREFIX } } });
  await db.shift.deleteMany({ where: { loungeId: lounge.id } });
  const owner = await db.user.findUnique({ where: { email: "owner@gamelounge.dev" } });
  if (owner) await db.auditLog.deleteMany({ where: { loungeId: lounge.id, actorId: owner.id } });
  await db.user.deleteMany({ where: { email: CUSTOMER } });
}

beforeAll(async () => {
  await cleanup();
  const lounge = await db.lounge.findUniqueOrThrow({ where: { slug: SLUG } });
  loungeId = lounge.id;
  floorHeight = lounge.floorPlanHeight;
  ownerId = (await db.user.findUniqueOrThrow({ where: { email: "owner@gamelounge.dev" } })).id;
  customerId = (await db.user.create({ data: { email: CUSTOMER, name: "Devices Test" } })).id;
  await openShift(ctxAt(), { openingFloat: 0, shiftType: "MORNING" });
});

afterAll(async () => {
  await cleanup();
  await db.lounge.update({ where: { id: loungeId }, data: { floorPlanHeight: floorHeight } });
  await db.$disconnect();
});

describe("helpers", () => {
  it("derives codes, normalizes MACs, converts tier rates and finds free floor spots", () => {
    expect(deriveCode("pc 01!")).toBe("PC01");
    expect(deriveCode("PS5 VIP Room-2")).toBe("PS5VIPROOM-2");
    expect(normalizeMac("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMac("aabb.ccdd.eeff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMac("")).toBeNull();
    expect(() => normalizeMac("zz:bb:cc:dd:ee:ff")).toThrow(PosError);
    expect(tierBpsFromRates(400_000, 600_000)).toBe(15_000);
    expect(tierBpsFromRates(400_000, null)).toBeNull();
    const taken = [{ posX: 0, posY: 0, width: 2, height: 1 }];
    expect(findFreeSpot({ width: 3, height: 2 }, taken, { width: 1, height: 1 })).toEqual({ posX: 2, posY: 0 });
    expect(findFreeSpot({ width: 3, height: 2 }, taken, { width: 2, height: 2 })).toBeNull();
  });
});

describe("categories", () => {
  it("creates a category with tier rates stored as multipliers", async () => {
    categoryId = (await createCategory(ctxAt(), category())).id;
    const c = await db.deviceCategory.findUniqueOrThrow({ where: { id: categoryId } });
    expect(toMinor(c.baseHourlyRate)).toBe(500_000);
    expect(c).toMatchObject({ multiTierBps: 15_000, vipTierBps: null, type: "SIMULATOR" });
    await expectCode(createCategory(ctxAt(), category()), "NAME_TAKEN");
    await expectCode(createCategory(ctxAt(), category({ name: `${PREFIX} Bad`, minBookingMinutes: 7 })), "INVALID_INPUT");
  });
});

describe("devices", () => {
  it("creates a device in a free spot with its own rates and network details", async () => {
    deviceId = (
      await createDevice(
        ctxAt(),
        device({ hourlyRate: 600_000, vipRate: 1_200_000, ipAddress: "10.0.9.21", macAddress: "aa-bb-cc-dd-ee-01", specs: "Fanatec DD2, triple 32\"" }),
      )
    ).id;
    const d = await db.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(d).toMatchObject({
      code: "ZZTESTRIG1",
      status: "IDLE",
      macAddress: "AA:BB:CC:DD:EE:01",
      multiTierBpsOverride: null,
      vipTierBpsOverride: 20_000,
      specs: { summary: 'Fanatec DD2, triple 32"' },
    });
    expect(toMinor(d.hourlyRateOverride!)).toBe(600_000);
    // Auto-placed without overlapping anything else on the floor.
    const others = await db.device.findMany({ where: { loungeId, archivedAt: null, id: { not: deviceId } } });
    const overlap = others.some(
      (o) => d.posX < o.posX + o.width && o.posX < d.posX + d.width && d.posY < o.posY + o.height && o.posY < d.posY + d.height,
    );
    expect(overlap).toBe(false);

    await expectCode(createDevice(ctxAt(), device()), "NAME_TAKEN");
    await expectCode(createDevice(ctxAt(), device({ name: `${PREFIX} Rig X`, macAddress: "nope" })), "INVALID_INPUT");
    await expectCode(createDevice(ctxAt(), device({ name: `${PREFIX} Rig Y`, ipAddress: "999.1.1.1" })), "INVALID_INPUT");
  });

  it("bills sessions at the device's own rate", async () => {
    const s = await startWalkIn(ctxAt(at(17)), { deviceId, mode: "FIXED", durationMinutes: 60, players: 1 });
    const b = await db.booking.findUniqueOrThrow({ where: { id: s.id } });
    expect(toMinor(b.playSubtotal)).toBe(600_000);
    await endSession(ctxAt(at(18)), { bookingId: s.id, version: b.version, payments: [{ method: "CASH", amount: 600_000 }] });
  });

  it("re-prices a running open session from the moment the rate changes, not retroactively", async () => {
    const s = await startWalkIn(ctxAt(at(18)), { deviceId, mode: "OPEN", players: 1 });
    await expectCode(updateDevice(ctxAt(at(18, 30)), deviceId, device({ status: "MAINTENANCE", hourlyRate: 600_000 })), "DEVICE_BUSY");
    await updateDevice(ctxAt(at(18, 30)), deviceId, device({ hourlyRate: 1_200_000 }));
    const segments = await db.sessionSegment.findMany({ where: { bookingId: s.id }, orderBy: { startedAt: "asc" } });
    expect(segments).toHaveLength(2);
    expect(toMinor(segments[0].amount!)).toBe(300_000); // 30 min at 6,000/hr

    const b = await db.booking.findUniqueOrThrow({ where: { id: s.id } });
    const res = await endSession(ctxAt(at(19, 1)), {
      bookingId: s.id,
      version: b.version,
      billUntil: at(19),
      payments: [{ method: "CARD", amount: 900_000 }], // + 30 min at 12,000/hr
    });
    expect(res.total).toBe(900_000);
  });

  it("deletes a never-used device but refuses while bookings are upcoming", async () => {
    const spare = await createDevice(ctxAt(), device({ name: `${PREFIX} Rig 2` }));
    const { reference } = await createBooking({
      customerId,
      loungeSlug: SLUG,
      deviceId: spare.id,
      start: at(20),
      durationMinutes: 60,
      players: 1,
      addOns: [],
      checkoutMethod: "PAY_AT_LOUNGE",
      locale: "en",
    });
    await expectCode(removeDevice(ctxAt(at(18)), spare.id), "HAS_UPCOMING_BOOKINGS");
    const booking = await db.booking.findUniqueOrThrow({ where: { reference } });
    await db.booking.delete({ where: { id: booking.id } });

    expect(await removeDevice(ctxAt(at(18)), spare.id)).toEqual({ result: "DELETED" });
    expect(await db.device.count({ where: { id: spare.id } })).toBe(0);
  });

  it("archives a device with history, hides it everywhere, and restores it in maintenance", async () => {
    const s = await startWalkIn(ctxAt(at(21)), { deviceId, mode: "FIXED", durationMinutes: 30, players: 1 });
    await expectCode(removeDevice(ctxAt(at(21, 10)), deviceId), "DEVICE_BUSY");
    const b = await db.booking.findUniqueOrThrow({ where: { id: s.id } });
    await endSession(ctxAt(at(21, 30)), { bookingId: s.id, version: b.version, payments: [{ method: "CASH", amount: toMinor(b.totalPrice) }] });

    expect(await removeDevice(ctxAt(at(21, 31)), deviceId)).toEqual({ result: "ARCHIVED" });
    const archived = await db.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.isBookableOnline).toBe(false);
    // History stays: the bookings still point at it.
    expect(await db.booking.count({ where: { deviceId } })).toBeGreaterThan(0);

    await expectCode(startWalkIn(ctxAt(at(22)), { deviceId, mode: "OPEN", players: 1 }), "NOT_FOUND");
    const board = (await getPosBoard(loungeId))!;
    expect(board.devices.some((d) => d.id === deviceId)).toBe(false);

    await restoreDevice(ctxAt(), deviceId);
    expect(await db.device.findUniqueOrThrow({ where: { id: deviceId } })).toMatchObject({ archivedAt: null, status: "MAINTENANCE" });
  });

  it("keeps categories that hold devices (even archived) and deletes empty ones", async () => {
    await expectCode(deleteCategory(ctxAt(), categoryId), "CATEGORY_IN_USE");
    const empty = await createCategory(ctxAt(), category({ name: `${PREFIX} Empty`, multiRate: null }));
    await deleteCategory(ctxAt(), empty.id);
    expect(await db.deviceCategory.count({ where: { id: empty.id } })).toBe(0);
  });

  it("lets devices without their own rate follow category rate changes", async () => {
    const plain = await createDevice(ctxAt(), device({ name: `${PREFIX} Rig 3` }));
    await updateCategory(ctxAt(), categoryId, category({ baseRate: 800_000, multiRate: 1_200_000 }));
    const s = await startWalkIn(ctxAt(at(23)), { deviceId: plain.id, mode: "FIXED", durationMinutes: 60, players: 1, priceTier: "MULTI" });
    const b = await db.booking.findUniqueOrThrow({ where: { id: s.id } });
    expect(toMinor(b.playSubtotal)).toBe(1_200_000);
    await endSession(ctxAt(at(23, 30)), { bookingId: s.id, version: b.version, payments: [{ method: "CASH", amount: toMinor(b.totalPrice) }] });
  });
});
