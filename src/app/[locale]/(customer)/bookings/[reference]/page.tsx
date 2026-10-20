import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/server/session";
import { BookingStatusBadge } from "@/components/booking/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { formatDate, formatDuration, formatTime, money } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { diffMinutes } from "@/lib/booking/time";
import { getCustomerBooking } from "@/server/queries/bookings";

export const metadata: Metadata = { robots: { index: false } };

export default function BookingPage({ params }: PageProps<"/[locale]/bookings/[reference]">) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <Suspense fallback={<Skeleton className="h-[28rem] rounded-3xl" />}>
        <BookingContent params={params} />
      </Suspense>
    </main>
  );
}

async function BookingContent({ params }: Pick<PageProps<"/[locale]/bookings/[reference]">, "params">) {
  const { reference } = await params;
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, `/bookings/${reference}`))}`);
  }
  const booking = await getCustomerBooking(reference, session.user.id);
  if (!booking) notFound();
  const dict = await getDictionary(locale);

  const tz = booking.lounge.timezone;
  const fmt = (minor: number) => money(locale, minor, booking.currency);
  const cancelled = booking.status === "CANCELLED" || booking.status === "NO_SHOW";
  const pending = booking.status === "PENDING";
  const [Icon, title, tone] = cancelled
    ? [XCircle, dict.confirmation.cancelledTitle, "text-rose-600"]
    : pending
      ? [Clock, dict.confirmation.pendingTitle, "text-amber-600"]
      : [CheckCircle2, dict.confirmation.title, "text-emerald-600"];

  return (
    <article className="overflow-hidden rounded-3xl border bg-card">
      <header className="flex flex-col items-center gap-2 border-b bg-muted/40 p-6 text-center">
        <Icon className={`size-12 ${tone}`} aria-hidden />
        <h1 className="text-2xl font-bold">{title}</h1>
        {!cancelled && <p className="text-sm text-muted-foreground">{dict.confirmation.subtitle}</p>}
        {booking.holdExpired && <p className="text-sm text-destructive">{dict.payment.expired}</p>}
        <p dir="ltr" className="mt-1 rounded-xl border bg-background px-4 py-2 font-mono text-2xl font-bold tracking-widest">
          {booking.reference}
        </p>
        <BookingStatusBadge status={booking.status} dict={dict} />
      </header>

      <dl className="grid gap-3 p-6 text-sm">
        <Row label={dict.confirmation.lounge}>
          <Link href={localePath(locale, `/lounges/${booking.lounge.slug}`)} className="font-medium hover:underline">
            {booking.lounge.name}
          </Link>
          <span className="block text-muted-foreground">
            {booking.lounge.city} · {booking.lounge.addressLine}
          </span>
        </Row>
        <Row label={dict.confirmation.device}>
          {booking.device.name} · {booking.device.categoryName}
        </Row>
        <Row label={dict.confirmation.when}>
          {formatDate(locale, booking.scheduledStart, tz, "full")}
          <span className="block">
            {formatTime(locale, booking.scheduledStart, tz)} – {formatTime(locale, booking.scheduledEnd, tz)} (
            {formatDuration(locale, diffMinutes(booking.scheduledEnd, booking.scheduledStart), dict)})
          </span>
        </Row>
        <Row label={dict.booking.players}>{booking.players}</Row>
        <Row label={dict.confirmation.paymentStatus}>
          {dict.paymentStatus[booking.paymentStatus]} · {dict.payment[booking.checkoutMethod]}
        </Row>

        {booking.items.length > 0 && (
          <>
            <Separator />
            <div>
              <dt className="mb-1 font-semibold">{dict.confirmation.preOrder}</dt>
              <dd>
                <ul className="space-y-1">
                  {booking.items.map((i) => (
                    <li key={i.id} className="flex justify-between">
                      <span>
                        {i.name} × {i.quantity}
                      </span>
                      <span className="tabular-nums">{fmt(i.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </>
        )}

        <Separator />
        <Row label={dict.booking.playTime}>{fmt(booking.playSubtotal)}</Row>
        {booking.canteenSubtotal > 0 && <Row label={dict.booking.canteen}>{fmt(booking.canteenSubtotal)}</Row>}
        {booking.taxTotal > 0 && <Row label={dict.booking.tax}>{fmt(booking.taxTotal)}</Row>}
        <Row label={<span className="text-base font-bold text-foreground">{dict.common.total}</span>}>
          <span className="text-base font-bold">{fmt(booking.totalPrice)}</span>
        </Row>
      </dl>

      <footer className="flex flex-wrap justify-center gap-2 border-t p-4">
        {booking.pendingTransactionId && (
          <Link href={localePath(locale, `/checkout/${booking.pendingTransactionId}`)} className={buttonVariants()}>
            {dict.confirmation.payNow}
          </Link>
        )}
        <Link href={localePath(locale, "/account/bookings")} className={buttonVariants({ variant: "outline" })}>
          {dict.nav.myBookings}
        </Link>
        <Link href={localePath(locale, `/lounges/${booking.lounge.slug}`)} className={buttonVariants({ variant: "ghost" })}>
          {dict.confirmation.backToLounge}
        </Link>
      </footer>
    </article>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end tabular-nums">{children}</dd>
    </div>
  );
}
