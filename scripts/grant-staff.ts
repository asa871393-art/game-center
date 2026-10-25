/**
 * Gives an account cashier (or manager) access to lounges, and optionally its sign-in PIN, against
 * whichever Firestore .env points at (the live project, or the emulator when FIRESTORE_EMULATOR_HOST
 * is set).
 *
 *   npm run staff:grant -- ali@gmail.com                         cashier at every lounge
 *   npm run staff:grant -- ali@gmail.com --lounge nexus-downtown  one lounge (by slug)
 *   npm run staff:grant -- ali@gmail.com --role MANAGER
 *   npm run staff:grant -- me@gmail.com --role SUPER_ADMIN       platform admin, owner of the primary branch
 *   npm run staff:grant -- ali@gmail.com --pin 4821              also set the sign-in PIN (4-6 digits)
 *   npm run staff:grant -- --list                                 lounges and their staff
 *
 * PINs are the only sign-in (on /pos/login); without one the account can't sign in yet.
 * Lounge managers can do the same from the Staff screens without this script.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { hashPin, isValidPin, isWeakPin, PIN_RESET_STATE } from "@/lib/pin";
import { db } from "@/server/db";
import { grantLoungeAccess, listLoungeStaff, type GrantableRole } from "@/server/services/staff-access";
import { getPrimaryLoungeId } from "@/server/staff";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      lounge: { type: "string" },
      role: { type: "string", default: "STAFF" },
      pin: { type: "string" },
      list: { type: "boolean", default: false },
    },
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
        console.log(`  ${m.role.padEnd(8)} ${m.email ?? m.name ?? m.userId}${m.hasPin ? "  [PIN set]" : "  [no PIN]"}`);
      }
    }
    return;
  }

  const email = positionals[0]?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Usage: npm run staff:grant -- <email> [--lounge <slug>] [--role STAFF|MANAGER|SUPER_ADMIN] [--pin <digits>]");
  const role = values.role?.toUpperCase();
  if (values.pin !== undefined && (!isValidPin(values.pin) || isWeakPin(values.pin))) {
    throw new Error("--pin must be 4-6 digits, not a repeated digit or a straight run like 1111 or 1234.");
  }
  if (role === "SUPER_ADMIN") {
    await grantSuperAdmin(email, values.lounge ? lounges[0].id : await getPrimaryLoungeId());
    return setPin(email, values.pin);
  }
  if (role !== "STAFF" && role !== "MANAGER") throw new Error(`--role must be STAFF, MANAGER or SUPER_ADMIN, not "${values.role}".`);

  for (const l of lounges) {
    const r = await grantLoungeAccess({ loungeId: l.id, actorId: null }, { email, role: role as GrantableRole });
    const note = r.created ? " (new account)" : r.promoted ? " (customer account promoted to staff)" : "";
    console.log(`${role} at ${l.name}: ${email}${note}`);
  }
  await setPin(email, values.pin);
}

/** Sets the account's sign-in PIN (when one was given) and clears any PIN lockout. */
async function setPin(email: string, pin: string | undefined) {
  if (pin === undefined) return;
  await db.user.update({
    where: { email },
    data: { pinHash: await hashPin(pin), pinFailedAttempts: PIN_RESET_STATE.failures, pinLockedUntil: PIN_RESET_STATE.lockedUntil },
  });
  console.log(`PIN set for ${email}.`);
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
  console.log(`${user.role} and OWNER at ${lounge.name}: ${email}${created ? " (new account)" : ""}${user.isActive ? "" : " [account disabled]"}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
