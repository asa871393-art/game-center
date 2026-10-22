import "server-only";
import type { ModelName } from "@/lib/db/types";
import type { Row } from "./codec";

/**
 * Integrity rules the Postgres schema enforced and Firestore can't: partial
 * unique keys, check constraints and the booking overlap rule. The data layer
 * checks them inside the writing transaction, so concurrent writers serialize
 * on the same key documents (see session.ts).
 */

export class DbConstraintError extends Error {
  constructor(
    /** Postgres-style codes the services already test for: P2002 unique, 23P01 overlap, 23514 check, P2003 foreign key. */
    public readonly code: "P2002" | "23P01" | "23514" | "P2003" | "P2025",
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DbConstraintError";
  }
}

export interface PartialUnique {
  name: string;
  fields: string[];
  where: (row: Row) => boolean;
}

export const PARTIAL_UNIQUES: Partial<Record<ModelName, PartialUnique[]>> = {
  Shift: [{ name: "Shift_one_open_per_lounge", fields: ["loungeId"], where: (r) => r.status === "OPEN" }],
  SessionSegment: [{ name: "SessionSegment_one_running_per_booking", fields: ["bookingId"], where: (r) => r.endedAt === null }],
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(String(v)));
const nonNegative = (row: Row, fields: string[]) => fields.every((f) => num(row[f]) === null || num(row[f])! >= 0);

/** Row-level CHECK constraints; each returns the violated constraint's name or null. */
export const CHECKS: Partial<Record<ModelName, ((row: Row) => string | null)[]>> = {
  Booking: [
    (r) => ((r.scheduledEnd as Date) > (r.scheduledStart as Date) ? null : "Booking_time_order_chk"),
    (r) => ((r.players as number) >= 1 ? null : "Booking_players_chk"),
    (r) =>
      nonNegative(r, ["hourlyRate", "playSubtotal", "canteenSubtotal", "discountTotal", "taxTotal", "totalPrice", "amountPaid"])
        ? null
        : "Booking_money_chk",
    (r) => ((r.pausedMinutes as number) >= 0 ? null : "Booking_paused_chk"),
  ],
  MenuItem: [
    (r) => (nonNegative(r, ["price"]) ? null : "MenuItem_price_chk"),
    (r) => (nonNegative(r, ["stockQuantity"]) ? null : "MenuItem_stock_chk"),
    (r) => (nonNegative(r, ["lowStockAt"]) ? null : "MenuItem_low_stock_chk"),
  ],
  CanteenOrderItem: [(r) => ((r.quantity as number) > 0 && nonNegative(r, ["unitPrice"]) ? null : "CanteenOrderItem_qty_chk")],
  Transaction: [(r) => (num(r.amount)! > 0 ? null : "Transaction_amount_chk")],
  Wallet: [(r) => (nonNegative(r, ["balance"]) ? null : "Wallet_balance_chk")],
  Shift: [(r) => (nonNegative(r, ["openingFloat", "countedCash"]) ? null : "Shift_money_chk")],
  SessionSegment: [
    (r) => (r.endedAt === null || (r.endedAt as Date) >= (r.startedAt as Date) ? null : "SessionSegment_time_chk"),
    (r) => (nonNegative(r, ["minutes", "amount"]) ? null : "SessionSegment_money_chk"),
  ],
};

/** Booking statuses that hold a device (the former exclusion constraint's WHERE). */
export const OVERLAP_STATUSES = ["PENDING", "CONFIRMED", "ACTIVE"];

/** Collections whose changes are broadcast to the lounge's live screens, with the table names clients expect. */
export const REALTIME_TABLES: Partial<Record<ModelName, string>> = {
  Booking: "Booking",
  Device: "Device",
  CanteenOrder: "CanteenOrder",
  Shift: "Shift",
  ShiftExpense: "ShiftExpense",
  MenuItem: "MenuItem",
  MenuCategory: "MenuCategory",
};

export const EVENTS_COLLECTION = "loungeEvents";
export const UNIQUES_COLLECTION = "_uniques";
export const LOCKS_COLLECTION = "_locks";
/** Lounge events are only needed while screens catch up; a Firestore TTL policy on expireAt deletes them. */
export const EVENT_TTL_MS = 24 * 60 * 60_000;
