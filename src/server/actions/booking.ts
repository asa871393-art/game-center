"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { isLocale, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { format } from "@/i18n/format";
import { getDictionaryFor } from "@/i18n/server";
import { db } from "@/server/db";
import {
  BookingError,
  createBooking,
  MAX_ADVANCE_DAYS,
  settlePayment,
  type BookingErrorCode,
  type SettleOutcome,
} from "@/server/services/booking";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: BookingErrorCode | "UNAUTHENTICATED" | "VALIDATION" };

const bookingSchema = z.object({
  locale: z.string(),
  loungeSlug: z.string().min(1).max(120),
  deviceId: z.string().min(1).max(64),
  start: z.iso.datetime(),
  durationMinutes: z.number().int().positive(),
  players: z.number().int().min(1).max(50),
  addOns: z
    .array(z.object({ menuItemId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(20) }))
    .max(30),
  checkoutMethod: z.enum(["PAY_AT_LOUNGE", "ZAINCASH", "FASTPAY"]),
  notes: z.string().trim().max(500).optional(),
});

export type CreateBookingPayload = z.input<typeof bookingSchema>;

function errorMessage(dict: Dictionary, code: BookingErrorCode): string {
  const map: Record<BookingErrorCode, string> = {
    NOT_FOUND: dict.errors.notFound,
    DEVICE_UNAVAILABLE: dict.errors.deviceUnavailable,
    TOO_MANY_PLAYERS: dict.errors.tooManyPlayers,
    DURATION_INVALID: dict.errors.durationInvalid,
    TOO_SOON: dict.errors.tooSoon,
    TOO_FAR: format(dict.errors.tooFar, { days: MAX_ADVANCE_DAYS }),
    OUTSIDE_HOURS: dict.errors.outsideHours,
    SLOT_TAKEN: dict.errors.slotTaken,
    ITEM_UNAVAILABLE: dict.errors.itemUnavailable,
    PAYMENT_UNAVAILABLE: dict.errors.paymentUnavailable,
  };
  return map[code];
}

export async function createBookingAction(payload: CreateBookingPayload): Promise<ActionResult<{ redirectUrl: string }>> {
  const locale: Locale = isLocale(payload?.locale) ? payload.locale : "ar";
  const dict = await getDictionaryFor(locale);

  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: dict.errors.unauthenticated, code: "UNAUTHENTICATED" };

  const parsed = bookingSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: dict.errors.validation, code: "VALIDATION" };

  try {
    const { redirectUrl } = await createBooking({
      ...parsed.data,
      start: new Date(parsed.data.start),
      customerId: session.user.id,
      locale,
    });
    return { ok: true, data: { redirectUrl } };
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: errorMessage(dict, error.code), code: error.code };
    console.error("createBookingAction failed", error);
    return { ok: false, error: dict.errors.generic };
  }
}

/** Sandbox gateway only: simulates the wallet's approve/decline callback. */
export async function completeSandboxPaymentAction(
  locale: string,
  transactionId: string,
  outcome: SettleOutcome,
): Promise<ActionResult<{ result: Awaited<ReturnType<typeof settlePayment>>["result"]; reference: string }>> {
  const dict = await getDictionaryFor(locale);
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: dict.errors.unauthenticated, code: "UNAUTHENTICATED" };
  if (outcome !== "approved" && outcome !== "declined") return { ok: false, error: dict.errors.validation };

  const payment = await db.transaction.findUnique({
    where: { id: transactionId },
    select: { userId: true, provider: true, providerRef: true },
  });
  // Only the payer can act, and only on sandbox transactions.
  if (!payment || payment.userId !== session.user.id || !payment.providerRef?.startsWith("sandbox_")) {
    return { ok: false, error: dict.errors.notFound, code: "NOT_FOUND" };
  }

  try {
    return { ok: true, data: await settlePayment(transactionId, outcome) };
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: errorMessage(dict, error.code), code: error.code };
    console.error("completeSandboxPaymentAction failed", error);
    return { ok: false, error: dict.errors.generic };
  }
}
