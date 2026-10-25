import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ManagersOnly } from "@/components/pos/managers-only";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { Skeleton } from "@/components/ui/skeleton";
import { getDictionary, getLocale } from "@/i18n/server";
import { posLoginHref } from "@/lib/pos-login";
import { getPosBoard } from "@/server/queries/manage";
import { getSession } from "@/server/session";
import { getLoungeAccess, getPlatformRole, hasLoungeRole, isStaffRole } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.pos.title, robots: { index: false } };
}

export default function PosTerminalPage({ params }: PageProps<"/[locale]/pos/[loungeId]">) {
  return (
    <Suspense fallback={<TerminalSkeleton />}>
      {params.then(({ loungeId }) => (
        <Terminal loungeId={loungeId} />
      ))}
    </Suspense>
  );
}

async function Terminal({ loungeId }: { loungeId: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(posLoginHref(locale, `/pos/${loungeId}`));
  }
  if (!isStaffRole((await getPlatformRole(session.user.id)) ?? undefined)) {
    return (
      <ManagersOnly
        locale={locale}
        email={session.user.email ?? ""}
        path={`/pos/${loungeId}`}
      />
    );
  }
  // Same response for "no such lounge" and "not yours", so ids can't be probed.
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access) notFound();
  const data = await getPosBoard(loungeId);
  if (!data) notFound();
  return (
    <PosTerminal
      data={data}
      canManageDevices={hasLoungeRole(access, "MANAGER")}
      cashierName={session.user.name ?? session.user.email ?? ""}
    />
  );
}

function TerminalSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-16 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
