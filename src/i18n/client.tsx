"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { localeMeta, localePath, type Locale } from "./config";
import type { Dictionary } from "./dictionaries/ar";
import { format } from "./format";

interface I18nValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  intl: string;
  dict: Dictionary;
  /** Fills placeholders in an already-selected string. */
  t: typeof format;
  /** Locale-prefixed href. */
  href: (path: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dictionary; children: ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      dir: localeMeta[locale].dir,
      intl: localeMeta[locale].intl,
      dict,
      t: format,
      href: (path) => localePath(locale, path),
    }),
    [locale, dict],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
