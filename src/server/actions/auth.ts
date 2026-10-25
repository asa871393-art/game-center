"use server";

import { signIn, signOut } from "@/auth";
import { isLocale, localePath } from "@/i18n/config";
import { isGoogleAuthEnabled } from "@/lib/env";

/** Only allow same-origin relative redirects ("/ar/..."), never "//evil.com". */
function safeRedirect(target: FormDataEntryValue | null, locale: string): string {
  const fallback = localePath(isLocale(locale) ? locale : "ar");
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) {
    return fallback;
  }
  return target;
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  if (!isGoogleAuthEnabled) return;
  const locale = String(formData.get("locale") ?? "ar");
  await signIn("google", { redirectTo: safeRedirect(formData.get("callbackUrl"), locale) });
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "ar");
  await signOut({ redirectTo: safeRedirect(formData.get("redirectTo"), locale) });
}
