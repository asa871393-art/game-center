"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { money } from "@/i18n/format";
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

/** Tap-to-add menu grid with quantity steppers, grouped by category. */
export function MenuPicker({ cart, onChange }: { cart: Cart; onChange: (cart: Cart) => void }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const groups = Object.groupBy(data.menuItems, (m) => m.category);

  const setQty = (item: MenuItem, qty: number) => {
    const max = Math.min(20, item.stock ?? 20);
    onChange({ ...cart, [item.id]: Math.max(0, Math.min(max, qty)) });
  };

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([group, items]) => (
        <section key={group}>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {dict.menuCategory[group as MenuItem["category"]]}
          </h4>
          <ul className="grid gap-2 sm:grid-cols-2">
            {items!.map((item) => {
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
                    className="min-w-0 flex-1 text-start"
                  >
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {money(locale, item.price, data.lounge.currency)}
                      {item.stock !== null &&
                        ` · ${item.isAvailable ? t(dict.manage.canteen.stock, { count: item.stock }) : dict.booking.soldOut}`}
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
