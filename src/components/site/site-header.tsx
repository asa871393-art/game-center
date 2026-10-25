import { Gamepad2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getSession } from "@/server/session";
import { getPlatformRole, isStaffRole, listManagedLounges } from "@/server/staff";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { localePath } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { posLoginHref } from "@/lib/pos-login";
import { LocaleSwitcher } from "./locale-switcher";
import { StaffNav } from "./staff-nav";
import { UserMenu } from "./user-menu";

export async function SiteHeader() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
        <Link href={localePath(locale, "/pos")} className="flex shrink-0 items-center gap-2 font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Gamepad2 className="size-5" aria-hidden />
          </span>
          <span className="hidden sm:inline">{dict.common.appName}</span>
        </Link>
        <Suspense>
          <StaffNavArea />
        </Suspense>
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

/** POS, management, staff and shift-report links, for lounge staff only. */
async function StaffNavArea() {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const role = await getPlatformRole(session.user.id);
  if (!role || !isStaffRole(role)) return null;
  const lounges = await listManagedLounges(session.user.id, role);
  return <StaffNav defaultLoungeId={lounges.length === 1 ? lounges[0].id : null} />;
}

async function AuthArea() {
  const [session, locale] = await Promise.all([getSession(), getLocale()]);
  const dict = await getDictionary(locale);
  if (!session?.user) {
    return (
      <Link href={posLoginHref(locale)} className={buttonVariants({ size: "sm" })}>
        {dict.nav.signIn}
      </Link>
    );
  }
  const { name, email, image, role } = session.user;
  return <UserMenu user={{ name: name ?? null, email: email ?? null, image: image ?? null, role }} />;
}
