import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { isDeviceType } from "@/components/lounge/device-type";
import { LoungeCard } from "@/components/lounge/lounge-card";
import { SearchForm } from "@/components/search/search-form";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { format, formatNumber } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { getCities, searchLounges } from "@/server/queries/lounges";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.search.resultsTitle };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.trim().slice(0, 80) || undefined;
}

export default async function LoungesPage({ searchParams }: PageProps<"/[locale]/lounges">) {
  const dict = await getDictionary();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">{dict.search.resultsTitle}</h1>
      <Suspense
        fallback={
          <div className="space-y-6">
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        }
      >
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/[locale]/lounges">, "searchParams">) {
  const sp = await searchParams;
  // Firestore reads are request-time (the SDK uses random request ids).
  await connection();
  const q = firstParam(sp.q);
  const city = firstParam(sp.city);
  const rawType = firstParam(sp.type);
  const type = isDeviceType(rawType) ? rawType : undefined;

  const [locale, cities, lounges] = await Promise.all([getLocale(), getCities(), searchLounges({ q, city, type })]);
  const dict = await getDictionary(locale);

  return (
    <div className="space-y-6">
      {/* The key resets the form state when the URL filters change. */}
      <SearchForm key={`${q}|${city}|${type}`} cities={cities} initial={{ q, city, type }} />
      <p className="text-sm text-muted-foreground">
        {format(dict.search.resultsCount, { count: formatNumber(locale, lounges.length) })}
      </p>
      {lounges.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed p-10 text-center">
          <p className="text-muted-foreground">{dict.search.noResults}</p>
          <Link href={localePath(locale, "/lounges")} className={buttonVariants({ variant: "outline" })}>
            {dict.search.clearFilters}
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lounges.map((l) => (
            <LoungeCard key={l.id} lounge={l} locale={locale} dict={dict} />
          ))}
        </div>
      )}
    </div>
  );
}
