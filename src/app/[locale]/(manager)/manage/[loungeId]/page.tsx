import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PosBoard } from "@/components/manage/pos-board";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { getPosBoard } from "@/server/queries/manage";
import { getSession } from "@/server/session";
import { getLoungeAccess, hasLoungeRole } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.manage.title, robots: { index: false } };
}

export default function ManageLoungePage({ params }: PageProps<"/[locale]/manage/[loungeId]">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <Suspense fallback={<BoardSkeleton />}>
        {params.then(({ loungeId }) => (
          <Board loungeId={loungeId} />
        ))}
      </Suspense>
    </main>
  );
}

async function Board({ loungeId }: { loungeId: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, `/manage/${loungeId}`))}`);
  }
  // Same response for "no such lounge" and "not yours", so ids can't be probed.
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access) notFound();
  const data = await getPosBoard(loungeId);
  if (!data) notFound();
  return <PosBoard data={data} canManageDevices={hasLoungeRole(access, "MANAGER")} />;
}

function BoardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-[28rem] rounded-2xl" />
    </div>
  );
}
