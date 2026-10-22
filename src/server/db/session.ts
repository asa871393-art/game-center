import "server-only";
import { appendFileSync } from "node:fs";
import { FieldPath, FieldValue, Timestamp, type Firestore, type Query, type Transaction } from "firebase-admin/firestore";
import type { ModelName } from "@/lib/db/types";
import { cloneRow, comparable, decodeRow, encodeRow, isFilterObject, metaOf, queryOperand, type Row } from "./codec";
import {
  CHECKS,
  DbConstraintError,
  EVENT_TTL_MS,
  EVENTS_COLLECTION,
  LOCKS_COLLECTION,
  OVERLAP_STATUSES,
  PARTIAL_UNIQUES,
  REALTIME_TABLES,
  UNIQUES_COLLECTION,
} from "./constraints";
import { matchScalar, orderSpec, planQueries, sortRows, type OrderSpec, type QueryPlan } from "./filter";
import type { RelationMeta } from "./meta-types";

/**
 * One unit of database work. Inside a transaction, writes are buffered and
 * applied at commit, so the code can keep reading after it writes (Firestore
 * requires all transactional reads before any write) and sees its own writes.
 * Commit also enforces the integrity rules and emits the realtime events.
 */

export interface FindOptions {
  orderBy?: unknown;
  take?: number;
  skip?: number;
  distinct?: readonly string[];
}

type Memo = Map<string, Promise<unknown>>;

const IN_LIMIT = 30;
const GET_ALL_LIMIT = 300;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const keyOf = (model: ModelName, id: string) => `${model}/${id}`;

/** Composite indexes the pushed-down queries need, logged when FIRESTORE_INDEX_LOG is set (see scripts/firestore-indexes.ts). */
const loggedIndexes = new Set<string>();
function recordIndex(collection: string, plan: QueryPlan, order: OrderSpec | undefined) {
  const file = process.env.FIRESTORE_INDEX_LOG;
  if (!file) return;
  const eqFields = [...new Set([...plan.eq.map(([f]) => f), ...(plan.inFilter ? [plan.inFilter[0]] : [])])].filter((f) => f !== "id");
  // Firestore orders multiple inequality fields by name, and so must the index.
  const rangeFields = [...new Set(plan.ranges.map(([f]) => f))].sort();
  const orderFields = (order ?? []).filter(([f]) => !rangeFields.includes(f));
  if (rangeFields.length + orderFields.length === 0) return;
  if (eqFields.length === 0 && rangeFields.length + orderFields.length <= 1) return;
  const fields = [
    ...eqFields.map((f) => ({ fieldPath: f, order: "ASCENDING" })),
    ...rangeFields.map((f) => ({ fieldPath: f, order: "ASCENDING" })),
    ...orderFields.map(([f, dir]) => ({ fieldPath: f, order: dir === "asc" ? "ASCENDING" : "DESCENDING" })),
  ];
  const line = JSON.stringify({ collectionGroup: collection, queryScope: "COLLECTION", fields });
  if (loggedIndexes.has(line)) return;
  loggedIndexes.add(line);
  appendFileSync(file, line + "\n");
}

export class Session {
  /** Current state of every document read or written in this transaction. */
  private readonly overlay = new Map<string, Row | null>();
  /** State before this transaction's first write, per written document. */
  private readonly before = new Map<string, Row | null>();
  private readonly dirty = new Map<string, { model: ModelName; id: string }>();
  private readonly locks = new Set<string>();

  constructor(
    readonly fs: Firestore,
    readonly t: Transaction | null,
  ) {}

  ref(model: ModelName, id: string) {
    return this.fs.collection(metaOf(model).collection).doc(id);
  }

