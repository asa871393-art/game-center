"use client";

import { Banknote, CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/client";
import { money } from "@/i18n/format";
import { applyBps } from "@/lib/money";
import { addSessionOrderAction, counterSaleAction } from "@/server/actions/pos";
import type { PosSession } from "@/server/queries/manage";
import { cartLines, cartSubtotal, MenuPicker, type Cart } from "./menu-picker";
import { usePos, usePosAction } from "./pos-context";

interface OrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bill the order to this seat; omitted for a paid-on-the-spot counter sale. */
  session?: PosSession;
  deviceName?: string;
}

export function OrderDialog({ open, onOpenChange, session, deviceName }: OrderDialogProps) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const [cart, setCart] = useState<Cart>({});
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<"CASH" | "CARD">("CASH");
  const cur = data.lounge.currency;

  const items = cartLines(cart);
  const subtotal = cartSubtotal(cart, data.menuItems);
  const total = subtotal + applyBps(subtotal, data.lounge.taxRateBps);

  const close = (next: boolean) => {
    if (!next) {
      setCart({});
      setNotes("");
    }
    onOpenChange(next);
  };

  const submit = () => {
    const common = { locale, loungeId: data.lounge.id, items, notes: notes || undefined };
    if (session) {
      run(
        () => addSessionOrderAction({ ...common, bookingId: session.id }),
        () => {
          close(false);
          return t(dict.manage.canteen.ordered, { device: deviceName ?? "" });
        },
      );
    } else {
      run(
        () => counterSaleAction({ ...common, method }),
        (res) => {
          close(false);
          return t(dict.manage.canteen.sold, { amount: money(locale, res.total, cur) });
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {session ? t(dict.manage.canteen.orderFor, { device: deviceName ?? "" }) : dict.manage.canteen.counterSale}
          </DialogTitle>
          <DialogDescription>{session ? dict.manage.canteen.orderHint : dict.manage.canteen.counterHint}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          <MenuPicker cart={cart} onChange={setCart} />
        </div>

        <div className="space-y-3 border-t pt-3">
          <Input
            placeholder={dict.manage.canteen.notes}
            value={notes}
            maxLength={200}
            onChange={(e) => setNotes(e.target.value)}
          />
          {!session && (
            <ToggleGroup
              value={[method]}
              onValueChange={(v: string[]) => v[0] && setMethod(v[0] as "CASH" | "CARD")}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem value="CASH" className="flex-1">
                <Banknote aria-hidden /> {dict.manage.checkout.CASH}
              </ToggleGroupItem>
              <ToggleGroupItem value="CARD" className="flex-1">
                <CreditCard aria-hidden /> {dict.manage.checkout.CARD}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-lg font-semibold tabular-nums">{money(locale, total, cur)}</span>
          <Button onClick={submit} disabled={pending || items.length === 0}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {session ? dict.manage.canteen.addToBill : t(dict.manage.canteen.charge, { amount: money(locale, total, cur) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
