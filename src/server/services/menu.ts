import "server-only";
import type { MenuItemCategory, Prisma } from "@/generated/prisma/client";
import { fromMinor, type Minor } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { PosError, type PosContext } from "./pos";

/**
 * Canteen menu management (manager/owner). Items that appear in past orders
 * are archived rather than deleted, so sales reports keep their lines.
 */

type Tx = Prisma.TransactionClient;

const MAX_PRICE: Minor = 100_000_000; // 1,000,000.00
const MAX_STOCK = 100_000;

function audit(tx: Tx, ctx: PosContext, action: string, entityType: string, entityId: string, data?: Prisma.InputJsonValue) {
  return tx.auditLog.create({ data: { actorId: ctx.actorId, loungeId: ctx.loungeId, action, entityType, entityId, data } });
}

const validMoney = (v: Minor | null | undefined) => v === null || v === undefined || (Number.isInteger(v) && v >= 0 && v <= MAX_PRICE);

// -----------------------------------------------------------------------------
// Items
// -----------------------------------------------------------------------------

export interface MenuItemInput {
  name: string;
  nameEn?: string | null;
  description?: string | null;
  menuCategoryId: string;
  price: Minor;
  costPrice?: Minor | null;
  /** null = unlimited (stock not tracked). */
  stockQuantity: number | null;
  lowStockAt: number;
  imageUrl?: string | null;
  iconName?: string | null;
  sku?: string | null;
  isAvailable: boolean;
}

async function itemFields(tx: Tx, ctx: PosContext, input: MenuItemInput, itemId?: string) {
  const name = input.name.trim();
  const nameEn = input.nameEn?.trim() || null;
  const sku = input.sku?.trim().toUpperCase() || null;
  if (!name || name.length > 60 || (nameEn && nameEn.length > 60)) throw new PosError("INVALID_INPUT");
  if (!validMoney(input.price) || !validMoney(input.costPrice)) throw new PosError("INVALID_INPUT");
  if (input.stockQuantity !== null && (!Number.isInteger(input.stockQuantity) || input.stockQuantity < 0 || input.stockQuantity > MAX_STOCK)) {
    throw new PosError("INVALID_INPUT");
  }
  if (!Number.isInteger(input.lowStockAt) || input.lowStockAt < 0 || input.lowStockAt > 1_000) throw new PosError("INVALID_INPUT");
  const imageUrl = input.imageUrl?.trim() || null;
  if (imageUrl && (imageUrl.length > 500 || !/^https?:\/\/\S+$/i.test(imageUrl))) throw new PosError("INVALID_INPUT");
  const iconName = input.iconName?.trim() || null;
  if (iconName && !/^[a-z][a-z-]{0,29}$/.test(iconName)) throw new PosError("INVALID_INPUT");

  const category = await tx.menuCategory.findFirst({ where: { id: input.menuCategoryId, loungeId: ctx.loungeId } });
  if (!category) throw new PosError("NOT_FOUND");

  // Names must be unique among live items; archived ones keep theirs for history.
  const notSelf = itemId ? { id: { not: itemId } } : {};
  if (await tx.menuItem.count({ where: { loungeId: ctx.loungeId, name, archivedAt: null, ...notSelf } })) throw new PosError("NAME_TAKEN");
  if (sku && (await tx.menuItem.count({ where: { loungeId: ctx.loungeId, sku, ...notSelf } }))) throw new PosError("CODE_TAKEN");

  return {
    name,
    nameEn,
    description: input.description?.trim() || null,
    menuCategoryId: category.id,
    category: category.kind,
    price: fromMinor(input.price),
    costPrice: input.costPrice === null || input.costPrice === undefined ? null : fromMinor(input.costPrice),
    lowStockAt: input.lowStockAt,
    imageUrl,
    iconName,
    sku,
    isAvailable: input.isAvailable,
  };
}

