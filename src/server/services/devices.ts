import "server-only";
import { isIP } from "node:net";
import type { DeviceType, InputJsonValue } from "@/lib/db/types";
import { fromMinor, toMinor, type Minor } from "@/lib/money";
import { db, type TxClient, type DbReader } from "@/server/db";
import { BLOCKING_STATUSES } from "@/server/queries/lounges";
import { PosError, splitOpenSegmentsOnDevice, type PosContext } from "./pos";

/**
 * Device and category management (manager/owner). Rates are entered as
 * money per hour; tier rates are stored as multipliers of the single rate,
 * the same way the pricing engine applies them.
 */

type Tx = TxClient;

const MAX_RATE: Minor = 100_000_000; // 1,000,000.00 per hour
const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60] as const;

/** Default floor-plan footprint for a new device, in grid cells. */
const FOOTPRINT: Record<DeviceType, { width: number; height: number }> = {
  PC: { width: 1, height: 1 },
  CONSOLE: { width: 2, height: 2 },
  VR: { width: 2, height: 2 },
  VIP_ROOM: { width: 3, height: 3 },
  SIMULATOR: { width: 2, height: 2 },
  OTHER: { width: 1, height: 1 },
};

function audit(tx: Tx, ctx: PosContext, action: string, entityType: string, entityId: string, data?: InputJsonValue) {
  return tx.auditLog.create({ data: { actorId: ctx.actorId, loungeId: ctx.loungeId, action, entityType, entityId, data } });
}

function validRate(v: Minor | null | undefined, allowZero = true): boolean {
  return v === null || v === undefined || (Number.isInteger(v) && (allowZero ? v >= 0 : v > 0) && v <= MAX_RATE);
}

/** A tier's absolute hourly rate as a multiplier of the single rate (10000 = 1x). */
export function tierBpsFromRates(single: Minor, tierRate: Minor | null | undefined): number | null {
  if (tierRate === null || tierRate === undefined) return null;
  if (single <= 0 || tierRate <= 0) throw new PosError("INVALID_INPUT");
  return Math.round((tierRate * 10_000) / single);
}

/** "pc 01!" -> "PC01": short stable code for POS/hardware agents. */
export function deriveCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 20);
}

/** "aa-bb-cc-dd-ee-ff" | "aabb.ccdd.eeff" -> "AA:BB:CC:DD:EE:FF". */
export function normalizeMac(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const hex = raw.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12 || raw.replace(/[0-9a-fA-F:.\-\s]/g, "").length > 0) throw new PosError("INVALID_INPUT");
  return hex.toUpperCase().match(/.{2}/g)!.join(":");
}

/** "10.0.0.7" | "fe80::1" | "10.0.0.0/24" (the forms Postgres inet accepted); throws INVALID_INPUT otherwise. */
export function normalizeIp(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const [addr, prefix, ...rest] = value.split("/");
  const version = isIP(addr);
  const maxPrefix = version === 4 ? 32 : 128;
  if (!version || rest.length || (prefix !== undefined && !(/^\d{1,3}$/.test(prefix) && Number(prefix) <= maxPrefix))) {
    throw new PosError("INVALID_INPUT");
  }
  return value;
}

