import { ChevronLeft, ChevronRight, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { localeMeta, localePath } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { getSession } from "@/server/session";
import { listManagedLounges } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.manage.title, robots: { index: false } };
}

export default async function ManageIndexPage() {
  const dict = await getDictionary();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{dict.manage.chooseLounge}</h1>
      <Suspense fallback={<Skeleton className="h-48 rounded-2xl" />}>
        <LoungeList />
      </Suspense>
    </main>
  );
}

async function LoungeList() {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, "/manage"))}`);
  }
  const [dict, lounges] = await Promise.all([getDictionary(locale), listManagedLounges(session.user.id, session.user.role)]);
  if (lounges.length === 1) redirect(localePath(locale, `/manage/${lounges[0].id}`));

  if (lounges.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">{dict.manage.noLounges}</p>
    );
  }

  const Chevron = localeMeta[locale].dir === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {lounges.map((l) => (
        <li key={l.id}>
          <Link
            href={localePath(locale, `/manage/${l.id}`)}
            className="flex items-center gap-3 p-4 transition hover:bg-muted/50"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Store className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{l.name}</span>
              <span className="text-sm text-muted-foreground">
                {l.city} · {format(dict.search.devicesCount, { count: l.deviceCount })}
              </span>
            </span>
            <Badge variant="secondary">{dict.manage.role[l.role]}</Badge>
            <Chevron className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
