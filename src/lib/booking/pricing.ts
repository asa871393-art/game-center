import { applyBps, type Minor } from "@/lib/money";
import { addMinutes, getZonedParts } from "./time";

export interface PricingRuleInput {
  id: string;
  categoryId: string | null;
  daysOfWeek: readonly number[];
  startMinute: number;
  endMinute: number;
  hourlyRate: Minor | null;
  multiplierBps: number | null;
  priority: number;
  validFrom: Date | null;
  validTo: Date | null;
  isActive: boolean;
}

export interface QuoteInput {
  start: Date;
  durationMinutes: number;
  timeZone: string;
  categoryId: string;
  baseHourlyRate: Minor;
  rules: readonly PricingRuleInput[];
  taxRateBps: number;
  addOns: readonly { unitPrice: Minor; quantity: number }[];
}

export interface QuoteSegment {
  /** Hourly rate applied to this run of minutes. */
  hourlyRate: Minor;
  minutes: number;
  ruleId: string | null;
}

export interface Quote {
  segments: QuoteSegment[];
  playSubtotal: Minor;
  canteenSubtotal: Minor;
  taxTotal: Minor;
  total: Minor;
  /** Average hourly rate over the booking, for the price snapshot. */
  effectiveHourlyRate: Minor;
}

/** Pricing granularity. Booking starts and durations are multiples of this. */
export const PRICING_STEP_MINUTES = 5;

function inWindow(minuteOfDay: number, start: number, end: number): boolean {
  // end <= start wraps past midnight (e.g. 20:00 -> 02:00).
  return start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
}

/**
 * Highest-priority active rule matching the local minute. Day-of-week is the
 * local day of that minute, so a Thursday 20:00-02:00 rule needs Friday listed
 * too if it should cover Friday 00:00-02:00.
 */
export function matchRule(
  rules: readonly PricingRuleInput[],
  categoryId: string,
  instant: Date,
  timeZone: string,
): PricingRuleInput | null {
  const { dayOfWeek, minuteOfDay } = getZonedParts(instant, timeZone);
  let best: PricingRuleInput | null = null;
  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.categoryId !== null && rule.categoryId !== categoryId) continue;
    if (rule.validFrom && instant < rule.validFrom) continue;
    if (rule.validTo && instant >= rule.validTo) continue;
    if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(dayOfWeek)) continue;
    if (!inWindow(minuteOfDay, rule.startMinute, rule.endMinute)) continue;
    // Ties: category-specific beats lounge-wide, then lowest id for determinism.
    if (
      !best ||
      rule.priority > best.priority ||
      (rule.priority === best.priority &&
        (rule.categoryId !== null) > (best.categoryId !== null)) ||
      (rule.priority === best.priority &&
        (rule.categoryId !== null) === (best.categoryId !== null) &&
        rule.id < best.id)
    ) {
      best = rule;
    }
  }
  return best;
}

export function rateFor(rule: PricingRuleInput | null, baseHourlyRate: Minor): Minor {
  if (!rule) return baseHourlyRate;
  if (rule.hourlyRate !== null) return rule.hourlyRate;
  if (rule.multiplierBps !== null) return applyBps(baseHourlyRate, rule.multiplierBps);
  return baseHourlyRate;
}

export function quoteBooking(input: QuoteInput): Quote {
  const { start, durationMinutes, timeZone, categoryId, baseHourlyRate, rules } = input;
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("durationMinutes must be a positive integer");
  }

  const segments: QuoteSegment[] = [];
  for (let offset = 0; offset < durationMinutes; offset += PRICING_STEP_MINUTES) {
    const minutes = Math.min(PRICING_STEP_MINUTES, durationMinutes - offset);
    const rule = matchRule(rules, categoryId, addMinutes(start, offset), timeZone);
    const hourlyRate = rateFor(rule, baseHourlyRate);
    const last = segments.at(-1);
    if (last && last.hourlyRate === hourlyRate && last.ruleId === (rule?.id ?? null)) {
      last.minutes += minutes;
    } else {
      segments.push({ hourlyRate, minutes, ruleId: rule?.id ?? null });
    }
  }

  // Sum rate × minutes first, round once, so splitting into segments never adds cents.
  const rateMinutes = segments.reduce((sum, s) => sum + s.hourlyRate * s.minutes, 0);
  const playSubtotal = Math.round(rateMinutes / 60);
  const canteenSubtotal = input.addOns.reduce((sum, a) => sum + a.unitPrice * a.quantity, 0);
  const taxTotal = applyBps(playSubtotal + canteenSubtotal, input.taxRateBps);

  return {
    segments,
    playSubtotal,
    canteenSubtotal,
    taxTotal,
    total: playSubtotal + canteenSubtotal + taxTotal,
    effectiveHourlyRate: Math.round(rateMinutes / durationMinutes),
  };
}
