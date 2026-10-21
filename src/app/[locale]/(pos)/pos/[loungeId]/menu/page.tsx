import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { MenuAdmin } from "@/components/menu/menu-admin";
import { ManagersOnly } from "@/components/pos/managers-only";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { getMenuAdmin } from "@/server/queries/menu";
import { getSession } from "@/server/session";
import { getLoungeAccess, hasLoungeRole, loungeExists } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.menuAdmin.title, robots: { index: false } };
}

export default function MenuPage({ params }: PageProps<"/[locale]/pos/[loungeId]/menu">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      {params.then(({ loungeId }) => (
        <Menu loungeId={loungeId} />
      ))}
    </Suspense>
  );
}

async function Menu({ loungeId }: { loungeId: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, `/pos/${loungeId}/menu`))}`);
  }
  // Managers and owners only. Anyone else signed in is told why and offered a switch of
  // account (lounges are public on the booking site, so this reveals nothing new).
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access || !hasLoungeRole(access, "MANAGER")) {
    if (!(await loungeExists(loungeId))) notFound();
    return <ManagersOnly locale={locale} loungeId={loungeId} email={session.user.email ?? ""} path={`/pos/${loungeId}/menu`} />;
  }
  const data = await getMenuAdmin(loungeId);
  if (!data) notFound();
  return <MenuAdmin data={data} />;
}

function MenuSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-12 rounded-xl" />
      <div className="grid gap-2 md:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
