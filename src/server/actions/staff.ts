"use server";

import { z } from "zod";
import { PosError } from "@/server/services/pos";
import { grantLoungeAccess, revokeLoungeAccess } from "@/server/services/staff-access";
import { getLoungeAccess } from "@/server/staff";
import { actionId as id, loungeScoped as base, runLoungeAction as run } from "./pipeline";

/** Lounge staff and cashier access: managers add cashiers, owners also add managers. */

/** The caller's lounge role (the pipeline has already checked they are at least a manager). */
async function actorRole(ctx: { loungeId: string; actorId: string }) {
  const access = await getLoungeAccess(ctx.actorId, ctx.loungeId);
  if (!access) throw new PosError("FORBIDDEN");
  return access.role;
}

const grantSchema = base.extend({
  email: z.email().trim().toLowerCase().max(254),
  role: z.enum(["STAFF", "MANAGER"]),
});

export async function grantStaffAction(payload: z.input<typeof grantSchema>) {
  return run(grantSchema, payload, "MANAGER", async (ctx, i) => {
    if (i.role === "MANAGER" && (await actorRole(ctx)) !== "OWNER") throw new PosError("FORBIDDEN");
    const result = await grantLoungeAccess(ctx, { email: i.email, role: i.role });
    return { created: result.created };
  });
}

const revokeSchema = base.extend({ memberId: id });

export async function revokeStaffAction(payload: z.input<typeof revokeSchema>) {
  return run(revokeSchema, payload, "MANAGER", async (ctx, i) => {
    await revokeLoungeAccess(ctx, { memberId: i.memberId, actorRole: await actorRole(ctx) });
    return null;
  });
}
