import { Gamepad2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getSession } from "@/server/session";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { LocaleSwitcher } from "./locale-switcher";
import { UserMenu } from "./user-menu";

export async function SiteHeader() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
        <Link href={localePath(locale)} className="flex items-center gap-2 font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Gamepad2 className="size-5" aria-hidden />
          </span>
          <span className="hidden sm:inline">{dict.common.appName}</span>
        </Link>
        <nav className="ms-2 flex items-center">
          <Link href={localePath(locale, "/lounges")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {dict.nav.lounges}
          </Link>
        </nav>
        <div className="ms-auto flex items-center gap-1">
          <Suspense fallback={<Skeleton className="h-7 w-20" />}>
            <LocaleSwitcher />
          </Suspense>
          <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
            <AuthArea />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function AuthArea() {
  const [session, locale] = await Promise.all([getSession(), getLocale()]);
  const dict = await getDictionary(locale);
  if (!session?.user) {
    return (
      <Link href={localePath(locale, "/login")} className={buttonVariants({ size: "sm" })}>
        {dict.nav.signIn}
      </Link>
    );
  }
  const { name, email, image, role } = session.user;
  return <UserMenu user={{ name: name ?? null, email: email ?? null, image: image ?? null, role }} />;
}
