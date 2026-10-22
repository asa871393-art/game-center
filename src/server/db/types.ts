import type { Decimal } from "@/lib/db/decimal";
import type { InputJsonValue, ModelName, ModelTypes } from "@/lib/db/types";
import type { RelationTypes } from "./relations";

/**
 * Query and result types of the Firestore data layer. The call shapes follow
 * the Prisma API the app was written against (where / select / include /
 * orderBy / take), so services read the same; results are typed from the
 * select/include the caller passes.
 */

export type Model<N extends ModelName> = ModelTypes[N];
type Rels<N extends ModelName> = RelationTypes[N];
type RelTarget<R> = R extends { model: infer T extends ModelName } ? T : never;
type ManyRelKeys<N extends ModelName> = { [K in keyof Rels<N>]: Rels<N>[K] extends { kind: "many" } ? K : never }[keyof Rels<N>];
type ScalarKeys<N extends ModelName> = keyof Model<N> & string;

// -----------------------------------------------------------------------------
// Filters
// -----------------------------------------------------------------------------

type Comparable<T> = [T] extends [Decimal] ? Decimal | number | string : T;

export interface ScalarFilter<T> {
  equals?: Comparable<T> | null;
  in?: readonly Comparable<T>[];
  notIn?: readonly Comparable<T>[];
  not?: Comparable<T> | null | ScalarFilter<T>;
  lt?: Comparable<T>;
  lte?: Comparable<T>;
  gt?: Comparable<T>;
  gte?: Comparable<T>;
  contains?: T extends string ? string : never;
  startsWith?: T extends string ? string : never;
  endsWith?: T extends string ? string : never;
  mode?: "insensitive" | "default";
}

type FieldFilter<T> = [T] extends [readonly unknown[]] ? never : Comparable<NonNullable<T>> | null | ScalarFilter<NonNullable<T>>;

type RelationFilter<R> = R extends { kind: "many"; model: infer T extends ModelName }
  ? { some?: Where<T>; none?: Where<T>; every?: Where<T> }
  : R extends { model: infer T extends ModelName }
    ? Where<T> | { is?: Where<T> | null; isNot?: Where<T> | null } | null
    : never;

export type Where<N extends ModelName> = { [K in ScalarKeys<N>]?: FieldFilter<Model<N>[K]> } & {
  [K in keyof Rels<N>]?: RelationFilter<Rels<N>[K]>;
} & {
  AND?: Where<N> | readonly Where<N>[];
  OR?: readonly Where<N>[];
  NOT?: Where<N> | readonly Where<N>[];
} & Record<string, unknown>;

export type SortOrder = "asc" | "desc";
export type OrderBy<N extends ModelName> = { [K in ScalarKeys<N>]?: SortOrder } | readonly { [K in ScalarKeys<N>]?: SortOrder }[];

// -----------------------------------------------------------------------------
// Select / include
// -----------------------------------------------------------------------------

type CountSelect<N extends ModelName> = { select: { [K in ManyRelKeys<N>]?: boolean | { where?: Where<RelTarget<Rels<N>[K]>> } } };

type RelArgs<R> = R extends { kind: "many"; model: infer T extends ModelName }
  ? FindManyArgs<T>
  : R extends { model: infer T extends ModelName }
    ? { select?: Select<T>; include?: Include<T> }
    : never;

export type Select<N extends ModelName> = { [K in ScalarKeys<N>]?: boolean } & {
  [K in keyof Rels<N>]?: boolean | RelArgs<Rels<N>[K]>;
} & { _count?: boolean | CountSelect<N> };

export type Include<N extends ModelName> = { [K in keyof Rels<N>]?: boolean | RelArgs<Rels<N>[K]> } & {
  _count?: boolean | CountSelect<N>;
};

export interface FindManyArgs<N extends ModelName> {
  where?: Where<N>;
  orderBy?: OrderBy<N>;
  take?: number;
  skip?: number;
  select?: Select<N>;
  include?: Include<N>;
  distinct?: readonly ScalarKeys<N>[];
}

export type FindFirstArgs<N extends ModelName> = FindManyArgs<N>;
export type FindUniqueArgs<N extends ModelName> = { where: Where<N>; select?: Select<N>; include?: Include<N> };

// -----------------------------------------------------------------------------
// Result payloads
// -----------------------------------------------------------------------------

type Selected<S> = { [K in keyof S as S[K] extends false | undefined | null ? never : K]: S[K] };

type RelPayload<R, V> = R extends { kind: "many"; model: infer T extends ModelName }
  ? Payload<T, [V] extends [boolean] ? object : V>[]
  : R extends { model: infer T extends ModelName; nullable: infer Nullable }
    ? Payload<T, [V] extends [boolean] ? object : V> | (Nullable extends true ? null : never)
    : never;

