"use client";

import { CheckCircle2, ExternalLink, Loader2, QrCode, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import type { Minor } from "@/lib/money";
import { cancelZainCashAction, requestZainCashAction } from "@/server/actions/pos";

export interface ZainCashState {
  paymentId: string;
  payUrl: string;
  qrSvg: string;
  status: "PENDING" | "PAID" | "FAILED";
}

const POLL_MS = 2500;
/** ZainCash's minimum, in minor units. */
const MIN_AMOUNT: Minor = 1000 * 100;

/**
 * The ZainCash part of a bill when the gateway is connected: request a payment, show its QR code
 * to the customer and wait until ZainCash confirms it.
 */
export function ZainCashPay({
  loungeId,
  amount,
  state,
  onChange,
}: {
  loungeId: string;
  amount: Minor;
  state: ZainCashState | undefined;
  onChange: (state: ZainCashState | undefined) => void;
}) {
  const { dict, locale } = useI18n();
  const z = dict.zainCash;
  const [pending, startTransition] = useTransition();
  const waitingFor = state?.status === "PENDING" ? state.paymentId : null;
  // The POS re-renders every second (clocks); keep the poll on one timer with the latest callback.
  const latest = useRef({ state, onChange });
  useEffect(() => {
    latest.current = { state, onChange };
  });

  useEffect(() => {
    if (!waitingFor) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/manage/${loungeId}/zaincash/${waitingFor}`, { cache: "no-store" });
        const body = (await res.json()) as { status?: ZainCashState["status"] };
        const current = latest.current.state;
        if (!stop && body.status && body.status !== "PENDING" && current?.paymentId === waitingFor) {
          latest.current.onChange({ ...current, status: body.status });
        }
      } catch {
        // Try again on the next tick.
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [waitingFor, loungeId]);

  const request = () =>
    startTransition(async () => {
      const res = await requestZainCashAction({ locale, loungeId, amount });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onChange({ paymentId: res.data.paymentId, payUrl: res.data.payUrl, qrSvg: res.data.qrSvg, status: "PENDING" });
    });

  const cancel = () =>
    startTransition(async () => {
      if (state) await cancelZainCashAction({ locale, loungeId, paymentId: state.paymentId });
      onChange(undefined);
    });

  if (!state) {
    return (
      <Button variant="secondary" className="h-11 w-full" onClick={request} disabled={pending || amount < MIN_AMOUNT || amount % 100 !== 0}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <QrCode aria-hidden />}
        {z.request}
      </Button>
    );
  }

  if (state.status === "PAID") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-500/15 p-2 text-sm font-semibold text-emerald-300">
        <CheckCircle2 className="size-5" aria-hidden /> {z.paid}
      </div>
    );
  }

  if (state.status === "FAILED") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-rose-500/15 p-2 text-sm">
        <span className="flex items-center gap-2 font-semibold text-rose-300">
          <XCircle className="size-5" aria-hidden /> {z.failed}
        </span>
        <Button size="sm" variant="outline" onClick={() => onChange(undefined)}>
          <RotateCcw aria-hidden /> {z.retry}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border bg-background p-3 text-center">
      <p className="text-sm font-medium">{z.scan}</p>
      <div
        className="size-48 rounded-md bg-white p-1 [&_svg]:size-full"
        role="img"
        aria-label={z.scan}
        // Generated on our server by the qrcode library from ZainCash's payment URL.
        dangerouslySetInnerHTML={{ __html: state.qrSvg }}
      />
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {z.waiting}
      </p>
      <div className="flex gap-2">
        <a href={state.payUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
          <ExternalLink className="size-3" aria-hidden /> {z.openLink}
        </a>
        <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>
          {z.cancel}
        </Button>
      </div>
    </div>
  );
}
