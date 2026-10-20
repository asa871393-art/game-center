"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { getDictionaryFor } from "@/i18n/server";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  locale: z.string().max(5),
  loungeId: z.string().min(1).max(64),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

export type AdminActionResult = { ok: true } | { ok: false; error: string };

/**
 * Suspends or reactivates a lounge. Suspended lounges disappear from search and
 * can't take online bookings; their staff board keeps working for running sessions.
 */
export async function setLoungeStatusAction(payload: z.input<typeof schema>): Promise<AdminActionResult> {
  const dict = await getDictionaryFor(typeof payload?.locale === "string" ? payload.locale : "ar");
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: dict.errors.validation };

  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: dict.errors.unauthenticated };
  // Re-check the role in the database; the JWT may be stale.
  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, isActive: true } });
  if (actor?.role !== "SUPER_ADMIN" || !actor.isActive) return { ok: false, error: dict.manage.errors.FORBIDDEN };

  const { loungeId, status } = parsed.data;
  const lounge = await prisma.lounge.findUnique({ where: { id: loungeId }, select: { status: true } });
  if (!lounge) return { ok: false, error: dict.manage.errors.NOT_FOUND };
  if (lounge.status === status) return { ok: true };

  await prisma.$transaction([
    prisma.lounge.update({ where: { id: loungeId }, data: { status } }),
    prisma.auditLog.create({
      data: {
        actorId: session.user.id,
        loungeId,
        action: status === "SUSPENDED" ? "lounge.suspend" : "lounge.activate",
        entityType: "Lounge",
        entityId: loungeId,
        data: { from: lounge.status, to: status },
      },
    }),
  ]);
  refresh();
  return { ok: true };
}