type CountPayload<N extends ModelName, V> = V extends { select: infer CS }
  ? { [K in keyof Selected<CS>]: number }
  : { [K in ManyRelKeys<N>]: number };

type SelectPayload<N extends ModelName, S> = {
  [K in keyof Selected<S>]: K extends keyof Model<N>
    ? Model<N>[K]
    : K extends keyof Rels<N>
      ? RelPayload<Rels<N>[K], S[K]>
      : K extends "_count"
        ? CountPayload<N, S[K]>
        : never;
};

type IncludePayload<N extends ModelName, I> = {
  [K in keyof Selected<I>]: K extends keyof Rels<N> ? RelPayload<Rels<N>[K], I[K]> : K extends "_count" ? CountPayload<N, I[K]> : never;
};

export type Payload<N extends ModelName, A> = A extends { select: infer S }
  ? [S] extends [undefined]
    ? A extends { include: infer I }
      ? Model<N> & IncludePayload<N, I>
      : Model<N>
    : SelectPayload<N, S>
  : A extends { include: infer I }
    ? [I] extends [undefined]
      ? Model<N>
      : Model<N> & IncludePayload<N, I>
    : Model<N>;

/** Result type of a find with the given args, e.g. `GetPayload<"Lounge", { select: typeof summarySelect }>`. */
export type GetPayload<N extends ModelName, A> = Payload<N, A>;

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

type ScalarInput<T> = T extends Decimal
  ? Decimal | number | string
  : T extends Decimal | null
    ? Decimal | number | string | null
    : T extends import("@/lib/db/types").JsonValue
      ? InputJsonValue | null
      : T;

export interface NumberOps {
  increment?: number;
  decrement?: number;
  multiply?: number;
  divide?: number;
  set?: number | null;
}

type NestedCreate<R> = R extends { kind: "many"; model: infer T extends ModelName }
  ? { create?: CreateData<T> | readonly CreateData<T>[] }
  : R extends { model: infer T extends ModelName }
    ? { create?: CreateData<T> }
    : never;

/** Create input. Required fields are checked at runtime (fields with defaults may be omitted). */
export type CreateData<N extends ModelName> = { [K in ScalarKeys<N>]?: ScalarInput<Model<N>[K]> } & {
  [K in keyof Rels<N>]?: NestedCreate<Rels<N>[K]>;
};

export type UpdateData<N extends ModelName> = {
  [K in ScalarKeys<N>]?: Model<N>[K] extends number | null ? Model<N>[K] | NumberOps : ScalarInput<Model<N>[K]>;
};

// -----------------------------------------------------------------------------
// Aggregates
// -----------------------------------------------------------------------------

type NumericKeys<N extends ModelName> = {
  [K in ScalarKeys<N>]: NonNullable<Model<N>[K]> extends number | Decimal ? K : never;
}[ScalarKeys<N>];
type SortableKeys<N extends ModelName> = {
  [K in ScalarKeys<N>]: NonNullable<Model<N>[K]> extends number | Decimal | Date | string ? K : never;
}[ScalarKeys<N>];

type FieldFlags<Keys extends string> = { [K in Keys]?: true };

export interface AggregateArgs<N extends ModelName> {
  where?: Where<N>;
  _sum?: FieldFlags<NumericKeys<N>>;
  _max?: FieldFlags<SortableKeys<N>>;
  _min?: FieldFlags<SortableKeys<N>>;
  _count?: true | { _all?: true };
}

type SumOf<T> = NonNullable<T> extends Decimal ? Decimal | null : number | null;
type AggPayload<N extends ModelName, A> = (A extends { _sum: infer S } ? { _sum: { [K in keyof S & keyof Model<N>]: SumOf<Model<N>[K]> } } : unknown) &
  (A extends { _max: infer S } ? { _max: { [K in keyof S & keyof Model<N>]: Model<N>[K] | null } } : unknown) &
  (A extends { _min: infer S } ? { _min: { [K in keyof S & keyof Model<N>]: Model<N>[K] | null } } : unknown) &
  (A extends { _count: infer C } ? { _count: C extends true ? number : { _all: number } } : unknown);

export type AggregatePayload<N extends ModelName, A> = AggPayload<N, A>;

export interface GroupByArgs<N extends ModelName> extends AggregateArgs<N> {
  by: readonly ScalarKeys<N>[];
}

export type GroupByPayload<N extends ModelName, A> = (A extends { by: readonly (infer K)[] }
  ? { [P in K & keyof Model<N>]: Model<N>[P] }
  : unknown) &
  AggPayload<N, A>;
