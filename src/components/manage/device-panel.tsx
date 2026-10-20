"use client";

import { Ban, Clock, LogIn, Play, Plus, Power, ReceiptText, ShoppingBag, UserX, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { deviceTypeMeta } from "@/components/lounge/device-type";
import { useDevicePricing, useLiveBill } from "@/components/pos/use-live-bill";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useI18n } from "@/i18n/client";
import { formatDuration, formatTime, money } from "@/i18n/format";
import { quoteBooking } from "@/lib/booking/pricing";
import { pricePlay } from "@/lib/booking/session-billing";
import { diffMinutes } from "@/lib/booking/time";
import { cn } from "@/lib/utils";
import {
  cancelBookingAction,
  cancelSessionOrderAction,
  checkInAction,
  extendSessionAction,
  markNoShowAction,
  setDeviceStatusAction,
  startWalkInAction,
} from "@/server/actions/pos";
import type { PosDevice, PosSession } from "@/server/queries/manage";
import { CheckoutDialog } from "./checkout-dialog";
import { OrderDialog } from "./order-dialog";
import { usePos, usePosAction } from "./pos-context";
import { formatCountdown, PaymentBadge, posStatusTone } from "./pos-ui";

const WALK_IN_OPTIONS = [30, 60, 90, 120, 180, 240, 300, 360];
const EXTEND_OPTIONS = [30, 60];

export function DevicePanel({ device, now }: { device: PosDevice; now: Date }) {
  const { dict } = useI18n();
  const { data, canManageDevices } = usePos();
  const category = data.categories.find((c) => c.id === device.categoryId)!;
  const { icon: Icon, color } = deviceTypeMeta[category.type];
  const current = data.sessions.find((s) => s.id === device.currentBookingId) ?? null;
  const next = data.sessions.find((s) => s.id === device.nextBookingId) ?? null;
  const outOfService = device.status === "MAINTENANCE" || device.status === "OFFLINE";

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="flex items-center gap-2 text-lg">
          <Icon className="size-5" style={{ color }} aria-hidden />
          {device.name}
          <Badge className={cn("border-0", posStatusTone[device.status])}>{dict.deviceStatus[device.status]}</Badge>
        </SheetTitle>
        <SheetDescription>
          {category.name} · {device.code}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-6">
        {current ? (
          <SessionSection session={current} device={device} now={now} />
        ) : outOfService ? (
          <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
            {dict.manage.device.outOfService}
          </p>
        ) : (
          <WalkInSection device={device} now={now} />
        )}

        {next && (
          <>
            <Separator />
            <NextBookingSection booking={next} hasCurrent={!!current || outOfService} />
          </>
        )}

        {canManageDevices && (
          <>
            <Separator />
            <DeviceAdminSection device={device} hasCurrent={!!current} />
          </>
        )}
      </div>
    </>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 font-semibold">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {children}
    </h3>
  );
}

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong ? "font-semibold" : "text-sm")}>
      <span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

