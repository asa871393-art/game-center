"use server";

import { z } from "zod";
import {
  createCategory,
  createDevice,
  deleteCategory,
  removeDevice,
  restoreDevice,
  updateCategory,
  updateDevice,
} from "@/server/services/devices";
import { setDeviceStatus } from "@/server/services/pos";
import { actionId as id, loungeScoped as base, runLoungeAction as run } from "./pipeline";

/** Device & category management: managers and owners only. */

const rate = z.number().int().min(0).max(100_000_000);
const optionalRate = rate.nullable().optional();
const ip = z.union([z.ipv4(), z.ipv6()]);

const deviceFields = z.object({
  name: z.string().trim().min(1).max(40),
  code: z.string().trim().max(20).optional(),
  categoryId: id,
  zoneId: id.nullable().optional(),
  specs: z.string().trim().max(300).nullable().optional(),
  ipAddress: z
    .string()
    .trim()
    .max(45)
    .nullable()
    .optional()
    .refine((v) => !v || ip.safeParse(v).success),
  macAddress: z.string().trim().max(17).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  isBookableOnline: z.boolean(),
  status: z.enum(["ACTIVE", "MAINTENANCE", "OFFLINE"]),
  hourlyRate: optionalRate,
  multiRate: optionalRate,
  vipRate: optionalRate,
  posX: z.number().int().min(0).max(200).optional(),
  posY: z.number().int().min(0).max(200).optional(),
  width: z.number().int().min(1).max(20).optional(),
  height: z.number().int().min(1).max(20).optional(),
});

const createSchema = base.extend({ device: deviceFields });

export async function createDeviceAction(payload: z.input<typeof createSchema>) {
  return run(createSchema, payload, "MANAGER", (ctx, i) => createDevice(ctx, i.device));
}

const updateSchema = base.extend({ deviceId: id, device: deviceFields });

export async function updateDeviceAction(payload: z.input<typeof updateSchema>) {
  return run(updateSchema, payload, "MANAGER", (ctx, i) => updateDevice(ctx, i.deviceId, i.device));
}

const deviceIdSchema = base.extend({ deviceId: id });

export async function removeDeviceAction(payload: z.input<typeof deviceIdSchema>) {
  return run(deviceIdSchema, payload, "MANAGER", (ctx, i) => removeDevice(ctx, i.deviceId));
}

export async function restoreDeviceAction(payload: z.input<typeof deviceIdSchema>) {
  return run(deviceIdSchema, payload, "MANAGER", (ctx, i) => restoreDevice(ctx, i.deviceId));
}

const statusSchema = base.extend({ deviceId: id, status: z.enum(["IDLE", "MAINTENANCE", "OFFLINE"]) });

export async function setDeviceStatusFromAdminAction(payload: z.input<typeof statusSchema>) {
  return run(statusSchema, payload, "MANAGER", (ctx, i) => setDeviceStatus(ctx, i));
}

const categoryFields = z.object({
  name: z.string().trim().min(1).max(40),
  type: z.enum(["PC", "CONSOLE", "VR", "VIP_ROOM", "SIMULATOR", "OTHER"]),
  description: z.string().trim().max(300).nullable().optional(),
  baseRate: rate,
  multiRate: optionalRate,
  vipRate: optionalRate,
  capacity: z.number().int().min(1).max(50),
  minBookingMinutes: z.number().int().min(15).max(720),
  slotIntervalMinutes: z.number().int().min(5).max(60),
  isActive: z.boolean(),
});

const createCategorySchema = base.extend({ category: categoryFields });

export async function createCategoryAction(payload: z.input<typeof createCategorySchema>) {
  return run(createCategorySchema, payload, "MANAGER", (ctx, i) => createCategory(ctx, i.category));
}

const updateCategorySchema = base.extend({ categoryId: id, category: categoryFields });

export async function updateCategoryAction(payload: z.input<typeof updateCategorySchema>) {
  return run(updateCategorySchema, payload, "MANAGER", (ctx, i) => updateCategory(ctx, i.categoryId, i.category));
}

const categoryIdSchema = base.extend({ categoryId: id });

export async function deleteCategoryAction(payload: z.input<typeof categoryIdSchema>) {
  return run(categoryIdSchema, payload, "MANAGER", async (ctx, i) => {
    await deleteCategory(ctx, i.categoryId);
    return null;
  });
}
