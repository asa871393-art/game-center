import "server-only";
import { refresh } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import type { LoungeMemberRole } from "@/generated/prisma/client";
import { getDictionaryFor } from "@/i18n/server";
import { PosError, type PosContext, type PosErrorCode } from "@/server/services/pos";
import { getLoungeAccess, hasLoungeRole } from "@/server/staff";

/**
 * Shared pipeline for lounge-scoped Server Actions. Lives outside the
 * "use server" files so it is never exposed as an action itself.
 */

export type PosActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: PosErrorCode | "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" };

export const actionId = z.string().min(1).max(64);
export const loungeScoped = z.object({ locale: z.string().max(5), loungeId: actionId });

/** Validate, authenticate, authorize against the lounge (from the database), run, and refresh the page. */
export async function runLoungeAction<S extends typeof loungeScoped, T>(
  schema: S,
  payload: unknown,
  minRole: LoungeMemberRole,
  fn: (ctx: PosContext, input: z.infer<S>) => Promise<T>,
): Promise<PosActionResult<T>> {
  const locale = (payload as { locale?: unknown } | null)?.locale;
  const dict = await getDictionaryFor(typeof locale === "string" ? locale : "ar");

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: dict.errors.validation, code: "VALIDATION" };

  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: dict.errors.unauthenticated, code: "UNAUTHENTICATED" };

  const access = await getLoungeAccess(session.user.id, parsed.data.loungeId);
  if (!access || !hasLoungeRole(access, minRole)) {
    return { ok: false, error: dict.manage.errors.FORBIDDEN, code: "FORBIDDEN" };
  }

  try {
    const data = await fn({ loungeId: access.loungeId, actorId: session.user.id }, parsed.data);
    refresh();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof PosError) {
      // Someone else changed it: show the latest state along with the message.
      if (error.code === "STALE" || error.code === "PAYMENT_MISMATCH") refresh();
      return { ok: false, error: dict.manage.errors[error.code], code: error.code };
    }
    console.error("Lounge action failed", error);
    return { ok: false, error: dict.errors.generic };
  }
}