export async function createMenuItem(ctx: PosContext, input: MenuItemInput) {
  return prisma.$transaction(async (tx) => {
    const data = await itemFields(tx, ctx, input);
    const last = await tx.menuItem.aggregate({ where: { menuCategoryId: data.menuCategoryId }, _max: { sortOrder: true } });
    const item = await tx.menuItem.create({
      data: { ...data, loungeId: ctx.loungeId, stockQuantity: input.stockQuantity, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      select: { id: true, name: true },
    });
    await audit(tx, ctx, "menu.create", "MenuItem", item.id, { name: item.name, price: input.price });
    return item;
  });
}

/**
 * Saves an item. `expectedStock` is the stock the form was opened with; if a
 * sale changed it since, the save is refused (STALE) instead of silently
 * overwriting the new count.
 */
export async function updateMenuItem(ctx: PosContext, itemId: string, input: MenuItemInput, expectedStock?: number | null) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.menuItem.findFirst({ where: { id: itemId, loungeId: ctx.loungeId, archivedAt: null } });
    if (!item) throw new PosError("NOT_FOUND");
    const data = await itemFields(tx, ctx, input, item.id);
    const res = await tx.menuItem.updateMany({
      where: { id: item.id, ...(expectedStock !== undefined ? { stockQuantity: expectedStock } : {}) },
      data: { ...data, stockQuantity: input.stockQuantity },
    });
    if (res.count !== 1) throw new PosError("STALE");
    await audit(tx, ctx, "menu.update", "MenuItem", item.id, {
      price: { from: Number(item.price), to: input.price / 100 },
      stock: { from: item.stockQuantity, to: input.stockQuantity },
    });
    return { id: item.id };
  });
}

export async function setMenuItemAvailability(ctx: PosContext, input: { itemId: string; isAvailable: boolean }) {
  return prisma.$transaction(async (tx) => {
    const res = await tx.menuItem.updateMany({
      where: { id: input.itemId, loungeId: ctx.loungeId, archivedAt: null },
      data: { isAvailable: input.isAvailable },
    });
    if (res.count !== 1) throw new PosError("NOT_FOUND");
    await audit(tx, ctx, "menu.availability", "MenuItem", input.itemId, { isAvailable: input.isAvailable });
  });
}

/** Restock (+) or write off (−) relative to the current count, so concurrent sales are never lost. */
export async function adjustMenuStock(ctx: PosContext, input: { itemId: string; delta: number }) {
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > MAX_STOCK) throw new PosError("INVALID_INPUT");
  return prisma.$transaction(async (tx) => {
    const item = await tx.menuItem.findFirst({ where: { id: input.itemId, loungeId: ctx.loungeId, archivedAt: null } });
    if (!item) throw new PosError("NOT_FOUND");
    if (item.stockQuantity === null) throw new PosError("INVALID_STATE");
    const res = await tx.menuItem.updateMany({
      where: { id: item.id, stockQuantity: { gte: Math.max(0, -input.delta) } },
      data: { stockQuantity: { increment: input.delta } },
    });
    if (res.count !== 1) throw new PosError("ITEM_UNAVAILABLE");
    const after = await tx.menuItem.findUniqueOrThrow({ where: { id: item.id }, select: { stockQuantity: true } });
    await audit(tx, ctx, "menu.stock", "MenuItem", item.id, { delta: input.delta, stock: after.stockQuantity });
    return { stock: after.stockQuantity };
  });
}

/** Deletes an item never sold; archives one with order history. */
export async function removeMenuItem(ctx: PosContext, itemId: string, now = new Date()): Promise<{ result: "DELETED" | "ARCHIVED" }> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.menuItem.findFirst({ where: { id: itemId, loungeId: ctx.loungeId, archivedAt: null } });
    if (!item) throw new PosError("NOT_FOUND");
    if (await tx.canteenOrderItem.count({ where: { menuItemId: item.id } })) {
      await tx.menuItem.update({ where: { id: item.id }, data: { archivedAt: now, isAvailable: false } });
      await audit(tx, ctx, "menu.archive", "MenuItem", item.id, { name: item.name });
      return { result: "ARCHIVED" as const };
    }
    await tx.menuItem.delete({ where: { id: item.id } });
    await audit(tx, ctx, "menu.delete", "MenuItem", item.id, { name: item.name });
    return { result: "DELETED" as const };
  });
}

