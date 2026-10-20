"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import type { LoungeMemberRole } from "@/generated/prisma/client";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { getDictionaryFor } from "@/i18n/server";
import {
  addSessionOrder,
  cancelBooking,
  cancelSessionOrder,
  checkIn,
  counterSale,
  endSession,
  extendSession,
  markNoShow,
  markOrderServed,
  PosError,
  setDeviceStatus,
  startWalkIn,
  type PosContext,
  type PosErrorCode,
} from "@/server/services/pos";
import { getLoungeAccess, hasLoungeRole } from "@/server/staff";

export type PosActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: PosErrorCode | "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" };

const id = z.string().min(1).max(64);
const base = z.object({ locale: z.string().max(5), loungeId: id });
const versioned = base.extend({ bookingId: id, version: z.number().int().min(0) });
const lines = z.array(z.object({ menuItemId: id, quantity: z.number().int().min(1).max(20) })).min(1).max(30);
const method = z.enum(["CASH", "CARD"]);

function errorMessage(dict: Dictionary, code: PosErrorCode): string {
  return dict.manage.errors[code];
}

/**
 * Shared action pipeline: validate, authenticate, authorize against the
 * lounge (from the database), run, and refresh the board.
 */
async function run<S extends typeof base, T>(
  schema: S,
  payload: unknown,
  minRole: LoungeMemberRole,
  fn: (ctx: PosContext, input: z.infer<S>) => Promise<T>,
): Promise<PosActionResult<T>> {
  const locale = (payload as { locale?: unknown } | null)?.locale;
  const dict = await getDictionaryFor(typeof locale === "string" ? locale : "ar");

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: dict.errors.validation, code: "VALIDATION" };

  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: dict.errors.unauthenticated, code: "UNAUTHENTICATED" };

  const access = await getLoungeAccess(session.user.id, parsed.data.loungeId);
  if (!access || !hasLoungeRole(access, minRole)) {
    return { ok: false, error: dict.manage.errors.FORBIDDEN, code: "FORBIDDEN" };
  }

  try {
    const data = await fn({ loungeId: access.loungeId, actorId: session.user.id }, parsed.data);
    refresh();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof PosError) {
      // Someone else changed it: show the latest state along with the message.
      if (error.code === "STALE") refresh();
      return { ok: false, error: errorMessage(dict, error.code), code: error.code };
    }
    console.error("POS action failed", error);
    return { ok: false, error: dict.errors.generic };
  }
}

const walkInSchema = base.extend({
  deviceId: id,
  durationMinutes: z.number().int().positive(),
  players: z.number().int().min(1).max(50),
  guestName: z.string().trim().max(80).optional(),
  guestPhone: z.string().trim().max(30).optional(),
});

export async function startWalkInAction(payload: z.input<typeof walkInSchema>) {
  return run(walkInSchema, payload, "STAFF", (ctx, i) => startWalkIn(ctx, i));
}

export async function checkInAction(payload: z.input<typeof versioned>) {
  return run(versioned, payload, "STAFF", async (ctx, i) => {
    await checkIn(ctx, i);
    return null;
  });
}

const extendSchema = versioned.extend({ minutes: z.number().int().positive() });

export async function extendSessionAction(payload: z.input<typeof extendSchema>) {
  return run(extendSchema, payload, "STAFF", async (ctx, i) => {
    const { price } = await extendSession(ctx, i);
    return { price };
  });
}

const endSchema = versioned.extend({
  payment: z.object({ method, amount: z.number().int().positive() }).nullable(),
});

export async function endSessionAction(payload: z.input<typeof endSchema>) {
  return run(endSchema, payload, "STAFF", (ctx, i) => endSession(ctx, i));
}

export async function markNoShowAction(payload: z.input<typeof versioned>) {
  return run(versioned, payload, "STAFF", async (ctx, i) => {
    await markNoShow(ctx, i);
    return null;
  });
}

export async function cancelBookingAction(payload: z.input<typeof versioned>) {
  return run(versioned, payload, "STAFF", async (ctx, i) => {
    await cancelBooking(ctx, i);
    return null;
  });
}

const sessionOrderSchema = base.extend({ bookingId: id, items: lines, notes: z.string().trim().max(200).optional() });

export async function addSessionOrderAction(payload: z.input<typeof sessionOrderSchema>) {
  return run(sessionOrderSchema, payload, "STAFF", (ctx, i) => addSessionOrder(ctx, i));
}

const counterSchema = base.extend({ items: lines, method, notes: z.string().trim().max(200).optional() });

export async function counterSaleAction(payload: z.input<typeof counterSchema>) {
  return run(counterSchema, payload, "STAFF", (ctx, i) => counterSale(ctx, i));
}

const orderSchema = base.extend({ orderId: id });

export async function markOrderServedAction(payload: z.input<typeof orderSchema>) {
  return run(orderSchema, payload, "STAFF", async (ctx, i) => {
    await markOrderServed(ctx, i);
    return null;
  });
}

export async function cancelSessionOrderAction(payload: z.input<typeof orderSchema>) {
  return run(orderSchema, payload, "STAFF", async (ctx, i) => {
    await cancelSessionOrder(ctx, i);
    return null;
  });
}

const deviceStatusSchema = base.extend({ deviceId: id, status: z.enum(["IDLE", "MAINTENANCE", "OFFLINE"]) });

/** Taking devices in and out of service is a manager decision. */
export async function setDeviceStatusAction(payload: z.input<typeof deviceStatusSchema>) {
  return run(deviceStatusSchema, payload, "MANAGER", (ctx, i) => setDeviceStatus(ctx, i));
}
