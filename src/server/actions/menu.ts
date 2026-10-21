"use server";

import { z } from "zod";
import {
  adjustMenuStock,
  createMenuCategory,
  createMenuItem,
  deleteMenuCategory,
  removeMenuItem,
  restoreMenuItem,
  setMenuItemAvailability,
  updateMenuCategory,
  updateMenuItem,
} from "@/server/services/menu";
import { actionId as id, loungeScoped as base, runLoungeAction as run } from "./pipeline";

/** Canteen menu management: managers and owners. */

const money = z.number().int().min(0).max(100_000_000);
const kind = z.enum(["DRINK", "SNACK", "MEAL", "DESSERT", "HOOKAH", "OTHER"]);

const itemFields = z.object({
  name: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  menuCategoryId: id,
  price: money,
  costPrice: money.nullable().optional(),
  stockQuantity: z.number().int().min(0).max(100_000).nullable(),
  lowStockAt: z.number().int().min(0).max(1_000),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  iconName: z.string().trim().max(30).nullable().optional(),
  sku: z.string().trim().max(30).nullable().optional(),
  isAvailable: z.boolean(),
});

const createItemSchema = base.extend({ item: itemFields });

export async function createMenuItemAction(payload: z.input<typeof createItemSchema>) {
  return run(createItemSchema, payload, "MANAGER", (ctx, i) => createMenuItem(ctx, i.item));
}

const updateItemSchema = base.extend({
  itemId: id,
  item: itemFields,
  /** Stock when the form was opened; guards against overwriting sales made meanwhile. */
  expectedStock: z.number().int().nullable(),
});

export async function updateMenuItemAction(payload: z.input<typeof updateItemSchema>) {
  return run(updateItemSchema, payload, "MANAGER", (ctx, i) => updateMenuItem(ctx, i.itemId, i.item, i.expectedStock));
}

const availabilitySchema = base.extend({ itemId: id, isAvailable: z.boolean() });

/** Toggling availability is a front-desk call too (e.g. the coffee machine is down). */
export async function setMenuItemAvailabilityAction(payload: z.input<typeof availabilitySchema>) {
  return run(availabilitySchema, payload, "STAFF", async (ctx, i) => {
    await setMenuItemAvailability(ctx, i);
    return null;
  });
}

const stockSchema = base.extend({ itemId: id, delta: z.number().int().min(-100_000).max(100_000) });

export async function adjustMenuStockAction(payload: z.input<typeof stockSchema>) {
  return run(stockSchema, payload, "MANAGER", (ctx, i) => adjustMenuStock(ctx, i));
}

const itemIdSchema = base.extend({ itemId: id });

export async function removeMenuItemAction(payload: z.input<typeof itemIdSchema>) {
  return run(itemIdSchema, payload, "MANAGER", (ctx, i) => removeMenuItem(ctx, i.itemId));
}

export async function restoreMenuItemAction(payload: z.input<typeof itemIdSchema>) {
  return run(itemIdSchema, payload, "MANAGER", (ctx, i) => restoreMenuItem(ctx, i.itemId));
}

const categoryFields = z.object({
  name: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().max(40).nullable().optional(),
  kind,
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const createCategorySchema = base.extend({ category: categoryFields });

export async function createMenuCategoryAction(payload: z.input<typeof createCategorySchema>) {
  return run(createCategorySchema, payload, "MANAGER", (ctx, i) => createMenuCategory(ctx, i.category));
}

const updateCategorySchema = base.extend({ categoryId: id, category: categoryFields });

export async function updateMenuCategoryAction(payload: z.input<typeof updateCategorySchema>) {
  return run(updateCategorySchema, payload, "MANAGER", (ctx, i) => updateMenuCategory(ctx, i.categoryId, i.category));
}

const categoryIdSchema = base.extend({ categoryId: id });

export async function deleteMenuCategoryAction(payload: z.input<typeof categoryIdSchema>) {
  return run(categoryIdSchema, payload, "MANAGER", async (ctx, i) => {
    await deleteMenuCategory(ctx, i.categoryId);
    return null;
  });
}
