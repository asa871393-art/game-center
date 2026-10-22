import { Badge } from "@/components/ui/badge";
import type { BookingStatus } from "@/lib/db/types";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { cn } from "@/lib/utils";

const tone: Record<BookingStatus, string> = {
  PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  CONFIRMED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ACTIVE: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  COMPLETED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  NO_SHOW: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export function BookingStatusBadge({ status, dict }: { status: BookingStatus; dict: Dictionary }) {
  return <Badge className={cn("border-0", tone[status])}>{dict.bookingStatus[status]}</Badge>;
}
