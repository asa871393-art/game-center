import { DatabaseZap } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { LoungeFallback } from "@/components/manage/lounge-fallback";
import { PosBoard } from "@/components/manage/pos-board";
import { Skeleton } from "@/components/ui/skeleton";
import { type Locale, localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { FirebaseAdminNotConfiguredError } from "@/lib/firebase-admin";
import { getPosBoard } from "@/server/queries/manage";
import { getSession } from "@/server/session";
import { getLoungeAccess, hasLoungeRole, type LoungeAccess } from "@/server/staff";
import { posLoginHref } from "@/lib/pos-login";

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
    redirect(posLoginHref(locale, `/manage/${loungeId}`));
  }
  const userId = session.user.id;

  // Firestore failures (missing credentials, outage) render a card instead of a 500.
  // notFound() stays outside the try: it works by throwing.
  let loaded: { access: LoungeAccess; data: Awaited<ReturnType<typeof getPosBoard>> } | null;
  try {
    const access = await getLoungeAccess(userId, loungeId);
    loaded = access ? { access, data: await getPosBoard(loungeId) } : null;
  } catch (error) {
    console.error(
      error instanceof FirebaseAdminNotConfiguredError ? "[manage] Firebase Admin is not configured:" : `[manage] Failed to load lounge ${loungeId}:`,
      error,
    );
    return <LoadFailed locale={locale} loungeId={loungeId} />;
  }
  // Same response for "no such lounge" and "not yours", so ids can't be probed.
  if (!loaded?.data) notFound();
  return <PosBoard data={loaded.data} canManageDevices={hasLoungeRole(loaded.access, "MANAGER")} />;
}

async function LoadFailed({ locale, loungeId }: { locale: Locale; loungeId: string }) {
  const dict = await getDictionary(locale);
  return (
    <LoungeFallback
      icon={DatabaseZap}
      tone="destructive"
      title={dict.manage.loadFailed}
      hint={dict.manage.loadFailedHint}
      actions={[
        { href: localePath(locale, `/manage/${encodeURIComponent(loungeId)}`), label: dict.common.retry, primary: true },
      ]}
    />
  );
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
