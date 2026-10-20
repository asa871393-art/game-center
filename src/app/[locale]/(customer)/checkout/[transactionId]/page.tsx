import { FlaskConical, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/server/session";
import { SandboxGatewayActions } from "@/components/booking/sandbox-gateway";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { format, formatDate, formatNumber, formatTime, money } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { diffMinutes } from "@/lib/booking/time";
import { getCheckoutTransaction } from "@/server/queries/bookings";

export const metadata: Metadata = { robots: { index: false } };

export default function CheckoutPage({ params }: PageProps<"/[locale]/checkout/[transactionId]">) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
        <Checkout params={params} />
      </Suspense>
    </main>
  );
}

async function Checkout({ params }: Pick<PageProps<"/[locale]/checkout/[transactionId]">, "params">) {
  const { transactionId } = await params;
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, `/checkout/${transactionId}`))}`);
  }
  const payment = await getCheckoutTransaction(transactionId, session.user.id);
  if (!payment || !payment.isSandbox) notFound();
  const dict = await getDictionary(locale);

  const { booking } = payment;
  const bookingHref = localePath(locale, `/bookings/${booking.reference}`);
  const provider = dict.payment[booking.checkoutMethod];
  const now = new Date();
  const expired = booking.expiresAt !== null && booking.expiresAt <= now;
  const settled = payment.status !== "PENDING" || booking.status !== "PENDING";

  return (
    <article className="overflow-hidden rounded-3xl border bg-card shadow-sm">
      <header className="flex items-center gap-3 border-b bg-gradient-to-br from-primary/15 to-transparent p-5">
        <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Wallet aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-bold">{format(dict.payment.gatewayTitle, { provider })}</h1>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <FlaskConical className="size-3.5" aria-hidden />
            {dict.payment.sandbox}
          </p>
        </div>
      </header>

      <div className="space-y-5 p-5">
        <Alert>
          <FlaskConical aria-hidden />
          <AlertDescription>{dict.payment.sandboxNotice}</AlertDescription>
        </Alert>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{dict.payment.reference}</dt>
            <dd dir="ltr" className="font-mono font-semibold">
              {booking.reference}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{dict.confirmation.lounge}</dt>
            <dd className="text-end">
              {booking.lounge.name} · {booking.device.name}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{dict.confirmation.when}</dt>
            <dd className="text-end">
              {formatDate(locale, booking.scheduledStart, booking.lounge.timezone)} ·{" "}
              {formatTime(locale, booking.scheduledStart, booking.lounge.timezone)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between border-t pt-3">
            <dt className="font-semibold">{dict.payment.amountDue}</dt>
            <dd className="text-2xl font-extrabold tabular-nums">{money(locale, payment.amount, payment.currency)}</dd>
          </div>
        </dl>

        {settled ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">{dict.payment.alreadyProcessed}</p>
            <Link href={bookingHref} className={buttonVariants({ variant: "outline" })}>
              {dict.nav.myBookings}
            </Link>
          </div>
        ) : expired ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-destructive">{dict.payment.expired}</p>
            <Link href={bookingHref} className={buttonVariants({ variant: "outline" })}>
              {dict.nav.myBookings}
            </Link>
          </div>
        ) : (
          <>
            {booking.expiresAt && (
              <p className="text-center text-xs text-muted-foreground">
                {format(dict.payment.expiresIn, {
                  minutes: formatNumber(locale, Math.max(1, diffMinutes(booking.expiresAt, now))),
                })}
              </p>
            )}
            <SandboxGatewayActions transactionId={payment.id} />
          </>
        )}
      </div>
    </article>
  );
}
