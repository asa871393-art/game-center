import { CalendarCheck, MapPinned, Search } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DEVICE_TYPES, deviceTypeMeta } from "@/components/lounge/device-type";
import { LoungeCard } from "@/components/lounge/lounge-card";
import { SearchForm } from "@/components/search/search-form";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { getCities, searchLounges } from "@/server/queries/lounges";

export default async function HomePage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const steps = [
    { icon: Search, title: dict.home.step1Title, body: dict.home.step1Body },
    { icon: MapPinned, title: dict.home.step2Title, body: dict.home.step2Body },
    { icon: CalendarCheck, title: dict.home.step3Title, body: dict.home.step3Body },
  ];

  return (
    <main>
      <section className="relative overflow-hidden border-b bg-gradient-to-b from-primary/10 via-background to-background">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-16 text-center sm:py-24">
          <h1 className="text-balance text-3xl font-extrabold tracking-tight sm:text-5xl">{dict.home.heroTitle}</h1>
          <p className="max-w-2xl text-pretty text-muted-foreground sm:text-lg">{dict.home.heroSubtitle}</p>
          <Suspense fallback={<Skeleton className="h-14 w-full rounded-2xl" />}>
            <HeroSearch />
          </Suspense>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12">
        <h2 className="mb-4 text-xl font-bold">{dict.home.browseByType}</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DEVICE_TYPES.slice(0, 4).map((type) => {
            const { icon: Icon, color } = deviceTypeMeta[type];
            return (
              <li key={type}>
                <Link
                  href={localePath(locale, `/lounges?type=${type}`)}
                  className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-5 text-center font-medium transition hover:shadow-md"
                >
                  <span className="grid size-12 place-items-center rounded-xl text-white" style={{ background: color }}>
                    <Icon className="size-6" aria-hidden />
                  </span>
                  {dict.deviceType[type]}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{dict.home.featured}</h2>
          <Link href={localePath(locale, "/lounges")} className="text-sm font-medium text-primary hover:underline">
            {dict.common.viewAll}
          </Link>
        </div>
        <Suspense fallback={<CardGridSkeleton />}>
          <FeaturedLounges />
        </Suspense>
      </section>

      <section className="border-t bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <h2 className="mb-6 text-xl font-bold">{dict.home.howItWorks}</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {steps.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex gap-3 rounded-2xl border bg-card p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">
                  {i + 1}
                </span>
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    <Icon className="size-4" aria-hidden />
                    {title}
                  </p>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}

async function HeroSearch() {
  await connection();
  const cities = await getCities();
  return <SearchForm cities={cities} />;
}

async function FeaturedLounges() {
  await connection();
  const [locale, lounges] = await Promise.all([getLocale(), searchLounges({}, 6)]);
  const dict = await getDictionary(locale);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lounges.map((l) => (
        <LoungeCard key={l.id} lounge={l} locale={locale} dict={dict} />
      ))}
    </div>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
      ))}
    </div>
  );
}
