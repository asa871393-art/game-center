import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { localePath, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getDictionary } from "@/i18n/server";
import { posLoginHref } from "@/lib/pos-login";
import { signOutAction } from "@/server/actions/auth";

/**
 * Shown to lounge staff who open a manager-only POS screen (or, without a loungeId, to an
 * account without cashier access opening the POS). Signing out returns them to the cashier
 * sign-in with this screen as the callback, so someone with access can take over.
 */
export async function ManagersOnly({
  locale,
  loungeId,
  email,
  path,
  viaGoogle = false,
}: {
  locale: Locale;
  loungeId?: string;
  email: string;
  path: string;
  /** Signed in with Google: say "this Gmail account" in the no-access message. */
  viaGoogle?: boolean;
}) {
  const dict = await getDictionary(locale);
  const back = loungeId ? localePath(locale, `/pos/${loungeId}`) : localePath(locale);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <ShieldAlert className="size-12 text-amber-500" aria-hidden />
      {loungeId ? (
        <>
          <h1 className="text-xl font-semibold">{dict.errors.managersOnly}</h1>
          <p className="max-w-md text-sm text-muted-foreground">{format(dict.errors.managersOnlyHint, { email })}</p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">{dict.posLogin.noAccessTitle}</h1>
          <p role="alert" className="max-w-md text-base">
            {viaGoogle ? dict.posLogin.noAccessGmail : dict.posLogin.noAccess}
          </p>
          <p className="text-sm text-muted-foreground" dir="auto">
            {format(dict.posLogin.signedInAs, { email })}
          </p>
        </>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <form action={signOutAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="redirectTo" value={posLoginHref(locale, path)} />
          <Button type="submit" size="lg">
            {dict.errors.switchAccount}
          </Button>
        </form>
        <Link href={back} className={buttonVariants({ variant: "outline", size: "lg" })}>
          {loungeId ? dict.devices.backToPos : dict.nav.home}
        </Link>
      </div>
    </main>
  );
}
