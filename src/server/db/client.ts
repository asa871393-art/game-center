import "server-only";
import { Decimal } from "@/lib/db/decimal";
import type { ModelName } from "@/lib/db/types";
import { closeAdminApp, getAdminDb } from "@/lib/firebase-admin";
import { cloneRow, comparable, isFilterObject, metaOf, nextSeq, SEQ, type Row } from "./codec";
import { DbConstraintError } from "./constraints";
import { orderSpec, sortRows } from "./filter";
import { MODELS } from "./schema";
import { Session } from "./session";
import type {
  AggregateArgs,
  AggregatePayload,
  CreateData,
  FindFirstArgs,
  FindManyArgs,
  FindUniqueArgs,
  GroupByArgs,
  GroupByPayload,
  Include,
  Payload,
  Select,
  UpdateData,
  Where,
} from "./types";

/**
 * Firestore data layer with the query API the services were written against
 * (findMany / include / select / groupBy / $transaction ...), built on the
 * Firebase Admin SDK. See session.ts for transactions and integrity rules.
 */

type Args = Record<string, unknown>;
type AnyRecord = Record<string, unknown>;

export interface Delegate<N extends ModelName> {
  findMany<const A extends FindManyArgs<N>>(args?: A): Promise<Payload<N, A>[]>;
  findFirst<const A extends FindFirstArgs<N>>(args?: A): Promise<Payload<N, A> | null>;
  findFirstOrThrow<const A extends FindFirstArgs<N>>(args?: A): Promise<Payload<N, A>>;
  findUnique<const A extends FindUniqueArgs<N>>(args: A): Promise<Payload<N, A> | null>;
  findUniqueOrThrow<const A extends FindUniqueArgs<N>>(args: A): Promise<Payload<N, A>>;
  count(args?: { where?: Where<N> }): Promise<number>;
  aggregate<const A extends AggregateArgs<N>>(args: A): Promise<AggregatePayload<N, A>>;
  groupBy<const A extends GroupByArgs<N>>(args: A): Promise<GroupByPayload<N, A>[]>;
  create<const A extends { data: CreateData<N>; select?: Select<N>; include?: Include<N> }>(args: A): Promise<Payload<N, A>>;
  createMany(args: { data: readonly CreateData<N>[] }): Promise<{ count: number }>;
  update<const A extends { where: Where<N>; data: UpdateData<N>; select?: Select<N>; include?: Include<N> }>(args: A): Promise<Payload<N, A>>;
  updateMany(args: { where?: Where<N>; data: UpdateData<N> }): Promise<{ count: number }>;
  upsert<const A extends { where: Where<N>; create: CreateData<N>; update: UpdateData<N>; select?: Select<N>; include?: Include<N> }>(
    args: A,
  ): Promise<Payload<N, A>>;
  delete<const A extends { where: Where<N>; select?: Select<N>; include?: Include<N> }>(args: A): Promise<Payload<N, A>>;
  deleteMany(args?: { where?: Where<N> }): Promise<{ count: number }>;
}

type Delegates = { [N in ModelName as Uncapitalize<N>]: Delegate<N> };

export type TxClient = Delegates & {
  /** Serializes concurrent transactions on `name` (like SELECT ... FOR UPDATE). */
  $lock(name: string): Promise<void>;
};

export type DbClient = Delegates & {
  $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T>;
  /** Closes the Firestore connection (scripts and tests). */
  $disconnect(): Promise<void>;
};

/** Any client a helper can read through: the root client or a transaction. */
export type DbReader = Delegates;

export class RecordNotFoundError extends DbConstraintError {
  constructor(model: string) {
    super("P2025", `No ${model} found`);
    this.name = "RecordNotFoundError";
  }
}

// -----------------------------------------------------------------------------
// Where normalization: compound unique inputs ({ loungeId_userId: {...} }).
// -----------------------------------------------------------------------------

