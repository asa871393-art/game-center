import "server-only";
import type { DeviceType, Prisma } from "@/generated/prisma/client";
import type { PricingRuleInput } from "@/lib/booking/pricing";
import { getOpeningWindow, type Interval } from "@/lib/booking/schedule";
import type { IsoDate } from "@/lib/booking/time";
import { toMinor, type Minor } from "@/lib/money";
import { prisma } from "@/lib/prisma";

/** Booking statuses that occupy a device (mirrors the DB exclusion constraint). */
export const BLOCKING_STATUSES = ["PENDING", "CONFIRMED", "ACTIVE"] as const;

export interface LoungeSearchFilters {
  q?: string;
  city?: string;
  type?: DeviceType;
}

export interface LoungeSummary {
  id: string;
  slug: string;
  name: string;
  city: string;
  addressLine: string;
  coverImageUrl: string | null;
  currency: string;
  deviceCount: number;
  types: DeviceType[];
  /** Lowest base hourly rate across active categories. */
  fromHourlyRate: Minor | null;
}

const summarySelect = {
  id: true,
  slug: true,
  name: true,
  city: true,
  addressLine: true,
  coverImageUrl: true,
  currency: true,
  categories: {
    where: { isActive: true },
    select: { type: true, baseHourlyRate: true, _count: { select: { devices: { where: { archivedAt: null } } } } },
  },
} satisfies Prisma.LoungeSelect;

function toSummary(l: Prisma.LoungeGetPayload<{ select: typeof summarySelect }>): LoungeSummary {
  const rates = l.categories.map((c) => toMinor(c.baseHourlyRate));
  return {
    id: l.id,
    slug: l.slug,
    name: l.name,
    city: l.city,
    addressLine: l.addressLine,
    coverImageUrl: l.coverImageUrl,
    currency: l.currency,
    deviceCount: l.categories.reduce((n, c) => n + c._count.devices, 0),
    types: [...new Set(l.categories.map((c) => c.type))],
    fromHourlyRate: rates.length ? Math.min(...rates) : null,
  };
}

export async function searchLounges(filters: LoungeSearchFilters, take = 30): Promise<LoungeSummary[]> {
  const lounges = await prisma.lounge.findMany({
    where: {
      status: "ACTIVE",
      ...(filters.city ? { city: { equals: filters.city, mode: "insensitive" } } : {}),
      ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" } } : {}),
      ...(filters.type ? { categories: { some: { type: filters.type, isActive: true } } } : {}),
    },
    orderBy: [{ city: "asc" }, { name: "asc" }],
    take,
    select: summarySelect,
  });
  return lounges.map(toSummary);
}

export async function getCities(): Promise<string[]> {
  const rows = await prisma.lounge.findMany({
    where: { status: "ACTIVE" },
    distinct: ["city"],
    select: { city: true },
    orderBy: { city: "asc" },
  });
  return rows.map((r) => r.city);
}

