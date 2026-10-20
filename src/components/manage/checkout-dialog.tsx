"use client";

import { Banknote, CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/client";
import { money } from "@/i18n/format";
import { endSessionAction } from "@/server/actions/pos";
import type { PosSession } from "@/server/queries/manage";
import { usePos, usePosAction } from "./pos-context";

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: PosSession;
  deviceName: string;
}

/** Ends a session: shows the bill, takes the balance in cash or card, frees the seat. */
export function CheckoutDialog({ open, onOpenChange, session, deviceName }: CheckoutDialogProps) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const [method, setMethod] = useState<"CASH" | "CARD">("CASH");
  const cur = data.lounge.currency;
  const due = Math.max(0, session.totalPrice - session.amountPaid);

  const confirm = () =>
    run(
      () =>
        endSessionAction({
          locale,
          loungeId: data.lounge.id,
          bookingId: session.id,
          version: session.version,
          payment: due > 0 ? { method, amount: due } : null,
        }),
      (res) => {
        onOpenChange(false);
        return res.collected > 0
          ? t(dict.manage.checkout.done, { amount: money(locale, res.collected, cur) })
          : dict.manage.checkout.doneNoPayment;
      },
    );

  const lines: [string, number][] = [
    [dict.booking.playTime, session.playSubtotal],
    [dict.booking.canteen, session.canteenSubtotal],
    [dict.booking.tax, session.taxTotal],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(dict.manage.checkout.title, { device: deviceName })}</DialogTitle>
          <DialogDescription>{session.guestLabel ?? dict.manage.session.walkInGuest}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 text-sm">
          {lines
            .filter(([, v]) => v > 0)
            .map(([label, v]) => (
              <div key={label} className="flex justify-between">
                <span className="text-muted-foreground">{label}</span>
                <span className="tabular-nums">{money(locale, v, cur)}</span>
              </div>
            ))}
          <div className="flex justify-between border-t pt-1.5 font-semibold">
            <span>{dict.common.total}</span>
            <span className="tabular-nums">{money(locale, session.totalPrice, cur)}</span>
          </div>
          {session.amountPaid > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{dict.manage.session.paid}</span>
              <span className="tabular-nums">−{money(locale, session.amountPaid, cur)}</span>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-primary/10 p-4 text-center">
          <div className="text-xs font-medium text-muted-foreground">{dict.manage.checkout.amountDue}</div>
          <div className="text-3xl font-bold tabular-nums">{money(locale, due, cur)}</div>
        </div>

        {due > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">{dict.payment.method}</div>
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
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">{dict.manage.checkout.nothingDue}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {dict.common.cancel}
          </Button>
          <Button onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {due > 0 ? dict.manage.checkout.confirm : dict.manage.checkout.confirmNoPay}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
