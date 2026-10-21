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

  // Container queries: the picker sits in dialogs and in the narrow docked counter panel.
  return (
    <div className="@container space-y-4">
      {groups.map(({ category, items }) => (
        <section key={category.id}>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{localName(locale, category)}</h4>
          <ul className="grid grid-cols-2 gap-2 @md:grid-cols-3 @3xl:grid-cols-4">
            {items.map((item) => {
              const qty = cart[item.id] ?? 0;
              const max = Math.min(20, item.stock ?? 20);
              const low = item.isAvailable && item.stock !== null && item.stock <= item.lowStockAt;
              const name = localName(locale, item);
              return (
                <li
                  key={item.id}
                  className={cn(
                    "flex flex-col overflow-hidden rounded-2xl border-2 bg-card transition",
                    qty > 0 ? "border-primary" : "border-border",
                    !item.isAvailable && "opacity-60",
                  )}
                >
                  {/* The whole card is the "add one" target: fast to hit on a touchscreen. */}
                  <button
                    type="button"
                    disabled={!item.isAvailable || qty >= max}
                    onClick={() => setQty(item, qty + 1)}
                    aria-label={`${name} +1`}
                    className="flex flex-1 flex-col text-start transition select-none active:scale-[0.97] disabled:active:scale-100"
                  >
                    <span className="relative block aspect-[4/3] w-full">
                      <MenuThumb
                        imageUrl={item.imageUrl}
                        iconName={item.iconName}
                        kind={item.category}
                        className="size-full rounded-none"
                        iconClassName="size-10"
                      />
                      {qty > 0 && (
                        <span className="absolute start-1.5 top-1.5 grid h-7 min-w-7 place-items-center rounded-full bg-primary px-1.5 text-sm font-bold text-primary-foreground tabular-nums shadow">
                          {qty}
                        </span>
                      )}
                      {!item.isAvailable ? (
                        <span className="absolute inset-0 grid place-items-center bg-black/55 text-sm font-semibold text-white">
                          {dict.booking.soldOut}
                        </span>
                      ) : (
                        item.stock !== null && (
                          <span
                            className={cn(
                              "absolute end-1.5 bottom-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums backdrop-blur",
                              low ? "bg-amber-500/90 text-black" : "bg-black/50 text-white",
                            )}
                          >
                            {t(dict.manage.canteen.stock, { count: item.stock })}
                          </span>
                        )
                      )}
                    </span>
                    <span className="block space-y-0.5 p-2">
                      <span className="line-clamp-2 min-h-[2.5em] text-sm leading-tight font-medium">{name}</span>
                      <span className="block font-semibold text-primary tabular-nums">{money(locale, item.price, data.lounge.currency)}</span>
                    </span>
                  </button>
                  {qty > 0 && (
                    <div className="grid grid-cols-3 items-center border-t">
                      <Button size="icon-lg" variant="ghost" className="h-11 w-full rounded-none" onClick={() => setQty(item, qty - 1)} aria-label={`${name} −1`}>
                        <Minus />
                      </Button>
                      <span className="text-center font-bold tabular-nums">{qty}</span>
                      <Button
                        size="icon-lg"
                        variant="ghost"
                        className="h-11 w-full rounded-none"
                        disabled={qty >= max}
                        onClick={() => setQty(item, qty + 1)}
                        aria-label={`${name} +1`}
                      >
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
