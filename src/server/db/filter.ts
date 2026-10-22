import "server-only";
import type { ModelName } from "@/lib/db/types";
import { comparable, isFilterObject, metaOf, operand, SEQ, type Row } from "./codec";
import type { ScalarMeta } from "./meta-types";

/**
 * Prisma-style filters evaluated in memory (with SQL NULL semantics), and the
 * part of a filter that can be pushed down to Firestore as a query.
 */

type Prim = string | number | boolean | null;

const FILTER_OPS = new Set(["equals", "in", "notIn", "not", "lt", "lte", "gt", "gte", "contains", "startsWith", "endsWith", "mode"]);

function eq(meta: ScalarMeta | undefined, value: unknown, target: unknown): boolean {
  const a = comparable(value);
  const b = operand(meta, target);
  return a !== null && b !== null && a === b;
}

function cmp(a: Prim, b: Prim): number {
  if (a === b) return 0;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}

/** Scalar condition: a literal (equality), null (IS NULL) or a filter object. */
export function matchScalar(meta: ScalarMeta | undefined, value: unknown, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (cond === null) return value === null || value === undefined;
  if (!isFilterObject(cond)) return eq(meta, value, cond);

  const isNull = value === null || value === undefined;
  const insensitive = cond.mode === "insensitive";
  const str = (v: unknown) => (insensitive ? String(v).toLowerCase() : String(v));
  for (const [op, arg] of Object.entries(cond)) {
    if (arg === undefined || op === "mode") continue;
    switch (op) {
      case "equals":
        if (arg === null ? !isNull : isNull || (insensitive && typeof value === "string" ? str(value) !== str(arg) : !eq(meta, value, arg))) {
          return false;
        }
        break;
      case "in":
        if (isNull || !(arg as unknown[]).some((v) => eq(meta, value, v))) return false;
        break;
      case "notIn":
        if (isNull || (arg as unknown[]).some((v) => eq(meta, value, v))) return false;
        break;
      case "not":
        if (arg === null) {
          if (isNull) return false;
        } else if (isFilterObject(arg)) {
          if (isNull || matchScalar(meta, value, arg)) return false;
        } else if (isNull || eq(meta, value, arg)) {
          return false;
        }
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte": {
        if (isNull) return false;
        const c = cmp(comparable(value), operand(meta, arg));
        if ((op === "lt" && !(c < 0)) || (op === "lte" && !(c <= 0)) || (op === "gt" && !(c > 0)) || (op === "gte" && !(c >= 0))) {
          return false;
        }
        break;
      }
      case "contains":
        if (isNull || !str(value).includes(str(arg))) return false;
        break;
      case "startsWith":
        if (isNull || !str(value).startsWith(str(arg))) return false;
        break;
      case "endsWith":
        if (isNull || !str(value).endsWith(str(arg))) return false;
        break;
      default:
        throw new Error(`Unsupported filter operator "${op}"`);
    }
  }
  return true;
}

// -----------------------------------------------------------------------------
// Pushdown planning
// -----------------------------------------------------------------------------

export type RangeOp = "<" | "<=" | ">" | ">=";

export interface QueryPlan {
  /** Equality filters (null allowed). */
  eq: [string, unknown][];
  /** At most one `in` filter; values are de-duplicated. */
  inFilter?: [string, unknown[]];
  ranges: [string, RangeOp, unknown][];
  /** True when the plan expresses the whole filter (nothing left for memory). */
  exact: boolean;
}

const RANGE_OPS: Record<string, RangeOp> = { lt: "<", lte: "<=", gt: ">", gte: ">=" };
const RANGE_TYPES = new Set(["DateTime", "Int", "Float", "Decimal"]);

function emptyPlan(): QueryPlan {
  return { eq: [], ranges: [], exact: true };
}

