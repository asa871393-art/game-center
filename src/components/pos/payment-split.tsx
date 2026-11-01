"use client";

import { Banknote, CreditCard, Plus, Smartphone, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { money } from "@/i18n/format";
import { toMinor, type Minor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { usePos } from "@/components/manage/pos-context";
import { ZainCashPay, type ZainCashState } from "./zaincash-pay";

export type PayMethod = "CASH" | "CARD" | "ZAINCASH" | "FASTPAY";

export interface PaymentRow {
  key: number;
  method: PayMethod;
  amount: Minor;
  /** Cash handed over (cash rows only). */
  tendered: Minor | null;
  /** ZainCash through the gateway: the payment requested for this row. */
  zainCash?: ZainCashState;
}

/** A row is settled once its ZainCash payment is paid; until then it can't be charged, and after it can't change. */
const zainCashPaid = (r: PaymentRow) => r.zainCash?.status === "PAID";

/** Whether every ZainCash row has been paid through the gateway (always true without the gateway). */
export function paymentsReady(rows: readonly PaymentRow[], gateway: boolean) {
  return !gateway || rows.every((r) => r.method !== "ZAINCASH" || r.amount === 0 || zainCashPaid(r));
}

/** Whether a paid ZainCash payment pins the rows (the bill can't be changed any more). */
export const hasPaidZainCash = (rows: readonly PaymentRow[]) => rows.some(zainCashPaid);

/** The payload for the checkout actions. */
export function paymentParts(rows: readonly PaymentRow[]) {
  return rows
    .filter((r) => r.amount > 0)
    .map((r) => ({
      method: r.method,
      amount: r.amount,
      tendered: r.method === "CASH" && r.tendered !== null && r.tendered >= r.amount ? r.tendered : undefined,
      zainCashPaymentId: r.method === "ZAINCASH" && r.zainCash?.status === "PAID" ? r.zainCash.paymentId : undefined,
    }));
}

export const payMethodMeta: Record<PayMethod, { icon: typeof Banknote }> = {
  CASH: { icon: Banknote },
  CARD: { icon: CreditCard },
  ZAINCASH: { icon: Smartphone },
  FASTPAY: { icon: Wallet },
};

const METHODS: PayMethod[] = ["CASH", "ZAINCASH", "FASTPAY", "CARD"];

let lastRowKey = 0;
/** Stable React keys for payment rows. */
export const nextRowKey = () => ++lastRowKey;

/** Minor units <-> the major-unit text the cashier types (IQD has no fractions in practice). */
const toInput = (minor: Minor) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));
function parseInput(value: string): Minor | null {
  const clean = value.replace(/[^\d.]/g, "");
  if (!clean) return 0;
  try {
    return toMinor(clean);
  } catch {
    return null;
  }
}

/** Banknote-friendly amounts at or above `due` for one-tap "cash given". */
function cashSuggestions(due: Minor): Minor[] {
  const steps = [1_000, 5_000, 10_000, 25_000, 50_000].map((major) => major * 100);
  const out = new Set<Minor>([due]);
  for (const step of steps) out.add(Math.ceil(due / step) * step);
  return [...out].filter((v) => v >= due).sort((a, b) => a - b).slice(0, 4);
}

export function paymentsBalance(rows: readonly PaymentRow[], due: Minor) {
  return due - rows.reduce((s, r) => s + r.amount, 0);
}

