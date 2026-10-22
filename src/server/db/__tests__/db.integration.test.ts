import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Decimal } from "@/lib/db/decimal";
import { toMinor } from "@/lib/money";
import { db, DbConstraintError, isDbError } from "@/server/db";

/**
 * The Firestore data layer's own guarantees: the integrity rules Postgres used
 * to enforce (overlap, unique keys, partial uniques, cascades) holding under
 * concurrent transactions, read-your-writes, and Prisma-compatible semantics.
 * Runs on its own throwaway lounge, so the seeded demo data is untouched.
 */

const SLUG = `db-layer-test-${Date.now()}`;
let orgId: string;
let loungeId: string;
let categoryId: string;
let deviceId: string;
let ownerId: string;

const t0 = new Date("2031-01-06T10:00:00Z");
const plus = (min: number) => new Date(t0.getTime() + min * 60_000);

function bookingData(start: Date, end: Date, extra: Record<string, unknown> = {}) {
  return {
    reference: `T-${Math.random().toString(36).slice(2, 10)}`,
    loungeId,
    deviceId,
    status: "CONFIRMED" as const,
    scheduledStart: start,
    scheduledEnd: end,
    currency: "IQD",
    hourlyRate: "3000.00",
    ...extra,
  };
}

beforeAll(async () => {
  const owner = await db.user.create({ data: { email: `${SLUG}@test.dev`, name: "DB test" } });
  ownerId = owner.id;
  const org = await db.organization.create({ data: { name: "DB test org", slug: SLUG, ownerId } });
  orgId = org.id;
  const lounge = await db.lounge.create({
    data: {
      organizationId: orgId,
      name: "DB test lounge",
      slug: SLUG,
      addressLine: "-",
      city: "Test",
      country: "IQ",
      latitude: 0,
      longitude: 0,
      timezone: "Asia/Baghdad",
    },
  });
  loungeId = lounge.id;
  const category = await db.deviceCategory.create({ data: { loungeId, name: "PC", type: "PC", baseHourlyRate: "3000" } });
  categoryId = category.id;
  const device = await db.device.create({ data: { loungeId, categoryId, name: "PC-1", code: "PC1" } });
  deviceId = device.id;
});

afterAll(async () => {
  await db.booking.deleteMany({ where: { loungeId } });
  await db.shift.deleteMany({ where: { loungeId } });
  await db.lounge.deleteMany({ where: { id: loungeId } });
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.user.deleteMany({ where: { id: ownerId } });
  await db.$disconnect();
});

