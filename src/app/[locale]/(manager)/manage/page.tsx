import type { Metadata } from "next";
import { Suspense } from "react";
import { OpenBranch } from "@/components/manage/open-branch";
import { Skeleton } from "@/components/ui/skeleton";
import { getDictionary } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.manage.title, robots: { index: false } };
}

/** Opens the branch's dashboard; there is no lounge to choose in single-branch mode. */
export default function ManageIndexPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Suspense fallback={<Skeleton className="h-48 rounded-2xl" />}>
        <OpenBranch section="" />
      </Suspense>
    </main>
  );
}
