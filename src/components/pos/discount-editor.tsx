"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { money } from "@/i18n/format";
import { toMinor, type Minor } from "@/lib/money";

/** A bill discount as the cashier enters it: a fixed amount (minor units) or a whole percentage. */
export type DiscountInput = { kind: "amount"; value: Minor } | { kind: "percent"; value: number };

/** Discount in minor units on `subtotal` (play + canteen, before tax), never more than the subtotal. */
export function discountAmount(d: DiscountInput, subtotal: Minor): Minor {
  const raw = d.kind === "percent" ? Math.round((subtotal * Math.min(100, Math.max(0, d.value))) / 100) : Math.max(0, d.value);
  return Math.min(subtotal, raw);
}

const PRESETS = [5, 10, 15, 20, 50];

export function DiscountEditor({
  value,
  onChange,
  currency,
}: {
  value: DiscountInput;
  onChange: (d: DiscountInput) => void;
  currency: string;
}) {
  const { dict, locale } = useI18n();
  const text = value.kind === "percent" ? String(value.value) : value.value % 100 === 0 ? String(value.value / 100) : (value.value / 100).toFixed(2);

  const parse = (raw: string) => {
    const clean = raw.replace(/[^\d.]/g, "");
    if (value.kind === "percent") return onChange({ kind: "percent", value: Math.min(100, Math.floor(Number(clean) || 0)) });
    try {
      onChange({ kind: "amount", value: clean ? toMinor(clean) : 0 });
    } catch {
      /* ignore partial input */
    }
  };

  return (
    <div className="space-y-2 rounded-xl border p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{dict.receipt.discount}</span>
        <div className="ms-auto flex rounded-lg border p-0.5">
          <Button
            size="sm"
            variant={value.kind === "amount" ? "default" : "ghost"}
            onClick={() => onChange({ kind: "amount", value: 0 })}
          >
            {dict.pos.amount}
          </Button>
          <Button size="sm" variant={value.kind === "percent" ? "default" : "ghost"} onClick={() => onChange({ kind: "percent", value: 0 })}>
            %
          </Button>
        </div>
        <Input
          inputMode="decimal"
          dir="ltr"
          className="h-10 w-32 text-end text-lg font-semibold tabular-nums"
          value={text}
          onChange={(e) => parse(e.target.value)}
          aria-label={dict.receipt.discount}
        />
      </div>
      {value.kind === "amount" && value.value > 0 && (
        <div className="text-end text-xs text-muted-foreground tabular-nums">{money(locale, value.value, currency)}</div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={value.kind === "percent" && value.value === p ? "secondary" : "outline"}
            onClick={() => onChange({ kind: "percent", value: p })}
          >
            {p}%
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onChange({ kind: "amount", value: 0 })}>
          {dict.pos.noDiscount}
        </Button>
      </div>
    </div>
  );
}