/** First free top-left cell for a w×h device on the floor grid, row by row; null if the floor is full. */
export function findFreeSpot(
  floor: { width: number; height: number },
  taken: readonly { posX: number; posY: number; width: number; height: number }[],
  size: { width: number; height: number },
): { posX: number; posY: number } | null {
  const overlaps = (x: number, y: number) =>
    taken.some((d) => x < d.posX + d.width && d.posX < x + size.width && y < d.posY + d.height && d.posY < y + size.height);
  for (let y = 0; y + size.height <= floor.height; y++) {
    for (let x = 0; x + size.width <= floor.width; x++) {
      if (!overlaps(x, y)) return { posX: x, posY: y };
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Devices
// -----------------------------------------------------------------------------

export interface DeviceInput {
  name: string;
  code?: string;
  categoryId: string;
  zoneId?: string | null;
  /** Free-text hardware description, e.g. "RTX 4080, 240Hz monitor". */
  specs?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  notes?: string | null;
  isBookableOnline: boolean;
  /** ACTIVE puts the device in service; MAINTENANCE / OFFLINE ("out of order") take it out. */
  status: "ACTIVE" | "MAINTENANCE" | "OFFLINE";
  /** Per-device hourly rates; null/undefined = use the category's. */
  hourlyRate?: Minor | null;
  multiRate?: Minor | null;
  vipRate?: Minor | null;
  /** Floor-plan placement; omitted on create = first free spot. */
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
}

async function resolveDeviceFields(tx: Tx, ctx: PosContext, input: DeviceInput, deviceId?: string) {
  const name = input.name.trim();
  const code = deriveCode(input.code?.trim() || name);
  if (!name || name.length > 40 || !code) throw new PosError("INVALID_INPUT");
  if (![input.hourlyRate, input.multiRate, input.vipRate].every((r) => validRate(r))) throw new PosError("INVALID_INPUT");

  const category = await tx.deviceCategory.findFirst({ where: { id: input.categoryId, loungeId: ctx.loungeId } });
  if (!category) throw new PosError("NOT_FOUND");
  if (input.zoneId) {
    const zone = await tx.floorZone.count({ where: { id: input.zoneId, loungeId: ctx.loungeId } });
    if (!zone) throw new PosError("NOT_FOUND");
  }

  // Unique per lounge, archived devices included (their history keeps the name).
  const clash = await tx.device.findFirst({
    where: { loungeId: ctx.loungeId, OR: [{ name }, { code }], ...(deviceId ? { id: { not: deviceId } } : {}) },
    select: { name: true },
  });
  if (clash) throw new PosError(clash.name === name ? "NAME_TAKEN" : "CODE_TAKEN");

  const single = input.hourlyRate ?? toMinor(category.baseHourlyRate);
  const sizes = [input.posX, input.posY, input.width, input.height];
  if (sizes.some((v) => v !== undefined && (!Number.isInteger(v) || v < 0 || v > 200))) throw new PosError("INVALID_INPUT");
  if ((input.width !== undefined && input.width < 1) || (input.height !== undefined && input.height < 1)) {
    throw new PosError("INVALID_INPUT");
  }

  return {
    category,
    data: {
      name,
      code,
      categoryId: category.id,
      zoneId: input.zoneId || null,
      specs: input.specs?.trim() ? ({ summary: input.specs.trim().slice(0, 300) } as InputJsonValue) : null,
      ipAddress: normalizeIp(input.ipAddress),
      macAddress: normalizeMac(input.macAddress),
      notes: input.notes?.trim() || null,
      isBookableOnline: input.isBookableOnline,
      hourlyRateOverride: input.hourlyRate === null || input.hourlyRate === undefined ? null : fromMinor(input.hourlyRate),
      multiTierBpsOverride: tierBpsFromRates(single, input.multiRate),
      vipTierBpsOverride: tierBpsFromRates(single, input.vipRate),
    },
  };
}

export async function createDevice(ctx: PosContext, input: DeviceInput) {
  return db.$transaction(async (tx) => {
    const { category, data } = await resolveDeviceFields(tx, ctx, input);
    const lounge = await tx.lounge.findUniqueOrThrow({
      where: { id: ctx.loungeId },
      select: { floorPlanWidth: true, floorPlanHeight: true },
    });
    const size = {
      width: input.width ?? FOOTPRINT[category.type].width,
      height: input.height ?? FOOTPRINT[category.type].height,
    };
    let spot = input.posX !== undefined && input.posY !== undefined ? { posX: input.posX, posY: input.posY } : null;
    if (!spot) {
      const taken = await tx.device.findMany({
        where: { loungeId: ctx.loungeId, archivedAt: null },
        select: { posX: true, posY: true, width: true, height: true },
      });
      spot = findFreeSpot({ width: lounge.floorPlanWidth, height: lounge.floorPlanHeight }, taken, size);
      if (!spot) {
        // Floor full: grow it downwards.
        spot = { posX: 0, posY: lounge.floorPlanHeight };
        await tx.lounge.update({ where: { id: ctx.loungeId }, data: { floorPlanHeight: lounge.floorPlanHeight + size.height } });
      }
    }
    const device = await tx.device.create({
      data: {
        ...data,
        loungeId: ctx.loungeId,
        status: input.status === "ACTIVE" ? "IDLE" : input.status,
        ...spot,
        ...size,
      },
      select: { id: true, name: true },
    });
    await audit(tx, ctx, "device.create", "Device", device.id, { name: device.name });
    return device;
  });
}

export async function updateDevice(ctx: PosContext, deviceId: string, input: DeviceInput) {
  const now = ctx.now ?? new Date();
  return db.$transaction(async (tx) => {
    const device = await tx.device.findFirst({ where: { id: deviceId, loungeId: ctx.loungeId, archivedAt: null } });
    if (!device) throw new PosError("NOT_FOUND");
    const { data } = await resolveDeviceFields(tx, ctx, input, device.id);
    const active = await tx.booking.count({ where: { deviceId: device.id, status: "ACTIVE" } });

    if (active > 0 && (input.status !== "ACTIVE" || data.categoryId !== device.categoryId)) throw new PosError("DEVICE_BUSY");

    const ratesChanged =
      String(device.hourlyRateOverride ?? "") !== String(data.hourlyRateOverride ?? "") ||
      device.multiTierBpsOverride !== data.multiTierBpsOverride ||
      device.vipTierBpsOverride !== data.vipTierBpsOverride;
    // Running open sessions keep the old rate up to now, the new one from now on.
    if (ratesChanged && active > 0) await splitOpenSegmentsOnDevice(tx, ctx.loungeId, device.id, now);

    const status =
      input.status !== "ACTIVE" ? input.status : device.status === "MAINTENANCE" || device.status === "OFFLINE" ? "IDLE" : device.status;
    await tx.device.update({
      where: { id: device.id },
      data: {
        ...data,
        status,
        ...(input.posX !== undefined ? { posX: input.posX } : {}),
        ...(input.posY !== undefined ? { posY: input.posY } : {}),
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
      },
    });
    await audit(tx, ctx, "device.update", "Device", device.id, { ratesChanged, status });
    return { id: device.id };
  });
}

/** Usage that blocks removal, and whether there's history to keep. */
export async function deviceUsage(db: Tx | DbReader, deviceId: string, now = new Date()) {
  const [active, upcoming, history] = await Promise.all([
    db.booking.count({ where: { deviceId, status: "ACTIVE" } }),
    db.booking.count({
      where: {
        deviceId,
        status: { in: BLOCKING_STATUSES.filter((s) => s !== "ACTIVE") },
        scheduledEnd: { gt: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    db.booking.count({ where: { deviceId } }),
  ]);
  const segments = await db.sessionSegment.count({ where: { deviceId } });
  return { active, upcoming, hasHistory: history + segments > 0 };
}

/**
 * Removes a device: deleted outright if it was never used, otherwise archived
 * so receipts and reports keep their history. Refused while a session is
 * running or bookings are still to come.
 */
export async function removeDevice(ctx: PosContext, deviceId: string): Promise<{ result: "DELETED" | "ARCHIVED" }> {
  const now = ctx.now ?? new Date();
  return db.$transaction(async (tx) => {
    const device = await tx.device.findFirst({ where: { id: deviceId, loungeId: ctx.loungeId, archivedAt: null } });
    if (!device) throw new PosError("NOT_FOUND");
    const usage = await deviceUsage(tx, device.id, now);
    if (usage.active > 0) throw new PosError("DEVICE_BUSY");
    if (usage.upcoming > 0) throw new PosError("HAS_UPCOMING_BOOKINGS");

    if (usage.hasHistory) {
      await tx.device.update({
        where: { id: device.id },
        data: { archivedAt: now, isBookableOnline: false, status: "OFFLINE" },
      });
      await audit(tx, ctx, "device.archive", "Device", device.id, { name: device.name });
      return { result: "ARCHIVED" as const };
    }
    await tx.device.delete({ where: { id: device.id } });
    await audit(tx, ctx, "device.delete", "Device", device.id, { name: device.name });
    return { result: "DELETED" as const };
  });
}

/** Brings an archived device back (out of service, so it's checked before use). */
export async function restoreDevice(ctx: PosContext, deviceId: string) {
  return db.$transaction(async (tx) => {
    const device = await tx.device.findFirst({ where: { id: deviceId, loungeId: ctx.loungeId, archivedAt: { not: null } } });
    if (!device) throw new PosError("NOT_FOUND");
    await tx.device.update({ where: { id: device.id }, data: { archivedAt: null, status: "MAINTENANCE" } });
    await audit(tx, ctx, "device.restore", "Device", device.id, { name: device.name });
    return { id: device.id };
  });
}

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------

export interface CategoryInput {
  name: string;
  type: DeviceType;
  description?: string | null;
  /** Default single-player rate per hour. */
  baseRate: Minor;
  /** Optional Multi / VIP rates per hour; null = tier not offered. */
  multiRate?: Minor | null;
  vipRate?: Minor | null;
  capacity: number;
  minBookingMinutes: number;
  slotIntervalMinutes: number;
  isActive: boolean;
}

function categoryData(input: CategoryInput) {
  const name = input.name.trim();
  if (!name || name.length > 40) throw new PosError("INVALID_INPUT");
  if (!validRate(input.baseRate) || !validRate(input.multiRate) || !validRate(input.vipRate)) throw new PosError("INVALID_INPUT");
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 50) throw new PosError("INVALID_INPUT");
  if (
    !Number.isInteger(input.minBookingMinutes) ||
    input.minBookingMinutes < 15 ||
    input.minBookingMinutes > 720 ||
    input.minBookingMinutes % 5 !== 0
  ) {
    throw new PosError("INVALID_INPUT");
  }
  if (!(SLOT_INTERVALS as readonly number[]).includes(input.slotIntervalMinutes)) throw new PosError("INVALID_INPUT");
  return {
    name,
    type: input.type,
    description: input.description?.trim() || null,
    baseHourlyRate: fromMinor(input.baseRate),
    multiTierBps: tierBpsFromRates(input.baseRate, input.multiRate),
    vipTierBps: tierBpsFromRates(input.baseRate, input.vipRate),
    capacity: input.capacity,
    minBookingMinutes: input.minBookingMinutes,
    slotIntervalMinutes: input.slotIntervalMinutes,
    isActive: input.isActive,
  };
}

export async function createCategory(ctx: PosContext, input: CategoryInput) {
  const data = categoryData(input);
  return db.$transaction(async (tx) => {
    if (await tx.deviceCategory.count({ where: { loungeId: ctx.loungeId, name: data.name } })) throw new PosError("NAME_TAKEN");
    const category = await tx.deviceCategory.create({ data: { ...data, loungeId: ctx.loungeId }, select: { id: true } });
    await audit(tx, ctx, "category.create", "DeviceCategory", category.id, { name: data.name });
    return category;
  });
}

export async function updateCategory(ctx: PosContext, categoryId: string, input: CategoryInput) {
  const data = categoryData(input);
  const now = ctx.now ?? new Date();
  return db.$transaction(async (tx) => {
    const category = await tx.deviceCategory.findFirst({ where: { id: categoryId, loungeId: ctx.loungeId } });
    if (!category) throw new PosError("NOT_FOUND");
    if (await tx.deviceCategory.count({ where: { loungeId: ctx.loungeId, name: data.name, id: { not: category.id } } })) {
      throw new PosError("NAME_TAKEN");
    }
    const ratesChanged =
      toMinor(category.baseHourlyRate) !== input.baseRate ||
      category.multiTierBps !== data.multiTierBps ||
      category.vipTierBps !== data.vipTierBps;
    if (ratesChanged) {
      // Devices inheriting these rates with open sessions running: bill up to now at the old rate.
      const devices = await tx.device.findMany({ where: { categoryId: category.id, archivedAt: null }, select: { id: true } });
      for (const d of devices) await splitOpenSegmentsOnDevice(tx, ctx.loungeId, d.id, now);
    }
    await tx.deviceCategory.update({ where: { id: category.id }, data });
    await audit(tx, ctx, "category.update", "DeviceCategory", category.id, { ratesChanged });
    return { id: category.id };
  });
}

/** Only an empty category can be deleted; otherwise deactivate it (hides it from booking). */
export async function deleteCategory(ctx: PosContext, categoryId: string) {
  return db.$transaction(async (tx) => {
    const category = await tx.deviceCategory.findFirst({ where: { id: categoryId, loungeId: ctx.loungeId } });
    if (!category) throw new PosError("NOT_FOUND");
    if (await tx.device.count({ where: { categoryId: category.id } })) throw new PosError("CATEGORY_IN_USE");
    await tx.deviceCategory.delete({ where: { id: category.id } });
    await audit(tx, ctx, "category.delete", "DeviceCategory", category.id, { name: category.name });
  });
}

