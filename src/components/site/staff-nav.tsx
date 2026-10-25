"use client";

import { ClipboardList, LayoutDashboard, MonitorSmartphone, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** Staff navigation for the single branch: POS terminal, lounge management, staff and shift reports. */
export function StaffNav({ loungeId }: { loungeId: string }) {
  const { dict, href } = useI18n();
  const pathname = usePathname();

  const links = [
    { path: `/pos/${loungeId}`, label: dict.nav.posTerminal, icon: MonitorSmartphone },
    { path: `/manage/${loungeId}`, label: dict.nav.manageLounge, icon: LayoutDashboard },
    { path: `/manage/${loungeId}/staff`, label: dict.nav.staff, icon: Users },
    { path: `/pos/${loungeId}/shifts`, label: dict.nav.shiftReports, icon: ClipboardList },
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
