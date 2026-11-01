"use client";

import { Banknote, CreditCard, Loader2, Smartphone } from "lucide-react";
import { useState } from "react";
import { useBillContext } from "@/components/pos/use-live-bill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/client";
import { money } from "@/i18n/format";
import { liveBill } from "@/lib/booking/live-bill";
import { endSessionAction } from "@/server/actions/pos";
import type { PosSession } from "@/server/queries/manage";
import { usePos, usePosAction } from "./pos-context";

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: PosSession;
  deviceName: string;
}

type Method = "CASH" | "CARD" | "ZAINCASH";

/** Ends a session with a single payment. The POS terminal (/pos) offers split payments and receipts. */
export function CheckoutDialog({ open, onOpenChange, session, deviceName }: CheckoutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted per opening, so the bill is frozen at the moment checkout opens. */}
        {open && <CheckoutBody session={session} deviceName={deviceName} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CheckoutBody({ session, deviceName, onDone }: { session: PosSession; deviceName: string; onDone: () => void }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const ctx = useBillContext();
  const { pending, run } = usePosAction();
  const [method, setMethod] = useState<Method>("CASH");
  const [billUntil] = useState(() => new Date());
  const cur = data.lounge.currency;
  const bill = liveBill(session, ctx, billUntil);

  const confirm = () =>
    run(
      () =>
        endSessionAction({
          locale,
          loungeId: data.lounge.id,
          bookingId: session.id,
          version: session.version,
          billUntil: session.mode === "OPEN" ? billUntil.toISOString() : undefined,
          payments: bill.due > 0 ? [{ method, amount: bill.due }] : [],
        }),
      (res) => {
        onDone();
        return res.collected > 0
          ? t(dict.manage.checkout.done, { amount: money(locale, res.collected, cur) })
          : dict.manage.checkout.doneNoPayment;
      },
    );

  const lines: [string, number][] = [
    [dict.booking.playTime, bill.play],
    [dict.booking.canteen, bill.canteen],
    [dict.booking.tax, bill.tax],
  ];

  return (
    <>
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
          <span className="tabular-nums">{money(locale, bill.total, cur)}</span>
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
        <div className="text-3xl font-bold tabular-nums">{money(locale, bill.due, cur)}</div>
      </div>

      {bill.due > 0 ? (
        <div className="space-y-2">
          <div className="text-sm font-medium">{dict.payment.method}</div>
          <ToggleGroup
            value={[method]}
            onValueChange={(v: string[]) => v[0] && setMethod(v[0] as Method)}
            variant="outline"
            className="w-full"
          >
            <ToggleGroupItem value="CASH" className="flex-1">
              <Banknote aria-hidden /> {dict.manage.checkout.CASH}
            </ToggleGroupItem>
            <ToggleGroupItem value="CARD" className="flex-1">
              <CreditCard aria-hidden /> {dict.manage.checkout.CARD}
            </ToggleGroupItem>
            {!data.zainCashGateway && (
              <ToggleGroupItem value="ZAINCASH" className="flex-1">
                <Smartphone aria-hidden /> {dict.pos.method.ZAINCASH}
              </ToggleGroupItem>
            )}
          </ToggleGroup>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground">{dict.manage.checkout.nothingDue}</p>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          {dict.common.cancel}
        </Button>
        <Button onClick={confirm} disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {bill.due > 0 ? dict.manage.checkout.confirm : dict.manage.checkout.confirmNoPay}
        </Button>
      </DialogFooter>
    </>
  );
}
