import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { localePath, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getDictionary } from "@/i18n/server";
import { signOutAction } from "@/server/actions/auth";

/**
 * Shown to lounge staff who open a manager-only POS screen (or, without a loungeId, to a
 * non-staff account opening the POS). Signing out returns them to the login page with this
 * screen as the callback, so someone with access can take over.
 */
export async function ManagersOnly({
  locale,
  loungeId,
  email,
  path,
}: {
  locale: Locale;
  loungeId?: string;
  email: string;
  path: string;
}) {
  const dict = await getDictionary(locale);
  const back = loungeId ? localePath(locale, `/pos/${loungeId}`) : localePath(locale);
  const login = `${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, path))}`;
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <ShieldAlert className="size-12 text-amber-500" aria-hidden />
      <h1 className="text-xl font-semibold">{loungeId ? dict.errors.managersOnly : dict.errors.staffOnly}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {format(loungeId ? dict.errors.managersOnlyHint : dict.errors.staffOnlyHint, { email })}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <form action={signOutAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="redirectTo" value={login} />
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