describe("integrity under concurrency", () => {
  it("lets only one of two concurrent overlapping bookings on a device commit", async () => {
    const results = await Promise.allSettled([
      db.booking.create({ data: bookingData(plus(0), plus(60)) }),
      db.booking.create({ data: bookingData(plus(30), plus(90)) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(isDbError(rejected.reason, "23P01")).toBe(true);
  });

  it("allows back-to-back bookings (half-open ranges) and ignores cancelled ones", async () => {
    await db.booking.create({ data: bookingData(plus(120), plus(180), { status: "CANCELLED" }) });
    await db.booking.create({ data: bookingData(plus(120), plus(180)) });
    await db.booking.create({ data: bookingData(plus(180), plus(240)) });
    await expect(db.booking.create({ data: bookingData(plus(170), plus(190)) })).rejects.toSatisfy((e) => isDbError(e, "23P01"));
  });

  it("keeps one open shift per lounge when two cashiers open at once", async () => {
    const open = () => db.shift.create({ data: { loungeId, cashierId: ownerId, openingFloat: 0 } });
    const results = await Promise.allSettled([open(), open(), open()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => isDbError((r as PromiseRejectedResult).reason, "P2002"))).toBe(true);
    // Closing frees the key for the next shift.
    await db.shift.updateMany({ where: { loungeId, status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date() } });
    await expect(open()).resolves.toBeTruthy();
  });

  it("enforces unique keys across concurrent creates and releases them on rename", async () => {
    const make = () => db.device.create({ data: { loungeId, categoryId, name: "PC-2", code: "PC2" } });
    const results = await Promise.allSettled([make(), make()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const created = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value;
    await db.device.update({ where: { id: created.id }, data: { name: "PC-3", code: "PC3" } });
    // The old name is free again.
    const again = await db.device.create({ data: { loungeId, categoryId, name: "PC-2", code: "PC2" } });
    await db.device.delete({ where: { id: again.id } });
    await db.device.delete({ where: { id: created.id } });
  });

  it("never oversells stock under concurrent guarded decrements", async () => {
    const section = await db.menuCategory.create({ data: { loungeId, name: "Drinks" } });
    const item = await db.menuItem.create({
      data: { loungeId, menuCategoryId: section.id, name: "Cola", category: "DRINK", price: "1000", stockQuantity: 3 },
    });
    const take = () =>
      db.$transaction(async (tx) => {
        const res = await tx.menuItem.updateMany({
          where: { id: item.id, stockQuantity: { gte: 1 } },
          data: { stockQuantity: { decrement: 1 } },
        });
        if (res.count !== 1) throw new Error("sold out");
      });
    const results = await Promise.allSettled(Array.from({ length: 6 }, take));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: item.id } })).stockQuantity).toBe(0);
    await db.menuItem.delete({ where: { id: item.id } });
    await db.menuCategory.delete({ where: { id: section.id } });
  });
});

describe("transactions", () => {
  it("sees its own writes and commits nothing when it throws", async () => {
    let seenInside = 0;
    await db
      .$transaction(async (tx) => {
        await tx.floorZone.create({ data: { loungeId, name: "Ghost zone" } });
        seenInside = await tx.floorZone.count({ where: { loungeId, name: "Ghost zone" } });
        throw new Error("rollback");
      })
      .catch(() => {});
    expect(seenInside).toBe(1);
    expect(await db.floorZone.count({ where: { loungeId, name: "Ghost zone" } })).toBe(0);
  });
});

describe("semantics", () => {
  it("returns money as Decimal: zero is still a value, sums are exact", async () => {
    const b = await db.booking.create({ data: bookingData(plus(600), plus(660), { discountTotal: 0, playSubtotal: "0.10" }) });
    const row = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.discountTotal).toBeInstanceOf(Decimal);
    expect(row.discountTotal ? "set" : "unset").toBe("set");
    await db.booking.create({ data: bookingData(plus(700), plus(760), { playSubtotal: "0.20" }) });
    const agg = await db.booking.aggregate({ where: { loungeId, playSubtotal: { gt: 0 } }, _sum: { playSubtotal: true } });
    expect(toMinor(agg._sum.playSubtotal!)).toBe(30);
  });

  it("filters with SQL NULL semantics and relation filters", async () => {
    const active = await db.booking.findMany({ where: { loungeId, status: { not: "CANCELLED" }, notes: null } });
    expect(active.every((b) => b.status !== "CANCELLED")).toBe(true);
    // `not` on a nullable column excludes NULLs, as in SQL.
    expect(await db.booking.count({ where: { loungeId, notes: { not: "x" } } })).toBe(0);
    const lounges = await db.lounge.findMany({ where: { slug: SLUG, devices: { some: { code: "PC1" } } }, select: { id: true } });
    expect(lounges).toEqual([{ id: loungeId }]);
  });

  it("cascades and refuses deletes like the old foreign keys", async () => {
    // A category with devices can't go (Restrict) ...
    await expect(db.deviceCategory.delete({ where: { id: categoryId } })).rejects.toBeInstanceOf(DbConstraintError);
    // ... and a booking's segments go with it (Cascade).
    const b = await db.booking.create({
      data: { ...bookingData(plus(900), plus(960)), segments: { create: [{ deviceId, priceTier: "SINGLE", startedAt: plus(900) }] } },
      include: { segments: true },
    });
    expect(b.segments).toHaveLength(1);
    await db.booking.delete({ where: { id: b.id } });
    expect(await db.sessionSegment.count({ where: { bookingId: b.id } })).toBe(0);
  });
});
