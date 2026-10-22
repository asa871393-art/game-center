import "server-only";
import { isFirebaseStorageEnabled } from "@/lib/env";
import { toMinor } from "@/lib/money";
import { db } from "@/server/db";

export type StockState = "UNLIMITED" | "IN_STOCK" | "LOW" | "OUT";

export function stockState(stock: number | null, lowStockAt: number): StockState {
  if (stock === null) return "UNLIMITED";
  if (stock <= 0) return "OUT";
  return stock <= lowStockAt ? "LOW" : "IN_STOCK";
}

const SALES_WINDOW_DAYS = 30;

/** Everything the menu management screen needs for one lounge, serializable. */
export async function getMenuAdmin(loungeId: string, now = new Date()) {
  const lounge = await db.lounge.findUnique({
    where: { id: loungeId },
    select: {
      id: true,
      name: true,
      currency: true,
      menuCategories: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      menuItems: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
  });
  if (!lounge) return null;

  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * 86_400_000);
  const [sold, history] = await Promise.all([
    db.canteenOrderItem.groupBy({
      by: ["menuItemId"],
      where: { order: { loungeId, status: { not: "CANCELLED" }, createdAt: { gte: since } } },
      _sum: { quantity: true },
    }),
    db.canteenOrderItem.groupBy({ by: ["menuItemId"], where: { order: { loungeId } }, _count: { _all: true } }),
  ]);
  const soldOf = (id: string) => sold.find((s) => s.menuItemId === id)?._sum.quantity ?? 0;
  const hasHistory = (id: string) => history.some((h) => h.menuItemId === id);

  const live = lounge.menuItems.filter((m) => m.archivedAt === null);
  return {
    lounge: { id: lounge.id, name: lounge.name, currency: lounge.currency },
    salesWindowDays: SALES_WINDOW_DAYS,
    /** Firebase Storage is configured, so the item form can offer "upload image". */
    imageUploads: isFirebaseStorageEnabled,
    categories: lounge.menuCategories.map((c) => ({
      id: c.id,
      name: c.name,
      nameEn: c.nameEn,
      kind: c.kind,
      sortOrder: c.sortOrder,
      itemCount: live.filter((m) => m.menuCategoryId === c.id).length,
      totalCount: lounge.menuItems.filter((m) => m.menuCategoryId === c.id).length,
    })),
    items: live.map((m) => {
      const price = toMinor(m.price);
      const cost = m.costPrice === null ? null : toMinor(m.costPrice);
      return {
        id: m.id,
        name: m.name,
        nameEn: m.nameEn,
        description: m.description,
        menuCategoryId: m.menuCategoryId,
        kind: m.category,
        price,
        costPrice: cost,
        /** Margin as a percentage of the selling price, when the cost is known. */
        marginPct: cost !== null && price > 0 ? Math.round(((price - cost) / price) * 100) : null,
        stock: m.stockQuantity,
        lowStockAt: m.lowStockAt,
        stockState: stockState(m.stockQuantity, m.lowStockAt),
        imageUrl: m.imageUrl,
        iconName: m.iconName,
        sku: m.sku,
        isAvailable: m.isAvailable,
        sold30d: soldOf(m.id),
        hasHistory: hasHistory(m.id),
      };
    }),
    archived: lounge.menuItems
      .filter((m) => m.archivedAt !== null)
      .map((m) => ({
        id: m.id,
        name: m.name,
        nameEn: m.nameEn,
        kind: m.category,
        price: toMinor(m.price),
        archivedAt: m.archivedAt!.toISOString(),
      })),
  };
}

export type MenuAdminData = NonNullable<Awaited<ReturnType<typeof getMenuAdmin>>>;
export type AdminMenuItem = MenuAdminData["items"][number];
export type AdminMenuCategory = MenuAdminData["categories"][number];
