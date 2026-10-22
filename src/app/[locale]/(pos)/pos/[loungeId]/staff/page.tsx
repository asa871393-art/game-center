import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ManagersOnly } from "@/components/pos/managers-only";
import { StaffAdmin } from "@/components/pos/staff-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { getDictionary, getLocale } from "@/i18n/server";
import { env } from "@/lib/env";
import { posLoginHref } from "@/lib/pos-login";
import { db } from "@/server/db";
import { listLoungeStaff } from "@/server/services/staff-access";
import { getSession } from "@/server/session";
import { getLoungeAccess, hasLoungeRole, loungeExists } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.staffAdmin.title, robots: { index: false } };
}

export default function StaffPage({ params }: PageProps<"/[locale]/pos/[loungeId]/staff">) {
  return (
    <Suspense fallback={<StaffSkeleton />}>
      {params.then(({ loungeId }) => (
        <Staff loungeId={loungeId} />
      ))}
    </Suspense>
  );
}

async function Staff({ loungeId }: { loungeId: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  const path = `/pos/${loungeId}/staff`;
  if (!session?.user?.id) redirect(posLoginHref(locale, path));
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access || !hasLoungeRole(access, "MANAGER")) {
    if (!(await loungeExists(loungeId))) notFound();
    return <ManagersOnly locale={locale} loungeId={loungeId} email={session.user.email ?? ""} path={path} />;
  }
  const [lounge, members] = await Promise.all([
    db.lounge.findUnique({ where: { id: loungeId }, select: { id: true, name: true } }),
    listLoungeStaff(loungeId),
  ]);
  if (!lounge) notFound();
  const loginUrl = new URL(posLoginHref(locale, `/pos/${loungeId}`), env.NEXT_PUBLIC_APP_URL).toString();
  return <StaffAdmin data={{ lounge, members, viewer: { userId: session.user.id, role: access.role }, loginUrl }} />;
}

function StaffSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-36 rounded-2xl" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-20 rounded-2xl" />
      ))}
    </div>
  );
}
