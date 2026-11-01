import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkBranchPin, setMemberPin } from "@/server/services/pos-pin";
import { addStaffMember, grantLoungeAccess, listLoungeStaff, revokeLoungeAccess, updateStaffMember } from "@/server/services/staff-access";
import { getLoungeAccess, getManagedLounge, getPlatformRole } from "@/server/staff";

/**
 * Staff access by email address: granting prepares (or promotes) the account and the lounge
 * membership; a PIN set by a manager is then the way in.
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

describe("granting cashier access to an email address", () => {
  it("prepares a STAFF account that can sign in once it has a PIN", async () => {
    const email = mail("new");
    const r = await grantLoungeAccess(system(), { email: email.toUpperCase(), role: "STAFF" });
    expect(r).toMatchObject({ created: true, promoted: false });

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: "STAFF", passwordHash: null, isActive: true });
    expect(await getLoungeAccess(user.id, loungeId)).toEqual({ loungeId, role: "STAFF" });
    expect(await getManagedLounge(user.id)).toMatchObject({ id: loungeId, role: "STAFF" });

    expect((await listLoungeStaff(loungeId)).find((m) => m.userId === user.id)).toMatchObject({ hasPin: false, role: "STAFF" });
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

  it("creates the account with name, phone and a first PIN that signs in at the lounge", async () => {
    const email = mail("added");
    const r = await addStaffMember(asOwner(), { email, name: "Sara Ali", phone: "+964 750 123 4567", role: "STAFF", pin: "4821", actorRole: "OWNER" });
    expect(r).toMatchObject({ created: true, role: "STAFF" });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ name: "Sara Ali", phone: "+964 750 123 4567", role: "STAFF" });
    expect(await getLoungeAccess(r.userId, loungeId)).toEqual({ loungeId, role: "STAFF" });
    expect(await checkBranchPin({ loungeId, pin: "4821" })).toEqual({ ok: true, userId: r.userId });
    expect((await listLoungeStaff(loungeId)).find((m) => m.userId === r.userId)).toMatchObject({ hasPin: true, onShift: false, phone: "+964 750 123 4567" });
  });

  it("locks PIN sign-in at the branch after five wrong PINs, for longer each time, and a correct PIN resets it", async () => {
    const r = await addStaffMember(asOwner(), { email: mail("lockout"), name: "L", phone: null, role: "STAFF", pin: "6307", actorRole: "OWNER" });
    const t0 = new Date();
    const at = (ms: number) => new Date(t0.getTime() + ms);
    try {
      for (let i = 4; i >= 1; i--) expect(await checkBranchPin({ loungeId, pin: "9990" }, t0)).toEqual({ ok: false, reason: "INVALID", attemptsLeft: i });
      expect(await checkBranchPin({ loungeId, pin: "9990" }, t0)).toEqual({ ok: false, reason: "LOCKED", retryAfter: 60 });
      // Even the right PIN waits out the lock.
      expect(await checkBranchPin({ loungeId, pin: "6307" }, at(30_000))).toMatchObject({ reason: "LOCKED" });

      for (let i = 0; i < 4; i++) await checkBranchPin({ loungeId, pin: "9990" }, at(61_000));
      expect(await checkBranchPin({ loungeId, pin: "9990" }, at(61_000))).toEqual({ ok: false, reason: "LOCKED", retryAfter: 120 });

      expect(await checkBranchPin({ loungeId, pin: "6307" }, at(182_000))).toEqual({ ok: true, userId: r.userId });
      expect(await checkBranchPin({ loungeId, pin: "9990" }, at(182_000))).toEqual({ ok: false, reason: "INVALID", attemptsLeft: 4 });
    } finally {
      await db.lounge.update({ where: { id: loungeId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
    }
  });

  it("keeps PINs unique at the branch and signs nobody in on a PIN two people share", async () => {
    const a = await addStaffMember(asOwner(), { email: mail("uniq-a"), name: "A", phone: null, role: "STAFF", pin: "7149", actorRole: "OWNER" });
    await expectCode(addStaffMember(asOwner(), { email: mail("uniq-b"), name: "B", phone: null, role: "STAFF", pin: "7149", actorRole: "OWNER" }), "PIN_TAKEN");
    const b = await addStaffMember(asOwner(), { email: mail("uniq-b"), name: "B", phone: null, role: "STAFF", pin: null, actorRole: "OWNER" });
    await expectCode(setMemberPin(asOwner(), { memberId: b.memberId, pin: "7149", actorRole: "OWNER" }), "PIN_TAKEN");
    // Setting your own PIN again is fine.
    await setMemberPin(asOwner(), { memberId: a.memberId, pin: "7149", actorRole: "OWNER" });

    // A PIN shared from before PINs had to be unique.
    const shared = await db.user.findUniqueOrThrow({ where: { id: a.userId }, select: { pinHash: true } });
    await db.user.update({ where: { id: b.userId }, data: { pinHash: shared.pinHash } });
    expect(await checkBranchPin({ loungeId, pin: "7149" })).toEqual({ ok: false, reason: "SHARED" });
    await setMemberPin(asOwner(), { memberId: b.memberId, pin: "7150", actorRole: "OWNER" });
  });

  it("keeps an existing account's name and refuses weak PINs and managers added by managers", async () => {
    const email = mail("named");
    await db.user.create({ data: { email, name: "Own Name", role: "CUSTOMER", emailVerified: new Date() } });
    const r = await addStaffMember(asOwner(), { email, name: "Other", phone: null, role: "STAFF", pin: null, actorRole: "OWNER" });
    expect(await db.user.findUniqueOrThrow({ where: { id: r.userId } })).toMatchObject({ name: "Own Name", role: "STAFF", pinHash: null });

    await expectCode(addStaffMember(asOwner(), { email: mail("weak"), name: "W", phone: null, role: "STAFF", pin: "1234", actorRole: "OWNER" }), "WEAK_PIN");
    const asManager = { loungeId, actorId: r.userId };
    await expectCode(addStaffMember(asManager, { email: mail("mgr3"), name: "M", phone: null, role: "MANAGER", pin: null, actorRole: "MANAGER" }), "FORBIDDEN");
    // Re-adding the owner's address can't set the owner's PIN.
    await expectCode(
      addStaffMember(asManager, { email: "owner@gamelounge.dev", name: "x", phone: null, role: "STAFF", pin: "5072", actorRole: "MANAGER" }),
      "FORBIDDEN",
    );
  });

  it("lets owners change roles and managers edit only cashiers' details", async () => {
    const cashier = await addStaffMember(asOwner(), { email: mail("edit-c"), name: "C", phone: null, role: "STAFF", pin: null, actorRole: "OWNER" });
    const manager = await addStaffMember(asOwner(), { email: mail("edit-m"), name: "M", phone: null, role: "MANAGER", pin: null, actorRole: "OWNER" });
    const asManager = { loungeId, actorId: manager.userId };

    await updateStaffMember(asManager, { memberId: cashier.memberId, name: "Cashier Two", phone: "0750 000 0000", role: "STAFF", actorRole: "MANAGER" });
    expect(await db.user.findUniqueOrThrow({ where: { id: cashier.userId } })).toMatchObject({ name: "Cashier Two", phone: "0750 000 0000" });
    await expectCode(updateStaffMember(asManager, { memberId: cashier.memberId, name: "C", phone: null, role: "MANAGER", actorRole: "MANAGER" }), "FORBIDDEN");
    await expectCode(updateStaffMember(asManager, { memberId: manager.memberId, name: "M", phone: null, role: "STAFF", actorRole: "MANAGER" }), "FORBIDDEN");

    await updateStaffMember(asOwner(), { memberId: cashier.memberId, name: "Cashier Two", phone: null, role: "MANAGER", actorRole: "OWNER" });
    expect(await getLoungeAccess(cashier.userId, loungeId)).toEqual({ loungeId, role: "MANAGER" });
  });

  it("changes a member's email and refuses an email or phone another account holds", async () => {
    const one = await addStaffMember(asOwner(), { email: mail("contact-1"), name: "One", phone: "0770 111 2222", role: "STAFF", pin: null, actorRole: "OWNER" });
    const two = await addStaffMember(asOwner(), { email: mail("contact-2"), name: "Two", phone: null, role: "STAFF", pin: null, actorRole: "OWNER" });
    const fresh = mail("contact-new");

    await updateStaffMember(asOwner(), { memberId: two.memberId, name: "Two", email: fresh.toUpperCase(), phone: null, role: "STAFF", actorRole: "OWNER" });
    expect(await db.user.findUniqueOrThrow({ where: { id: two.userId } })).toMatchObject({ email: fresh, emailVerified: null });

    await expectCode(
      updateStaffMember(asOwner(), { memberId: two.memberId, name: "Two", email: mail("contact-1"), phone: null, role: "STAFF", actorRole: "OWNER" }),
      "EMAIL_TAKEN",
    );
    await expectCode(
      updateStaffMember(asOwner(), { memberId: two.memberId, name: "Two", phone: "0770 111 2222", role: "STAFF", actorRole: "OWNER" }),
      "PHONE_TAKEN",
    );
    // Saving your own unchanged email and phone is fine.
    await updateStaffMember(asOwner(), { memberId: one.memberId, name: "One!", email: mail("contact-1"), phone: "0770 111 2222", role: "STAFF", actorRole: "OWNER" });
  });
});
