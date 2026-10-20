"use client";

import { Badge } from "@/components/ui/badge";
import type { DeviceStatus, PaymentStatus } from "@/generated/prisma/enums";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

export const posStatusTone: Record<DeviceStatus, string> = {
  IDLE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  IN_USE: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  RESERVED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  MAINTENANCE: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  OFFLINE: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
};

export const posStatusBorder: Record<DeviceStatus, string> = {
  IDLE: "border-emerald-500/60",
  IN_USE: "border-sky-500",
  RESERVED: "border-amber-500",
  MAINTENANCE: "border-zinc-400 border-dashed",
  OFFLINE: "border-zinc-400 border-dashed",
};

const paymentTone: Record<PaymentStatus, string> = {
  UNPAID: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  PARTIALLY_PAID: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  PAID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REFUNDED: "bg-muted text-muted-foreground",
  PARTIALLY_REFUNDED: "bg-muted text-muted-foreground",
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { dict } = useI18n();
  return <Badge className={cn("border-0", paymentTone[status])}>{dict.paymentStatus[status]}</Badge>;
}

/** 5_025_000 ms -> "1:23:45"; under an hour -> "23:45". */
export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}
