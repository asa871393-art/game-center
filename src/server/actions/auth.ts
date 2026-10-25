"use server";

import { signOut } from "@/auth";
import { isLocale, localePath } from "@/i18n/config";

/** Only allow same-origin relative redirects ("/ar/..."), never "//evil.com". */
function safeRedirect(target: FormDataEntryValue | null, locale: string): string {
  const fallback = localePath(isLocale(locale) ? locale : "ar");
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) {
    return fallback;
  }
  return target;
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "ar");
  await signOut({ redirectTo: safeRedirect(formData.get("redirectTo"), locale) });
}
