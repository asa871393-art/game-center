import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DeviceAdmin } from "@/components/devices/device-admin";
import { ManagersOnly } from "@/components/pos/managers-only";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { getDeviceAdmin } from "@/server/queries/devices";
import { getSession } from "@/server/session";
import { getLoungeAccess, hasLoungeRole, loungeExists } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.devices.title, robots: { index: false } };
}

export default function DevicesPage({ params }: PageProps<"/[locale]/pos/[loungeId]/devices">) {
  return (
    <Suspense fallback={<DevicesSkeleton />}>
      {params.then(({ loungeId }) => (
        <Devices loungeId={loungeId} />
      ))}
    </Suspense>
  );
}

async function Devices({ loungeId }: { loungeId: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, `/pos/${loungeId}/devices`))}`);
  }
  // Managers and owners only. Anyone else signed in is told why and offered a switch of
  // account (lounges are public on the booking site, so this reveals nothing new).
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access || !hasLoungeRole(access, "MANAGER")) {
    if (!(await loungeExists(loungeId))) notFound();
    return <ManagersOnly locale={locale} loungeId={loungeId} email={session.user.email ?? ""} path={`/pos/${loungeId}/devices`} />;
  }
  const data = await getDeviceAdmin(loungeId);
  if (!data) notFound();
  return <DeviceAdmin data={data} />;
}

function DevicesSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5">
      <Skeleton className="h-12 w-72" />
      <div className="grid gap-2 md:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