/** Brings an archived item back, unavailable until someone checks it. */
export async function restoreMenuItem(ctx: PosContext, itemId: string) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.menuItem.findFirst({ where: { id: itemId, loungeId: ctx.loungeId, archivedAt: { not: null } } });
    if (!item) throw new PosError("NOT_FOUND");
    if (await tx.menuItem.count({ where: { loungeId: ctx.loungeId, name: item.name, archivedAt: null } })) throw new PosError("NAME_TAKEN");
    await tx.menuItem.update({ where: { id: item.id }, data: { archivedAt: null, isAvailable: false } });
    await audit(tx, ctx, "menu.restore", "MenuItem", item.id, { name: item.name });
    return { id: item.id };
  });
}

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------

export interface MenuCategoryInput {
  name: string;
  nameEn?: string | null;
  kind: MenuItemCategory;
  sortOrder?: number;
}

function categoryFields(input: MenuCategoryInput) {
  const name = input.name.trim();
  const nameEn = input.nameEn?.trim() || null;
  if (!name || name.length > 40 || (nameEn && nameEn.length > 40)) throw new PosError("INVALID_INPUT");
  if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 999)) {
    throw new PosError("INVALID_INPUT");
  }
  return { name, nameEn, kind: input.kind };
}

export async function createMenuCategory(ctx: PosContext, input: MenuCategoryInput) {
  const data = categoryFields(input);
  return prisma.$transaction(async (tx) => {
    if (await tx.menuCategory.count({ where: { loungeId: ctx.loungeId, name: data.name } })) throw new PosError("NAME_TAKEN");
    const last = await tx.menuCategory.aggregate({ where: { loungeId: ctx.loungeId }, _max: { sortOrder: true } });
    const category = await tx.menuCategory.create({
      data: { ...data, loungeId: ctx.loungeId, sortOrder: input.sortOrder ?? (last._max.sortOrder ?? -1) + 1 },
      select: { id: true, name: true },
    });
    await audit(tx, ctx, "menuCategory.create", "MenuCategory", category.id, { name: category.name });
    return category;
  });
}

export async function updateMenuCategory(ctx: PosContext, categoryId: string, input: MenuCategoryInput) {
  const data = categoryFields(input);
  return prisma.$transaction(async (tx) => {
    const category = await tx.menuCategory.findFirst({ where: { id: categoryId, loungeId: ctx.loungeId } });
    if (!category) throw new PosError("NOT_FOUND");
    if (await tx.menuCategory.count({ where: { loungeId: ctx.loungeId, name: data.name, id: { not: category.id } } })) {
      throw new PosError("NAME_TAKEN");
    }
    await tx.menuCategory.update({
      where: { id: category.id },
      data: { ...data, ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}) },
    });
    // Items mirror their section's broad kind (icons, reports).
    if (category.kind !== data.kind) {
      await tx.menuItem.updateMany({ where: { menuCategoryId: category.id }, data: { category: data.kind } });
    }
    await audit(tx, ctx, "menuCategory.update", "MenuCategory", category.id, { name: data.name });
    return { id: category.id };
  });
}

/** Only a category with no items at all (archived ones included) can be deleted. */
export async function deleteMenuCategory(ctx: PosContext, categoryId: string) {
  return prisma.$transaction(async (tx) => {
    const category = await tx.menuCategory.findFirst({ where: { id: categoryId, loungeId: ctx.loungeId } });
    if (!category) throw new PosError("NOT_FOUND");
    if (await tx.menuItem.count({ where: { menuCategoryId: category.id } })) throw new PosError("CATEGORY_IN_USE");
    await tx.menuCategory.delete({ where: { id: category.id } });
    await audit(tx, ctx, "menuCategory.delete", "MenuCategory", category.id, { name: category.name });
  });
}