function normalizeWhere(model: ModelName, where: AnyRecord | undefined): AnyRecord {
  if (!where) return {};
  const meta = metaOf(model);
  const out: AnyRecord = {};
  for (const [key, value] of Object.entries(where)) {
    if (!meta.scalars[key] && !meta.relations[key] && key.includes("_") && isFilterObject(value) && !["AND", "OR", "NOT"].includes(key)) {
      Object.assign(out, value);
    } else out[key] = value;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Projection (select / include)
// -----------------------------------------------------------------------------

/** A row as callers see it (without the hidden sequence). */
function publicRow(row: Row): AnyRecord {
  const { [SEQ]: _seq, ...rest } = row;
  void _seq;
  return rest;
}

async function project(s: Session, model: ModelName, rows: Row[], args: Args | undefined): Promise<AnyRecord[]> {
  const select = args?.select as AnyRecord | undefined;
  const include = args?.include as AnyRecord | undefined;
  const shape = select ?? include;
  if (!shape) return rows.map(publicRow);

  const meta = metaOf(model);
  const relValues = new Map<string, Map<string, unknown>>();
  await Promise.all(
    Object.entries(shape).map(async ([key, value]) => {
      if (!value) return;
      if (key === "_count") relValues.set(key, await loadCounts(s, model, rows, value));
      else if (meta.relations[key]) relValues.set(key, await loadRelation(s, model, rows, key, value === true ? {} : (value as Args)));
      else if (!meta.scalars[key]) throw new Error(`Unknown field ${model}.${key} in select/include`);
    }),
  );

  return rows.map((row) => {
    const out: AnyRecord = select ? {} : publicRow(row);
    for (const [key, value] of Object.entries(shape)) {
      if (!value) continue;
      if (relValues.has(key)) out[key] = relValues.get(key)!.get(row.id);
      else out[key] = row[key];
    }
    return out;
  });
}

async function loadRelation(s: Session, model: ModelName, rows: Row[], name: string, args: Args): Promise<Map<string, unknown>> {
  const rel = metaOf(model).relations[name];
  const target = rel.model as ModelName;
  const result = new Map<string, unknown>();

  if (rel.kind === "one") {
    const ids = rows.map((r) => r[rel.fk]).filter((v): v is string => typeof v === "string");
    const targets = await s.getRows(target, ids);
    const projected = await project(s, target, targets, args);
    const byId = new Map(targets.map((t, i) => [t.id, projected[i]]));
    for (const r of rows) result.set(r.id, typeof r[rel.fk] === "string" ? (byId.get(r[rel.fk] as string) ?? null) : null);
    return result;
  }

  const parentIds = rows.map((r) => r.id);
  const where = args.where as AnyRecord | undefined;
  const children = parentIds.length
    ? await s.findRows(target, { AND: [{ [rel.fk]: { in: parentIds } }, ...(where ? [normalizeWhere(target, where)] : [])] })
    : [];
  const groups = new Map<string, Row[]>();
  for (const c of children) {
    const k = c[rel.fk] as string;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }

  const spec = orderSpec(args.orderBy);
  const kept: Row[] = [];
  const keptGroups = new Map<string, Row[]>();
  for (const [k, list] of groups) {
    let g = sortRows(list, spec);
    if (args.distinct) {
      const seen = new Set<string>();
      g = g.filter((r) => {
        const key = JSON.stringify((args.distinct as string[]).map((f) => comparable(r[f])));
        return seen.has(key) ? false : (seen.add(key), true);
      });
    }
    const skip = (args.skip as number | undefined) ?? 0;
    g = args.take !== undefined ? g.slice(skip, skip + (args.take as number)) : g.slice(skip);
    keptGroups.set(k, g);
    kept.push(...g);
  }
  const projected = await project(s, target, kept, args);
  const byRow = new Map(kept.map((r, i) => [r, projected[i]]));
  for (const r of rows) {
    const g = keptGroups.get(r.id) ?? [];
    result.set(r.id, rel.kind === "many" ? g.map((c) => byRow.get(c)) : g.length ? byRow.get(g[0]) : null);
  }
  return result;
}

async function loadCounts(s: Session, model: ModelName, rows: Row[], value: unknown): Promise<Map<string, unknown>> {
  const meta = metaOf(model);
  const wanted: [string, AnyRecord | undefined][] =
    value === true
      ? Object.entries(meta.relations)
          .filter(([, r]) => r.kind === "many")
          .map(([k]) => [k, undefined])
      : Object.entries(((value as AnyRecord).select ?? {}) as AnyRecord)
          .filter(([, v]) => v)
          .map(([k, v]) => [k, v === true ? undefined : ((v as AnyRecord).where as AnyRecord | undefined)]);
  const counts = new Map<string, AnyRecord>(rows.map((r) => [r.id, {}]));
  await Promise.all(
    wanted.map(async ([name, where]) => {
      const rel = meta.relations[name];
      const target = rel.model as ModelName;
      const children = rows.length
        ? await s.findRows(target, { AND: [{ [rel.fk]: { in: rows.map((r) => r.id) } }, ...(where ? [normalizeWhere(target, where)] : [])] })
        : [];
      for (const r of rows) counts.get(r.id)![name] = 0;
      for (const c of children) {
        const entry = counts.get(c[rel.fk] as string);
        if (entry) entry[name] = (entry[name] as number) + 1;
      }
    }),
  );
  return counts;
}

// -----------------------------------------------------------------------------
// Aggregates
// -----------------------------------------------------------------------------

function aggregateRows(model: ModelName, rows: Row[], args: AnyRecord): AnyRecord {
  const scalars = metaOf(model).scalars;
  const out: AnyRecord = {};
  if (args._sum) {
    const sums: AnyRecord = {};
    for (const field of Object.keys(args._sum as AnyRecord)) {
      const values = rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined);
      if (values.length === 0) sums[field] = null;
      else if (scalars[field].type === "Decimal") {
        const minor = values.reduce((acc: number, v) => acc + Math.round(Number(String(v)) * 100), 0);
        sums[field] = new Decimal(minor / 100);
      } else sums[field] = values.reduce((acc: number, v) => acc + (v as number), 0);
    }
    out._sum = sums;
  }
  for (const op of ["_max", "_min"] as const) {
    if (!args[op]) continue;
    const res: AnyRecord = {};
    for (const field of Object.keys(args[op] as AnyRecord)) {
      const sorted = sortRows(
        rows.filter((r) => r[field] !== null && r[field] !== undefined),
        [[field, op === "_max" ? "desc" : "asc"]],
      );
      res[field] = sorted.length ? sorted[0][field] : null;
    }
    out[op] = res;
  }
  if (args._count) out._count = args._count === true ? rows.length : { _all: rows.length };
  return out;
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

function applyNumberOp(current: unknown, op: AnyRecord, decimal: boolean): unknown {
  if ("set" in op) return op.set;
  const base = current === null || current === undefined ? null : Number(String(current));
  if (base === null) return null;
  const toMinor = (n: number) => (decimal ? Math.round(n * 100) : n);
  const fromMinor = (n: number) => (decimal ? n / 100 : n);
  let v = toMinor(base);
  if (op.increment !== undefined) v += toMinor(op.increment as number);
  if (op.decrement !== undefined) v -= toMinor(op.decrement as number);
  if (op.multiply !== undefined) v *= op.multiply as number;
  if (op.divide !== undefined) v /= op.divide as number;
  return fromMinor(v);
}

function applyUpdate(model: ModelName, row: Row, data: AnyRecord, now: Date): Row {
  const scalars = metaOf(model).scalars;
  const next = cloneRow(row);
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const meta = scalars[key];
    if (!meta) throw new Error(`Unknown field ${model}.${key} in update`);
    if (key === "id") throw new Error(`Cannot change ${model}.id`);
    if (isFilterObject(value) && meta.type !== "Json") {
      next[key] = applyNumberOp(row[key], value, meta.type === "Decimal");
    } else next[key] = value;
    if (meta.type === "Decimal" && next[key] !== null) next[key] = new Decimal(next[key] as number);
  }
  for (const [key, meta] of Object.entries(scalars)) if (meta.updatedAt) next[key] = now;
  return next;
}

function compoundIdOf(model: ModelName, row: AnyRecord): string | null {
  const fields = metaOf(model).compoundId;
  if (!fields) return null;
  return fields.map((f) => encodeURIComponent(String(row[f]))).join(":");
}

/** Builds a full row (defaults, nulls) and buffers it with its nested creates. */
async function createRow(s: Session, model: ModelName, data: AnyRecord, now: Date): Promise<Row> {
  const meta = metaOf(model);
  const row: AnyRecord = {};
  const nested: [string, unknown][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (meta.relations[key]) nested.push([key, value]);
    else if (meta.scalars[key]) row[key] = value;
    else throw new Error(`Unknown field ${model}.${key} in create`);
  }
  for (const [key, sm] of Object.entries(meta.scalars)) {
    if (key === "id") continue;
    if (row[key] === undefined || (sm.updatedAt && row[key] === undefined)) {
      if (sm.updatedAt) row[key] = now;
      else if (sm.default && "now" in sm.default) row[key] = now;
      else if (sm.default && "value" in sm.default) row[key] = sm.default.value;
      else if (sm.list) row[key] = [];
      else if (sm.optional) row[key] = null;
      else throw new Error(`Missing required field ${model}.${key}`);
    }
    if (sm.type === "Decimal" && row[key] !== null) row[key] = new Decimal(row[key] as number);
  }

  const compound = compoundIdOf(model, row);
  const id = (typeof data.id === "string" ? data.id : null) ?? compound ?? s.newId(model);
  if (compound || typeof data.id === "string") {
    if (await s.getRow(model, id)) throw new DbConstraintError("P2002", `Unique constraint failed on ${model}(id)`, { modelName: model, target: ["id"] });
  }
  const created = { ...row, id, [SEQ]: nextSeq() } as Row;
  s.setRow(model, id, created);

  for (const [key, value] of nested) {
    const rel = meta.relations[key];
    const create = (value as AnyRecord).create;
    if (rel.kind === "one" || create === undefined) throw new Error(`Unsupported nested write ${model}.${key}`);
    for (const child of Array.isArray(create) ? create : [create]) {
      await createRow(s, rel.model as ModelName, { ...(child as AnyRecord), [rel.fk]: id }, now);
    }
  }
  return created;
}

/** Children pointing at a deleted row: cascade, set null, or refuse (Prisma's default rules). */
const REFERENCES: { model: ModelName; fk: string; parent: ModelName; onDelete: string }[] = Object.entries(MODELS).flatMap(([name, meta]) =>
  Object.values(meta.relations)
    .filter((r) => r.kind === "one")
    .map((r) => ({
      model: name as ModelName,
      fk: r.fk,
      parent: r.model as ModelName,
      onDelete: r.onDelete ?? (meta.scalars[r.fk].optional ? "SetNull" : "Restrict"),
    })),
);

/**
 * Deletes a row like a single SQL DELETE: first the whole set of rows its
 * Cascade references remove, then SetNull on what stays, refusing (P2003) if a
 * Restrict reference would be left dangling.
 */
async function deleteRow(s: Session, model: ModelName, row: Row, now: Date) {
  const doomed = new Map<string, { model: ModelName; row: Row }>();
  const visit = async (m: ModelName, r: Row) => {
    const key = `${m}/${r.id}`;
    if (doomed.has(key)) return;
    doomed.set(key, { model: m, row: r });
    for (const ref of REFERENCES.filter((x) => x.parent === m && x.onDelete === "Cascade")) {
      for (const child of await s.findRows(ref.model, { [ref.fk]: r.id })) await visit(ref.model, child);
    }
  };
  await visit(model, row);

  for (const { model: m, row: r } of doomed.values()) {
    for (const ref of REFERENCES.filter((x) => x.parent === m && x.onDelete !== "Cascade")) {
      const children = (await s.findRows(ref.model, { [ref.fk]: r.id })).filter((c) => !doomed.has(`${ref.model}/${c.id}`));
      if (children.length === 0) continue;
      if (ref.onDelete === "SetNull") {
        for (const c of children) s.setRow(ref.model, c.id, applyUpdate(ref.model, c, { [ref.fk]: null }, now));
      } else {
        throw new DbConstraintError("P2003", `Foreign key constraint violated: ${ref.model}.${ref.fk} still references ${m} ${r.id}`, {
          modelName: ref.model,
          field: ref.fk,
        });
      }
    }
  }
  for (const { model: m, row: r } of doomed.values()) s.setRow(m, r.id, null);
}

// -----------------------------------------------------------------------------
// Delegates
// -----------------------------------------------------------------------------

function makeDelegate(model: ModelName, getSession: () => Session, inTx: <T>(fn: (s: Session) => Promise<T>) => Promise<T>) {
  const find = async (args: Args = {}) => {
    const s = getSession();
    const rows = await s.findRows(model, normalizeWhere(model, args.where as AnyRecord), {
      orderBy: args.orderBy,
      take: args.take as number | undefined,
      skip: args.skip as number | undefined,
      distinct: args.distinct as string[] | undefined,
    });
    return project(s, model, rows, args);
  };
  const first = async (args: Args = {}) => (await find({ ...args, take: 1 }))[0] ?? null;
  const orThrow = async (p: Promise<unknown>) => {
    const r = await p;
    if (r === null) throw new RecordNotFoundError(model);
    return r;
  };

  const delegate = {
    findMany: find,
    findFirst: first,
    findFirstOrThrow: (args?: Args) => orThrow(first(args)),
    findUnique: (args: Args) => first(args),
    findUniqueOrThrow: (args: Args) => orThrow(first(args)),
    async count(args: Args = {}) {
      return (await getSession().findRows(model, normalizeWhere(model, args.where as AnyRecord))).length;
    },
    async aggregate(args: Args) {
      return aggregateRows(model, await getSession().findRows(model, normalizeWhere(model, args.where as AnyRecord)), args);
    },
    async groupBy(args: Args) {
      const rows = await getSession().findRows(model, normalizeWhere(model, args.where as AnyRecord));
      const by = args.by as string[];
      const groups = new Map<string, Row[]>();
      for (const r of rows) {
        const k = JSON.stringify(by.map((f) => comparable(r[f])));
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      }
      return [...groups.values()].map((g) => ({ ...Object.fromEntries(by.map((f) => [f, g[0][f]])), ...aggregateRows(model, g, args) }));
    },
    create: (args: Args) =>
      inTx(async (s) => {
        const row = await createRow(s, model, args.data as AnyRecord, new Date());
        return (await project(s, model, [row], args))[0];
      }),
    createMany: (args: Args) =>
      inTx(async (s) => {
        const now = new Date();
        for (const data of args.data as AnyRecord[]) await createRow(s, model, data, now);
        return { count: (args.data as unknown[]).length };
      }),
    update: (args: Args) =>
      inTx(async (s) => {
        const [row] = await s.findRows(model, normalizeWhere(model, args.where as AnyRecord), { take: 1 });
        if (!row) throw new RecordNotFoundError(model);
        const next = applyUpdate(model, row, args.data as AnyRecord, new Date());
        s.setRow(model, row.id, next);
        return (await project(s, model, [next], args))[0];
      }),
    updateMany: (args: Args) =>
      inTx(async (s) => {
        const rows = await s.findRows(model, normalizeWhere(model, args.where as AnyRecord));
        const now = new Date();
        for (const row of rows) s.setRow(model, row.id, applyUpdate(model, row, args.data as AnyRecord, now));
        return { count: rows.length };
      }),
    upsert: (args: Args) =>
      inTx(async (s) => {
        const now = new Date();
        const [row] = await s.findRows(model, normalizeWhere(model, args.where as AnyRecord), { take: 1 });
        const next = row ? applyUpdate(model, row, args.update as AnyRecord, now) : await createRow(s, model, args.create as AnyRecord, now);
        if (row) s.setRow(model, row.id, next);
        return (await project(s, model, [next], args))[0];
      }),
    delete: (args: Args) =>
      inTx(async (s) => {
        const [row] = await s.findRows(model, normalizeWhere(model, args.where as AnyRecord), { take: 1 });
        if (!row) throw new RecordNotFoundError(model);
        const projected = (await project(s, model, [row], args))[0];
        await deleteRow(s, model, row, new Date());
        return projected;
      }),
    deleteMany: (args: Args = {}) =>
      inTx(async (s) => {
        const rows = await s.findRows(model, normalizeWhere(model, args.where as AnyRecord));
        const now = new Date();
        for (const row of rows) await deleteRow(s, model, row, now);
        return { count: rows.length };
      }),
  };
  return delegate as unknown as Delegate<typeof model>;
}

const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

function buildDelegates(getSession: () => Session, inTx: <T>(fn: (s: Session) => Promise<T>) => Promise<T>): Delegates {
  const out: AnyRecord = {};
  for (const name of Object.keys(MODELS) as ModelName[]) out[lowerFirst(name)] = makeDelegate(name, getSession, inTx);
  return out as Delegates;
}

async function runTransaction<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const fs = getAdminDb();
  return fs.runTransaction(async (t) => {
    const s = new Session(fs, t);
    const result = await fn(s);
    await s.commit();
    return result;
  });
}

function txClient(s: Session): TxClient {
  const delegates = buildDelegates(
    () => s,
    (fn) => fn(s),
  );
  return Object.assign(delegates, { $lock: (name: string) => s.lock(name) });
}

function createClient(): DbClient {
  const delegates = buildDelegates(() => new Session(getAdminDb(), null), runTransaction);
  return Object.assign(delegates, {
    $transaction: <T>(fn: (tx: TxClient) => Promise<T>) => runTransaction((s) => fn(txClient(s))),
    $disconnect: closeAdminApp,
  });
}

export const db: DbClient = createClient();

/** True for errors raised by the data layer's integrity rules with the given code. */
export function isDbError(error: unknown, code: DbConstraintError["code"]): boolean {
  return error instanceof DbConstraintError && error.code === code;
}