/** Adds the pushable parts of `where` to `plan`. Returns false if the filter can never match (`in: []`). */
function collect(model: ModelName, where: Record<string, unknown>, plan: QueryPlan): boolean {
  const scalars = metaOf(model).scalars;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "AND") {
      for (const part of Array.isArray(cond) ? cond : [cond]) if (!collect(model, part as Record<string, unknown>, plan)) return false;
      continue;
    }
    const meta = scalars[key];
    if (!meta || meta.list || meta.type === "Json") {
      plan.exact = false;
      continue;
    }
    if (!isFilterObject(cond)) {
      plan.eq.push([key, cond]);
      continue;
    }
    if (cond.mode === "insensitive") {
      plan.exact = false;
      continue;
    }
    for (const [op, arg] of Object.entries(cond)) {
      if (arg === undefined) continue;
      if (!FILTER_OPS.has(op)) throw new Error(`Unsupported filter operator "${op}" on ${model}.${key}`);
      if (op === "equals") plan.eq.push([key, arg]);
      else if (op === "in") {
        const values = [...new Set((arg as unknown[]).filter((v) => v !== null && v !== undefined))];
        if (values.length === 0) return false;
        if (!plan.inFilter) plan.inFilter = [key, values];
        else plan.exact = false;
      } else if (RANGE_OPS[op] && RANGE_TYPES.has(meta.type) && arg !== null) {
        plan.ranges.push([key, RANGE_OPS[op], arg]);
      } else plan.exact = false;
    }
  }
  return true;
}

/**
 * Query plans whose union covers every row `where` can match. Usually one;
 * a top-level OR whose branches are all selective becomes one query per branch.
 * Returns null when nothing can match.
 */
export function planQueries(model: ModelName, where: Record<string, unknown>): QueryPlan[] | null {
  const { OR, ...rest } = where;
  const base = emptyPlan();
  if (!collect(model, rest, base)) return null;
  if (OR === undefined) return [base];

  const branches = OR as Record<string, unknown>[];
  if (branches.length === 0) return null;
  const plans: QueryPlan[] = [];
  for (const branch of branches) {
    const p: QueryPlan = { eq: [...base.eq], inFilter: base.inFilter, ranges: [...base.ranges], exact: base.exact };
    const selectivity = (q: QueryPlan) => q.eq.filter(([, v]) => v !== null).length + q.ranges.length + (q.inFilter ? 1 : 0);
    const before = selectivity(p);
    if (!collect(model, branch, p)) continue;
    // A branch that adds nothing selective (or only `field: null`) would read about as much as
    // the base query alone; one query then beats several (and needs fewer indexes).
    if (selectivity(p) === before) return [{ ...base, exact: false }];
    p.exact = false;
    plans.push(p);
  }
  return plans.length ? plans : null;
}

// -----------------------------------------------------------------------------
// Ordering
// -----------------------------------------------------------------------------

export type OrderSpec = [string, "asc" | "desc"][];

export function orderSpec(orderBy: unknown): OrderSpec {
  if (!orderBy) return [];
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  const spec: OrderSpec = [];
  for (const entry of list as Record<string, "asc" | "desc">[]) {
    for (const [field, dir] of Object.entries(entry)) if (dir) spec.push([field, dir]);
  }
  return spec;
}

/** Postgres ordering: NULLs sort last ascending, first descending. */
export function sortRows<T extends Row>(rows: T[], spec: OrderSpec): T[] {
  if (spec.length === 0) return rows;
  return [...rows].sort((x, y) => {
    for (const [field, dir] of spec) {
      const a = comparable(x[field]);
      const b = comparable(y[field]);
      if (a === b) continue;
      const sign = dir === "asc" ? 1 : -1;
      if (a === null) return sign;
      if (b === null) return -sign;
      return (a < b ? -1 : 1) * sign;
    }
    // Same sort key: insertion order.
    return ((x[SEQ] as number | undefined) ?? 0) - ((y[SEQ] as number | undefined) ?? 0);
  });
}
