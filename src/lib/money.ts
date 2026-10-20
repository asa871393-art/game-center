/**
 * Money is handled as integer minor units (hundredths) everywhere in app code,
 * matching the Decimal(12,2) columns. Never do arithmetic on floats.
 */
export type Minor = number;

/** "12.50" | 12.5 | Prisma.Decimal -> 1250 */
export function toMinor(value: { toString(): string } | number | string): Minor {
  const str = typeof value === "number" ? value.toFixed(2) : value.toString();
  const match = /^(-)?(\d+)(?:\.(\d{1,}))?$/.exec(str.trim());
  if (!match) throw new Error(`Invalid money value: ${str}`);
  const [, sign, whole, frac = ""] = match;
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  // Round half-up on the third decimal, if any.
  const roundUp = frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0;
  return (sign ? -1 : 1) * (cents + roundUp);
}

/** 1250 -> "12.50" (for Prisma Decimal inputs) */
export function fromMinor(minor: Minor): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Applies basis points (1500 = 15%) with half-up rounding. */
export function applyBps(minor: Minor, bps: number): Minor {
  return Math.round((minor * bps) / 10_000);
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(minor: Minor, currency: string, intlLocale: string): string {
  const key = `${intlLocale}|${currency}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(intlLocale, { style: "currency", currency });
    formatters.set(key, fmt);
  }
  return fmt.format(minor / 100);
}
