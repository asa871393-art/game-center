import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firestoreAdapter } from "@/server/auth-adapter";
import { db } from "@/server/db";
import { addStaffMember, grantLoungeAccess, listLoungeStaff, revokeLoungeAccess, updateStaffMember } from "@/server/services/staff-access";
import { getLoungeAccess, getManagedLounge, getPlatformRole } from "@/server/staff";

/**
 * Cashier access by Gmail address: granting prepares (or promotes) the account and the
 * lounge membership, and the first Google sign-in links to it with the staff role intact.
 */

const RUN = `gmail-staff-${Date.now()}`;
const mail = (who: string) => `${RUN}-${who}@gmail.com`;
let loungeId: string;
let ownerId: string;
const system = () => ({ loungeId, actorId: null });

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  const lounge = await db.lounge.findUniqueOrThrow({ where: { slug: "nexus-downtown" }, select: { id: true } });
  loungeId = lounge.id;
  ownerId = (await db.user.findUniqueOrThrow({ where: { email: "owner@gamelounge.dev" }, select: { id: true } })).id;
});

afterAll(async () => {
  const users = await db.user.findMany({ where: { email: { startsWith: RUN } }, select: { id: true } });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
});

describe("granting cashier access to a Gmail address", () => {
  it("prepares a password-less STAFF account that the first Google sign-in links to", async () => {
    const email = mail("new");
    const r = await grantLoungeAccess(system(), { email: email.toUpperCase(), role: "STAFF" });
    expect(r).toMatchObject({ created: true, promoted: false });

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: "STAFF", passwordHash: null, isActive: true });
    expect(await getLoungeAccess(user.id, loungeId)).toEqual({ loungeId, role: "STAFF" });
    expect(await getManagedLounge(user.id)).toMatchObject({ id: loungeId, role: "STAFF" });

    // Auth.js on first Google sign-in: no account for this Google id, so it looks the email up and links.
    const adapter = firestoreAdapter();
    expect(await adapter.getUserByAccount!({ provider: "google", providerAccountId: `${RUN}-g1` })).toBeNull();
    const found = await adapter.getUserByEmail!(email);
    expect(found).toMatchObject({ id: user.id, role: "STAFF" });
    await adapter.linkAccount!({ userId: user.id, type: "oidc", provider: "google", providerAccountId: `${RUN}-g1` });
    expect(await adapter.getUserByAccount!({ provider: "google", providerAccountId: `${RUN}-g1` })).toMatchObject({ id: user.id, role: "STAFF" });
    expect((await listLoungeStaff(loungeId)).find((m) => m.userId === user.id)).toMatchObject({ googleLinked: true, role: "STAFF" });
  });

  it("is idempotent and re-activates a removed member", async () => {
    const email = mail("again");
    const first = await grantLoungeAccess(system(), { email, role: "STAFF" });
    await revokeLoungeAccess({ loungeId, actorId: ownerId }, { memberId: first.memberId, actorRole: "OWNER" });
    expect(await getLoungeAccess(first.userId, loungeId)).toBeNull();

    const second = await grantLoungeAccess(system(), { email, role: "STAFF" });
    expect(second).toMatchObject({ userId: first.userId, memberId: first.memberId, created: false });
    expect(await getLoungeAccess(first.userId, loungeId)).toEqual({ loungeId, role: "STAFF" });
    expect(await db.loungeMember.count({ where: { loungeId, userId: first.userId } })).toBe(1);
  });

  it("promotes a customer, dropping a password nobody verified", async () => {
    const unverified = await db.user.create({ data: { email: mail("squatter"), role: "CUSTOMER", passwordHash: "x" } });
    const verified = await db.user.create({ data: { email: mail("verified"), role: "CUSTOMER", passwordHash: "y", emailVerified: new Date() } });

    expect(await grantLoungeAccess(system(), { email: unverified.email!, role: "STAFF" })).toMatchObject({ promoted: true });
    expect(await db.user.findUniqueOrThrow({ where: { id: unverified.id } })).toMatchObject({ role: "STAFF", passwordHash: null });

    await grantLoungeAccess(system(), { email: verified.email!, role: "STAFF" });
    expect(await db.user.findUniqueOrThrow({ where: { id: verified.id } })).toMatchObject({ role: "STAFF", passwordHash: "y" });
    // The POS gate reads the role from the database, so no new sign-in is needed.
    expect(await getPlatformRole(verified.id)).toBe("STAFF");
  });

  it("never lowers a platform admin and refuses disabled accounts", async () => {
    const admin = await db.user.create({ data: { email: mail("admin"), role: "LOUNGE_ADMIN", emailVerified: new Date() } });
    expect(await grantLoungeAccess(system(), { email: admin.email!, role: "STAFF" })).toMatchObject({ promoted: false });
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("LOUNGE_ADMIN");

    const off = await db.user.create({ data: { email: mail("off"), role: "CUSTOMER", isActive: false } });
    await expectCode(grantLoungeAccess(system(), { email: off.email!, role: "STAFF" }), "ACCOUNT_DISABLED");
    expect(await getPlatformRole(off.id)).toBeNull();
  });
});

