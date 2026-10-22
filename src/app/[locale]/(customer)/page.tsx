import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ComponentProps } from "react";
import { HowItWorks } from "@/components/home/how-it-works";
import { DEVICE_TYPES, deviceTypeMeta } from "@/components/lounge/device-type";
import { LoungeCard } from "@/components/lounge/lounge-card";
import { SearchForm } from "@/components/search/search-form";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { getCities, searchLounges } from "@/server/queries/lounges";
import { getSession } from "@/server/session";

export default async function HomePage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const steps: Steps = [
    { title: dict.home.step1Title, body: dict.home.step1Body },
    { title: dict.home.step2Title, body: dict.home.step2Body },
    { title: dict.home.step3Title, body: dict.home.step3Body },
  ];
  const signInHref = `${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, "/lounges"))}`;

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

      <section id={stepTargets.loungesSectionId} className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-12">
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
          {/* Signed-out visitors' step 3 goes to sign-in, so the fallback assumes signed out. */}
          <Suspense fallback={<HowItWorks steps={steps} {...stepTargets} signInHref={signInHref} />}>
            <HowItWorksForViewer steps={steps} signInHref={signInHref} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function HeroSearch() {
  await connection();
  const cities = await getCities();
  return <SearchForm cities={cities} inputId={stepTargets.searchInputId} />;
}

type Steps = ComponentProps<typeof HowItWorks>["steps"];

/** Elements the how-it-works steps scroll to. */
const stepTargets = { searchInputId: "home-search", loungesSectionId: "featured-lounges" };

async function HowItWorksForViewer({ steps, signInHref }: { steps: Steps; signInHref: string }) {
  const session = await getSession();
  return <HowItWorks steps={steps} {...stepTargets} signInHref={session?.user ? undefined : signInHref} />;
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
