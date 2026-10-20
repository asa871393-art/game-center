"use client";

import { CheckCircle2, Loader2, LockKeyhole, Minus, Plus, Printer, Unlock } from "lucide-react";
import { useState } from "react";
import { usePos, usePosAction } from "@/components/manage/pos-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { formatTime, money } from "@/i18n/format";
import { toMinor, type Minor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { closeShiftAction, openShiftAction } from "@/server/actions/pos";
import type { PosBoardData } from "@/server/queries/manage";
import { printShiftReport } from "./print";

type ShiftData = NonNullable<PosBoardData["shift"]>;

/** Iraqi dinar banknotes, in minor units, for counting the drawer. */
const DENOMINATIONS: Minor[] = [50_000, 25_000, 10_000, 5_000, 1_000, 500, 250].map((d) => d * 100);
const FLOAT_PRESETS: Minor[] = [0, 25_000, 50_000, 100_000].map((d) => d * 100);

const toInput = (minor: Minor) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));
function parseMoney(raw: string): Minor | null {
  const clean = raw.replace(/[^\d.]/g, "");
  if (!clean) return 0;
  try {
    return toMinor(clean);
  } catch {
    return null;
  }
}

/** Top-bar shift block: cashier, shift start, live cash in drawer, and open/close actions. */
export function ShiftBar() {
  const { dict, locale } = useI18n();
  const { data } = usePos();
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const shift = data.shift;
  const tz = data.lounge.timezone;

  if (!shift) {
    return (
      <>
        <Button size="lg" className="h-12 bg-amber-500 text-black hover:bg-amber-400" onClick={() => setOpenDialog(true)}>
          <Unlock aria-hidden /> {dict.shift.open}
        </Button>
        <OpenShiftDialog open={openDialog} onOpenChange={setOpenDialog} />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-1.5">
        <div className="text-xs leading-tight">
          <div className="font-semibold">{shift.cashier}</div>
          <div className="text-muted-foreground" suppressHydrationWarning>
            {dict.shift.since} {formatTime(locale, shift.openedAt, tz)}
          </div>
        </div>
        <div className="border-s ps-3 text-xs leading-tight">
          <div className="text-muted-foreground">{dict.shift.cashInDrawer}</div>
          <div className="text-base font-bold tabular-nums text-emerald-300">{money(locale, shift.expectedCash, data.lounge.currency)}</div>
        </div>
        <Button variant="outline" className="h-10" onClick={() => setCloseDialog(true)}>
          <LockKeyhole aria-hidden /> <span className="hidden lg:inline">{dict.shift.close}</span>
        </Button>
      </div>
      <CloseShiftDialog open={closeDialog} onOpenChange={setCloseDialog} shift={shift} />
    </>
  );
}

function OpenShiftDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { dict, locale } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const [float, setFloat] = useState<Minor>(0);
  const cur = data.lounge.currency;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dict.shift.openTitle}</DialogTitle>
          <DialogDescription>{dict.shift.openHint}</DialogDescription>
        </DialogHeader>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{dict.shift.openingFloat}</span>
          <Input
            inputMode="decimal"
            dir="ltr"
            autoFocus
            className="h-14 text-end text-2xl font-bold tabular-nums"
            value={toInput(float)}
            onChange={(e) => {
              const v = parseMoney(e.target.value);
              if (v !== null) setFloat(v);
            }}
          />
        </label>
        <div className="grid grid-cols-4 gap-2">
          {FLOAT_PRESETS.map((v) => (
            <Button key={v} variant={float === v ? "secondary" : "outline"} className="h-11 tabular-nums" onClick={() => setFloat(v)}>
              {money(locale, v, cur)}
            </Button>
          ))}
        </div>
        <Button
          size="lg"
          className="h-14 text-lg"
          disabled={pending}
          onClick={() =>
            run(
              () => openShiftAction({ locale, loungeId: data.lounge.id, openingFloat: float }),
              () => {
                onOpenChange(false);
                return dict.shift.opened;
              },
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Unlock aria-hidden />}
          {dict.shift.open}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

interface CloseResult {
  shiftId: string;
  expected: Minor;
  counted: Minor;
  variance: Minor;
}

function CloseShiftDialog({ open, onOpenChange, shift }: { open: boolean; onOpenChange: (o: boolean) => void; shift: ShiftData }) {
  const [result, setResult] = useState<CloseResult | null>(null);
  const close = (o: boolean) => {
    if (!o) setResult(null);
    onOpenChange(o);
  };
  return (
    <Dialog open={open || !!result} onOpenChange={close}>
      <DialogContent className="flex max-h-[94dvh] flex-col sm:max-w-2xl">
        {result ? (
          <ClosedView result={result} onDone={() => close(false)} />
        ) : (
          open && <CloseForm shift={shift} onClosed={setResult} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CloseForm({ shift, onClosed }: { shift: ShiftData; onClosed: (r: CloseResult) => void }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const cur = data.lounge.currency;
  const m = (v: Minor) => money(locale, v, cur);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [manual, setManual] = useState<Minor | null>(null);
  const [notes, setNotes] = useState("");
  const fromNotes = DENOMINATIONS.reduce((s, d) => s + d * (counts[d] ?? 0), 0);
  const counted = manual ?? fromNotes;
  const variance = counted - shift.expectedCash;
  const setCount = (d: Minor, n: number) => {
    setManual(null);
    setCounts({ ...counts, [d]: Math.max(0, n) });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{dict.shift.closeTitle}</DialogTitle>
        <DialogDescription>
          {shift.cashier} · {dict.shift.since} {formatTime(locale, shift.openedAt, data.lounge.timezone)}
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
        <section className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Stat label={dict.shift.sessions} value={String(shift.sessions)} />
          <Stat label={dict.shift.counterSales} value={String(shift.counterSales)} />
          <Stat label={dict.receipt.gaming} value={m(shift.gaming)} />
          <Stat label={dict.receipt.canteen} value={m(shift.canteen)} />
        </section>

        <section className="rounded-xl border p-3 text-sm">
          <div className="mb-1 font-semibold">{dict.shift.byMethod}</div>
          {shift.byMethod.length === 0 ? (
            <div className="text-muted-foreground">{dict.shift.noPayments}</div>
          ) : (
            shift.byMethod.map((r) => (
              <div key={r.method} className="flex justify-between py-0.5">
                <span>
                  {dict.receipt.paymentMethod[r.method]} <span className="text-muted-foreground">×{r.count}</span>
                </span>
                <span className="tabular-nums">{m(r.amount)}</span>
              </div>
            ))
          )}
          {shift.discounts > 0 && (
            <div className="flex justify-between py-0.5 text-muted-foreground">
              <span>{dict.receipt.discount}</span>
              <span className="tabular-nums">−{m(shift.discounts)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>{dict.shift.totalCollected}</span>
            <span className="tabular-nums">{m(shift.totalCollected)}</span>
          </div>
        </section>

        <section className="rounded-xl border p-3">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-semibold">{dict.shift.countDrawer}</span>
            <span className="text-muted-foreground">
              {dict.shift.openingFloat}: {m(shift.openingFloat)} + {dict.shift.cashTaken}: {m(shift.cashNet)}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {DENOMINATIONS.map((d) => (
              <div key={d} className="flex items-center gap-2 rounded-lg bg-muted/40 p-1.5">
                <span className="w-24 text-sm font-medium tabular-nums">{m(d)}</span>
                <Button size="icon-lg" variant="outline" onClick={() => setCount(d, (counts[d] ?? 0) - 1)} aria-label="−">
                  <Minus />
                </Button>
                <Input
                  inputMode="numeric"
                  dir="ltr"
                  className="h-10 w-16 text-center tabular-nums"
                  value={counts[d] ?? 0}
                  onChange={(e) => setCount(d, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0))}
                  aria-label={m(d)}
                />
                <Button size="icon-lg" variant="outline" onClick={() => setCount(d, (counts[d] ?? 0) + 1)} aria-label="+">
                  <Plus />
                </Button>
              </div>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{dict.shift.orEnterTotal}</span>
            <Input
              inputMode="decimal"
              dir="ltr"
              className="h-10 flex-1 text-end font-semibold tabular-nums"
              value={toInput(counted)}
              onChange={(e) => {
                const v = parseMoney(e.target.value);
                if (v !== null) setManual(v);
              }}
            />
          </label>
        </section>

        <section className="grid grid-cols-3 gap-2 text-center">
          <Stat label={dict.shift.expected} value={m(shift.expectedCash)} />
          <Stat label={dict.shift.counted} value={m(counted)} />
          <Stat
            label={dict.shift.variance}
            value={`${variance > 0 ? "+" : variance < 0 ? "−" : ""}${m(Math.abs(variance))}`}
            tone={variance === 0 ? "ok" : variance > 0 ? "over" : "short"}
            hint={variance === 0 ? dict.shift.balanced : variance > 0 ? dict.shift.over : dict.shift.short}
          />
        </section>

        <Textarea placeholder={dict.shift.notes} value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <Button
        size="lg"
        className="h-14 text-lg"
        disabled={pending}
        onClick={() => {
          if (variance !== 0 && !window.confirm(t(dict.shift.confirmVariance, { amount: m(Math.abs(variance)) }))) return;
          run(
            () => closeShiftAction({ locale, loungeId: data.lounge.id, shiftId: shift.id, countedCash: counted, notes: notes || undefined }),
            (res) => {
              onClosed(res);
              return dict.shift.closed;
            },
          );
        }}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LockKeyhole aria-hidden />}
        {dict.shift.close}
      </Button>
    </>
  );
}

function ClosedView({ result, onDone }: { result: CloseResult; onDone: () => void }) {
  const { dict, locale } = useI18n();
  const { data } = usePos();
  const m = (v: Minor) => money(locale, v, data.lounge.currency);
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <DialogTitle className="sr-only">{dict.shift.closed}</DialogTitle>
      <CheckCircle2 className="size-14 text-emerald-400" aria-hidden />
      <div className="text-xl font-bold">{dict.shift.closed}</div>
      <div className="grid w-full grid-cols-3 gap-2">
        <Stat label={dict.shift.expected} value={m(result.expected)} />
        <Stat label={dict.shift.counted} value={m(result.counted)} />
        <Stat
          label={dict.shift.variance}
          value={`${result.variance > 0 ? "+" : result.variance < 0 ? "−" : ""}${m(Math.abs(result.variance))}`}
          tone={result.variance === 0 ? "ok" : result.variance > 0 ? "over" : "short"}
        />
      </div>
      <div className="grid w-full max-w-sm grid-cols-2 gap-2">
        <Button size="lg" className="h-14" onClick={() => printShiftReport(locale, result.shiftId)}>
          <Printer aria-hidden /> {dict.shift.printReport}
        </Button>
        <Button size="lg" variant="outline" className="h-14" onClick={onDone}>
          {dict.common.close}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "ok" | "over" | "short"; hint?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-2.5",
        tone === "ok" && "border-emerald-500/50 bg-emerald-500/10",
        tone === "over" && "border-sky-500/50 bg-sky-500/10",
        tone === "short" && "border-rose-500/50 bg-rose-500/10",
      )}
    >
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[11px]">{hint}</div>}
    </div>
  );
}
