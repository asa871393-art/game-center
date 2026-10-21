import { formatMoney, type Minor } from "@/lib/money";
import { localeMeta, type Locale } from "./config";

/** Fills {placeholders}: format("Book {device}", { device: "PC-01" }). */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** Display name in the current language: English when available in the English UI, Arabic otherwise. */
export function localName(locale: Locale, value: { name: string; nameEn?: string | null }): string {
  return locale === "en" && value.nameEn ? value.nameEn : value.name;
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(localeMeta[locale].intl).format(value);
}

export function money(locale: Locale, minor: Minor, currency: string): string {
  return formatMoney(minor, currency, localeMeta[locale].intl);
}

/** Wall-clock time in the lounge's timezone, e.g. "6:30 PM" / "٦:٣٠ م". */
export function formatTime(locale: Locale, instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat(localeMeta[locale].intl, { timeZone, hour: "numeric", minute: "2-digit" }).format(
    new Date(instant),
  );
}

export function formatDate(
  locale: Locale,
  instant: Date | string,
  timeZone: string,
  style: "full" | "medium" = "medium",
): string {
  const options: Intl.DateTimeFormatOptions =
    style === "full"
      ? { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : { timeZone, weekday: "short", day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(localeMeta[locale].intl, options).format(new Date(instant));
}

/** Minutes since midnight -> localized clock time ("12:00 PM"). */
export function formatMinuteOfDay(locale: Locale, minuteOfDay: number): string {
  const d = new Date(Date.UTC(2000, 0, 1, 0, minuteOfDay % 1440));
  return new Intl.DateTimeFormat(localeMeta[locale].intl, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(d);
}

export function formatDuration(
  locale: Locale,
  minutes: number,
  dict: { common: { hours: string; minutes: string } },
): string {
  if (minutes % 60 === 0) return format(dict.common.hours, { count: formatNumber(locale, minutes / 60) });
  if (minutes < 60) return format(dict.common.minutes, { count: formatNumber(locale, minutes) });
  return format(dict.common.hours, { count: formatNumber(locale, minutes / 60) });
}