export function PaymentSplit({
  rows,
  onChange,
  due,
  currency,
}: {
  rows: PaymentRow[];
  onChange: (rows: PaymentRow[]) => void;
  due: Minor;
  currency: string;
}) {
  const { dict, locale } = useI18n();
  const { data } = usePos();
  const gateway = data.zainCashGateway;
  const remaining = paymentsBalance(rows, due);
  const locked = hasPaidZainCash(rows);
  // Changing a row's method or amount drops its unpaid ZainCash request.
  const update = (key: number, patch: Partial<PaymentRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch, ...("method" in patch || "amount" in patch ? { zainCash: undefined } : {}) } : r)));

  const payAll = (method: PayMethod) => onChange([{ key: nextRowKey(), method, amount: due, tendered: null }]);
  const addRow = () =>
    onChange([
      ...rows,
      {
        key: nextRowKey(),
        method: METHODS.find((m) => !rows.some((r) => r.method === m)) ?? "CARD",
        amount: Math.max(0, remaining),
        tendered: null,
      },
    ]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {METHODS.map((m) => {
          const Icon = payMethodMeta[m].icon;
          const active = rows.length === 1 && rows[0].method === m && rows[0].amount === due;
          return (
            <Button
              key={m}
              variant={active ? "default" : "outline"}
              className="h-14 flex-col gap-0.5 text-sm"
              onClick={() => payAll(m)}
              disabled={locked}
            >
              <Icon className="size-5" aria-hidden />
              {dict.pos.payAll[m]}
            </Button>
          );
        })}
      </div>

      <ul className="space-y-2">
        {rows.map((row) => {
          const change = row.method === "CASH" && row.tendered !== null ? row.tendered - row.amount : null;
          // A requested ZainCash payment fixes its row: cancel the request to change it.
          const fixed = row.zainCash !== undefined && row.zainCash.status !== "FAILED";
          return (
            <li key={row.key} className="space-y-2 rounded-xl border bg-muted/30 p-2.5">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {METHODS.map((m) => {
                    const Icon = payMethodMeta[m].icon;
                    return (
                      <Button
                        key={m}
                        size="icon-lg"
                        variant={row.method === m ? "default" : "ghost"}
                        onClick={() => update(row.key, { method: m, tendered: m === "CASH" ? row.tendered : null })}
                        disabled={fixed}
                        aria-label={dict.pos.method[m]}
                        title={dict.pos.method[m]}
                      >
                        <Icon />
                      </Button>
                    );
                  })}
                </div>
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  className="h-10 flex-1 text-end text-lg font-semibold tabular-nums"
                  value={toInput(row.amount)}
                  onChange={(e) => {
                    const v = parseInput(e.target.value);
                    if (v !== null) update(row.key, { amount: v });
                  }}
                  aria-label={dict.pos.amount}
                  disabled={fixed}
                />
                {rows.length > 1 && !fixed && (
                  <Button size="icon-lg" variant="ghost" onClick={() => onChange(rows.filter((r) => r.key !== row.key))} aria-label={dict.common.close}>
                    <X />
                  </Button>
                )}
              </div>
              {gateway && row.method === "ZAINCASH" && row.amount > 0 && (
                <ZainCashPay
                  loungeId={data.lounge.id}
                  amount={row.amount}
                  state={row.zainCash}
                  onChange={(zainCash) => onChange(rows.map((r) => (r.key === row.key ? { ...r, zainCash } : r)))}
                />
              )}
              {row.method === "CASH" && row.amount > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">{dict.pos.cashGiven}:</span>
                  {cashSuggestions(row.amount).map((v) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={row.tendered === v ? "secondary" : "outline"}
                      onClick={() => update(row.key, { tendered: v })}
                      className="tabular-nums"
                    >
                      {money(locale, v, currency)}
                    </Button>
                  ))}
                  {change !== null && change >= 0 && (
                    <span className="ms-auto font-semibold text-emerald-300">
                      {dict.pos.change}: {money(locale, change, currency)}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={addRow} disabled={remaining <= 0}>
          <Plus aria-hidden /> {dict.pos.splitPayment}
        </Button>
        <span className={cn("text-sm font-semibold tabular-nums", remaining === 0 ? "text-emerald-300" : "text-amber-300")}>
          {remaining === 0
            ? dict.pos.balanced
            : remaining > 0
              ? `${dict.pos.remaining}: ${money(locale, remaining, currency)}`
              : `${dict.pos.over}: ${money(locale, -remaining, currency)}`}
        </span>
      </div>
    </div>
  );
}
