import { Clock, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/server/session";
import { deviceTypeMeta } from "@/components/lounge/device-type";
import { LoungeBooking } from "@/components/lounge/lounge-booking";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatMinuteOfDay, money } from "@/i18n/format";
import { isGoogleAuthEnabled } from "@/lib/env";
import { getDictionary, getLocale } from "@/i18n/server";
import { getAvailableCheckoutMethods } from "@/server/payments";
import { getLoungeDetails } from "@/server/queries/lounges";

export async function generateMetadata({ params }: PageProps<"/[locale]/lounges/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const lounge = await getLoungeDetails(slug);
  return lounge ? { title: lounge.name, description: lounge.description ?? undefined } : {};
}

export default function LoungePage({ params }: PageProps<"/[locale]/lounges/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
      <Suspense fallback={<LoungeSkeleton />}>
        <LoungeContent params={params} />
      </Suspense>
    </main>
  );
}

async function LoungeContent({ params }: Pick<PageProps<"/[locale]/lounges/[slug]">, "params">) {
  const { slug } = await params;
  const [locale, lounge, session] = await Promise.all([getLocale(), getLoungeDetails(slug), getSession()]);
  if (!lounge) notFound();
  const dict = await getDictionary(locale);

  const hoursByDay = new Map(lounge.openingHours.map((h) => [h.dayOfWeek, h]));

  return (
    <div className="space-y-8">
      <header className="overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/15 via-background to-sky-500/10">
        <div className="flex flex-col gap-3 p-5 sm:p-8">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{lounge.name}</h1>
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="size-4 shrink-0" aria-hidden />
            {lounge.city} · {lounge.addressLine}
          </p>
          {lounge.phone && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Phone className="size-4 shrink-0" aria-hidden />
              <a href={`tel:${lounge.phone}`} dir="ltr" className="hover:underline">
                {lounge.phone}
              </a>
            </p>
          )}
          {lounge.description && <p className="max-w-3xl text-pretty">{lounge.description}</p>}
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <section aria-labelledby="floor-plan-heading" className="min-w-0">
          <h2 id="floor-plan-heading" className="mb-3 text-xl font-bold">
            {dict.lounge.floorPlan}
          </h2>
          <LoungeBooking lounge={lounge} checkoutOptions={getAvailableCheckoutMethods()} isSignedIn={!!session?.user} googleEnabled={isGoogleAuthEnabled} />
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border p-4">
            <h2 className="mb-3 font-bold">{dict.lounge.pricing}</h2>
            <ul className="space-y-2.5">
              {lounge.categories.map((c) => {
                const { icon: Icon, color } = deviceTypeMeta[c.type];
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Icon className="size-4" style={{ color }} aria-hidden />
                      <span>
                        {c.name}
                        <span className="block text-xs text-muted-foreground">
                          {format(dict.lounge.capacity, { count: c.capacity })}
                        </span>
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {money(locale, c.baseHourlyRate, lounge.currency)}
                      <span className="font-normal text-muted-foreground">{dict.common.perHour}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl border p-4">
            <h2 className="mb-3 flex items-center gap-2 font-bold">
              <Clock className="size-4" aria-hidden />
              {dict.lounge.openingHours}
            </h2>
            <dl className="space-y-1.5 text-sm">
              {dict.days.map((day, dow) => {
                const h = hoursByDay.get(dow);
                return (
                  <div key={day} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{day}</dt>
                    <dd className="tabular-nums">
                      {!h || h.isClosed
                        ? dict.common.closed
                        : `${formatMinuteOfDay(locale, h.opensAtMinute)} – ${formatMinuteOfDay(locale, h.closesAtMinute)}`}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function LoungeSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-40 rounded-3xl" />
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}
