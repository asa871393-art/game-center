"use client";

import { Languages } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { LOCALE_COOKIE, localeMeta, localePath, locales, stripLocale } from "@/i18n/config";

export function LocaleSwitcher() {
  const { locale, dict } = useI18n();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const other = locales.find((l) => l !== locale)!;
  const href = localePath(other, stripLocale(pathname)) + (search ? `?${search}` : "");

  return (
    <Link
      href={href}
      hrefLang={other}
      aria-label={dict.common.language}
      className={buttonVariants({ variant: "ghost", size: "sm" })}
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=31536000; samesite=lax`;
      }}
    >
      <Languages aria-hidden />
      {localeMeta[other].label}
    </Link>
  );
}
