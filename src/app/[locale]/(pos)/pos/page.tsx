import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ManagersOnly } from "@/components/pos/managers-only";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { posLoginHref } from "@/lib/pos-login";
import { getSession } from "@/server/session";
import { getManagedLounge, getPlatformRole, isStaffRole } from "@/server/staff";

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
      <OpenBranch />
    </Suspense>
  );
}

/** Opens the branch's POS; there is no lounge to choose in single-branch mode. */
async function OpenBranch() {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(posLoginHref(locale, "/pos"));
  }
  // From the database, so access a manager just granted works without signing in again.
  const role = await getPlatformRole(session.user.id);
  if (!role || !isStaffRole(role)) {
    return <ManagersOnly locale={locale} email={session.user.email ?? ""} path="/pos" />;
  }
  const lounge = await getManagedLounge(session.user.id);
  if (lounge) redirect(localePath(locale, `/pos/${lounge.id}`));
  const dict = await getDictionary(locale);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">{dict.manage.noLounges}</p>
    </main>
  );
}
