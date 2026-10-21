import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { localePath, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getDictionary } from "@/i18n/server";
import { signOutAction } from "@/server/actions/auth";

/**
 * Shown to lounge staff who open a manager-only POS screen. Signing out returns
 * them to the login page with this screen as the callback, so a manager can take over.
 */
export async function ManagersOnly({ locale, loungeId, email, path }: { locale: Locale; loungeId: string; email: string; path: string }) {
  const dict = await getDictionary(locale);
  const back = localePath(locale, `/pos/${loungeId}`);
  const login = `${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, path))}`;
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <ShieldAlert className="size-12 text-amber-500" aria-hidden />
      <h1 className="text-xl font-semibold">{dict.errors.managersOnly}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{format(dict.errors.managersOnlyHint, { email })}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <form action={signOutAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="redirectTo" value={login} />
          <Button type="submit" size="lg">
            {dict.errors.switchAccount}
          </Button>
        </form>
        <Link href={back} className={buttonVariants({ variant: "outline", size: "lg" })}>
          {dict.devices.backToPos}
        </Link>
      </div>
    </main>
  );
}
