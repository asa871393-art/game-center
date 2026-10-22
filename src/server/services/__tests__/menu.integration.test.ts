import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinor } from "@/lib/money";
import { db } from "@/server/db";
import { getMenuAdmin } from "@/server/queries/menu";
import { getPosBoard } from "@/server/queries/manage";
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
  type MenuItemInput,
} from "../menu";
import { counterSale, PosError, type PosContext } from "../pos";
import { openShift } from "../shift";

const SLUG = "nexus-downtown";
const PREFIX = "ZZ";

let loungeId: string;
let ownerId: string;
let categoryId: string;
let itemId: string;
const ctx = (): PosContext => ({ loungeId, actorId: ownerId });

async function expectCode(promise: Promise<unknown>, code: PosError["code"]) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof PosError && e.code === code);
}

const item = (over: Partial<MenuItemInput> = {}): MenuItemInput => ({
  name: `${PREFIX} كرك`,
  nameEn: `${PREFIX} Karak tea`,
  menuCategoryId: categoryId,
  price: 150_000, // 1,500 IQD
  costPrice: 40_000,
  stockQuantity: 20,
  lowStockAt: 5,
  iconName: "coffee",
  isAvailable: true,
  ...over,
});

async function cleanup() {
  const lounge = await db.lounge.findUnique({ where: { slug: SLUG } });
  if (!lounge) return;
  const items = await db.menuItem.findMany({ where: { loungeId: lounge.id, name: { startsWith: PREFIX } }, select: { id: true } });
  const ids = items.map((i) => i.id);
  const orders = await db.canteenOrder.findMany({ where: { items: { some: { menuItemId: { in: ids } } } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await db.transaction.deleteMany({ where: { canteenOrderId: { in: orderIds } } });
  await db.canteenOrder.deleteMany({ where: { id: { in: orderIds } } });
  await db.menuItem.deleteMany({ where: { id: { in: ids } } });
  await db.menuCategory.deleteMany({ where: { loungeId: lounge.id, name: { startsWith: PREFIX } } });
  await db.shift.deleteMany({ where: { loungeId: lounge.id } });
  const owner = await db.user.findUnique({ where: { email: "owner@gamelounge.dev" } });
  if (owner) await db.auditLog.deleteMany({ where: { loungeId: lounge.id, actorId: owner.id } });
}

beforeAll(async () => {
  await cleanup();
  loungeId = (await db.lounge.findUniqueOrThrow({ where: { slug: SLUG } })).id;
  ownerId = (await db.user.findUniqueOrThrow({ where: { email: "owner@gamelounge.dev" } })).id;
  await openShift(ctx(), { openingFloat: 0, shiftType: "MORNING" });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("menu categories", () => {
  it("creates a bilingual section and rejects duplicates", async () => {
    categoryId = (await createMenuCategory(ctx(), { name: `${PREFIX} مشروبات ساخنة`, nameEn: "ZZ Hot drinks", kind: "DRINK" })).id;
    await expectCode(createMenuCategory(ctx(), { name: `${PREFIX} مشروبات ساخنة`, kind: "DRINK" }), "NAME_TAKEN");
  });
});

describe("menu items", () => {
  it("creates an item that shows up on the POS board", async () => {
    itemId = (await createMenuItem(ctx(), item())).id;
    const saved = await db.menuItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(saved).toMatchObject({ category: "DRINK", stockQuantity: 20, iconName: "coffee", nameEn: "ZZ Karak tea" });
    expect(toMinor(saved.costPrice!)).toBe(40_000);

    const board = (await getPosBoard(loungeId))!;
    expect(board.menuItems.find((m) => m.id === itemId)).toMatchObject({ price: 150_000, menuCategoryId: categoryId, isAvailable: true });
    expect(board.menuCategories.some((c) => c.id === categoryId)).toBe(true);

    const admin = (await getMenuAdmin(loungeId))!;
    expect(admin.items.find((m) => m.id === itemId)).toMatchObject({ marginPct: 73, stockState: "IN_STOCK", hasHistory: false });
  });

  it("validates input and uniqueness", async () => {
    await expectCode(createMenuItem(ctx(), item()), "NAME_TAKEN");
    await expectCode(createMenuItem(ctx(), item({ name: `${PREFIX} 2`, sku: "DRK-PEPSI" })), "CODE_TAKEN");
    await expectCode(createMenuItem(ctx(), item({ name: `${PREFIX} 3`, imageUrl: "javascript:alert(1)" })), "INVALID_INPUT");
    await expectCode(createMenuItem(ctx(), item({ name: `${PREFIX} 4`, iconName: "<svg>" })), "INVALID_INPUT");
  });

  it("refuses to overwrite stock that changed since the form was opened", async () => {
    await db.menuItem.update({ where: { id: itemId }, data: { stockQuantity: { decrement: 2 } } }); // a sale meanwhile
    await expectCode(updateMenuItem(ctx(), itemId, item({ price: 200_000 }), 20), "STALE");
    await updateMenuItem(ctx(), itemId, item({ price: 200_000, stockQuantity: 18 }), 18);
    const board = (await getPosBoard(loungeId))!;
    expect(board.menuItems.find((m) => m.id === itemId)?.price).toBe(200_000);
  });

  it("adjusts stock relative to the live count and flags low stock", async () => {
    expect(await adjustMenuStock(ctx(), { itemId, delta: -15 })).toEqual({ stock: 3 });
    await expectCode(adjustMenuStock(ctx(), { itemId, delta: -4 }), "ITEM_UNAVAILABLE");
    expect((await getMenuAdmin(loungeId))!.items.find((m) => m.id === itemId)?.stockState).toBe("LOW");
    expect(await adjustMenuStock(ctx(), { itemId, delta: 12 })).toEqual({ stock: 15 });

    const unlimited = await createMenuItem(ctx(), item({ name: `${PREFIX} قهوة`, nameEn: null, stockQuantity: null }));
    await expectCode(adjustMenuStock(ctx(), { itemId: unlimited.id, delta: 5 }), "INVALID_STATE");
    expect((await getMenuAdmin(loungeId))!.items.find((m) => m.id === unlimited.id)?.stockState).toBe("UNLIMITED");
  });

  it("stops selling an unavailable item", async () => {
    await setMenuItemAvailability(ctx(), { itemId, isAvailable: false });
    await expectCode(
      counterSale(ctx(), { items: [{ menuItemId: itemId, quantity: 1 }], payments: [{ method: "CASH", amount: 200_000 }] }),
      "ITEM_UNAVAILABLE",
    );
    await setMenuItemAvailability(ctx(), { itemId, isAvailable: true });
  });

  it("deletes a never-sold item and archives a sold one, keeping its order lines", async () => {
    const spare = await createMenuItem(ctx(), item({ name: `${PREFIX} spare`, nameEn: null }));
    expect(await removeMenuItem(ctx(), spare.id)).toEqual({ result: "DELETED" });

    const { orderId } = await counterSale(ctx(), {
      items: [{ menuItemId: itemId, quantity: 1 }],
      payments: [{ method: "CASH", amount: 200_000 }],
    });
    expect((await getMenuAdmin(loungeId))!.items.find((m) => m.id === itemId)).toMatchObject({ hasHistory: true, sold30d: 1 });

    expect(await removeMenuItem(ctx(), itemId)).toEqual({ result: "ARCHIVED" });
    expect(await db.canteenOrderItem.count({ where: { orderId, menuItemId: itemId } })).toBe(1);
    const board = (await getPosBoard(loungeId))!;
    expect(board.menuItems.some((m) => m.id === itemId)).toBe(false);
    await expectCode(
      counterSale(ctx(), { items: [{ menuItemId: itemId, quantity: 1 }], payments: [{ method: "CASH", amount: 200_000 }] }),
      "ITEM_UNAVAILABLE",
    );

    await restoreMenuItem(ctx(), itemId);
    expect(await db.menuItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({ archivedAt: null, isAvailable: false });
  });

  it("keeps sections with items, deletes empty ones, and cascades a kind change to items", async () => {
    await expectCode(deleteMenuCategory(ctx(), categoryId), "CATEGORY_IN_USE");
    await updateMenuCategory(ctx(), categoryId, { name: `${PREFIX} مشروبات ساخنة`, nameEn: "ZZ Hot drinks", kind: "OTHER" });
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: itemId } })).category).toBe("OTHER");

    const empty = await createMenuCategory(ctx(), { name: `${PREFIX} فارغ`, kind: "SNACK" });
    await deleteMenuCategory(ctx(), empty.id);
    expect(await db.menuCategory.count({ where: { id: empty.id } })).toBe(0);
  });
});
