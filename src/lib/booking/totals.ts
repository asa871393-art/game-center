import type { PaymentStatus } from "@/lib/db/types";
import { applyBps, type Minor } from "@/lib/money";

export interface BookingTotalsInput {
  playSubtotal: Minor;
  canteenSubtotal: Minor;
  discountTotal: Minor;
  taxRateBps: number;
}

export interface BookingTotals {
  playSubtotal: Minor;
  canteenSubtotal: Minor;
  discountTotal: Minor;
  taxTotal: Minor;
  totalPrice: Minor;
}

/**
 * Recomputes a booking's bill after a POS change (extension, canteen order).
 * Tax is charged on the discounted subtotal, matching quoteBooking() when the
 * discount is zero.
 */
export function computeBookingTotals(input: BookingTotalsInput): BookingTotals {
  const gross = input.playSubtotal + input.canteenSubtotal;
  const discountTotal = Math.min(Math.max(0, input.discountTotal), gross);
  const taxable = gross - discountTotal;
  const taxTotal = applyBps(taxable, input.taxRateBps);
  return {
    playSubtotal: input.playSubtotal,
    canteenSubtotal: input.canteenSubtotal,
    discountTotal,
    taxTotal,
    totalPrice: taxable + taxTotal,
  };
}

export function paymentStatusFor(totalPrice: Minor, amountPaid: Minor): PaymentStatus {
  if (amountPaid <= 0) return totalPrice <= 0 ? "PAID" : "UNPAID";
  return amountPaid >= totalPrice ? "PAID" : "PARTIALLY_PAID";
}
