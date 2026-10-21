"use client";

import { Minus, Plus } from "lucide-react";
import { MenuThumb } from "@/components/canteen/menu-icons";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { localName, money } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { PosBoardData } from "@/server/queries/manage";
import { usePos } from "./pos-context";

type MenuItem = PosBoardData["menuItems"][number];
export type Cart = Record<string, number>;

export function cartLines(cart: Cart) {
  return Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
}

export function cartSubtotal(cart: Cart, menu: readonly MenuItem[]) {
  return cartLines(cart).reduce((sum, l) => sum + (menu.find((m) => m.id === l.menuItemId)?.price ?? 0) * l.quantity, 0);
}

/** Tap-to-add menu grid with quantity steppers, grouped by the lounge's menu categories. */
export function MenuPicker({ cart, onChange }: { cart: Cart; onChange: (cart: Cart) => void }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const groups = data.menuCategories
    .map((c) => ({ category: c, items: data.menuItems.filter((m) => m.menuCategoryId === c.id) }))
    .filter((g) => g.items.length > 0);

  const setQty = (item: MenuItem, qty: number) => {
    const max = Math.min(20, item.stock ?? 20);
    onChange({ ...cart, [item.id]: Math.max(0, Math.min(max, qty)) });
  };

  return (
    <div className="space-y-4">
      {groups.map(({ category, items }) => (
        <section key={category.id}>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{localName(locale, category)}</h4>
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => {
              const qty = cart[item.id] ?? 0;
              return (
                <li
                  key={item.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-xl border p-2.5",
                    qty > 0 && "border-primary bg-primary/5",
                    !item.isAvailable && "opacity-50",
                  )}
                >
                  <button
                    type="button"
                    disabled={!item.isAvailable}
                    onClick={() => setQty(item, qty + 1)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
                  >
                    <MenuThumb imageUrl={item.imageUrl} iconName={item.iconName} kind={item.category} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{localName(locale, item)}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {money(locale, item.price, data.lounge.currency)}
                        {item.stock !== null &&
                          ` · ${item.isAvailable ? t(dict.manage.canteen.stock, { count: item.stock }) : dict.booking.soldOut}`}
                      </span>
                    </span>
                  </button>
                  {qty > 0 && (
                    <div className="flex items-center gap-1">
                      <Button size="icon-xs" variant="outline" onClick={() => setQty(item, qty - 1)} aria-label="−">
                        <Minus />
                      </Button>
                      <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                      <Button size="icon-xs" variant="outline" onClick={() => setQty(item, qty + 1)} aria-label="+">
                        <Plus />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