  newId(model: ModelName): string {
    return this.fs.collection(metaOf(model).collection).doc().id;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async getRow(model: ModelName, id: string): Promise<Row | null> {
    const key = keyOf(model, id);
    if (this.overlay.has(key)) {
      const row = this.overlay.get(key)!;
      return row ? cloneRow(row) : null;
    }
    const ref = this.ref(model, id);
    const snap = this.t ? await this.t.get(ref) : await ref.get();
    const row = snap.exists ? decodeRow(model, snap.id, snap.data()!) : null;
    if (this.t && !this.overlay.has(key)) this.overlay.set(key, row);
    return row ? cloneRow((this.t ? this.overlay.get(key) : row)!) : null;
  }

  async getRows(model: ModelName, ids: readonly string[]): Promise<Row[]> {
    const unique = [...new Set(ids)];
    const missing = unique.filter((id) => !this.overlay.has(keyOf(model, id)));
    const fetched = new Map<string, Row | null>();
    for (const part of chunk(missing, GET_ALL_LIMIT)) {
      const refs = part.map((id) => this.ref(model, id));
      const snaps = this.t ? await this.t.getAll(...refs) : await this.fs.getAll(...refs);
      for (const snap of snaps) {
        const row = snap.exists ? decodeRow(model, snap.id, snap.data()!) : null;
        if (this.t && !this.overlay.has(keyOf(model, snap.id))) this.overlay.set(keyOf(model, snap.id), row);
        fetched.set(snap.id, row);
      }
    }
    const rows: Row[] = [];
    for (const id of unique) {
      const key = keyOf(model, id);
      const row = this.overlay.has(key) ? this.overlay.get(key)! : (fetched.get(id) ?? null);
      if (row) rows.push(cloneRow(row));
    }
    return rows;
  }

  private async runPlan(model: ModelName, plan: QueryPlan, order?: OrderSpec, limit?: number): Promise<Row[]> {
    const meta = metaOf(model);
    const field = (f: string) => (f === "id" ? FieldPath.documentId() : f);
    let base: Query = this.fs.collection(meta.collection);
    for (const [f, v] of plan.eq) base = base.where(field(f), "==", queryOperand(meta.scalars[f], v));
    for (const [f, op, v] of plan.ranges) base = base.where(field(f), op, queryOperand(meta.scalars[f], v));
    let queries: Query[] = [base];
    if (plan.inFilter) {
      const [f, values] = plan.inFilter;
      queries = chunk(values, IN_LIMIT).map((part) => base.where(field(f), "in", part.map((v) => queryOperand(meta.scalars[f], v))));
    }
    if (order) queries = queries.map((q) => order.reduce((acc, [f, dir]) => acc.orderBy(f, dir), q));
    if (limit !== undefined) queries = queries.map((q) => q.limit(limit));
    recordIndex(meta.collection, plan, order);
    if (process.env.NODE_ENV === "development" && plan.eq.length + plan.ranges.length === 0 && !plan.inFilter) {
      console.warn(`[db] full scan of ${meta.collection}`);
    }

    const snaps = await Promise.all(queries.map((q) => (this.t ? this.t.get(q) : q.get())));
    const rows: Row[] = [];
    for (const snap of snaps) {
      for (const doc of snap.docs) {
        const row = decodeRow(model, doc.id, doc.data());
        const key = keyOf(model, doc.id);
        if (this.t && !this.overlay.has(key)) this.overlay.set(key, row);
        rows.push(row);
      }
    }
    return rows;
  }

  dirtyCount(model: ModelName): number {
    let n = 0;
    for (const d of this.dirty.values()) if (d.model === model) n++;
    return n;
  }

  /** Query results with this transaction's own writes applied. */
  private mergeOverlay(model: ModelName, rows: Row[]): Row[] {
    // The overlay holds the newest known state of every document this transaction touched.
    const byId = new Map(rows.map((r) => [r.id, this.overlay.get(keyOf(model, r.id)) ?? r]));
    for (const [key, d] of this.dirty) {
      if (d.model !== model) continue;
      const row = this.overlay.get(key);
      if (row) byId.set(d.id, row);
      else byId.delete(d.id);
    }
    return [...byId.values()].map(cloneRow);
  }

  async findRows(model: ModelName, where: Record<string, unknown> | undefined, opts: FindOptions = {}, memo: Memo = new Map()): Promise<Row[]> {
    const w = where ?? {};
    const plans = planQueries(model, w);
    if (!plans) return [];
    const single = plans.length === 1 ? plans[0] : null;
    const spec = orderSpec(opts.orderBy);
    const idEq = single?.eq.find(([f]) => f === "id");

    let rows: Row[];
    if (idEq) {
      const row = typeof idEq[1] === "string" ? await this.getRow(model, idEq[1]) : null;
      rows = row ? [row] : [];
    } else if (single?.inFilter?.[0] === "id") {
      rows = await this.getRows(model, single.inFilter[1] as string[]);
    } else {
      const scalars = metaOf(model).scalars;
      const pushOrder =
        single !== null &&
        single.exact &&
        single.ranges.length === 0 &&
        (!single.inFilter || single.inFilter[1].length <= IN_LIMIT) &&
        spec.length > 0 &&
        opts.take !== undefined &&
        !opts.distinct &&
        spec.every(([f]) => scalars[f] && !scalars[f].optional && f !== "id") &&
        this.dirtyCount(model) === 0;
      const lists = await Promise.all(
        plans.map((p) => this.runPlan(model, p, pushOrder ? spec : undefined, pushOrder ? (opts.skip ?? 0) + opts.take! : undefined)),
      );
      const byId = new Map<string, Row>();
      for (const list of lists) for (const r of list) byId.set(r.id, r);
      rows = [...byId.values()];
      if (this.t) rows = this.mergeOverlay(model, rows);
    }

    rows = await this.filterRows(model, rows, w, memo);
    rows = sortRows(rows, spec);
    if (opts.distinct?.length) {
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        const k = JSON.stringify(opts.distinct!.map((f) => comparable(r[f])));
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    const skip = opts.skip ?? 0;
    return opts.take !== undefined ? rows.slice(skip, skip + opts.take) : rows.slice(skip);
  }

  async filterRows(model: ModelName, rows: Row[], where: Record<string, unknown>, memo: Memo = new Map()): Promise<Row[]> {
    if (Object.keys(where).length === 0) return rows;
    const keep = await Promise.all(rows.map((r) => this.matches(model, r, where, memo)));
    return rows.filter((_, i) => keep[i]);
  }

  async matches(model: ModelName, row: Row, where: Record<string, unknown>, memo: Memo): Promise<boolean> {
    const meta = metaOf(model);
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === "AND" || key === "NOT") {
        const parts = (Array.isArray(cond) ? cond : [cond]) as Record<string, unknown>[];
        for (const part of parts) {
          const ok = await this.matches(model, row, part, memo);
          if (key === "AND" && !ok) return false;
          if (key === "NOT" && ok) return false;
        }
        continue;
      }
      if (key === "OR") {
        let any = false;
        for (const part of cond as Record<string, unknown>[]) {
          if (await this.matches(model, row, part, memo)) {
            any = true;
            break;
          }
        }
        if (!any) return false;
        continue;
      }
      const scalar = meta.scalars[key];
      if (scalar) {
        if (!matchScalar(scalar, row[key], cond)) return false;
        continue;
      }
      const rel = meta.relations[key];
      if (!rel) throw new Error(`Unknown field ${model}.${key} in filter`);
      if (!(await this.matchRelation(rel, row, cond, memo))) return false;
    }
    return true;
  }

