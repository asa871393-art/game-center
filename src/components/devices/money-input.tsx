"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { toMinor, type Minor } from "@/lib/money";
import { cn } from "@/lib/utils";

const toText = (minor: Minor | null) => (minor === null ? "" : minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

/**
 * Money field in major units (dinars). Empty = null when `nullable`, so
 * "use the default" stays distinct from zero.
 */
export function MoneyInput({
  value,
  onChange,
  nullable,
  placeholder,
  className,
  id,
  ...aria
}: {
  value: Minor | null;
  onChange: (v: Minor | null) => void;
  nullable?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  // Keep the raw text while typing so "12." isn't reformatted under the cursor.
  const [text, setText] = useState(() => toText(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (parse(text) !== value) setText(toText(value));
  }

  function parse(raw: string): Minor | null | undefined {
    const clean = raw.replace(/[^\d.]/g, "");
    if (!clean) return nullable ? null : 0;
    try {
      return toMinor(clean);
    } catch {
      return undefined;
    }
  }

  return (
    <Input
      id={id}
      inputMode="decimal"
      dir="ltr"
      className={cn("h-11 text-end tabular-nums", className)}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parse(e.target.value);
        if (v !== undefined) onChange(v);
      }}
      {...aria}
    />
  );
}