export async function getLoungeDetails(slug: string) {
  const lounge = await prisma.lounge.findFirst({
    where: { slug, status: "ACTIVE" },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      openingHours: { orderBy: { dayOfWeek: "asc" } },
      zones: { orderBy: { sortOrder: "asc" } },
      categories: { where: { isActive: true }, orderBy: { baseHourlyRate: "asc" } },
      devices: { where: { archivedAt: null }, orderBy: [{ posY: "asc" }, { posX: "asc" }] },
      pricingRules: { where: { isActive: true } },
      menuItems: { where: { isAvailable: true, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      menuCategories: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
  });
  if (!lounge) return null;

  // Plain, serializable shape for Client Components (no Decimal instances).
  return {
    id: lounge.id,
    slug: lounge.slug,
    name: lounge.name,
    description: lounge.description,
    addressLine: lounge.addressLine,
    city: lounge.city,
    phone: lounge.phone,
    timezone: lounge.timezone,
    currency: lounge.currency,
    taxRateBps: lounge.taxRateBps,
    coverImageUrl: lounge.coverImageUrl,
    floorPlan: { width: lounge.floorPlanWidth, height: lounge.floorPlanHeight },
    photos: lounge.photos.map((p) => ({ id: p.id, url: p.url, alt: p.alt })),
    openingHours: lounge.openingHours.map((h) => ({
      dayOfWeek: h.dayOfWeek,
      opensAtMinute: h.opensAtMinute,
      closesAtMinute: h.closesAtMinute,
      isClosed: h.isClosed,
    })),
    zones: lounge.zones.map((z) => ({ id: z.id, name: z.name, color: z.color })),
    categories: lounge.categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      description: c.description,
      baseHourlyRate: toMinor(c.baseHourlyRate),
      capacity: c.capacity,
      minBookingMinutes: c.minBookingMinutes,
      slotIntervalMinutes: c.slotIntervalMinutes,
      specs: (c.specs ?? null) as Record<string, unknown> | null,
      iconName: c.iconName,
    })),
    devices: lounge.devices.map((d) => ({
      id: d.id,
      name: d.name,
      categoryId: d.categoryId,
      zoneId: d.zoneId,
      status: d.status,
      isBookableOnline: d.isBookableOnline,
      /** Device rate override, or null to use the category's. */
      hourlyRate: d.hourlyRateOverride === null ? null : toMinor(d.hourlyRateOverride),
      posX: d.posX,
      posY: d.posY,
      width: d.width,
      height: d.height,
    })),
    pricingRules: lounge.pricingRules.map(
      (r): PricingRuleInput => ({
        id: r.id,
        categoryId: r.categoryId,
        daysOfWeek: r.daysOfWeek,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        hourlyRate: r.hourlyRate === null ? null : toMinor(r.hourlyRate),
        multiplierBps: r.multiplierBps,
        priority: r.priority,
        validFrom: r.validFrom,
        validTo: r.validTo,
        isActive: r.isActive,
      }),
    ),
    menuCategories: lounge.menuCategories.map((c) => ({ id: c.id, name: c.name, nameEn: c.nameEn, kind: c.kind })),
    menuItems: lounge.menuItems.map((m) => ({
      id: m.id,
      name: m.name,
      nameEn: m.nameEn,
      menuCategoryId: m.menuCategoryId,
      iconName: m.iconName,
      description: m.description,
      category: m.category,
      price: toMinor(m.price),
      imageUrl: m.imageUrl,
      soldOut: m.stockQuantity !== null && m.stockQuantity <= 0,
    })),
  };
}

export type LoungeDetails = NonNullable<Awaited<ReturnType<typeof getLoungeDetails>>>;

export interface DayAvailability {
  date: IsoDate;
  window: { start: string; end: string } | null;
  /** Busy intervals per device id, as ISO strings. */
  busy: Record<string, { start: string; end: string }[]>;
}

export async function getDayAvailability(slug: string, date: IsoDate): Promise<DayAvailability | null> {
  const lounge = await prisma.lounge.findFirst({
    where: { slug, status: "ACTIVE" },
    select: { id: true, timezone: true, openingHours: true },
  });
  if (!lounge) return null;

  const window = getOpeningWindow(date, lounge.openingHours, lounge.timezone);
  if (!window) return { date, window: null, busy: {} };

  const bookings = await prisma.booking.findMany({
    where: {
      loungeId: lounge.id,
      status: { in: [...BLOCKING_STATUSES] },
      scheduledStart: { lt: window.end },
      scheduledEnd: { gt: window.start },
      // Expired payment holds no longer block the slot.
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { deviceId: true, scheduledStart: true, scheduledEnd: true },
  });

  const busy: DayAvailability["busy"] = {};
  for (const b of bookings) {
    (busy[b.deviceId] ??= []).push({ start: b.scheduledStart.toISOString(), end: b.scheduledEnd.toISOString() });
  }
  return { date, window: serializeInterval(window), busy };
}

function serializeInterval(i: Interval) {
  return { start: i.start.toISOString(), end: i.end.toISOString() };
}
