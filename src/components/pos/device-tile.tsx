"use client";

import { Pause } from "lucide-react";
import { deviceTypeMeta } from "@/components/devices/device-type";
import { usePos } from "@/components/manage/pos-context";
import { formatCountdown } from "@/components/manage/pos-ui";
import { useI18n } from "@/i18n/client";
import { formatTime, money } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { PosDevice } from "@/server/queries/manage";
import { useLiveBill } from "./use-live-bill";

export type TileState = "IDLE" | "IN_USE" | "PAUSED" | "OVERTIME" | "RESERVED" | "MAINTENANCE" | "OFFLINE";

export const tileTone: Record<TileState, { ring: string; chip: string; glow: string }> = {
  IDLE: { ring: "border-emerald-500/40", chip: "bg-emerald-500/15 text-emerald-300", glow: "" },
  IN_USE: { ring: "border-sky-500", chip: "bg-sky-500/20 text-sky-200", glow: "shadow-[0_0_24px_-8px] shadow-sky-500/60" },
  PAUSED: { ring: "border-violet-400", chip: "bg-violet-500/20 text-violet-200", glow: "" },
  OVERTIME: { ring: "border-rose-500", chip: "bg-rose-500/25 text-rose-200", glow: "shadow-[0_0_24px_-6px] shadow-rose-500/70" },
  RESERVED: { ring: "border-amber-400", chip: "bg-amber-500/20 text-amber-200", glow: "" },
  MAINTENANCE: { ring: "border-zinc-600 border-dashed", chip: "bg-zinc-700/60 text-zinc-300", glow: "" },
  OFFLINE: { ring: "border-zinc-600 border-dashed", chip: "bg-zinc-700/60 text-zinc-300", glow: "" },
};

export function DeviceTile({ device, now, onOpen }: { device: PosDevice; now: Date; onOpen: () => void }) {
  const { dict, locale } = useI18n();
  const { data } = usePos();
  const category = data.categories.find((c) => c.id === device.categoryId);
  const session = data.sessions.find((s) => s.id === device.currentBookingId);
  const next = data.sessions.find((s) => s.id === device.nextBookingId);
  const bill = useLiveBill(session, now);
  if (!category) return null;
  const { icon: Icon, color } = deviceTypeMeta[category.type];

  let state: TileState = device.status === "IN_USE" ? "IN_USE" : device.status;
  if (bill?.paused) state = "PAUSED";
  else if (bill?.remainingMs !== null && bill?.remainingMs !== undefined && bill.remainingMs < 0) state = "OVERTIME";
  const tone = tileTone[state];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "relative flex min-h-36 flex-col gap-2 rounded-2xl border-2 bg-card p-3 text-start transition",
        "active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:outline-none",
        tone.ring,
        tone.glow,
        (state === "MAINTENANCE" || state === "OFFLINE") && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-lg leading-tight font-bold">
            <Icon className="size-5 shrink-0" style={{ color }} aria-hidden />
            <span className="truncate">{device.name}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{category.name}</div>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone.chip)}>
          {dict.pos.state[state]}
        </span>
      </div>

      {session && bill ? (
        <div className="mt-auto space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">{dict.pos.mode[session.mode]}</span>
            {session.priceTier !== "SINGLE" && (
              <span className="rounded-md bg-primary/20 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                {dict.pos.tier[session.priceTier]}
              </span>
            )}
            {bill.paused && <Pause className="size-3.5 text-violet-300" aria-label={dict.pos.state.PAUSED} />}
          </div>
          <div className="flex items-end justify-between gap-2">
            <span dir="ltr" className={cn("font-mono text-2xl leading-none font-bold tabular-nums", state === "OVERTIME" && "text-rose-300")}>
              {bill.remainingMs !== null
                ? `${bill.remainingMs < 0 ? "+" : ""}${formatCountdown(Math.abs(bill.remainingMs))}`
                : formatCountdown(bill.elapsedMs ?? 0)}
            </span>
            <span className="text-sm font-semibold tabular-nums">{money(locale, bill.total, data.lounge.currency)}</span>
          </div>
          {session.guestLabel && <div className="truncate text-xs text-muted-foreground">{session.guestLabel}</div>}
        </div>
      ) : next && state === "RESERVED" ? (
        <div className="mt-auto text-sm">
          <div className="font-semibold text-amber-200">{formatTime(locale, next.scheduledStart, data.lounge.timezone)}</div>
          <div className="truncate text-xs text-muted-foreground">{next.guestLabel ?? next.reference}</div>
        </div>
      ) : (
        <div className="mt-auto text-xs text-muted-foreground">
          {state === "IDLE" && next ? `${dict.pos.nextAt} ${formatTime(locale, next.scheduledStart, data.lounge.timezone)}` : " "}
        </div>
      )}
    </button>
  );
}
