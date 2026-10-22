// Builds firestore.indexes.json from the composite indexes the data layer logged
// while running (FIRESTORE_INDEX_LOG=<file>; see src/server/db/session.ts):
//
//   FIRESTORE_INDEX_LOG=.indexes.log npm run test:integration   (and click through the app)
//   node scripts/firestore-indexes.mjs .indexes.log
//
// Existing entries are kept, so the file only grows. Deploy with `npm run firestore:deploy`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [, , logFile] = process.argv;
const OUT = "firestore.indexes.json";

const current = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { indexes: [], fieldOverrides: [] };
const logged = logFile && existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

// Not logged by queries: the realtime hub's listener and the event TTL policy.
const fixed = [
  {
    collectionGroup: "loungeEvents",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "loungeId", order: "ASCENDING" },
      { fieldPath: "at", order: "ASCENDING" },
    ],
  },
];

const key = (i) => JSON.stringify([i.collectionGroup, i.queryScope, i.fields]);
const byKey = new Map();
for (const index of [...current.indexes, ...fixed, ...logged]) byKey.set(key(index), index);
const indexes = [...byKey.values()].sort((a, b) => key(a).localeCompare(key(b)));

const fieldOverrides = current.fieldOverrides.some((f) => f.collectionGroup === "loungeEvents" && f.fieldPath === "expireAt")
  ? current.fieldOverrides
  : [...current.fieldOverrides, { collectionGroup: "loungeEvents", fieldPath: "expireAt", ttl: true, indexes: [] }];

writeFileSync(OUT, JSON.stringify({ indexes, fieldOverrides }, null, 2) + "\n");
console.log(`${OUT}: ${indexes.length} composite indexes`);
