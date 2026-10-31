import { isLocale, localePath, type Locale } from "@/i18n/config";

/** Sections the cashier sign-in may return to: the POS, management dashboards and printouts. */
const STAFF_SECTIONS = new Set(["pos", "manage", "receipt", "shift-report"]);

/** The cashier sign-in page, returning to `path` (a locale-less staff path) afterwards. */
export function posLoginHref(locale: Locale, path = "/pos"): string {
  return `${localePath(locale, "/pos/login")}?callbackUrl=${encodeURIComponent(localePath(locale, path))}`;
}

/**
 * Where to send someone after the cashier sign-in: the requested staff page when it is one,
 * otherwise the POS home. Only same-site /{locale}/{pos|manage|receipt|shift-report} paths
 * are accepted.
 */
export function posCallback(locale: Locale, raw: unknown): string {
  if (typeof raw !== "string") return localePath(locale, "/pos");
  const [, first, second] = raw.split("?")[0].split("/");
  const ok = raw.startsWith("/") && !raw.startsWith("//") && isLocale(first) && STAFF_SECTIONS.has(second) && !raw.includes("\\");
  return ok && !/^\/[^/]+\/pos\/login(?:[/?]|$)/.test(raw) ? raw : localePath(locale, "/pos");
}
