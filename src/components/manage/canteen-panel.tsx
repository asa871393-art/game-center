"use client";

import { Check, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { money } from "@/i18n/format";
import { diffMinutes } from "@/lib/booking/time";
import { markOrderServedAction } from "@/server/actions/pos";
import { OrderDialog } from "./order-dialog";
import { usePos, usePosAction } from "./pos-context";

/** Kitchen queue (orders for seated guests and counter sales) plus the counter-sale entry point. */
export function CanteenPanel({ now }: { now: Date }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const [counterOpen, setCounterOpen] = useState(false);

  const serve = (orderId: string) =>
    run(() => markOrderServedAction({ locale, loungeId: data.lounge.id, orderId }), () => dict.manage.canteen.servedToast);

  const lowStock = data.menuItems.filter((m) => m.stock !== null && m.stock <= m.lowStockAt);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">
            {dict.manage.canteen.queue} <Badge variant="secondary">{data.queue.length}</Badge>
          </h2>
          <Button onClick={() => setCounterOpen(true)}>
            <ShoppingCart aria-hidden /> {dict.manage.canteen.counterSale}
          </Button>
        </div>
        {data.queue.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">{dict.manage.canteen.queueEmpty}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.queue.map((o) => (
              <li key={o.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{o.deviceName ?? dict.manage.canteen.counter}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(dict.manage.canteen.minutesAgo, { count: Math.max(0, diffMinutes(now, new Date(o.createdAt))) })}
                  </span>
                </div>
                <ul className="flex-1 text-sm">
                  {o.items.map((i, idx) => (
                    <li key={idx}>
                      <span className="font-semibold tabular-nums">{i.quantity}×</span> {i.name}
                    </li>
                  ))}
                </ul>
                {o.notes && <p className="rounded-lg bg-amber-500/10 p-2 text-xs">{o.notes}</p>}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {money(locale, o.total, data.lounge.currency)}
                    {o.isPreOrder && ` · ${dict.manage.booking.preOrder}`}
                  </span>
                  <Button size="sm" onClick={() => serve(o.id)} disabled={pending}>
                    <Check aria-hidden /> {dict.manage.canteen.markServed}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside>
        <h2 className="mb-3 font-semibold">{dict.manage.canteen.lowStock}</h2>
        {lowStock.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.manage.canteen.stockOk}</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card text-sm">
            {lowStock.map((m) => (
              <li key={m.id} className="flex justify-between p-2.5">
                <span>{m.name}</span>
                <span className={m.stock === 0 ? "font-semibold text-destructive" : "tabular-nums"}>{m.stock}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <OrderDialog open={counterOpen} onOpenChange={setCounterOpen} />
    </div>
  );
}
