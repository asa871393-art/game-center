import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { StaffManager } from "@/components/manage/staff-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { db } from "@/server/db";
import { listLoungeStaff } from "@/server/services/staff-access";
import { getSession } from "@/server/session";
import { getLoungeAccess, hasLoungeRole } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.staffManage.title, robots: { index: false } };
}

/** Dashboard staff management: owners and lounge admins (and platform super admins) only. */
export default function ManageStaffPage({ params }: PageProps<"/[locale]/manage/[loungeId]/staff">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <Suspense fallback={<StaffSkeleton />}>
        {params.then(({ loungeId }) => (
          <Staff loungeId={loungeId} />
        ))}
      </Suspense>
    </main>
  );
}

async function Staff({ loungeId }: { loungeId: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  const path = `/manage/${loungeId}/staff`;
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, path))}`);
  }
  const access = await getLoungeAccess(session.user.id, loungeId);
  // Same response for "no such lounge", "not yours" and "cashier only", so ids can't be probed.
  if (!access || !hasLoungeRole(access, "MANAGER")) notFound();
  const [lounge, members] = await Promise.all([
    db.lounge.findUnique({ where: { id: loungeId }, select: { id: true, name: true } }),
    listLoungeStaff(loungeId),
  ]);
  if (!lounge) notFound();
  return <StaffManager data={{ lounge, members, viewer: { userId: session.user.id, role: access.role } }} />;
}

function StaffSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}
