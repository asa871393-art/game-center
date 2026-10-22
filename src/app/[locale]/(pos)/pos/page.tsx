import { ChevronLeft, ChevronRight, MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ManagersOnly } from "@/components/pos/managers-only";
import { Skeleton } from "@/components/ui/skeleton";
import { localeMeta, localePath } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { posLoginHref } from "@/lib/pos-login";
import { getSession } from "@/server/session";
import { getPlatformRole, isStaffRole, listManagedLounges } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.pos.title, robots: { index: false } };
}

export default function PosIndexPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-2xl px-4 py-10">
          <Skeleton className="h-48 rounded-2xl" />
        </main>
      }
    >
      <LoungeList />
    </Suspense>
  );
}

async function LoungeList() {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(posLoginHref(locale, "/pos"));
  }
  // From the database, so access a manager just granted works without signing in again.
  const role = await getPlatformRole(session.user.id);
  if (!role || !isStaffRole(role)) {
    return <ManagersOnly locale={locale} email={session.user.email ?? ""} path="/pos" viaGoogle={session.user.provider === "google"} />;
  }
  const [dict, lounges] = await Promise.all([getDictionary(locale), listManagedLounges(session.user.id, role)]);
  if (lounges.length === 1) redirect(localePath(locale, `/pos/${lounges[0].id}`));
  const Chevron = localeMeta[locale].dir === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-6 flex items-center gap-3 text-2xl font-bold">
        <MonitorSmartphone className="size-7 text-primary" aria-hidden />
        {dict.pos.chooseLounge}
      </h1>
      {lounges.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">{dict.manage.noLounges}</p>
      ) : (
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
      )}
    </main>
  );
}
