import { isLocale, localePath, type Locale } from "@/i18n/config";

/** The cashier sign-in page, returning to `path` (a locale-less POS path) afterwards. */
export function posLoginHref(locale: Locale, path = "/pos"): string {
  return `${localePath(locale, "/pos/login")}?callbackUrl=${encodeURIComponent(localePath(locale, path))}`;
}

/**
 * Where to send someone after the cashier sign-in: the requested POS page when it is one,
 * otherwise the POS home. Only same-site /{locale}/pos paths are accepted.
 */
export function posCallback(locale: Locale, raw: unknown): string {
  if (typeof raw !== "string") return localePath(locale, "/pos");
  const [, first, second] = raw.split("?")[0].split("/");
  const ok = raw.startsWith("/") && !raw.startsWith("//") && isLocale(first) && second === "pos" && !raw.includes("\\");
  return ok && !/^\/[^/]+\/pos\/login(?:[/?]|$)/.test(raw) ? raw : localePath(locale, "/pos");
}
