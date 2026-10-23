import { Lock, MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { GoogleSignInButton, GoogleSignInUnavailable, SignInForm } from "@/components/auth/auth-forms";
import { signInErrorMessage } from "@/components/auth/sign-in-errors";
import { ManagersOnly } from "@/components/pos/managers-only";
import { PinKeypad } from "@/components/pos/pin-keypad";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { authSecret, isGoogleAuthEnabled } from "@/lib/env";
import { posCallback } from "@/lib/pos-login";
import { POS_TERMINAL_COOKIE, readTerminal } from "@/lib/pos-terminal";
import { db } from "@/server/db";
import { listPinStaff } from "@/server/services/pos-pin";
import { getSession } from "@/server/session";
import { getPlatformRole, isStaffRole } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.posLogin.title, robots: { index: false } };
}

/**
 * Cashier sign-in for the POS touchscreen: Gmail first (the account a manager granted access
 * to), email and password as a fallback. Staff who are already signed in go straight on.
 * On a registered cashier terminal (locked with "Lock screen / Switch staff") it shows the
 * lounge's PIN keypad first, with the other methods folded away.
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
  const terminal = await terminalLounge();
  if (terminal) {
    const l = dict.posLock;
    return (
      <div className="w-full max-w-md space-y-6 rounded-3xl border bg-card p-6 shadow-lg sm:p-8">
        <div className="space-y-1 text-center">
          <div className="text-sm font-semibold text-primary">
            {dict.common.appName} - {dict.pos.controlTitle}
          </div>
          <Lock className="mx-auto size-9 text-primary" aria-hidden />
          <h1 className="text-2xl font-bold">{l.title}</h1>
          <p className="text-sm text-muted-foreground">{terminal.name}</p>
        </div>
        {terminal.staff.length > 0 ? (
          <PinKeypad staff={terminal.staff} callbackUrl={callbackUrl} />
        ) : (
          <p className="rounded-2xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">{l.noStaff}</p>
        )}
        <p className="text-center text-xs text-muted-foreground">{l.shiftKept}</p>
        <details className="group rounded-2xl border p-4" open={terminal.staff.length === 0 || !!error}>
          <summary className="cursor-pointer list-none text-center text-sm font-medium text-muted-foreground group-open:mb-4">
            {l.otherMethod}
          </summary>
          <div className="space-y-4">
            {isGoogleAuthEnabled ? (
              <GoogleSignInButton callbackUrl={callbackUrl} label={p.google} size="xl" />
            ) : (
              <GoogleSignInUnavailable label={p.google} note={p.notConfigured} size="xl" />
            )}
            <SignInForm callbackUrl={callbackUrl} initialError={error} />
          </div>
        </details>
      </div>
    );
  }

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

/** The lounge this browser is a locked cashier terminal for, with who can sign in by PIN there. */
async function terminalLounge() {
  const loungeId = readTerminal((await cookies()).get(POS_TERMINAL_COOKIE)?.value, authSecret);
  if (!loungeId) return null;
  const [lounge, staff] = await Promise.all([
    db.lounge.findUnique({ where: { id: loungeId }, select: { id: true, name: true } }),
    listPinStaff(loungeId),
  ]);
  return lounge ? { ...lounge, staff } : null;
}