  private memoized<T>(memo: Memo, key: string, load: () => Promise<T>): Promise<T> {
    let p = memo.get(key) as Promise<T> | undefined;
    if (!p) memo.set(key, (p = load()));
    return p;
  }

  private async matchRelation(rel: RelationMeta, row: Row, cond: unknown, memo: Memo): Promise<boolean> {
    const target = rel.model as ModelName;
    if (rel.kind === "many") {
      const children = await this.memoized(memo, `many:${target}:${rel.fk}:${row.id}`, () =>
        this.findRows(target, { [rel.fk]: row.id }, {}, memo),
      );
      const { some, none, every } = (cond ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const test = (w: Record<string, unknown>) => Promise.all(children.map((c) => this.matches(target, c, w, memo)));
      if (some !== undefined && !(await test(some)).some(Boolean)) return false;
      if (none !== undefined && (await test(none)).some(Boolean)) return false;
      if (every !== undefined && !(await test(every)).every(Boolean)) return false;
      return true;
    }

    const related =
      rel.kind === "one"
        ? row[rel.fk]
          ? await this.memoized(memo, `one:${target}:${row[rel.fk] as string}`, () => this.getRow(target, row[rel.fk] as string))
          : null
        : ((await this.memoized(memo, `many:${target}:${rel.fk}:${row.id}`, () => this.findRows(target, { [rel.fk]: row.id }, {}, memo)))[0] ??
          null);

    if (cond === null) return related === null;
    const c = cond as Record<string, unknown>;
    const keys = Object.keys(c);
    if (isFilterObject(c) && keys.length > 0 && keys.every((k) => k === "is" || k === "isNot")) {
      if ("is" in c) {
        if (c.is === null ? related !== null : !related || !(await this.matches(target, related, c.is as Record<string, unknown>, memo))) {
          return false;
        }
      }
      if ("isNot" in c) {
        if (c.isNot === null ? related === null : related && (await this.matches(target, related, c.isNot as Record<string, unknown>, memo))) {
          return false;
        }
      }
      return true;
    }
    return related !== null && (await this.matches(target, related, c, memo));
  }

  // ---------------------------------------------------------------------------
  // Writes (buffered until commit)
  // ---------------------------------------------------------------------------

  private requireTx(): Transaction {
    if (!this.t) throw new Error("Writes need a transaction");
    return this.t;
  }

  setRow(model: ModelName, id: string, row: Row | null) {
    this.requireTx();
    const key = keyOf(model, id);
    if (!this.dirty.has(key)) this.before.set(key, this.overlay.get(key) ?? null);
    this.overlay.set(key, row ? cloneRow(row) : null);
    this.dirty.set(key, { model, id });
  }

  /** Serializes transactions on `name`, like SELECT ... FOR UPDATE on a row. */
  async lock(name: string) {
    const t = this.requireTx();
    if (this.locks.has(name)) return;
    this.locks.add(name);
    await t.get(this.fs.collection(LOCKS_COLLECTION).doc(encodeURIComponent(name)));
  }

  async commit() {
    const t = this.requireTx();
    const entries = [...this.dirty.entries()]
      .map(([key, d]) => ({ ...d, owner: key, before: this.before.get(key) ?? null, after: this.overlay.get(key) ?? null }))
      .filter((e) => e.before !== null || e.after !== null);

    // CHECK constraints.
    for (const e of entries) {
      if (!e.after) continue;
      for (const check of CHECKS[e.model] ?? []) {
        const name = check(e.after);
        if (name) throw new DbConstraintError("23514", `new row for ${e.model} violates check constraint "${name}"`);
      }
    }

    // Unique keys (schema uniques + partial uniques), claimed as documents.
    const claims = new Map<string, { model: ModelName; id: string; fields: string[]; name: string }>();
    const releases = new Set<string>();
    for (const e of entries) {
      const specs = [
        ...metaOf(e.model).uniques.map((fields) => ({ name: `${e.model}_${fields.join("_")}_key`, fields, where: () => true })),
        ...(PARTIAL_UNIQUES[e.model] ?? []),
      ];
      for (const spec of specs) {
        const k = (row: Row | null) => {
          if (!row || !spec.where(row)) return null;
          const values = spec.fields.map((f) => row[f]);
          if (values.some((v) => v === null || v === undefined)) return null;
          return `${spec.name}:${values.map((v) => encodeURIComponent(String(comparable(v)))).join("|")}`;
        };
        const before = k(e.before);
        const after = k(e.after);
        if (before === after) continue;
        if (before) releases.add(before);
        if (after) {
          const prior = claims.get(after);
          if (prior && prior.id !== e.id) throw this.uniqueError(e.model, spec.fields);
          claims.set(after, { model: e.model, id: e.id, fields: spec.fields, name: spec.name });
        }
      }
    }
    const claimIds = [...claims.keys()];
    const claimRefs = claimIds.map((id) => this.fs.collection(UNIQUES_COLLECTION).doc(id));
    const claimSnaps = claimRefs.length ? await t.getAll(...claimRefs) : [];
    for (const [i, snap] of claimSnaps.entries()) {
      if (!snap.exists || releases.has(claimIds[i])) continue;
      const data = snap.data() as { model: ModelName; id: string };
      const claim = claims.get(claimIds[i])!;
      if (data.model === claim.model && data.id === claim.id) continue;
      // A stale claim (its owner was deleted or changed outside this app) doesn't block.
      const owner = await this.getRow(data.model, data.id);
      const stillOwns = owner && claim.fields.every((f) => comparable(owner[f]) === comparable(this.overlay.get(keyOf(claim.model, claim.id))?.[f]));
      if (stillOwns) throw this.uniqueError(claim.model, claim.fields);
    }

    // No two live bookings may overlap on one device (half-open ranges).
    for (const e of entries) {
      if (e.model !== "Booking" || !e.after || !OVERLAP_STATUSES.includes(e.after.status as string)) continue;
      const b = e.before;
      const a = e.after;
      const unchanged =
        b &&
        OVERLAP_STATUSES.includes(b.status as string) &&
        b.deviceId === a.deviceId &&
        comparable(b.scheduledStart) === comparable(a.scheduledStart) &&
        comparable(b.scheduledEnd) === comparable(a.scheduledEnd);
      if (unchanged) continue;
      await this.lock(`device-bookings:${a.deviceId as string}`);
      const others = await this.findRows("Booking", { deviceId: a.deviceId, status: { in: OVERLAP_STATUSES } });
      const clash = others.some(
        (o) =>
          o.id !== e.id && (o.scheduledStart as Date) < (a.scheduledEnd as Date) && (a.scheduledStart as Date) < (o.scheduledEnd as Date),
      );
      if (clash) {
        throw new DbConstraintError("23P01", 'conflicting key value violates exclusion constraint "Booking_no_overlap_per_device"');
      }
    }

    // Writes start here: no reads below.
    for (const e of entries) {
      const ref = this.ref(e.model, e.id);
      if (e.after) t.set(ref, encodeRow(e.model, e.after));
      else t.delete(ref);
    }
    for (const id of releases) if (!claims.has(id)) t.delete(this.fs.collection(UNIQUES_COLLECTION).doc(id));
    for (const [id, c] of claims) t.set(this.fs.collection(UNIQUES_COLLECTION).doc(id), { model: c.model, id: c.id });
    for (const name of this.locks) t.set(this.fs.collection(LOCKS_COLLECTION).doc(encodeURIComponent(name)), { at: FieldValue.serverTimestamp() });

    const expireAt = Timestamp.fromMillis(Date.now() + EVENT_TTL_MS);
    for (const e of entries) {
      const table = REALTIME_TABLES[e.model];
      const row = e.after ?? e.before!;
      if (!table || typeof row.loungeId !== "string") continue;
      const op = !e.before ? "INSERT" : !e.after ? "DELETE" : "UPDATE";
      if (op === "UPDATE" && sameRow(e.model, e.before!, e.after!)) continue;
      t.set(this.fs.collection(EVENTS_COLLECTION).doc(), {
        loungeId: row.loungeId,
        table,
        op,
        id: e.id,
        status: typeof row.status === "string" ? row.status : "",
        ...("source" in row ? { source: row.source } : {}),
        at: FieldValue.serverTimestamp(),
        expireAt,
      });
    }
  }

  private uniqueError(model: ModelName, fields: string[]) {
    return new DbConstraintError("P2002", `Unique constraint failed on ${model}(${fields.join(", ")})`, { modelName: model, target: fields });
  }
}

function sameRow(model: ModelName, a: Row, b: Row): boolean {
  for (const [name, meta] of Object.entries(metaOf(model).scalars)) {
    if (meta.updatedAt) continue;
    if (JSON.stringify(comparable(a[name]) ?? a[name]) !== JSON.stringify(comparable(b[name]) ?? b[name])) return false;
  }
  return true;
}

export { DbConstraintError };
export type { Row };
export { orderSpec, sortRows };
