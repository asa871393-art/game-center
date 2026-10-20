"use client";

import { ClipboardList, LayoutDashboard, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { DEVICE_TYPES, deviceTypeMeta } from "@/components/lounge/device-type";
import { CanteenPanel } from "@/components/manage/canteen-panel";
import { OrderDialog } from "@/components/manage/order-dialog";
import { PosProvider, useAutoRefresh, useNow, usePos } from "@/components/manage/pos-context";
import { LocaleSwitcher } from "@/components/site/locale-switcher";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { DeviceType } from "@/generated/prisma/enums";
import { useDebouncedRefresh, useLiveEvents, type LiveStatus } from "@/hooks/use-live-events";
import { useI18n } from "@/i18n/client";
import { formatDate, money } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { PosBoardData } from "@/server/queries/manage";
import { DeviceTile } from "./device-tile";
import { QuickActions } from "./quick-actions";

interface FeedEvent {
  table: string;
  op: string;
  source?: string;
}

export function PosTerminal({
  data,
  canManageDevices,
  cashierName,
}: {
  data: PosBoardData;
  canManageDevices: boolean;
  cashierName: string;
}) {
  return (
    <PosProvider value={{ data, canManageDevices }}>
      <Terminal cashierName={cashierName} />
    </PosProvider>
  );
}

const liveDot: Record<LiveStatus, string> = {
  live: "bg-emerald-400 animate-pulse",
  connecting: "bg-zinc-400",
  offline: "bg-amber-400",
};

function Terminal({ cashierName }: { cashierName: string }) {
  const { dict, locale, href, dir, intl } = useI18n();
  const { data } = usePos();
  const now = useNow(data.generatedAt);
  const refresh = useDebouncedRefresh();
  const live = useLiveEvents<FeedEvent>(`/api/manage/${data.lounge.id}/events`, {
    onChange: (e) => {
      refresh();
      if (e.table === "Booking" && e.op === "INSERT" && e.source === "ONLINE") toast.info(dict.manage.newOnlineBooking);
    },
    onResync: refresh,
  });
  useAutoRefresh(live === "live" ? 120_000 : 15_000);

  const [filter, setFilter] = useState<DeviceType | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const typesPresent = DEVICE_TYPES.filter((t) => data.devices.some((d) => categories.get(d.categoryId)?.type === t));
  const devices = data.devices.filter((d) => filter === "ALL" || categories.get(d.categoryId)?.type === filter);
  const selected = data.devices.find((d) => d.id === selectedId) ?? null;
  const tz = data.lounge.timezone;
  const openSessions = data.sessions.filter((s) => s.status === "ACTIVE" && s.mode === "OPEN").length;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{data.lounge.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {dict.pos.cashier}: {cashierName}
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs" title={dict.manage.connection[`${live}Hint`]}>
          <span className={cn("size-2 rounded-full", liveDot[live])} aria-hidden />
          {dict.manage.connection[live]}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <div className="hidden text-end sm:block">
            <div dir="ltr" className="font-mono text-2xl leading-none font-bold tabular-nums" suppressHydrationWarning>
              {new Intl.DateTimeFormat(intl, {
                timeZone: tz,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }).format(now)}
            </div>
            <div className="text-[11px] text-muted-foreground" suppressHydrationWarning>
              {formatDate(locale, now, tz)}
            </div>
          </div>
          <Button size="lg" variant="secondary" className="h-12" onClick={() => setQueueOpen(true)}>
            <ClipboardList aria-hidden />
            <span className="hidden md:inline">{dict.pos.ordersQueue}</span>
            {data.queue.length > 0 && <Badge>{data.queue.length}</Badge>}
          </Button>
          <Button size="lg" className="h-12" onClick={() => setCounterOpen(true)}>
            <ShoppingCart aria-hidden />
            <span className="hidden md:inline">{dict.manage.canteen.counterSale}</span>
          </Button>
          <Suspense>
            <LocaleSwitcher />
          </Suspense>
          <Link href={href(`/manage/${data.lounge.id}`)} className={buttonVariants({ variant: "ghost", size: "icon-lg" })} title={dict.nav.dashboard}>
            <LayoutDashboard aria-hidden />
            <span className="sr-only">{dict.nav.dashboard}</span>
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 px-4 pt-3 sm:grid-cols-4">
        <Summary label={dict.manage.stats.occupancy} value={`${data.stats.activeSessions} / ${data.stats.inService}`} />
        <Summary label={dict.pos.openSessions} value={String(openSessions)} />
        <Summary label={dict.manage.stats.upcoming} value={String(data.stats.upcomingToday)} />
        <Summary label={dict.manage.stats.revenue} value={money(locale, data.stats.revenue, data.lounge.currency)} />
      </div>

      <nav className="flex gap-2 overflow-x-auto px-4 py-3" aria-label={dict.search.deviceType}>
        <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} label={dict.search.allTypes} count={data.devices.length} />
        {typesPresent.map((type) => {
          const { icon: Icon } = deviceTypeMeta[type];
          return (
            <FilterChip
              key={type}
              active={filter === type}
              onClick={() => setFilter(type)}
              label={dict.deviceType[type]}
              icon={<Icon className="size-4" aria-hidden />}
              count={data.devices.filter((d) => categories.get(d.categoryId)?.type === type).length}
            />
          );
        })}
      </nav>

      <main className="grid flex-1 auto-rows-min grid-cols-2 gap-3 px-4 pb-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {devices.map((d) => (
          <DeviceTile key={d.id} device={d} now={now} onOpen={() => setSelectedId(d.id)} />
        ))}
      </main>

      <QuickActions device={selected} now={now} onClose={() => setSelectedId(null)} />
      <OrderDialog open={counterOpen} onOpenChange={setCounterOpen} />
      <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
        <SheetContent side={dir === "rtl" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{dict.manage.canteen.queue}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <CanteenPanel now={now} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/60",
      )}
    >
      {icon}
      {label}
      <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-primary-foreground/20" : "bg-muted")}>{count}</span>
    </button>
  );
}
