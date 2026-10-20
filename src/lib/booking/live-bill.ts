import type { PriceTier, SessionMode } from "@/generated/prisma/enums";
import type { PricingRuleInput } from "./pricing";
import { accruedPlay, playedMinutes, type PricedCategory } from "./session-billing";
import { computeBookingTotals } from "./totals";

/**
 * Live view of a session's bill and clock at `now`, from the board's
 * serialized data. Matches what endSession() charges when billed up to `now`.
 */

export interface LiveSessionInput {
  mode: SessionMode;
  scheduledEnd: string;
  pausedAt: string | null;
  playSubtotal: number;
  canteenSubtotal: number;
  discountTotal: number;
  amountPaid: number;
  segments: readonly {
    deviceId: string;
    priceTier: PriceTier;
    startedAt: string;
    endedAt: string | null;
    amount: number | null;
  }[];
}

export interface LiveBillContext {
  timeZone: string;
  taxRateBps: number;
  rules: readonly PricingRuleInput[];
  /** Category of each device id. */
  categoryOf: (deviceId: string) => PricedCategory | undefined;
}

export interface LiveBill {
  play: number;
  canteen: number;
  tax: number;
  total: number;
  due: number;
  /** Minutes played so far, pauses excluded. */
  playedMinutes: number;
  /** FIXED only: ms left of the booked time (negative = overtime); frozen while paused. */
  remainingMs: number | null;
  /** OPEN only: ms on the clock (pauses excluded). */
  elapsedMs: number | null;
  paused: boolean;
}

export function liveBill(session: LiveSessionInput, ctx: LiveBillContext, now: Date): LiveBill {
  const paused = session.pausedAt !== null;
  const clock = paused ? new Date(session.pausedAt!) : now;
  const segments = session.segments.flatMap((s) => {
    const category = ctx.categoryOf(s.deviceId);
    if (!category) return [];
    return [
      {
        startedAt: new Date(s.startedAt),
        endedAt: s.endedAt ? new Date(s.endedAt) : null,
        priceTier: s.priceTier,
        amount: s.amount,
        category,
      },
    ];
  });

  const play =
    session.mode === "OPEN" ? accruedPlay({ timeZone: ctx.timeZone, rules: ctx.rules }, segments, clock) : session.playSubtotal;
  const totals = computeBookingTotals({
    playSubtotal: play,
    canteenSubtotal: session.canteenSubtotal,
    discountTotal: session.discountTotal,
    taxRateBps: ctx.taxRateBps,
  });
  const elapsedMs = segments.reduce((ms, s) => ms + Math.max(0, (s.endedAt ?? clock).getTime() - s.startedAt.getTime()), 0);

  return {
    play,
    canteen: session.canteenSubtotal,
    tax: totals.taxTotal,
    total: totals.totalPrice,
    due: Math.max(0, totals.totalPrice - session.amountPaid),
    playedMinutes: playedMinutes(segments, clock),
    remainingMs: session.mode === "FIXED" ? new Date(session.scheduledEnd).getTime() - clock.getTime() : null,
    elapsedMs: session.mode === "OPEN" ? elapsedMs : null,
    paused,
  };
}
