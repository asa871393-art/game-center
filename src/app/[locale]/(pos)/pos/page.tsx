import { ChevronLeft, ChevronRight, MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { localeMeta, localePath } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { getSession } from "@/server/session";
import { listManagedLounges } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.pos.title, robots: { index: false } };
}

export default async function PosIndexPage() {
  const dict = await getDictionary();
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-6 flex items-center gap-3 text-2xl font-bold">
        <MonitorSmartphone className="size-7 text-primary" aria-hidden />
        {dict.pos.chooseLounge}
      </h1>
      <Suspense fallback={<Skeleton className="h-48 rounded-2xl" />}>
        <LoungeList />
      </Suspense>
    </main>
  );
}

async function LoungeList() {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, "/pos"))}`);
  }
  const [dict, lounges] = await Promise.all([getDictionary(locale), listManagedLounges(session.user.id, session.user.role)]);
  if (lounges.length === 1) redirect(localePath(locale, `/pos/${lounges[0].id}`));
  if (lounges.length === 0) {
    return <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">{dict.manage.noLounges}</p>;
  }

  const Chevron = localeMeta[locale].dir === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <ul className="grid gap-3">
      {lounges.map((l) => (
        <li key={l.id}>
          <Link
            href={localePath(locale, `/pos/${l.id}`)}
            className="flex min-h-20 items-center gap-4 rounded-2xl border bg-card p-5 text-lg transition active:scale-[0.99] hover:border-primary"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{l.name}</span>
              <span className="text-sm text-muted-foreground">
                {l.city} · {format(dict.search.devicesCount, { count: l.deviceCount })}
              </span>
            </span>
            <Chevron className="size-5 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
