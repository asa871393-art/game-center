import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { Decimal } from "@/lib/db/decimal";
import type { ModelName } from "@/lib/db/types";
import type { ModelMeta, ScalarMeta } from "./meta-types";
import { MODELS } from "./schema";

/**
 * Conversion between app values and Firestore fields. Rows inside the data
 * layer are "decoded": Date for timestamps, Decimal for money, null for
 * missing optionals. Firestore stores money as numbers and dates as Timestamps.
 */

export type Row = Record<string, unknown> & { id: string };

/**
 * Hidden creation sequence (`_seq`), the last tie-breaker when sorting, so rows
 * created in the same millisecond keep their insertion order. Never returned to callers.
 */
export const SEQ = "_seq";
let seqCounter = 0;
export function nextSeq(): number {
  seqCounter = (seqCounter + 1) % 1000;
  return Date.now() * 1000 + seqCounter;
}

export function metaOf(model: ModelName): ModelMeta {
  return MODELS[model];
}

export function isFilterObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !(v instanceof Date) && !(v instanceof Decimal) && !Array.isArray(v);
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  throw new Error(`Invalid date: ${String(v)}`);
}

function toDecimalNumber(v: unknown): number {
  if (typeof v === "number") return Number(v.toFixed(2));
  if (v instanceof Decimal) return v.toNumber();
  if (typeof v === "string" || (typeof v === "object" && v !== null)) return Number(Number(String(v)).toFixed(2));
  throw new Error(`Invalid money value: ${String(v)}`);
}

/** Removes undefined (Firestore rejects it inside maps) and turns Decimals into numbers. */
function cleanJson(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Decimal) return v.toNumber();
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(cleanJson);
  if (typeof v === "object" && v !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (val !== undefined) out[k] = cleanJson(val);
    return out;
  }
  return v;
}

/** One field, app value -> Firestore value. */
export function encodeScalar(meta: ScalarMeta, v: unknown): unknown {
  if (v === undefined || v === null) return meta.list ? [] : null;
  switch (meta.type) {
    case "Decimal":
      return toDecimalNumber(v);
    case "DateTime":
      return toDate(v);
    case "Json":
      return cleanJson(v);
    default:
      return v;
  }
}

/** One field, Firestore value -> app value. */
export function decodeScalar(meta: ScalarMeta, v: unknown): unknown {
  if (v === undefined || v === null) return meta.list ? [] : null;
  switch (meta.type) {
    case "Decimal":
      return new Decimal(v as number);
    case "DateTime":
      return toDate(v);
    case "Json":
      return decodeJson(v);
    default:
      return v;
  }
}

function decodeJson(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate();
  if (Array.isArray(v)) return v.map(decodeJson);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, decodeJson(val)]));
  }
  return v;
}

export function decodeRow(model: ModelName, id: string, data: Record<string, unknown>): Row {
  const row: Row = { id };
  for (const [name, meta] of Object.entries(metaOf(model).scalars)) {
    if (name === "id") continue;
    row[name] = decodeScalar(meta, data[name]);
  }
  if (typeof data[SEQ] === "number") row[SEQ] = data[SEQ];
  return row;
}

export function encodeRow(model: ModelName, row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, meta] of Object.entries(metaOf(model).scalars)) {
    if (name === "id") continue;
    out[name] = encodeScalar(meta, row[name]);
  }
  if (typeof row[SEQ] === "number") out[SEQ] = row[SEQ];
  return out;
}

/** Comparable primitive for equality, ordering and grouping. */
export function comparable(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.getTime();
  if (v instanceof Timestamp) return v.toMillis();
  if (v instanceof Decimal) return v.toNumber();
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

/** Normalizes a filter operand for a field (money given as "12.50" compares as a number). */
export function operand(meta: ScalarMeta | undefined, v: unknown): string | number | boolean | null {
  if (meta?.type === "Decimal" && v !== null && v !== undefined) return toDecimalNumber(v);
  if (meta?.type === "DateTime" && v !== null && v !== undefined) return toDate(v).getTime();
  return comparable(v);
}

/** Firestore value for a pushed-down filter operand. */
export function queryOperand(meta: ScalarMeta | undefined, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (meta?.type === "Decimal") return toDecimalNumber(v);
  if (meta?.type === "DateTime") return toDate(v);
  return v;
}

export function cloneRow<T extends Row>(row: T): T {
  return { ...row };
}
