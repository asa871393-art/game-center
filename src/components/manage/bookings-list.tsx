"use client";

import { BookingStatusBadge } from "@/components/booking/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/client";
import { formatTime, money } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { usePos } from "./pos-context";
import { PaymentBadge } from "./pos-ui";

/** Today's schedule; clicking a row opens that booking's device. */
export function BookingsList({ onSelectDevice }: { onSelectDevice: (deviceId: string) => void }) {
  const { dict, locale } = useI18n();
  const { data } = usePos();
  const tz = data.lounge.timezone;
  const devices = new Map(data.devices.map((d) => [d.id, d.name]));

  if (data.sessions.length === 0) {
    return <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">{dict.manage.bookings.empty}</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{dict.manage.bookings.time}</TableHead>
            <TableHead>{dict.manage.bookings.device}</TableHead>
            <TableHead>{dict.manage.session.guest}</TableHead>
            <TableHead>{dict.manage.session.source}</TableHead>
            <TableHead>{dict.manage.bookings.status}</TableHead>
            <TableHead className="text-end">{dict.common.total}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.sessions.map((s) => (
            <TableRow
              key={s.id}
              onClick={() => onSelectDevice(s.deviceId)}
              className={cn(
                "cursor-pointer",
                (s.status === "CANCELLED" || s.status === "NO_SHOW") && "text-muted-foreground opacity-70",
              )}
            >
              <TableCell className="whitespace-nowrap tabular-nums">
                {formatTime(locale, s.scheduledStart, tz)} – {formatTime(locale, s.scheduledEnd, tz)}
              </TableCell>
              <TableCell className="font-medium">{devices.get(s.deviceId)}</TableCell>
              <TableCell>
                <div>{s.guestLabel ?? dict.manage.session.walkInGuest}</div>
                <div dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
                  {s.reference}
                </div>
              </TableCell>
              <TableCell>{dict.manage.source[s.source]}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  <BookingStatusBadge status={s.status} dict={dict} />
                  {s.status !== "CANCELLED" && <PaymentBadge status={s.paymentStatus} />}
                </div>
              </TableCell>
              <TableCell className="text-end tabular-nums">{money(locale, s.totalPrice, data.lounge.currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
