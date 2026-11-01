"use client";

import { Loader2, ShoppingCart, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cartLines, cartSubtotal, MenuPicker, type Cart } from "@/components/manage/menu-picker";
import { usePos, usePosAction } from "@/components/manage/pos-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { localName, money } from "@/i18n/format";
import { applyBps } from "@/lib/money";
import { counterSaleAction } from "@/server/actions/pos";
import { hasPaidZainCash, nextRowKey, PaymentSplit, paymentParts, paymentsBalance, paymentsReady, type PaymentRow } from "./payment-split";
import { printReceipt } from "./print";

/**
 * Walk-in canteen sales for guests who aren't playing: tap items, take payment
 * (split allowed), optionally print a receipt. Docked beside the device grid.
 */
export function CounterPanel() {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const [cart, setCart] = useState<Cart>({});
  const [step, setStep] = useState<"items" | "pay">("items");
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const cur = data.lounge.currency;

  const items = cartLines(cart);
  const subtotal = cartSubtotal(cart, data.menuItems);
  const total = subtotal + applyBps(subtotal, data.lounge.taxRateBps);
  const balanced = paymentsBalance(rows, total) === 0 && rows.every((r) => r.amount > 0) && paymentsReady(rows, data.zainCashGateway);
  // A paid ZainCash payment fixes the sale: the cart can't change any more.
  const locked = hasPaidZainCash(rows);
  const count = items.reduce((n, i) => n + i.quantity, 0);

  const reset = () => {
    setCart({});
    setRows([]);
    setStep("items");
  };
  const toPay = () => {
    setRows([{ key: nextRowKey(), method: "CASH", amount: total, tendered: null }]);
    setStep("pay");
  };
  const charge = () =>
    run(
      () =>
        counterSaleAction({
          locale,
          loungeId: data.lounge.id,
          items,
          payments: paymentParts(rows),
        }),
      (res) => {
        reset();
        toast.success(t(dict.manage.canteen.sold, { amount: money(locale, res.total, cur) }), {
          action: { label: dict.pos.printReceipt, onClick: () => printReceipt(locale, res.orderId) },
          duration: 8_000,
        });
      },
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShoppingCart className="size-5" aria-hidden /> {dict.manage.canteen.counterSale}
        </h2>
        {count > 0 && (
          <Button variant="ghost" size="sm" onClick={reset} disabled={pending || locked}>
            <Trash2 aria-hidden /> {dict.pos.clearCart}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {step === "items" ? (
          <MenuPicker cart={cart} onChange={setCart} />
        ) : (
          <div className="space-y-3">
            <ul className="divide-y rounded-xl border text-sm">
              {items.map((l) => {
                const item = data.menuItems.find((m) => m.id === l.menuItemId)!;
                return (
                  <li key={l.menuItemId} className="flex justify-between gap-2 p-2">
                    <span>
                      {l.quantity}× {localName(locale, item)}
                    </span>
                    <span className="tabular-nums">{money(locale, item.price * l.quantity, cur)}</span>
                  </li>
                );
              })}
            </ul>
            <PaymentSplit rows={rows} onChange={setRows} due={total} currency={cur} />
            {!data.shift && (
              <p className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 text-sm text-amber-200">{dict.shift.requiredToPay}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">{t(dict.pos.itemsCount, { count })}</span>
          <span className="text-2xl font-bold tabular-nums">{money(locale, total, cur)}</span>
        </div>
        {step === "items" ? (
          <Button size="lg" className="h-14 w-full text-lg" disabled={count === 0} onClick={toPay}>
            {dict.pos.toPayment}
          </Button>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button size="lg" variant="outline" className="h-14" onClick={() => setStep("items")} disabled={pending || locked}>
              {dict.common.back}
            </Button>
            <Button size="lg" className="h-14 text-lg" onClick={charge} disabled={pending || !balanced || !data.shift}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {t(dict.manage.canteen.charge, { amount: money(locale, total, cur) })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
