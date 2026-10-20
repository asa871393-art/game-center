"use server";

import { z } from "zod";
import { actionId as id, loungeScoped as base, runLoungeAction as run, type PosActionResult } from "./pipeline";
import {
  addSessionOrder,
  cancelBooking,
  cancelSessionOrder,
  changeTier,
  checkIn,
  counterSale,
  endSession,
  extendSession,
  markNoShow,
  markOrderServed,
  pauseSession,
  resumeSession,
  setDeviceStatus,
  startWalkIn,
  transferSession,
} from "@/server/services/pos";
import { closeShift, openShift } from "@/server/services/shift";

export type { PosActionResult };

const versioned = base.extend({ bookingId: id, version: z.number().int().min(0) });
const lines = z.array(z.object({ menuItemId: id, quantity: z.number().int().min(1).max(20) })).min(1).max(30);
const tier = z.enum(["SINGLE", "MULTI", "VIP"]);
const payments = z
  .array(
    z.object({
      method: z.enum(["CASH", "CARD", "ZAINCASH", "FASTPAY"]),
      amount: z.number().int().positive(),
      tendered: z.number().int().positive().optional(),
    }),
  )
  .max(6);

const walkInSchema = base.extend({
  deviceId: id,
  mode: z.enum(["FIXED", "OPEN"]).default("FIXED"),
  priceTier: tier.default("SINGLE"),
  durationMinutes: z.number().int().positive().optional(),
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

const tierSchema = versioned.extend({ tier });

export async function changeTierAction(payload: z.input<typeof tierSchema>) {
  return run(tierSchema, payload, "STAFF", (ctx, i) => changeTier(ctx, i));
}

export async function pauseSessionAction(payload: z.input<typeof versioned>) {
  return run(versioned, payload, "STAFF", async (ctx, i) => {
    await pauseSession(ctx, i);
    return null;
  });
}

export async function resumeSessionAction(payload: z.input<typeof versioned>) {
  return run(versioned, payload, "STAFF", async (ctx, i) => {
    const { lostMinutes } = await resumeSession(ctx, i);
    return { lostMinutes };
  });
}

const transferSchema = versioned.extend({ targetDeviceId: id });

export async function transferSessionAction(payload: z.input<typeof transferSchema>) {
  return run(transferSchema, payload, "STAFF", (ctx, i) => transferSession(ctx, i));
}

const endSchema = versioned.extend({
  payments,
  billUntil: z.iso.datetime().optional(),
  discount: z.number().int().min(0).optional(),
  discountReason: z.string().trim().max(120).optional(),
});

export async function endSessionAction(payload: z.input<typeof endSchema>) {
  return run(endSchema, payload, "STAFF", (ctx, i) =>
    endSession(ctx, { ...i, billUntil: i.billUntil ? new Date(i.billUntil) : undefined }),
  );
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

const counterSchema = base.extend({ items: lines, payments: payments.min(1), notes: z.string().trim().max(200).optional() });

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

const openShiftSchema = base.extend({ openingFloat: z.number().int().min(0) });

export async function openShiftAction(payload: z.input<typeof openShiftSchema>) {
  return run(openShiftSchema, payload, "STAFF", async (ctx, i) => {
    const shift = await openShift(ctx, i);
    return { shiftId: shift.id };
  });
}

const closeShiftSchema = base.extend({
  shiftId: id,
  countedCash: z.number().int().min(0),
  notes: z.string().trim().max(300).optional(),
});

export async function closeShiftAction(payload: z.input<typeof closeShiftSchema>) {
  return run(closeShiftSchema, payload, "STAFF", (ctx, i) => closeShift(ctx, i));
}

const deviceStatusSchema = base.extend({ deviceId: id, status: z.enum(["IDLE", "MAINTENANCE", "OFFLINE"]) });

/** Taking devices in and out of service is a manager decision. */
export async function setDeviceStatusAction(payload: z.input<typeof deviceStatusSchema>) {
  return run(deviceStatusSchema, payload, "MANAGER", (ctx, i) => setDeviceStatus(ctx, i));
}
