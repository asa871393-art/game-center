import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getLoungeAccess, getManagedLounge, getPrimaryLoungeId } from "@/server/staff";

/** Who may open a lounge's POS: a staff platform role plus a membership, or a super admin. */

const RUN = `staff-gate-${Date.now()}`;
let loungeId: string;
const userIds: string[] = [];

async function userWith(role: "CUSTOMER" | "STAFF" | "SUPER_ADMIN", member: boolean, isActive = true) {
  const user = await db.user.create({ data: { email: `${RUN}-${role}-${member}-${isActive}@test.dev`.toLowerCase(), role, isActive } });
  userIds.push(user.id);
  if (member) await db.loungeMember.create({ data: { loungeId, userId: user.id, role: "STAFF" } });
  return user.id;
}

beforeAll(async () => {
  loungeId = (await db.lounge.findUniqueOrThrow({ where: { slug: "nexus-downtown" }, select: { id: true } })).id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("POS access gate", () => {
  it("lets a STAFF member in with their membership role", async () => {
    const id = await userWith("STAFF", true);
    expect(await getLoungeAccess(id, loungeId)).toEqual({ loungeId, role: "STAFF" });
    expect(await getManagedLounge(id)).toMatchObject({ id: loungeId, role: "STAFF" });
  });

  it("refuses a CUSTOMER even when they hold a membership", async () => {
    const id = await userWith("CUSTOMER", true);
    expect(await getLoungeAccess(id, loungeId)).toBeNull();
    expect(await getManagedLounge(id)).toBeNull();
  });

  it("refuses STAFF without a membership and deactivated staff", async () => {
    expect(await getLoungeAccess(await userWith("STAFF", false), loungeId)).toBeNull();
    expect(await getLoungeAccess(await userWith("STAFF", true, false), loungeId)).toBeNull();
  });

  it("gives a SUPER_ADMIN owner access to any existing lounge only", async () => {
    const id = await userWith("SUPER_ADMIN", false);
    expect(await getLoungeAccess(id, loungeId)).toEqual({ loungeId, role: "OWNER" });
    expect(await getLoungeAccess(id, "no-such-lounge")).toBeNull();
  });

  it("locks everyone, super admins included, to the primary branch (the oldest lounge: nexus-downtown in the seed)", async () => {
    expect(await getPrimaryLoungeId()).toBe(loungeId);
    const other = (await db.lounge.findUniqueOrThrow({ where: { slug: "pixel-hub-erbil" }, select: { id: true } })).id;
    const admin = (await db.user.findUniqueOrThrow({ where: { email: `${RUN}-SUPER_ADMIN-false-true@test.dev`.toLowerCase() } })).id;
    expect(await getLoungeAccess(admin, other)).toBeNull();
  });
});
