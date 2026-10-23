import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { GoogleSignInButton, GoogleSignInUnavailable, SignInForm } from "@/components/auth/auth-forms";
import { SignInTabs } from "@/components/auth/sign-in-tabs";
import { signInErrorMessage } from "@/components/auth/sign-in-errors";
import { PinSignIn } from "@/components/pos/pin-sign-in";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { isGoogleAuthEnabled } from "@/lib/env";
import { posCallback } from "@/lib/pos-login";
import { getTerminalLounge } from "@/server/services/pos-pin";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.auth.signInTitle };
}

export default function LoginPage({ searchParams }: PageProps<"/[locale]/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <Suspense fallback={<Skeleton className="h-[26rem] w-full max-w-sm rounded-3xl" />}>
        <Login searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Login({ searchParams }: Pick<PageProps<"/[locale]/login">, "searchParams">) {
  const [sp, locale] = await Promise.all([searchParams, getLocale()]);
  const dict = await getDictionary(locale);
  // With no destination, sign-in continues to a step that sends staff to the POS and others home.
  const callbackUrl = typeof sp.callbackUrl === "string" ? sp.callbackUrl : localePath(locale, "/auth/continue");
  // Auth.js redirects back here with ?error=<code> (it is both the sign-in and the error page).
  const error = typeof sp.error === "string" ? signInErrorMessage(sp.error, dict.auth) : undefined;
  const terminal = await getTerminalLounge();
  // PIN sign-in is staff-only: offered here only on a cashier terminal, landing on its POS.
  const pinCallback = posCallback(locale, sp.callbackUrl);
  const registerHref = `${localePath(locale, "/register")}?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <AuthCard
      title={dict.auth.signInTitle}
      subtitle={dict.auth.signInSubtitle}
      googleEnabled={isGoogleAuthEnabled}
      callbackUrl={callbackUrl}
      orLabel={dict.auth.or}
      footer={{ text: dict.auth.noAccount, linkLabel: dict.nav.signUp, href: registerHref }}
      showGoogle={false}
    >
      <SignInTabs
        defaultTab={terminal?.staff.length && !error ? "pin" : "password"}
        pin={terminal ? <PinSignIn terminal={terminal} callbackUrl={pinCallback} dict={dict} /> : undefined}
        password={<SignInForm callbackUrl={callbackUrl} initialError={error} />}
        google={isGoogleAuthEnabled ? <GoogleSignInButton callbackUrl={callbackUrl} /> : <GoogleSignInUnavailable />}
      />
    </AuthCard>
  );
}
