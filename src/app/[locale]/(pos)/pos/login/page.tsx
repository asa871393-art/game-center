import { MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { GoogleSignInButton, GoogleSignInUnavailable, SignInForm } from "@/components/auth/auth-forms";
import { signInErrorMessage } from "@/components/auth/sign-in-errors";
import { ManagersOnly } from "@/components/pos/managers-only";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { isGoogleAuthEnabled } from "@/lib/env";
import { posCallback } from "@/lib/pos-login";
import { getSession } from "@/server/session";
import { getPlatformRole, isStaffRole } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.posLogin.title, robots: { index: false } };
}

/**
 * Cashier sign-in for the POS touchscreen: Gmail first (the account a manager granted access
 * to), email and password as a fallback. Staff who are already signed in go straight on.
 */
export default function PosLoginPage({ searchParams }: PageProps<"/[locale]/pos/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <Suspense fallback={<Skeleton className="h-[30rem] w-full max-w-md rounded-3xl" />}>
        <CashierLogin searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function CashierLogin({ searchParams }: Pick<PageProps<"/[locale]/pos/login">, "searchParams">) {
  const [sp, locale, session] = await Promise.all([searchParams, getLocale(), getSession()]);
  const dict = await getDictionary(locale);
  const callbackUrl = posCallback(locale, sp.callbackUrl);

  if (session?.user?.id) {
    const role = await getPlatformRole(session.user.id);
    if (role && isStaffRole(role)) redirect(callbackUrl);
    return (
      <ManagersOnly
        locale={locale}
        email={session.user.email ?? ""}
        path={callbackUrl.replace(/^\/[^/]+/, "")}
        viaGoogle={session.user.provider === "google"}
      />
    );
  }

  const error = typeof sp.error === "string" ? signInErrorMessage(sp.error, dict.auth) : undefined;
  const p = dict.posLogin;
  return (
    <div className="w-full max-w-md space-y-6 rounded-3xl border bg-card p-6 shadow-lg sm:p-8">
      <div className="space-y-2 text-center">
        <div className="text-sm font-semibold text-primary">
          {dict.common.appName} - {dict.pos.controlTitle}
        </div>
        <MonitorSmartphone className="mx-auto size-10 text-primary" aria-hidden />
        <h1 className="text-2xl font-bold">{p.title}</h1>
        <p className="text-sm text-muted-foreground">{p.subtitle}</p>
      </div>

      {isGoogleAuthEnabled ? (
        <GoogleSignInButton callbackUrl={callbackUrl} label={p.google} size="xl" />
      ) : (
        <GoogleSignInUnavailable label={p.google} note={p.notConfigured} size="xl" />
      )}

      <details className="group rounded-2xl border p-4" open={!isGoogleAuthEnabled || !!error}>
        <summary className="cursor-pointer list-none text-center text-sm font-medium text-muted-foreground group-open:mb-4">
          {p.orPassword}
        </summary>
        <SignInForm callbackUrl={callbackUrl} initialError={error} />
      </details>

      <p className="text-center text-sm">
        <Link href={localePath(locale, "/login")} className="text-muted-foreground hover:text-foreground hover:underline">
          {p.customerLogin}
        </Link>
      </p>
    </div>
  );
}