function WalkInSection({ device, now }: { device: PosDevice; now: Date }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const category = data.categories.find((c) => c.id === device.categoryId)!;
  const tz = data.lounge.timezone;

  const maxFree = device.freeUntil ? diffMinutes(new Date(device.freeUntil), now) : 0;
  const options = WALK_IN_OPTIONS.filter((m) => m <= maxFree);
  if (options.length === 0 && maxFree >= 15) options.push(Math.floor(maxFree / 5) * 5);

  const [duration, setDuration] = useState<number | null>(null);
  const [players, setPlayers] = useState(1);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const chosen = duration !== null && options.includes(duration) ? duration : (options.find((o) => o === 60) ?? options[0] ?? null);

  const quote =
    chosen !== null
      ? quoteBooking({
          start: now,
          durationMinutes: chosen,
          timeZone: tz,
          categoryId: category.id,
          baseHourlyRate: device.hourlyRateOverride ?? category.baseHourlyRate,
          rules: data.pricingRules,
          taxRateBps: data.lounge.taxRateBps,
          addOns: [],
        })
      : null;

  if (!category.isActive || chosen === null) {
    return (
      <section>
        <SectionTitle icon={Play}>{dict.manage.walkIn.title}</SectionTitle>
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          {device.freeUntil ? dict.manage.walkIn.noTime : dict.manage.closedNow}
        </p>
      </section>
    );
  }

  const start = () =>
    run(
      () =>
        startWalkInAction({
          locale,
          loungeId: data.lounge.id,
          deviceId: device.id,
          durationMinutes: chosen,
          players,
          guestName: guestName || undefined,
          guestPhone: guestPhone || undefined,
        }),
      () => t(dict.manage.walkIn.started, { device: device.name }),
    );

  return (
    <section className="space-y-4">
      <SectionTitle icon={Play}>{dict.manage.walkIn.title}</SectionTitle>
      {device.freeUntil && (
        <p className="text-sm text-muted-foreground">
          {t(dict.manage.device.freeUntil, { time: formatTime(locale, device.freeUntil, tz) })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{dict.booking.duration}</Label>
          <Select
            items={options.map((m) => ({ value: String(m), label: formatDuration(locale, m, dict) }))}
            value={String(chosen)}
            onValueChange={(v) => v && setDuration(Number(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {formatDuration(locale, m, dict)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{dict.booking.players}</Label>
          <Select
            items={Array.from({ length: category.capacity }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
            value={String(players)}
            onValueChange={(v) => v && setPlayers(Number(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: category.capacity }, (_, i) => (
                <SelectItem key={i} value={String(i + 1)}>
                  {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guest-name">
            {dict.manage.walkIn.guestName} <span className="text-muted-foreground">({dict.common.optional})</span>
          </Label>
          <Input id="guest-name" value={guestName} maxLength={80} onChange={(e) => setGuestName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guest-phone">
            {dict.auth.phone} <span className="text-muted-foreground">({dict.common.optional})</span>
          </Label>
          <Input
            id="guest-phone"
            type="tel"
            dir="ltr"
            value={guestPhone}
            maxLength={30}
            onChange={(e) => setGuestPhone(e.target.value)}
          />
        </div>
      </div>
      {quote && (
        <div className="space-y-1 rounded-xl bg-muted/50 p-3">
          <Row label={dict.booking.playTime}>{money(locale, quote.playSubtotal, data.lounge.currency)}</Row>
          {quote.taxTotal > 0 && <Row label={dict.booking.tax}>{money(locale, quote.taxTotal, data.lounge.currency)}</Row>}
          <Row label={dict.common.total} strong>
            {money(locale, quote.total, data.lounge.currency)}
          </Row>
        </div>
      )}
      <Button className="w-full" size="lg" onClick={start} disabled={pending}>
        <Play aria-hidden /> {dict.manage.walkIn.start}
      </Button>
    </section>
  );
}

function SessionSection({ session, device, now }: { session: PosSession; device: PosDevice; now: Date }) {
  const { dict, locale, t, href } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const [orderOpen, setOrderOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const tz = data.lounge.timezone;
  const cur = data.lounge.currency;

  const end = new Date(session.scheduledEnd);
  const bill = useLiveBill(session, now)!;
  const rates = useDevicePricing()(device.id)!;
  // OPEN sessions count up; FIXED count down (frozen while paused).
  const remainingMs = bill.remainingMs ?? 0;
  const isOpen = session.mode === "OPEN";
  const due = bill.due;

  const extend = (minutes: number) =>
    run(
      () =>
        extendSessionAction({
          locale,
          loungeId: data.lounge.id,
          bookingId: session.id,
          version: session.version,
          minutes,
        }),
      (res) => t(dict.manage.session.extended, { price: money(locale, res.price, cur) }),
    );

  const voidOrder = (orderId: string) =>
    run(
      () => cancelSessionOrderAction({ locale, loungeId: data.lounge.id, orderId }),
      () => dict.manage.canteen.voided,
    );

  return (
    <section className="space-y-4">
      <SectionTitle icon={Clock}>{dict.manage.session.title}</SectionTitle>

      <div
        className={cn(
          "rounded-2xl p-4 text-center",
          bill.paused
            ? "bg-violet-500/10 text-violet-800 dark:text-violet-200"
            : !isOpen && remainingMs < 0
              ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
              : "bg-sky-500/10 text-sky-800 dark:text-sky-200",
        )}
      >
        <div className="text-xs font-medium">
          {bill.paused
            ? dict.pos.state.PAUSED
            : isOpen
              ? dict.pos.elapsed
              : remainingMs < 0
                ? dict.manage.session.overtime
                : dict.manage.session.remaining}
        </div>
        <div dir="ltr" className="font-mono text-3xl font-bold tabular-nums">
          {formatCountdown(isOpen ? (bill.elapsedMs ?? 0) : Math.abs(remainingMs))}
        </div>
        <div className="text-xs opacity-80">
          {dict.pos.mode[session.mode]} · {dict.pos.tier[session.priceTier]} ·{" "}
          {formatTime(locale, session.actualStart ?? session.scheduledStart, tz)}
          {!isOpen && ` → ${formatTime(locale, session.scheduledEnd, tz)}`}
        </div>
      </div>
      <Link
        href={href(`/pos/${data.lounge.id}`)}
        className={buttonVariants({ variant: "link", size: "sm", className: "h-auto p-0" })}
      >
        {dict.pos.openInPos}
      </Link>

      <div className="space-y-1">
        <Row label={dict.manage.session.guest}>{session.guestLabel ?? dict.manage.session.walkInGuest}</Row>
        {session.phone && (
          <Row label={dict.auth.phone}>
            <span dir="ltr">{session.phone}</span>
          </Row>
        )}
        <Row label={dict.booking.players}>{session.players}</Row>
        <Row label={dict.manage.session.source}>{dict.manage.source[session.source]}</Row>
        {session.notes && <p className="rounded-lg bg-muted/50 p-2 text-sm">{session.notes}</p>}
      </div>

      <div className={cn("grid grid-cols-2 gap-2", isOpen && "hidden")}>
        {EXTEND_OPTIONS.map((m) => {
          const price = pricePlay({ timeZone: tz, rules: data.pricingRules }, rates, session.priceTier, end, m);
          return (
            <Button key={m} variant="outline" onClick={() => extend(m)} disabled={pending} className="h-auto flex-col py-2">
              <span className="flex items-center gap-1 font-semibold">
                <Plus aria-hidden /> {formatDuration(locale, m, dict)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{money(locale, price, cur)}</span>
            </Button>
          );
        })}
      </div>

      {session.orders.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">{dict.manage.session.orders}</h4>
          <ul className="space-y-1.5">
            {session.orders.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-2 rounded-lg border p-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(dict.manage.listSep)}</div>
                  <div className="text-xs text-muted-foreground">
                    {dict.manage.orderStatus[o.status]}
                    {o.isPreOrder && ` · ${dict.manage.booking.preOrder}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="tabular-nums">{money(locale, o.subtotal, cur)}</span>
                  {(o.status === "PENDING" || o.status === "PREPARING") && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => voidOrder(o.id)}
                      disabled={pending}
                      aria-label={dict.manage.canteen.void}
                      title={dict.manage.canteen.void}
                    >
                      <X />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1 rounded-xl bg-muted/50 p-3">
        <Row label={dict.booking.playTime}>{money(locale, bill.play, cur)}</Row>
        {bill.canteen > 0 && <Row label={dict.booking.canteen}>{money(locale, bill.canteen, cur)}</Row>}
        {bill.tax > 0 && <Row label={dict.booking.tax}>{money(locale, bill.tax, cur)}</Row>}
        <Row label={dict.common.total} strong>
          {money(locale, bill.total, cur)}
        </Row>
        {session.amountPaid > 0 && <Row label={dict.manage.session.paid}>{money(locale, session.amountPaid, cur)}</Row>}
        <div className="flex items-center justify-between pt-1">
          <PaymentBadge status={session.paymentStatus} />
          {due > 0 && session.amountPaid > 0 && (
            <span className="text-sm font-semibold tabular-nums">
              {dict.manage.session.due}: {money(locale, due, cur)}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setOrderOpen(true)} disabled={pending}>
          <ShoppingBag aria-hidden /> {dict.manage.session.addOrder}
        </Button>
        <Button onClick={() => setCheckoutOpen(true)} disabled={pending}>
          <ReceiptText aria-hidden /> {dict.manage.session.end}
        </Button>
      </div>

      <OrderDialog open={orderOpen} onOpenChange={setOrderOpen} session={session} deviceName={device.name} />
      <CheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} session={session} deviceName={device.name} />
    </section>
  );
}

function NextBookingSection({ booking, hasCurrent }: { booking: PosSession; hasCurrent: boolean }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const tz = data.lounge.timezone;
  const ids = { locale, loungeId: data.lounge.id, bookingId: booking.id, version: booking.version };
  const name = booking.guestLabel ?? booking.reference;

  return (
    <section className="space-y-3">
      <SectionTitle icon={LogIn}>{dict.manage.booking.next}</SectionTitle>
      <div className="space-y-1">
        <Row label={dict.manage.session.guest}>{name}</Row>
        <Row label={dict.payment.reference}>
          <span dir="ltr" className="font-mono">
            {booking.reference}
          </span>
        </Row>
        <Row label={dict.confirmation.when}>
          {formatTime(locale, booking.scheduledStart, tz)} → {formatTime(locale, booking.scheduledEnd, tz)}
        </Row>
        <Row label={dict.booking.players}>{booking.players}</Row>
        <Row label={dict.common.total}>{money(locale, booking.totalPrice, data.lounge.currency)}</Row>
        <div className="flex justify-end">
          <PaymentBadge status={booking.paymentStatus} />
        </div>
        {booking.orders.length > 0 && (
          <p className="rounded-lg bg-muted/50 p-2 text-sm">
            <span className="font-medium">{dict.manage.booking.preOrder}: </span>
            {booking.orders.flatMap((o) => o.items.map((i) => `${i.quantity}× ${i.name}`)).join(dict.manage.listSep)}
          </p>
        )}
        {booking.notes && <p className="rounded-lg bg-muted/50 p-2 text-sm">{booking.notes}</p>}
      </div>

      {booking.status === "PENDING" ? (
        <p className="text-sm text-muted-foreground">{dict.manage.booking.awaitingPayment}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="col-span-2"
            onClick={() => run(() => checkInAction(ids), () => t(dict.manage.booking.checkedIn, { name }))}
            disabled={pending || !booking.canCheckIn || hasCurrent}
          >
            <LogIn aria-hidden /> {dict.manage.booking.checkIn}
          </Button>
          {booking.canMarkNoShow && (
            <Button variant="outline" onClick={() => run(() => markNoShowAction(ids), () => dict.manage.booking.markedNoShow)} disabled={pending}>
              <UserX aria-hidden /> {dict.manage.booking.noShow}
            </Button>
          )}
          {booking.amountPaid === 0 && (
            <Button
              variant="destructive"
              className={booking.canMarkNoShow ? undefined : "col-span-2"}
              onClick={() => {
                if (window.confirm(dict.manage.booking.confirmCancel)) {
                  run(() => cancelBookingAction(ids), () => dict.manage.booking.cancelled);
                }
              }}
              disabled={pending}
            >
              <Ban aria-hidden /> {dict.manage.booking.cancel}
            </Button>
          )}
        </div>
      )}
      {!booking.canCheckIn && booking.status === "CONFIRMED" && (
        <p className="text-xs text-muted-foreground">{dict.manage.booking.checkInWindow}</p>
      )}
    </section>
  );
}

function DeviceAdminSection({ device, hasCurrent }: { device: PosDevice; hasCurrent: boolean }) {
  const { dict, locale } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const set = (status: "IDLE" | "MAINTENANCE" | "OFFLINE") =>
    run(
      () => setDeviceStatusAction({ locale, loungeId: data.lounge.id, deviceId: device.id, status }),
      () => dict.manage.deviceAdmin.updated,
    );
  const outOfService = device.status === "MAINTENANCE" || device.status === "OFFLINE";

  return (
    <section>
      <SectionTitle icon={Wrench}>{dict.manage.deviceAdmin.title}</SectionTitle>
      {outOfService ? (
        <Button variant="outline" className="w-full" onClick={() => set("IDLE")} disabled={pending}>
          <Power aria-hidden /> {dict.manage.deviceAdmin.backInService}
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => set("MAINTENANCE")} disabled={pending || hasCurrent}>
            <Wrench aria-hidden /> {dict.deviceStatus.MAINTENANCE}
          </Button>
          <Button variant="outline" onClick={() => set("OFFLINE")} disabled={pending || hasCurrent}>
            <Power aria-hidden /> {dict.deviceStatus.OFFLINE}
          </Button>
        </div>
      )}
      {hasCurrent && <p className="mt-2 text-xs text-muted-foreground">{dict.manage.deviceAdmin.busyHint}</p>}
    </section>
  );
}
