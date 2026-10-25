"use client";

import { ClipboardList, LayoutDashboard, MonitorSmartphone, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** The lounge in the current /{locale}/manage/{id} or /{locale}/pos/{id} URL, if any. */
function loungeFromPath(pathname: string): string | null {
  const [, , section, id] = pathname.split("/");
  if ((section === "manage" || section === "pos") && id && id !== "login") return id;
  return null;
}

/**
 * Staff navigation: POS terminal, lounge management, staff and shift reports. Staff and shift
 * reports are per lounge: the one in the URL, else the user's only lounge, else the lounge pickers.
 */
export function StaffNav({ defaultLoungeId }: { defaultLoungeId: string | null }) {
  const { dict, href } = useI18n();
  const pathname = usePathname();
  const loungeId = loungeFromPath(pathname) ?? defaultLoungeId;

  const links = [
    { path: "/pos", label: dict.nav.posTerminal, icon: MonitorSmartphone },
    { path: "/manage", label: dict.nav.manageLounge, icon: LayoutDashboard },
    { path: loungeId ? `/manage/${loungeId}/staff` : "/manage", label: dict.nav.staff, icon: Users },
    { path: loungeId ? `/pos/${loungeId}/shifts` : "/pos", label: dict.nav.shiftReports, icon: ClipboardList },
  ];
  const current = pathname.replace(/^\/[^/]+/, "");

  return (
    <nav className="ms-2 flex min-w-0 items-center overflow-x-auto">
      {links.map(({ path, label, icon: Icon }) => (
        <Link
          key={label}
          href={href(path)}
          aria-current={current === path ? "page" : undefined}
          className={cn(buttonVariants({ variant: current === path ? "secondary" : "ghost", size: "sm" }), "shrink-0")}
        >
          <Icon aria-hidden />
          <span className="hidden md:inline">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
