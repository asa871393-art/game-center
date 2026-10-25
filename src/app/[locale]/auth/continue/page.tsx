import { Loader2 } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { localePath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Landing step after a sign-in that had no particular destination (the login page's default
 * callback). Everyone goes to the POS, which shows non-staff accounts that they lack access. A page rather
 * than a route handler so the redirect also works after the client-side navigation a sign-in
 * Server Action ends with.
 */
export default function ContinuePage() {
  return (
    <main className="flex flex-1 items-center justify-center py-24">
      <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
      <Suspense>
        <Continue />
      </Suspense>
    </main>
  );
}

async function Continue(): Promise<null> {
  redirect(localePath(await getLocale(), "/pos"));
}
