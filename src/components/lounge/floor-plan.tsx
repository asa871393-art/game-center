"use client";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/client";
import { format, money } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { LoungeDetails } from "@/server/queries/lounges";
import { deviceTypeMeta } from "./device-type";

type Device = LoungeDetails["devices"][number];
type Category = LoungeDetails["categories"][number];

/** Online-bookable right now? (Live status only affects "now"; future slots are checked separately.) */
export function isSelectable(device: Device): boolean {
  return device.isBookableOnline && device.status !== "MAINTENANCE" && device.status !== "OFFLINE";
}

const statusDot: Record<Device["status"], string> = {
  IDLE: "bg-emerald-500",
  IN_USE: "bg-rose-500",
  RESERVED: "bg-amber-500",
  MAINTENANCE: "bg-zinc-400",
  OFFLINE: "bg-zinc-400",
};

interface FloorPlanProps {
  lounge: Pick<LoungeDetails, "devices" | "categories" | "zones" | "floorPlan" | "currency">;
  onSelect: (deviceId: string) => void;
}

export function FloorPlan({ lounge, onSelect }: FloorPlanProps) {
  const { dict } = useI18n();
  const categories = new Map(lounge.categories.map((c) => [c.id, c]));

  return (
    <Tabs defaultValue="map" className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{dict.lounge.floorPlanHint}</p>
        <TabsList>
          <TabsTrigger value="map">{dict.lounge.mapView}</TabsTrigger>
          <TabsTrigger value="list">{dict.lounge.listView}</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="map">
        <MapView lounge={lounge} categories={categories} onSelect={onSelect} />
        <Legend />
      </TabsContent>
      <TabsContent value="list">
        <ListView lounge={lounge} categories={categories} onSelect={onSelect} />
      </TabsContent>
    </Tabs>
  );
}

function MapView({
  lounge,
  categories,
  onSelect,
}: FloorPlanProps & { categories: Map<string, Category> }) {
  const { dict } = useI18n();
  const { width, height } = lounge.floorPlan;
  const zones = new Map(lounge.zones.map((z) => [z.id, z]));

  return (
    // The physical layout must not mirror in RTL, so the grid is always LTR.
    // On narrow screens the map scrolls inside its own frame.
    // dir is set on the scroller too, so it opens at the plan's left edge in RTL.
    <div dir="ltr" className="overflow-x-auto rounded-2xl border bg-muted/40 p-3">
      <div
        role="group"
        aria-label={dict.lounge.floorPlan}
        className="grid min-w-[640px] gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${height}, minmax(2.25rem, auto))`,
        }}
      >
        {lounge.devices.map((device) => {
          const category = categories.get(device.categoryId);
          if (!category) return null;
          const { icon: Icon, color } = deviceTypeMeta[category.type];
          const selectable = isSelectable(device);
          const zone = device.zoneId ? zones.get(device.zoneId) : undefined;
          return (
            <button
              key={device.id}
              type="button"
              disabled={!selectable}
              onClick={() => onSelect(device.id)}
              title={`${device.name} · ${category.name}${zone ? ` · ${zone.name}` : ""}`}
              aria-label={`${device.name}, ${category.name}, ${dict.deviceStatus[device.status]}`}
              className={cn(
                "relative flex min-h-9 flex-col items-center justify-center gap-0.5 rounded-lg border-2 bg-card p-1 text-[11px] font-semibold leading-tight transition",
                "focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none",
                selectable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : "cursor-not-allowed opacity-45",
              )}
              style={{
                gridColumn: `${device.posX + 1} / span ${device.width}`,
                gridRow: `${device.posY + 1} / span ${device.height}`,
                borderColor: color,
              }}
            >
              <span className={cn("absolute end-1 top-1 size-2 rounded-full", statusDot[device.status])} aria-hidden />
              <Icon className="size-4 shrink-0" style={{ color }} aria-hidden />
              <span className="truncate">{device.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  const { dict } = useI18n();
  const statuses = ["IDLE", "IN_USE", "RESERVED", "MAINTENANCE"] as const;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{dict.lounge.legend}:</span>
      {statuses.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", statusDot[s])} aria-hidden />
          {dict.deviceStatus[s]}
        </span>
      ))}
    </div>
  );
}

function ListView({ lounge, categories, onSelect }: FloorPlanProps & { categories: Map<string, Category> }) {
  const { dict, locale } = useI18n();
  return (
    <div className="space-y-5">
      {[...categories.values()].map((category) => {
        const devices = lounge.devices.filter((d) => d.categoryId === category.id);
        if (devices.length === 0) return null;
        const { icon: Icon, color } = deviceTypeMeta[category.type];
        return (
          <section key={category.id}>
            <h3 className="mb-2 flex items-center gap-2 font-semibold">
              <Icon className="size-4" style={{ color }} aria-hidden />
              {category.name}
              <span className="text-sm font-normal text-muted-foreground">
                · {money(locale, category.baseHourlyRate, lounge.currency)}
                {dict.common.perHour}
              </span>
            </h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {devices.map((device) => {
                const selectable = isSelectable(device);
                return (
                  <li key={device.id}>
                    <button
                      type="button"
                      disabled={!selectable}
                      onClick={() => onSelect(device.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card p-3 text-start transition enabled:hover:border-primary disabled:opacity-50"
                    >
                      <span>
                        <span className="block font-medium">{device.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(dict.lounge.capacity, { count: category.capacity })}
                        </span>
                      </span>
                      <Badge variant={selectable ? "secondary" : "outline"} className="gap-1.5">
                        <span className={cn("size-1.5 rounded-full", statusDot[device.status])} aria-hidden />
                        {selectable ? dict.deviceStatus[device.status] : dict.lounge.notBookable}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