describe("removing access", () => {
  it("lets managers remove cashiers but not managers, owners, or themselves", async () => {
    const manager = await grantLoungeAccess(system(), { email: mail("mgr"), role: "MANAGER" });
    const otherManager = await grantLoungeAccess(system(), { email: mail("mgr2"), role: "MANAGER" });
    const cashier = await grantLoungeAccess(system(), { email: mail("cashier"), role: "STAFF" });
    const asManager = { loungeId, actorId: manager.userId };
    const ownerMember = await db.loungeMember.findUniqueOrThrow({ where: { loungeId_userId: { loungeId, userId: ownerId } } });

    await expectCode(revokeLoungeAccess(asManager, { memberId: manager.memberId, actorRole: "MANAGER" }), "CANNOT_REMOVE_SELF");
    await expectCode(revokeLoungeAccess(asManager, { memberId: otherManager.memberId, actorRole: "MANAGER" }), "FORBIDDEN");
    await expectCode(revokeLoungeAccess(asManager, { memberId: ownerMember.id, actorRole: "MANAGER" }), "FORBIDDEN");
    await expectCode(revokeLoungeAccess(asManager, { memberId: "no-such-member", actorRole: "MANAGER" }), "NOT_FOUND");

    await revokeLoungeAccess(asManager, { memberId: cashier.memberId, actorRole: "MANAGER" });
    expect(await getLoungeAccess(cashier.userId, loungeId)).toBeNull();
    expect((await listLoungeStaff(loungeId)).some((m) => m.userId === cashier.userId)).toBe(false);

    await revokeLoungeAccess({ loungeId, actorId: ownerId }, { memberId: otherManager.memberId, actorRole: "OWNER" });
    expect(await getLoungeAccess(otherManager.userId, loungeId)).toBeNull();
  });

  it("does not demote the lounge owner when their email is granted again", async () => {
    await grantLoungeAccess(system(), { email: "owner@gamelounge.dev", role: "STAFF" });
    expect(await getLoungeAccess(ownerId, loungeId)).toEqual({ loungeId, role: "OWNER" });
  });
});

describe("adding and editing staff from the dashboard", () => {
  const asOwner = () => ({ loungeId, actorId: ownerId });

  it("creates the account with name and phone", async () => {
    const email = mail("added");
    const r = await addStaffMember(asOwner(), { email, name: "Sara Ali", phone: "+964 750 123 4567", role: "STAFF", actorRole: "OWNER" });
    expect(r).toMatchObject({ created: true, role: "STAFF" });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ name: "Sara Ali", phone: "+964 750 123 4567", role: "STAFF" });
    expect(await getLoungeAccess(r.userId, loungeId)).toEqual({ loungeId, role: "STAFF" });
    expect((await listLoungeStaff(loungeId)).find((m) => m.userId === r.userId)).toMatchObject({ onShift: false, phone: "+964 750 123 4567" });
  });

  it("keeps an existing account's name and refuses managers added by managers", async () => {
    const email = mail("named");
    await db.user.create({ data: { email, name: "Own Name", role: "CUSTOMER", emailVerified: new Date() } });
    const r = await addStaffMember(asOwner(), { email, name: "Other", phone: null, role: "STAFF", actorRole: "OWNER" });
    expect(await db.user.findUniqueOrThrow({ where: { id: r.userId } })).toMatchObject({ name: "Own Name", role: "STAFF" });

    const asManager = { loungeId, actorId: r.userId };
    await expectCode(addStaffMember(asManager, { email: mail("mgr3"), name: "M", phone: null, role: "MANAGER", actorRole: "MANAGER" }), "FORBIDDEN");
    // Re-adding the owner's address doesn't demote them.
    await addStaffMember(asManager, { email: "owner@gamelounge.dev", name: "x", phone: null, role: "STAFF", actorRole: "MANAGER" });
    expect(await getLoungeAccess(ownerId, loungeId)).toEqual({ loungeId, role: "OWNER" });
  });

  it("lets owners change roles and managers edit only cashiers' details", async () => {
    const cashier = await addStaffMember(asOwner(), { email: mail("edit-c"), name: "C", phone: null, role: "STAFF", actorRole: "OWNER" });
    const manager = await addStaffMember(asOwner(), { email: mail("edit-m"), name: "M", phone: null, role: "MANAGER", actorRole: "OWNER" });
    const asManager = { loungeId, actorId: manager.userId };

    await updateStaffMember(asManager, { memberId: cashier.memberId, name: "Cashier Two", phone: "0750 000 0000", role: "STAFF", actorRole: "MANAGER" });
    expect(await db.user.findUniqueOrThrow({ where: { id: cashier.userId } })).toMatchObject({ name: "Cashier Two", phone: "0750 000 0000" });
    await expectCode(updateStaffMember(asManager, { memberId: cashier.memberId, name: "C", phone: null, role: "MANAGER", actorRole: "MANAGER" }), "FORBIDDEN");
    await expectCode(updateStaffMember(asManager, { memberId: manager.memberId, name: "M", phone: null, role: "STAFF", actorRole: "MANAGER" }), "FORBIDDEN");

    await updateStaffMember(asOwner(), { memberId: cashier.memberId, name: "Cashier Two", phone: null, role: "MANAGER", actorRole: "OWNER" });
    expect(await getLoungeAccess(cashier.userId, loungeId)).toEqual({ loungeId, role: "MANAGER" });
  });
});
