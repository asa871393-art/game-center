import { notFound } from "next/navigation";
import { locale as localeParam } from "next/root-params";
import { isLocale, type Locale } from "./config";
import type { Dictionary } from "./dictionaries/ar";

const dictionaries: Record<Locale, () => Promise<Dictionary>> = {
  ar: () => import("./dictionaries/ar").then((m) => m.default),
  en: () => import("./dictionaries/en").then((m) => m.default),
};

/** Current locale from the `[locale]` root segment (Server Components only). */
export async function getLocale(): Promise<Locale> {
  const value = await localeParam();
  if (!isLocale(value)) notFound();
  return value;
}

export async function getDictionary(locale?: Locale): Promise<Dictionary> {
  return dictionaries[locale ?? (await getLocale())]();
}

/** Server Actions can't read root params; they receive the locale explicitly. */
export async function getDictionaryFor(value: string): Promise<Dictionary> {
  return dictionaries[isLocale(value) ? value : "ar"]();
}
