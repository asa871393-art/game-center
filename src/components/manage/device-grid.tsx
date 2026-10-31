"use client";

import { deviceTypeMeta } from "@/components/devices/device-type";
import { useI18n } from "@/i18n/client";
import { formatTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { useLiveBill } from "@/components/pos/use-live-bill";
import type { PosDevice, PosSession } from "@/server/queries/manage";
import { usePos } from "./pos-context";
import { formatCountdown, posStatusBorder, posStatusTone } from "./pos-ui";

/** Live floor map: each tile shows its status and, for running sessions, the time left. */
export function DeviceGrid({ now, onSelect, selectedId }: { now: Date; onSelect: (id: string) => void; selectedId: string | null }) {
  const { dict, locale } = useI18n();
  const { data } = usePos();
  const { width, height } = data.lounge.floorPlan;
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const sessions = new Map(data.sessions.map((s) => [s.id, s]));

  return (
    <div>
      {/* A physical room must not mirror in RTL. */}
      <div dir="ltr" className="overflow-x-auto rounded-2xl border bg-muted/40 p-3">
        <div
          role="group"
          aria-label={dict.lounge.floorPlan}
          className="grid min-w-[720px] gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${height}, minmax(2.75rem, auto))`,
          }}
        >
          {data.devices.map((device) => {
            const category = categories.get(device.categoryId);
            if (!category) return null;
            const { icon: Icon, color } = deviceTypeMeta[category.type];
            const current = device.currentBookingId ? sessions.get(device.currentBookingId) : undefined;
            const next = device.nextBookingId ? sessions.get(device.nextBookingId) : undefined;
            return (
              <button
                key={device.id}
                type="button"
                onClick={() => onSelect(device.id)}
                aria-label={`${device.name}, ${dict.deviceStatus[device.status]}`}
                aria-pressed={selectedId === device.id}
                className={cn(
                  "relative flex min-h-11 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border-2 bg-card p-1 text-[11px] leading-tight font-semibold transition",
                  "hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none",
                  posStatusBorder[device.status],
                  selectedId === device.id && "ring-3 ring-primary/60",
                  (device.status === "MAINTENANCE" || device.status === "OFFLINE") && "opacity-60",
                )}
                style={{
                  gridColumn: `${device.posX + 1} / span ${device.width}`,
                  gridRow: `${device.posY + 1} / span ${device.height}`,
                }}
              >
                <span className="flex items-center gap-1">
                  <Icon className="size-3.5 shrink-0" style={{ color }} aria-hidden />
                  <span className="truncate">{device.name}</span>
                </span>
                <TileStatus
                  device={device}
                  session={current ?? null}
                  now={now}
                  nextLabel={next ? formatTime(locale, next.scheduledStart, data.lounge.timezone) : null}
                />
              </button>
            );
          })}
        </div>
      </div>
      <Legend />
    </div>
  );
}

function TileStatus({
  device,
  session,
  now,
  nextLabel,
}: {
  device: PosDevice;
  session: PosSession | null;
  now: Date;
  nextLabel: string | null;
}) {
  const { dict } = useI18n();
  const bill = useLiveBill(session, now);
  if (bill?.elapsedMs !== null && bill?.elapsedMs !== undefined) {
    // Open session: count up.
    return (
      <span dir="ltr" className={cn("rounded px-1 font-mono text-[10px] tabular-nums", posStatusTone.IN_USE)}>
        {bill.paused ? "❚❚ " : "↑ "}
        {formatCountdown(bill.elapsedMs)}
      </span>
    );
  }
  const remainingMs = bill?.remainingMs ?? null;
  if (remainingMs !== null) {
    return (
      <span
        dir="ltr"
        className={cn(
          "rounded px-1 font-mono text-[10px] tabular-nums",
          remainingMs < 0 ? "animate-pulse bg-rose-500/20 text-rose-700 dark:text-rose-300" : posStatusTone.IN_USE,
        )}
      >
        {remainingMs < 0 ? "+" : ""}
        {formatCountdown(Math.abs(remainingMs))}
      </span>
    );
  }
  if (device.status === "RESERVED" && nextLabel) {
    return <span className={cn("rounded px-1 text-[10px]", posStatusTone.RESERVED)}>{nextLabel}</span>;
  }
  return <span className={cn("rounded px-1 text-[10px] font-medium", posStatusTone[device.status])}>{dict.deviceStatus[device.status]}</span>;
}

function Legend() {
  const { dict } = useI18n();
  const statuses = ["IDLE", "IN_USE", "RESERVED", "MAINTENANCE"] as const;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {statuses.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded border-2", posStatusBorder[s])} aria-hidden />
          {dict.deviceStatus[s]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="size-3 animate-pulse rounded bg-rose-500/40" aria-hidden />
        {dict.manage.session.overtime}
      </span>
    </div>
  );
}
