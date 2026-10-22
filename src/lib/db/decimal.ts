/**
 * Money read from Firestore. Stored as a plain number (two decimals at most);
 * read back as this wrapper so it behaves like the former Prisma Decimal: always
 * truthy (a zero variance is still "set"), exact via toString(), and never
 * accidentally added as a float. Convert with toMinor() from "@/lib/money".
 */
export class Decimal {
  private readonly value: string;

  constructor(value: number | string | { toString(): string }) {
    const n = typeof value === "number" ? value : Number(value.toString());
    if (!Number.isFinite(n)) throw new Error(`Invalid decimal: ${String(value)}`);
    this.value = n.toFixed(2);
  }

  toString(): string {
    return this.value;
  }

  toNumber(): number {
    return Number(this.value);
  }

  valueOf(): number {
    return this.toNumber();
  }

  toJSON(): string {
    return this.value;
  }
}
