export type ScalarKind = "String" | "Int" | "Float" | "Boolean" | "DateTime" | "Decimal" | "Json" | "Enum";

export interface ScalarMeta {
  type: ScalarKind;
  list?: boolean;
  optional?: boolean;
  /** `now` = the write time; `value` = a constant. */
  default?: { now: true } | { value: string | number | boolean };
  /** Set to the write time on every create and update. */
  updatedAt?: boolean;
}

export interface RelationMeta {
  /** one: this model holds the foreign key; oneBack: the other side of a 1:1; many: 1:n children. */
  kind: "one" | "oneBack" | "many";
  model: string;
  /** Foreign-key field (on this model for `one`, on `model` otherwise). Always references `id`. */
  fk: string;
  ref: string;
  onDelete: string | null;
}

export interface ModelMeta {
  collection: string;
  /** Natural-key models (Auth.js tables) use these fields, joined, as the document id. */
  compoundId?: string[];
  scalars: Record<string, ScalarMeta>;
  relations: Record<string, RelationMeta>;
  uniques: string[][];
}
