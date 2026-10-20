import type { PriceTier } from "@/generated/prisma/enums";
import { applyBps, type Minor } from "@/lib/money";
import { quoteBooking, type PricingRuleInput } from "./pricing";

/**
 * Pure billing helpers for POS sessions, shared by the server (which charges)
 * and the cashier screen (which previews), so both always show the same number.
 */

export const PRICE_TIERS: readonly PriceTier[] = ["SINGLE", "MULTI", "VIP"];
const SINGLE_BPS = 10_000;

export interface TierConfig {
  multiTierBps: number | null;
  vipTierBps: number | null;
}

/** Rate multiplier for a tier, or null when the category doesn't offer it. */
export function tierBps(category: TierConfig, tier: PriceTier): number | null {
  if (tier === "SINGLE") return SINGLE_BPS;
  return tier === "MULTI" ? category.multiTierBps : category.vipTierBps;
}

export function availableTiers(category: TierConfig): PriceTier[] {
  return PRICE_TIERS.filter((t) => tierBps(category, t) !== null);
}

/** Open play is billed per started minute. */
export function billableMinutes(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

export interface PlayPricing {
  timeZone: string;
  rules: readonly PricingRuleInput[];
}

export interface PricedCategory extends TierConfig {
  id: string;
  baseHourlyRate: Minor;
}

export interface DeviceRateOverrides {
  hourlyRateOverride: Minor | null;
  multiTierBpsOverride: number | null;
  vipTierBpsOverride: number | null;
}

/**
 * A device's effective pricing: its own overrides where set, else its
 * category's. The category id is kept, so time-of-day rules aimed at the
 * category still apply (multiplier rules scale the device rate; fixed-rate
 * rules replace it).
 */
export function withDeviceRates(category: PricedCategory, device: DeviceRateOverrides): PricedCategory {
  return {
    id: category.id,
    baseHourlyRate: device.hourlyRateOverride ?? category.baseHourlyRate,
    multiTierBps: device.multiTierBpsOverride ?? category.multiTierBps,
    vipTierBps: device.vipTierBpsOverride ?? category.vipTierBps,
  };
}

/**
 * Price of `minutes` of play starting at `start` on a category at a tier:
 * the time-of-day pricing rules first, then the tier multiplier.
 */
export function pricePlay(
  pricing: PlayPricing,
  category: PricedCategory,
  tier: PriceTier,
  start: Date,
  minutes: number,
): Minor {
  if (minutes <= 0) return 0;
  const bps = tierBps(category, tier) ?? SINGLE_BPS;
  const quote = quoteBooking({
    start,
    durationMinutes: minutes,
    timeZone: pricing.timeZone,
    categoryId: category.id,
    baseHourlyRate: category.baseHourlyRate,
    rules: pricing.rules,
    taxRateBps: 0,
    addOns: [],
  });
  return applyBps(quote.playSubtotal, bps);
}

export interface SegmentLike {
  startedAt: Date;
  endedAt: Date | null;
  priceTier: PriceTier;
  /** Set on closed segments. */
  amount: Minor | null;
  category: PricedCategory;
}

/** Play charge so far: closed segments at their recorded price plus the running one up to `until`. */
export function accruedPlay(pricing: PlayPricing, segments: readonly SegmentLike[], until: Date): Minor {
  let total = 0;
  for (const s of segments) {
    if (s.endedAt) total += s.amount ?? 0;
    else total += pricePlay(pricing, s.category, s.priceTier, s.startedAt, billableMinutes(s.startedAt, until));
  }
  return total;
}

/** Minutes actually played (pauses excluded), counting a running segment up to `until`. */
export function playedMinutes(segments: readonly Pick<SegmentLike, "startedAt" | "endedAt">[], until: Date): number {
  return segments.reduce((sum, s) => sum + billableMinutes(s.startedAt, s.endedAt ?? until), 0);
}
