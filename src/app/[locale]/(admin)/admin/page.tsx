import { Building2, CalendarCheck, Coins, Landmark, Monitor, Store, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { LoungeStatusToggle } from "@/components/admin/lounge-status-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LoungeStatus } from "@/lib/db/types";
import { localePath, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { format, formatDate, formatNumber, money } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { db } from "@/server/db";
import { getPlatformOverview, type PlatformOverview } from "@/server/queries/admin";
import { getSession } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.admin.title, robots: { index: false } };
}

export default async function AdminPage() {
  const dict = await getDictionary();
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">{dict.admin.title}</h1>
      <Suspense fallback={<Skeleton className="mt-6 h-96 rounded-2xl" />}>
        <Overview />
      </Suspense>
    </main>
  );
}

const loungeTone: Record<LoungeStatus, string> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  DRAFT: "bg-muted text-muted-foreground",
  SUSPENDED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  CLOSED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

async function Overview() {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, "/admin"))}`);
  }
  // The JWT role can be stale; the database decides.
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { role: true, isActive: true } });
  if (user?.role !== "SUPER_ADMIN" || !user.isActive) notFound();

  const [dict, data] = await Promise.all([getDictionary(locale), getPlatformOverview()]);
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">{format(dict.admin.period, { days: data.periodDays })}</p>
      <Totals data={data} locale={locale} dict={dict} />
      {data.organizations.map((org) => (
        <Organization key={org.id} org={org} locale={locale} dict={dict} />
      ))}
    </div>
  );
}

function Totals({ data, locale, dict }: { data: PlatformOverview; locale: Locale; dict: Dictionary }) {
  const { totals, currency } = data;
  const tiles = [
    { icon: Wallet, label: dict.admin.revenue, value: money(locale, totals.revenue, currency) },
    { icon: Landmark, label: dict.admin.onlinePayments, value: money(locale, totals.online, currency) },
    { icon: Coins, label: dict.admin.commission, value: money(locale, totals.commission, currency) },
    { icon: CalendarCheck, label: dict.admin.bookings, value: formatNumber(locale, totals.bookings) },
    {
      icon: Store,
      label: dict.admin.lounges,
      value: `${formatNumber(locale, totals.activeLounges)} / ${formatNumber(locale, totals.lounges)}`,
      hint: format(dict.admin.organizationsCount, { count: totals.organizations }),
    },
    {
      icon: Monitor,
      label: dict.admin.devices,
      value: formatNumber(locale, totals.devices),
      hint: format(dict.admin.liveSessions, { count: totals.activeSessions }),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map(({ icon: Icon, label, value, hint }) => (
        <div key={label} className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Icon className="size-4" aria-hidden />
            {label}
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
      ))}
    </div>
  );
}

type Org = PlatformOverview["organizations"][number];

function Organization({ org, locale, dict }: { org: Org; locale: Locale; dict: Dictionary }) {
  const sub = org.subscription;
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold">{org.name}</h2>
            <p className="text-sm text-muted-foreground">
              {dict.admin.owner}: {org.owner} · {dict.admin.commissionRate}: {formatNumber(locale, org.commissionRateBps / 100)}%
            </p>
          </div>
        </div>
        {sub && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{dict.admin.plan[sub.plan]}</Badge>
            <Badge variant="outline">{dict.admin.subscriptionStatus[sub.status]}</Badge>
            <span className="text-muted-foreground">
              {money(locale, sub.priceMonthly, sub.currency)}
              {dict.admin.perMonth} · {format(dict.admin.renews, { date: formatDate(locale, sub.currentPeriodEnd, "UTC") })}
            </span>
            <span className="text-muted-foreground">
              · {format(dict.admin.limits, { lounges: sub.maxLounges, devices: sub.maxDevices })}
            </span>
          </div>
        )}
      </header>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{dict.admin.lounge}</TableHead>
              <TableHead>{dict.admin.status}</TableHead>
              <TableHead className="text-end">{dict.admin.devices}</TableHead>
              <TableHead className="text-end">{dict.admin.liveNow}</TableHead>
              <TableHead className="text-end">{dict.admin.bookings}</TableHead>
              <TableHead className="text-end">{dict.admin.revenue}</TableHead>
              <TableHead className="text-end">{dict.admin.commission}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {org.lounges.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{l.city}</div>
                </TableCell>
                <TableCell>
                  <Badge className={cn("border-0", loungeTone[l.status])}>{dict.admin.loungeStatus[l.status]}</Badge>
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(locale, l.deviceCount)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(locale, l.activeSessions)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatNumber(locale, l.bookings)}</TableCell>
                <TableCell className="text-end tabular-nums">{money(locale, l.revenue, l.currency)}</TableCell>
                <TableCell className="text-end tabular-nums">{money(locale, l.commission, l.currency)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Link
                      href={localePath(locale, `/manage/${l.id}`)}
                      className={buttonVariants({ size: "sm", variant: "ghost" })}
                    >
                      {dict.admin.openBoard}
                    </Link>
                    <Link
                      href={localePath(locale, `/pos/${l.id}/devices`)}
                      className={buttonVariants({ size: "sm", variant: "ghost" })}
                    >
                      {dict.devices.title}
                    </Link>
                    <Link
                      href={localePath(locale, `/pos/${l.id}/menu`)}
                      className={buttonVariants({ size: "sm", variant: "ghost" })}
                    >
                      {dict.menuAdmin.title}
                    </Link>
                    <LoungeStatusToggle loungeId={l.id} name={l.name} status={l.status} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
