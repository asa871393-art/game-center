/**
 * Gives a Google account cashier (or manager) access to lounges, against whichever Firestore
 * .env points at (the live project, or the emulator when FIRESTORE_EMULATOR_HOST is set).
 *
 *   npm run staff:grant -- ali@gmail.com                         cashier at every lounge
 *   npm run staff:grant -- ali@gmail.com --lounge nexus-downtown  one lounge (by slug)
 *   npm run staff:grant -- ali@gmail.com --role MANAGER
 *   npm run staff:grant -- me@gmail.com --role SUPER_ADMIN       platform admin, owner of the primary branch
 *   npm run staff:grant -- --list                                 lounges and their staff
 *
 * The account needs no password: the first "Sign in with Gmail" on /pos/login links to it.
 * Lounge managers can do the same from the POS (Staff screen) without this script.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "@/server/db";
import { grantLoungeAccess, listLoungeStaff, type GrantableRole } from "@/server/services/staff-access";
import { getPrimaryLoungeId } from "@/server/staff";

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
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Usage: npm run staff:grant -- <email> [--lounge <slug>] [--role STAFF|MANAGER|SUPER_ADMIN]");
  const role = values.role?.toUpperCase();
  if (role === "SUPER_ADMIN") return grantSuperAdmin(email, values.lounge ? lounges[0].id : await getPrimaryLoungeId());
  if (role !== "STAFF" && role !== "MANAGER") throw new Error(`--role must be STAFF, MANAGER or SUPER_ADMIN, not "${values.role}".`);

  for (const l of lounges) {
    const r = await grantLoungeAccess({ loungeId: l.id, actorId: null }, { email, role: role as GrantableRole });
    const note = r.created ? " (new account, waiting for first Gmail sign-in)" : r.promoted ? " (customer account promoted to staff)" : "";
    console.log(`${role} at ${l.name}: ${email}${note}`);
  }
}

/**
 * Makes the address a platform SUPER_ADMIN and the OWNER of the branch, creating the account for
 * its first Google sign-in when needed. Super admins can open every POS and dashboard anyway; the
 * membership lists them on the branch's staff screen.
 */
async function grantSuperAdmin(email: string, loungeId: string | null) {
  if (!loungeId) throw new Error("No primary lounge found.");
  const { userId, memberId, created } = await grantLoungeAccess({ loungeId, actorId: null }, { email, role: "MANAGER" });
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role: "SUPER_ADMIN" } });
    await tx.loungeMember.update({ where: { id: memberId }, data: { role: "OWNER", isActive: true } });
    await tx.auditLog.create({
      data: { actorId: null, loungeId, action: "staff.superAdmin", entityType: "User", entityId: userId, data: { email } },
    });
  });
  const lounge = await db.lounge.findUniqueOrThrow({ where: { id: loungeId }, select: { name: true } });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, isActive: true } });
  console.log(`${user.role} and OWNER at ${lounge.name}: ${email}${created ? " (new account, waiting for first Google sign-in)" : ""}${user.isActive ? "" : " [account disabled]"}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
