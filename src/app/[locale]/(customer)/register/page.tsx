import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/auth-forms";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { isGoogleAuthEnabled } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.auth.signUpTitle };
}

export default function RegisterPage({ searchParams }: PageProps<"/[locale]/register">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <Suspense fallback={<Skeleton className="h-[30rem] w-full max-w-sm rounded-3xl" />}>
        <Register searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Register({ searchParams }: Pick<PageProps<"/[locale]/register">, "searchParams">) {
  const [sp, locale] = await Promise.all([searchParams, getLocale()]);
  const dict = await getDictionary(locale);
  const callbackUrl = typeof sp.callbackUrl === "string" ? sp.callbackUrl : localePath(locale);
  const loginHref = `${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <AuthCard
      title={dict.auth.signUpTitle}
      subtitle={dict.auth.signUpSubtitle}
      googleEnabled={isGoogleAuthEnabled}
      callbackUrl={callbackUrl}
      orLabel={dict.auth.or}
      footer={{ text: dict.auth.haveAccount, linkLabel: dict.nav.signIn, href: loginHref }}
    >
      <SignUpForm callbackUrl={callbackUrl} />
    </AuthCard>
  );
}
