"use client";

import { CalendarCheck, LayoutDashboard, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Role } from "@/lib/db/types";
import { useI18n } from "@/i18n/client";
import { signOutAction } from "@/server/actions/auth";

export interface MenuUser {
  name: string | null;
  email: string | null;
  image: string | null;
  role: Role;
}

export function UserMenu({ user }: { user: MenuUser }) {
  const { dict, href, locale } = useI18n();
  const initials = (user.name ?? user.email ?? "?").trim().slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" aria-label={user.name ?? ""} />}>
        <Avatar className="size-8">
          {user.image && <AvatarImage src={user.image} alt="" />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">
          <div className="font-medium text-foreground">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={href("/account/bookings")} />}>
          <CalendarCheck /> {dict.nav.myBookings}
        </DropdownMenuItem>
        {user.role !== "CUSTOMER" && (
          <>
            <DropdownMenuItem render={<Link href={href("/pos")} />}>
              <MonitorSmartphone /> {dict.pos.title}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={href("/manage")} />}>
              <LayoutDashboard /> {dict.nav.dashboard}
            </DropdownMenuItem>
          </>
        )}
        {user.role === "SUPER_ADMIN" && (
          <DropdownMenuItem render={<Link href={href("/admin")} />}>
            <ShieldCheck /> {dict.nav.admin}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <input type="hidden" name="locale" value={locale} />
          <DropdownMenuItem render={<button type="submit" className="w-full" />} closeOnClick={false}>
            <LogOut /> {dict.nav.signOut}
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
