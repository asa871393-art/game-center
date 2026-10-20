import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/server/session";
import { BookingStatusBadge } from "@/components/booking/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { formatDate, formatTime, money } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { listCustomerBookings } from "@/server/queries/bookings";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.account.bookingsTitle, robots: { index: false } };
}

export default async function MyBookingsPage() {
  const dict = await getDictionary();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{dict.account.bookingsTitle}</h1>
      <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
        <BookingsList />
      </Suspense>
    </main>
  );
}

type Booking = Awaited<ReturnType<typeof listCustomerBookings>>[number];

async function BookingsList() {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, "/account/bookings"))}`);
  }
  const [dict, bookings] = await Promise.all([getDictionary(locale), listCustomerBookings(session.user.id)]);

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed p-10 text-center">
        <p className="text-muted-foreground">{dict.account.empty}</p>
        <Link href={localePath(locale, "/lounges")} className={buttonVariants()}>
          {dict.account.findLounge}
        </Link>
      </div>
    );
  }

  // Rendered per request, so reading the clock here is fine.
  const now = new Date();
  const upcoming = bookings
    .filter((b) => b.scheduledEnd > now && b.status !== "CANCELLED" && b.status !== "NO_SHOW")
    .reverse();
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div className="space-y-8">
      {upcoming.length > 0 && <Group title={dict.account.upcoming} bookings={upcoming} locale={locale} dict={dict} />}
      {past.length > 0 && <Group title={dict.account.past} bookings={past} locale={locale} dict={dict} />}
    </div>
  );
}

function Group({ title, bookings, locale, dict }: { title: string; bookings: Booking[]; locale: Locale; dict: Dictionary }) {
  return (
    <section>
      <h2 className="mb-3 font-semibold text-muted-foreground">{title}</h2>
      <ul className="divide-y rounded-2xl border bg-card">
        {bookings.map((b) => (
          <li key={b.reference}>
            <Link
              href={localePath(locale, `/bookings/${b.reference}`)}
              className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {b.lounge.name} · {b.deviceName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatDate(locale, b.scheduledStart, b.lounge.timezone)} ·{" "}
                  {formatTime(locale, b.scheduledStart, b.lounge.timezone)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold tabular-nums">{money(locale, b.totalPrice, b.currency)}</span>
                <BookingStatusBadge status={b.status} dict={dict} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
