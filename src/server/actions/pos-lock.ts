"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signOut } from "@/auth";
import { isLocale } from "@/i18n/config";
import { posLoginHref } from "@/lib/pos-login";

const lockSchema = z.object({ locale: z.string().max(5), loungeId: z.string().min(1).max(64), path: z.string().max(512) });

/**
 * "Lock screen / switch staff": ends the current staff session and shows the Google sign-in,
 * which returns to the locked POS page. Shifts are stored per lounge, so an open shift stays
 * open for whoever signs in next.
 */
export async function lockPosAction(formData: FormData): Promise<void> {
  const parsed = lockSchema.safeParse(Object.fromEntries(formData));
  const locale = parsed.success && isLocale(parsed.data.locale) ? parsed.data.locale : "ar";
  if (!parsed.success) redirect(posLoginHref(locale));
  const { loungeId, path } = parsed.data;
  // Back to the locked page afterwards, when it is one of this lounge's POS pages.
  const back = path === `/pos/${loungeId}` || path.startsWith(`/pos/${loungeId}/`) ? path : `/pos/${loungeId}`;
  await signOut({ redirectTo: posLoginHref(locale, back) });
}
