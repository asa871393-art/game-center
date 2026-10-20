export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ar";

/** Cookie that remembers an explicit language choice. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const localeMeta: Record<Locale, { dir: "rtl" | "ltr"; intl: string; label: string }> = {
  ar: { dir: "rtl", intl: "ar-IQ", label: "العربية" },
  en: { dir: "ltr", intl: "en-US", label: "English" },
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

/** Prefixes an app path with the locale: localePath("en", "/lounges") -> "/en/lounges". */
export function localePath(locale: Locale, path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

/** Removes a leading locale segment: "/en/lounges" -> "/lounges". */
export function stripLocale(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  return isLocale(first) ? `/${rest.join("/")}` : pathname;
}
