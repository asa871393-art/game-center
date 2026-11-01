import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { signInErrorMessage } from "@/components/auth/sign-in-errors";
import { ManagersOnly } from "@/components/pos/managers-only";
import { PinSignIn } from "@/components/pos/pin-sign-in";
import { TerminalEnroll } from "@/components/pos/terminal-enroll";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getDictionary, getLocale } from "@/i18n/server";
import { posCallback } from "@/lib/pos-login";
import { getPinLounge } from "@/server/services/pos-pin";
import { getSession } from "@/server/session";
import { getPlatformRole, isStaffRole } from "@/server/staff";
import { isTrustedTerminal } from "@/server/terminal";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.posLogin.title, robots: { index: false } };
}

/**
 * The only sign-in: type your PIN on the branch's keypad, and the PIN says who you are. Staff who are
 * already signed in go straight on to the page they asked for (the POS by default).
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
      />
    );
  }

  const error = typeof sp.error === "string" ? signInErrorMessage(sp.error, dict.auth) : undefined;
  const p = dict.posLogin;
  // Browsers that haven't entered the branch code don't see the branch or its keypad.
  const trusted = await isTrustedTerminal();
  const lounge = trusted ? await getPinLounge() : null;
  return (
    <div className="w-full max-w-md space-y-6 rounded-3xl border bg-card p-6 shadow-lg sm:p-8">
      <div className="space-y-2 text-center">
        <Image
          src="/brand/logo-full-light.png"
          alt={dict.common.appName}
          width={896}
          height={460}
          priority
          className="mx-auto h-auto w-52"
        />
        <div className="text-sm font-semibold text-primary">{dict.pos.controlTitle}</div>
        <h1 className="text-2xl font-bold">{p.title}</h1>
        <p className="text-sm text-muted-foreground">{lounge ? `${lounge.name} · ${p.subtitle}` : p.subtitle}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {trusted ? <PinSignIn lounge={lounge} callbackUrl={callbackUrl} dict={dict} /> : <TerminalEnroll />}
    </div>
  );
}
