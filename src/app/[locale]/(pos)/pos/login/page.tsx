import { Lock, MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { GoogleSignInButton, GoogleSignInUnavailable, SignInForm } from "@/components/auth/auth-forms";
import { SignInTabs } from "@/components/auth/sign-in-tabs";
import { signInErrorMessage } from "@/components/auth/sign-in-errors";
import { ManagersOnly } from "@/components/pos/managers-only";
import { PinSignIn } from "@/components/pos/pin-sign-in";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { isGoogleAuthEnabled } from "@/lib/env";
import { posCallback } from "@/lib/pos-login";
import { getTerminalLounge } from "@/server/services/pos-pin";
import { getSession } from "@/server/session";
import { getPlatformRole, isStaffRole } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.posLogin.title, robots: { index: false } };
}

/**
 * Cashier sign-in for the POS touchscreen: Gmail first (the account a manager granted access
 * to), email and password as a fallback. Staff who are already signed in go straight on.
 * Quick PIN sign-in is the first tab; it works on a registered cashier terminal (locked with
 * "Lock screen / Switch staff"), which opens on the keypad.
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
  const terminal = await getTerminalLounge();
  // A terminal opens on the PIN keypad, elsewhere Gmail; a sign-in error shows on the password form.
  const defaultTab = error || (!terminal?.staff.length && !isGoogleAuthEnabled) ? "password" : terminal?.staff.length ? "pin" : "google";
  return (
    <div className="w-full max-w-md space-y-6 rounded-3xl border bg-card p-6 shadow-lg sm:p-8">
      <div className="space-y-2 text-center">
        <div className="text-sm font-semibold text-primary">
          {dict.common.appName} - {dict.pos.controlTitle}
        </div>
        {terminal ? (
          <Lock className="mx-auto size-10 text-primary" aria-hidden />
        ) : (
          <MonitorSmartphone className="mx-auto size-10 text-primary" aria-hidden />
        )}
        <h1 className="text-2xl font-bold">{terminal ? dict.posLock.title : p.title}</h1>
        {!terminal && <p className="text-sm text-muted-foreground">{p.subtitle}</p>}
      </div>

      <SignInTabs
        defaultTab={defaultTab}
        pin={<PinSignIn terminal={terminal} callbackUrl={callbackUrl} dict={dict} />}
        password={<SignInForm callbackUrl={callbackUrl} initialError={error} />}
        google={
          isGoogleAuthEnabled ? (
            <GoogleSignInButton callbackUrl={callbackUrl} label={p.google} size="xl" />
          ) : (
            <GoogleSignInUnavailable label={p.google} note={p.notConfigured} size="xl" />
          )
        }
      />

      <p className="text-center text-sm">
        <Link href={localePath(locale, "/login")} className="text-muted-foreground hover:text-foreground hover:underline">
          {p.customerLogin}
        </Link>
      </p>
    </div>
  );
}
