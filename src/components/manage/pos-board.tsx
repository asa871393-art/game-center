"use client";

import { Activity, CalendarClock, CheckCircle2, Coffee, Settings2, UtensilsCrossed, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/client";
import { formatDate, formatTime, money } from "@/i18n/format";
import { useDebouncedRefresh, useLiveEvents, type LiveStatus } from "@/hooks/use-live-events";
import { zonedTimeToUtc } from "@/lib/booking/time";
import { cn } from "@/lib/utils";
import type { PosBoardData } from "@/server/queries/manage";
import { BookingsList } from "./bookings-list";
import { CanteenPanel } from "./canteen-panel";
import { DeviceGrid } from "./device-grid";
import { DevicePanel } from "./device-panel";
import { PosProvider, useAutoRefresh, useNow, usePos } from "./pos-context";

export function PosBoard({ data, canManageDevices }: { data: PosBoardData; canManageDevices: boolean }) {
  return (
    <PosProvider value={{ data, canManageDevices }}>
      <Board />
    </PosProvider>
  );
}

function Board() {
  const { dict, locale, dir, t, href } = useI18n();
  const { data, canManageDevices } = usePos();
  const now = useNow(data.generatedAt);
  const refresh = useDebouncedRefresh();
  const live = useLiveEvents<BoardEvent>(`/api/manage/${data.lounge.id}/events`, {
    onChange: (e) => {
      refresh();
      if (e.table === "Booking" && e.op === "INSERT" && e.source === "ONLINE") toast.info(dict.manage.newOnlineBooking);
    },
    onResync: refresh,
  });
  // Polling is only a safety net while the live feed is up.
  useAutoRefresh(live === "live" ? 120_000 : 15_000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState("floor");
  const selected = data.devices.find((d) => d.id === selectedId) ?? null;
  const tz = data.lounge.timezone;

  const openDevice = (id: string) => {
    setSelectedId(id);
    setTab("floor");
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{data.lounge.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t(dict.manage.businessDay, {
              // The business date is a calendar date; noon avoids any DST edge.
              date: formatDate(locale, zonedTimeToUtc(data.businessDay.date, 12 * 60, tz), tz, "full"),
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {!data.businessDay.isOpen && <Badge variant="outline">{dict.manage.closedNow}</Badge>}
          <ConnectionBadge status={live} />
          <span suppressHydrationWarning>{t(dict.manage.updatedAt, { time: formatTime(locale, data.generatedAt, tz) })}</span>
          {canManageDevices && (
            <Link href={href(`/pos/${data.lounge.id}/devices`)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Settings2 aria-hidden /> {dict.devices.title}
            </Link>
          )}
          {canManageDevices && (
            <Link href={href(`/pos/${data.lounge.id}/menu`)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <UtensilsCrossed aria-hidden /> {dict.menuAdmin.title}
            </Link>
          )}
        </div>
      </header>

      <Stats />

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="gap-4">
        <TabsList>
          <TabsTrigger value="floor">{dict.manage.tabs.floor}</TabsTrigger>
          <TabsTrigger value="bookings">
            {dict.manage.tabs.bookings} <Badge variant="secondary">{data.sessions.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="canteen">
            {dict.manage.tabs.canteen}
            {data.queue.length > 0 && <Badge>{data.queue.length}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="floor">
          <DeviceGrid now={now} onSelect={setSelectedId} selectedId={selectedId} />
        </TabsContent>
        <TabsContent value="bookings">
          <BookingsList onSelectDevice={openDevice} />
        </TabsContent>
        <TabsContent value="canteen">
          <CanteenPanel now={now} />
        </TabsContent>
      </Tabs>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side={dir === "rtl" ? "left" : "right"} className="w-full gap-0 sm:max-w-md">
          {selected && <DevicePanel key={selected.id} device={selected} now={now} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface BoardEvent {
  table: "Booking" | "Device" | "CanteenOrder";
  op: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  status: string;
  source?: string;
}

const connectionTone: Record<LiveStatus, { badge: string; dot: string }> = {
  live: { badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", dot: "animate-pulse bg-emerald-500" },
  connecting: { badge: "bg-muted text-muted-foreground", dot: "bg-zinc-400" },
  offline: { badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
};

function ConnectionBadge({ status }: { status: LiveStatus }) {
  const { dict } = useI18n();
  return (
    <Badge className={cn("gap-1.5 border-0", connectionTone[status].badge)} title={dict.manage.connection[`${status}Hint`]}>
      <span className={cn("size-1.5 rounded-full", connectionTone[status].dot)} aria-hidden />
      {dict.manage.connection[status]}
    </Badge>
  );
}

function Stats() {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { stats } = data;
  const cur = data.lounge.currency;
  const tiles = [
    { icon: Wallet, label: dict.manage.stats.revenue, value: money(locale, stats.revenue, cur) },
    {
      icon: Activity,
      label: dict.manage.stats.occupancy,
      value: t(dict.manage.stats.occupancyValue, { active: stats.activeSessions, total: stats.inService }),
      hint: stats.inService ? `${Math.round((stats.activeSessions / stats.inService) * 100)}%` : undefined,
    },
    { icon: CalendarClock, label: dict.manage.stats.upcoming, value: String(stats.upcomingToday) },
    {
      icon: CheckCircle2,
      label: dict.manage.stats.completed,
      value: String(stats.completedToday),
      hint: stats.noShows ? t(dict.manage.stats.noShows, { count: stats.noShows }) : undefined,
    },
    { icon: Coffee, label: dict.manage.stats.canteenSales, value: money(locale, stats.canteenSales, cur) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
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
