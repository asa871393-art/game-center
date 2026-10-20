import "server-only";
import { applyBps, toMinor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { BLOCKING_STATUSES } from "./lounges";

/** Absolute hourly rate of a tier from a single rate and a multiplier; null when the tier isn't offered. */
function tierRate(single: number, bps: number | null) {
  return bps === null ? null : applyBps(single, bps);
}

/** Everything the device management screen needs for one lounge, serializable. */
export async function getDeviceAdmin(loungeId: string, now = new Date()) {
  const lounge = await prisma.lounge.findUnique({
    where: { id: loungeId },
    select: {
      id: true,
      name: true,
      currency: true,
      floorPlanWidth: true,
      floorPlanHeight: true,
      zones: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
      categories: {
        orderBy: [{ type: "asc" }, { baseHourlyRate: "asc" }],
        include: { _count: { select: { devices: { where: { archivedAt: null } } } } },
      },
      devices: { orderBy: [{ name: "asc" }], include: { category: { select: { name: true } } } },
    },
  });
  if (!lounge) return null;

  const [active, upcoming, history] = await Promise.all([
    prisma.booking.groupBy({ by: ["deviceId"], where: { loungeId, status: "ACTIVE" }, _count: { _all: true } }),
    prisma.booking.groupBy({
      by: ["deviceId"],
      where: {
        loungeId,
        status: { in: BLOCKING_STATUSES.filter((s) => s !== "ACTIVE") },
        scheduledEnd: { gt: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _count: { _all: true },
    }),
    prisma.booking.groupBy({ by: ["deviceId"], where: { loungeId }, _count: { _all: true } }),
  ]);
  const count = (rows: { deviceId: string; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.deviceId === id)?._count._all ?? 0;

  const categories = lounge.categories.map((c) => {
    const base = toMinor(c.baseHourlyRate);
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      description: c.description,
      baseRate: base,
      multiRate: tierRate(base, c.multiTierBps),
      vipRate: tierRate(base, c.vipTierBps),
      multiTierBps: c.multiTierBps,
      vipTierBps: c.vipTierBps,
      capacity: c.capacity,
      minBookingMinutes: c.minBookingMinutes,
      slotIntervalMinutes: c.slotIntervalMinutes,
      isActive: c.isActive,
      deviceCount: c._count.devices,
    };
  });
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const live = lounge.devices.filter((d) => d.archivedAt === null);
  const devices = live.map((d) => {
    const c = categoryById.get(d.categoryId)!;
    const override = d.hourlyRateOverride === null ? null : toMinor(d.hourlyRateOverride);
    const single = override ?? c.baseRate;
    const multiBps = d.multiTierBpsOverride ?? c.multiTierBps;
    const vipBps = d.vipTierBpsOverride ?? c.vipTierBps;
    const specs = (d.specs ?? null) as { summary?: string | null } | null;
    return {
      id: d.id,
      name: d.name,
      code: d.code,
      categoryId: d.categoryId,
      zoneId: d.zoneId,
      status: d.status,
      ipAddress: d.ipAddress,
      macAddress: d.macAddress,
      specs: specs?.summary ?? null,
      notes: d.notes,
      isBookableOnline: d.isBookableOnline,
      posX: d.posX,
      posY: d.posY,
      width: d.width,
      height: d.height,
      /** What the form shows as "own rate" (null = inherits the category). */
      overrides: {
        hourlyRate: override,
        multiRate: d.multiTierBpsOverride === null ? null : applyBps(single, d.multiTierBpsOverride),
        vipRate: d.vipTierBpsOverride === null ? null : applyBps(single, d.vipTierBpsOverride),
      },
      /** Effective rates now in force. */
      rates: { single, multi: tierRate(single, multiBps), vip: tierRate(single, vipBps) },
      usage: {
        active: count(active, d.id) > 0,
        upcoming: count(upcoming, d.id),
        hasHistory: count(history, d.id) > 0,
      },
    };
  });

  return {
    lounge: {
      id: lounge.id,
      name: lounge.name,
      currency: lounge.currency,
      floorPlan: { width: lounge.floorPlanWidth, height: lounge.floorPlanHeight },
    },
    zones: lounge.zones,
    categories,
    devices,
    archived: lounge.devices
      .filter((d) => d.archivedAt !== null)
      .map((d) => ({ id: d.id, name: d.name, code: d.code, categoryName: d.category.name, archivedAt: d.archivedAt!.toISOString() })),
  };
}

export type DeviceAdminData = NonNullable<Awaited<ReturnType<typeof getDeviceAdmin>>>;
export type AdminDevice = DeviceAdminData["devices"][number];
export type AdminCategory = DeviceAdminData["categories"][number];
