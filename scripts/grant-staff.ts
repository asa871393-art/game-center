/**
 * Gives a Google account cashier (or manager) access to lounges, against whichever Firestore
 * .env points at (the live project, or the emulator when FIRESTORE_EMULATOR_HOST is set).
 *
 *   npm run staff:grant -- ali@gmail.com                         cashier at every lounge
 *   npm run staff:grant -- ali@gmail.com --lounge nexus-downtown  one lounge (by slug)
 *   npm run staff:grant -- ali@gmail.com --role MANAGER
 *   npm run staff:grant -- --list                                 lounges and their staff
 *
 * The account needs no password: the first "Sign in with Gmail" on /pos/login links to it.
 * Lounge managers can do the same from the POS (Staff screen) without this script.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "@/server/db";
import { grantLoungeAccess, listLoungeStaff, type GrantableRole } from "@/server/services/staff-access";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { lounge: { type: "string" }, role: { type: "string", default: "STAFF" }, list: { type: "boolean", default: false } },
  });

  const lounges = await db.lounge.findMany({
    where: values.lounge ? { slug: values.lounge } : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
  if (lounges.length === 0) throw new Error(values.lounge ? `No lounge with slug "${values.lounge}".` : "No lounges found.");

  if (values.list) {
    for (const l of lounges) {
      console.log(`${l.name} (/${l.slug})`);
      for (const m of await listLoungeStaff(l.id)) {
        console.log(`  ${m.role.padEnd(8)} ${m.email ?? m.name ?? m.userId}${m.googleLinked ? "  [Gmail linked]" : ""}`);
      }
    }
    return;
  }

  const email = positionals[0]?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Usage: npm run staff:grant -- <email> [--lounge <slug>] [--role STAFF|MANAGER]");
  const role = values.role?.toUpperCase();
  if (role !== "STAFF" && role !== "MANAGER") throw new Error(`--role must be STAFF or MANAGER, not "${values.role}".`);

  for (const l of lounges) {
    const r = await grantLoungeAccess({ loungeId: l.id, actorId: null }, { email, role: role as GrantableRole });
    const note = r.created ? " (new account, waiting for first Gmail sign-in)" : r.promoted ? " (customer account promoted to staff)" : "";
    console.log(`${role} at ${l.name}: ${email}${note}`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
