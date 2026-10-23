"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth, signOut } from "@/auth";
import { isLocale } from "@/i18n/config";
import { authSecret } from "@/lib/env";
import { posLoginHref } from "@/lib/pos-login";
import { POS_TERMINAL_COOKIE, POS_TERMINAL_MAX_AGE, signTerminal } from "@/lib/pos-terminal";
import { getLoungeAccess } from "@/server/staff";

const lockSchema = z.object({ locale: z.string().max(5), loungeId: z.string().min(1).max(64), path: z.string().max(512) });

/**
 * "Lock screen / switch staff": registers this browser as the lounge's cashier terminal (so the
 * PIN keypad can be used here), ends the current staff session and shows the keypad. Shifts are
 * stored per lounge, so an open shift stays open for whoever signs in next.
 */
export async function lockPosAction(formData: FormData): Promise<void> {
  const parsed = lockSchema.safeParse(Object.fromEntries(formData));
  const locale = parsed.success && isLocale(parsed.data.locale) ? parsed.data.locale : "ar";
  if (!parsed.success) redirect(posLoginHref(locale));
  const { loungeId, path } = parsed.data;
  // Back to the locked page afterwards, when it is one of this lounge's POS pages.
  const back = path === `/pos/${loungeId}` || path.startsWith(`/pos/${loungeId}/`) ? path : `/pos/${loungeId}`;

  const session = await auth();
  if (session?.user?.id && (await getLoungeAccess(session.user.id, loungeId))) {
    (await cookies()).set(POS_TERMINAL_COOKIE, signTerminal(loungeId, authSecret), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: POS_TERMINAL_MAX_AGE,
    });
  }
  await signOut({ redirectTo: posLoginHref(locale, back) });
}
