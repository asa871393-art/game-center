"use client";

import {
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  Clock,
  Infinity as InfinityIcon,
  Layers,
  Loader2,
  LogIn,
  Minus,
  Pause,
  Percent,
  Play,
  Plus,
  Power,
  Printer,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Timer,
  UserX,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { deviceTypeMeta } from "@/components/lounge/device-type";
import { cartLines, cartSubtotal, MenuPicker, type Cart } from "@/components/manage/menu-picker";
import { usePos, usePosAction } from "@/components/manage/pos-context";
import { formatCountdown } from "@/components/manage/pos-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PriceTier } from "@/generated/prisma/enums";
import { useI18n } from "@/i18n/client";
import { formatDuration, formatTime, money } from "@/i18n/format";
import { liveBill } from "@/lib/booking/live-bill";
import { availableTiers, pricePlay, tierBps } from "@/lib/booking/session-billing";
import {
  clampInt,
  DURATION_PRESETS,
  MAX_FIXED_MINUTES,
  parseDigits,
  resolveDuration,
  WALK_IN_MIN_MINUTES,
} from "@/lib/booking/duration-input";
import { PRICING_STEP_MINUTES } from "@/lib/booking/pricing";
import { diffMinutes } from "@/lib/booking/time";
import { cn } from "@/lib/utils";
import {
  addSessionOrderAction,
  cancelBookingAction,
  changeTierAction,
  checkInAction,
  endSessionAction,
  extendSessionAction,
  markNoShowAction,
  pauseSessionAction,
  resumeSessionAction,
  setDeviceStatusAction,
  startWalkInAction,
  transferSessionAction,
} from "@/server/actions/pos";
import type { PosDevice, PosSession } from "@/server/queries/manage";
import { discountAmount, DiscountEditor, type DiscountInput } from "./discount-editor";
import { nextRowKey, PaymentSplit, paymentsBalance, type PaymentRow } from "./payment-split";
import { printReceipt } from "./print";
import { useBillContext, useDevicePricing, useLiveBill } from "./use-live-bill";

const EXTEND_OPTIONS = [30, 60];

type View = "home" | "items" | "tier" | "transfer" | "checkout";

export interface Completed {
  receiptId: string;
  deviceName: string;
  collected: number;
}

export function QuickActions({
  device,
  now,
  onClose,
}: {
  device: PosDevice | null;
  now: Date;
  onClose: () => void;
}) {
  const [completed, setCompleted] = useState<Completed | null>(null);
  const open = !!device || !!completed;
  const close = () => {
    setCompleted(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-0 p-0 sm:max-w-2xl">
        {completed ? (
          <DoneView completed={completed} onClose={close} />
        ) : device ? (
          <DeviceActions key={device.id} device={device} now={now} onCompleted={setCompleted} onClose={close} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeviceActions({
  device,
  now,
  onCompleted,
  onClose,
}: {
  device: PosDevice;
  now: Date;
  onCompleted: (c: Completed) => void;
  onClose: () => void;
}) {
  const { dict } = useI18n();
  const { data } = usePos();
  const [view, setView] = useState<View>("home");
  const category = data.categories.find((c) => c.id === device.categoryId)!;
  const { icon: Icon, color } = deviceTypeMeta[category.type];
  const session = data.sessions.find((s) => s.id === device.currentBookingId) ?? null;
  const next = data.sessions.find((s) => s.id === device.nextBookingId) ?? null;
  const outOfService = device.status === "MAINTENANCE" || device.status === "OFFLINE";
  // The session may end elsewhere while a sub-view is open.
  const activeView = session ? view : "home";

  return (
    <>
      <DialogHeader className="border-b p-4">
        <DialogTitle className="flex items-center gap-2 text-xl">
          <Icon className="size-6" style={{ color }} aria-hidden />
          {device.name}
          <span className="text-sm font-normal text-muted-foreground">· {category.name}</span>
        </DialogTitle>
        <DialogDescription className="sr-only">{dict.pos.quickActions}</DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto p-4">
        {session ? (
          activeView === "home" ? (
            <SessionHome session={session} device={device} now={now} onView={setView} />
          ) : activeView === "items" ? (
            <ItemsView session={session} deviceName={device.name} onDone={() => setView("home")} />
          ) : activeView === "tier" ? (
            <TierView session={session} device={device} now={now} onDone={() => setView("home")} />
          ) : activeView === "transfer" ? (
            <TransferView session={session} device={device} onDone={onClose} onBack={() => setView("home")} />
          ) : (
            <CheckoutView session={session} device={device} now={now} onCompleted={onCompleted} onBack={() => setView("home")} />
          )
        ) : outOfService ? (
          <OutOfService device={device} />
        ) : (
          <div className="space-y-6">
            {next && <NextBooking booking={next} />}
            <StartSession device={device} now={now} onStarted={onClose} />
          </div>
        )}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------

function StartSession({ device, now, onStarted }: { device: PosDevice; now: Date; onStarted: () => void }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const category = data.categories.find((c) => c.id === device.categoryId)!;
  const pricingOf = useDevicePricing();
  const rates = pricingOf(device.id)!;
  const tiers = availableTiers(rates);
  const cur = data.lounge.currency;

  const maxFree = device.freeUntil ? diffMinutes(new Date(device.freeUntil), now) : 0;
  // Longest fixed session that fits before the next booking / closing, on the server's step grid.
  const maxFixed = Math.min(MAX_FIXED_MINUTES, Math.floor(maxFree / PRICING_STEP_MINUTES) * PRICING_STEP_MINUTES);

  const [mode, setMode] = useState<"OPEN" | "FIXED">("OPEN");
  const [preset, setPreset] = useState(60);
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState<"MIN" | "HOUR">("MIN");
  const [pickedTier, setPickedTier] = useState<PriceTier | null>(null);
  const [playersText, setPlayersText] = useState("1");
  const [guest, setGuest] = useState("");

  const capacity = Math.max(1, category.capacity);
  const players = clampInt(parseDigits(playersText), 1, capacity) ?? 1;
  // Until the cashier picks a tier, more than one player means the group (MULTI) rate where offered.
  const autoTier: PriceTier = players > 1 && tiers.includes("MULTI") ? "MULTI" : "SINGLE";
  const tier = pickedTier ?? autoTier;

  const duration = resolveDuration({ preset, custom, unit, maxFixed });

  if (!category.isActive || maxFree < WALK_IN_MIN_MINUTES) {
    return (
      <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
        {device.freeUntil ? dict.manage.walkIn.noTime : dict.manage.closedNow}
      </p>
    );
  }

  const pricing = { timeZone: data.lounge.timezone, rules: data.pricingRules };
  // Rates right now, including time-of-day pricing rules.
  const hourlyFor = (t: PriceTier) => pricePlay(pricing, rates, t, now, 60);
  const fixedMinutes = duration.error ? null : duration.minutes;
  const fixedPrice = mode === "FIXED" && fixedMinutes ? pricePlay(pricing, rates, tier, now, fixedMinutes) : 0;
  const setPlayers = (n: number) => setPlayersText(String(Math.max(1, Math.min(capacity, n))));

  const start = () =>
    run(
      () =>
        startWalkInAction({
          locale,
          loungeId: data.lounge.id,
          deviceId: device.id,
          mode,
          priceTier: tier,
          durationMinutes: mode === "FIXED" ? (fixedMinutes ?? undefined) : undefined,
          players,
          guestName: guest || undefined,
        }),
      () => {
        onStarted();
        return t(dict.manage.walkIn.started, { device: device.name });
      },
    );

  return (
    <section className="space-y-5">
      <h3 className="text-lg font-semibold">{dict.pos.startSession}</h3>

      <div className="grid grid-cols-2 gap-2">
        {(["OPEN", "FIXED"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            disabled={m === "FIXED" && maxFixed < WALK_IN_MIN_MINUTES}
            className={cn(
              "flex h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 text-base font-semibold transition disabled:opacity-40",
              mode === m ? "border-primary bg-primary/15" : "border-border",
            )}
          >
            {m === "OPEN" ? <InfinityIcon className="size-6" aria-hidden /> : <Timer className="size-6" aria-hidden />}
            {dict.pos.mode[m]}
            <span className="text-xs font-normal text-muted-foreground">{dict.pos.modeHint[m]}</span>
          </button>
        ))}
      </div>

      {mode === "FIXED" && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-2">
            {DURATION_PRESETS.map((m) => (
              <Button
                key={m}
                variant={custom === "" && duration.minutes === m ? "default" : "outline"}
                className="h-12 px-1 text-base"
                disabled={m > maxFixed}
                onClick={() => {
                  setPreset(m);
                  setCustom("");
                }}
              >
                {formatDuration(locale, m, dict)}
              </Button>
            ))}
          </div>
          <div className={cn("flex gap-2 rounded-xl border-2 p-1.5 transition", custom !== "" ? "border-primary" : "border-transparent")}>
            <label htmlFor="pos-custom-duration" className="flex shrink-0 items-center gap-1.5 ps-1.5 text-sm text-muted-foreground">
              <Clock className="size-4" aria-hidden />
              {dict.pos.duration.custom}
            </label>
            <Input
              id="pos-custom-duration"
              inputMode="decimal"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 text-center text-lg font-semibold tabular-nums"
              placeholder={dict.pos.duration.customPlaceholder}
              value={custom}
              maxLength={5}
              aria-invalid={!!duration.error}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setCustom(e.target.value.replace(/[^\d٠-٩۰-۹.,٫]/g, ""))}
            />
            <div className="grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="group" aria-label={dict.pos.duration.title}>
              {(["MIN", "HOUR"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={unit === u}
                  onClick={() => setUnit(u)}
                  className={cn(
                    "h-9 rounded-md px-3 text-sm font-medium transition",
                    unit === u ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {u === "MIN" ? dict.pos.duration.minutes : dict.pos.duration.hours}
                </button>
              ))}
            </div>
          </div>
          <p className={cn("min-h-5 text-sm", duration.error ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
            {duration.error === "SHORT"
              ? t(dict.pos.duration.tooShort, { min: formatDuration(locale, WALK_IN_MIN_MINUTES, dict) })
              : duration.error === "LONG"
                ? t(dict.pos.duration.tooLong, { max: formatDuration(locale, maxFixed, dict) })
                : duration.minutes
                  ? [
                      duration.rounded && t(dict.pos.duration.rounded, { duration: formatDuration(locale, duration.minutes, dict) }),
                      t(dict.pos.duration.endsAt, {
                        time: formatTime(locale, new Date(now.getTime() + duration.minutes * 60_000), data.lounge.timezone),
                      }),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : t(dict.pos.duration.maxHint, { max: formatDuration(locale, maxFixed, dict) })}
          </p>
        </div>
      )}

      {tiers.length > 1 && (
        <div className="space-y-1.5">
          <TierButtons tiers={tiers} value={tier} onChange={setPickedTier} hourlyFor={hourlyFor} currency={cur} />
          {!pickedTier && tier === "MULTI" && <p className="text-xs text-primary">{dict.pos.multiAuto}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2 rounded-xl border p-2">
          <label htmlFor="pos-players" className="ps-2 text-sm text-muted-foreground">
            {dict.booking.players}
            <span className="block text-xs">{t(dict.pos.playersHint, { max: capacity })}</span>
          </label>
          <div className="flex items-center gap-1.5">
            <Button size="icon-lg" variant="outline" className="size-11" disabled={players <= 1} onClick={() => setPlayers(players - 1)} aria-label="−">
              <Minus />
            </Button>
            <Input
              id="pos-players"
              inputMode="numeric"
              autoComplete="off"
              className="h-11 w-14 text-center text-lg font-bold tabular-nums"
              value={playersText}
              maxLength={2}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setPlayersText(e.target.value.replace(/[^\d٠-٩۰-۹]/g, ""))}
              // Show the clamped value once the cashier leaves the box.
              onBlur={() => setPlayersText(String(players))}
            />
            <Button
              size="icon-lg"
              variant="outline"
              className="size-11"
              disabled={players >= capacity}
              onClick={() => setPlayers(players + 1)}
              aria-label="+"
            >
              <Plus />
            </Button>
          </div>
        </div>
        <Input
          className="h-14 text-base sm:h-auto"
          placeholder={`${dict.manage.walkIn.guestName} (${dict.common.optional})`}
          value={guest}
          maxLength={80}
          onChange={(e) => setGuest(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
        <span className="text-sm text-muted-foreground">
          {mode === "OPEN" ? (
            `${money(locale, hourlyFor(tier), cur)}${dict.common.perHour} · ${t(dict.pos.reservedUntil, { time: device.freeUntil ? formatTime(locale, device.freeUntil, data.lounge.timezone) : "" })}`
          ) : (
            <>
              {dict.booking.playTime}
              {fixedMinutes && (
                <span className="block text-xs">
                  {dict.pos.tier[tier]} · {formatDuration(locale, fixedMinutes, dict)}
                </span>
              )}
            </>
          )}
        </span>
        {mode === "FIXED" && (
          <span className="text-2xl font-bold tabular-nums" aria-live="polite">
            {fixedMinutes ? money(locale, fixedPrice, cur) : "—"}
          </span>
        )}
      </div>

      <Button size="lg" className="h-14 w-full text-lg" onClick={start} disabled={pending || (mode === "FIXED" && !fixedMinutes)}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
        {dict.pos.start}
      </Button>
    </section>
  );
}

function TierButtons({
  tiers,
  value,
  onChange,
  hourlyFor,
  currency,
}: {
  tiers: PriceTier[];
  value: PriceTier;
  onChange: (t: PriceTier) => void;
  /** Current hourly price at a tier. */
  hourlyFor: (t: PriceTier) => number;
  currency: string;
}) {
  const { dict, locale } = useI18n();
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiers.map((tier) => (
        <button
          key={tier}
          type="button"
          onClick={() => onChange(tier)}
          className={cn(
            "flex h-16 flex-col items-center justify-center rounded-2xl border-2 transition",
            value === tier ? "border-primary bg-primary/15" : "border-border",
          )}
        >
          <span className="font-semibold">{dict.pos.tier[tier]}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {money(locale, hourlyFor(tier), currency)}
            {dict.common.perHour}
          </span>
        </button>
      ))}
    </div>
  );
}

function NextBooking({ booking }: { booking: PosSession }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const ids = { locale, loungeId: data.lounge.id, bookingId: booking.id, version: booking.version };
  const name = booking.guestLabel ?? booking.reference;
  return (
    <section className="space-y-3 rounded-2xl border border-amber-400/50 bg-amber-500/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-amber-200">{dict.manage.booking.next}</div>
          <div className="text-lg font-semibold">{name}</div>
          <div className="text-sm text-muted-foreground">
            {formatTime(locale, booking.scheduledStart, data.lounge.timezone)} – {formatTime(locale, booking.scheduledEnd, data.lounge.timezone)} ·{" "}
            <span dir="ltr" className="font-mono">
              {booking.reference}
            </span>
          </div>
        </div>
        <span className="text-lg font-bold tabular-nums">{money(locale, booking.totalPrice, data.lounge.currency)}</span>
      </div>
      {booking.status === "PENDING" ? (
        <p className="text-sm text-muted-foreground">{dict.manage.booking.awaitingPayment}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Button
            className="col-span-3 h-12 text-base sm:col-span-1"
            onClick={() => run(() => checkInAction(ids), () => t(dict.manage.booking.checkedIn, { name }))}
            disabled={pending || !booking.canCheckIn}
          >
            <LogIn aria-hidden /> {dict.pos.checkIn}
          </Button>
          <Button
            variant="outline"
            className="h-12"
            onClick={() => run(() => markNoShowAction(ids), () => dict.manage.booking.markedNoShow)}
            disabled={pending || !booking.canMarkNoShow}
          >
            <UserX aria-hidden /> {dict.manage.booking.noShow}
          </Button>
          <Button
            variant="destructive"
            className="h-12"
            onClick={() => {
              if (window.confirm(dict.manage.booking.confirmCancel)) {
                run(() => cancelBookingAction(ids), () => dict.manage.booking.cancelled);
              }
            }}
            disabled={pending || booking.amountPaid > 0}
          >
            <Ban aria-hidden /> {dict.manage.booking.cancel}
          </Button>
        </div>
      )}
      {!booking.canCheckIn && booking.status === "CONFIRMED" && (
        <p className="text-xs text-muted-foreground">{dict.manage.booking.checkInWindow}</p>
      )}
    </section>
  );
}

function OutOfService({ device }: { device: PosDevice }) {
  const { dict, locale } = useI18n();
  const { data, canManageDevices } = usePos();
  const { pending, run } = usePosAction();
  return (
    <div className="space-y-4 text-center">
      <Wrench className="mx-auto size-10 text-muted-foreground" aria-hidden />
      <p className="text-muted-foreground">{dict.manage.device.outOfService}</p>
      {canManageDevices && (
        <Button
          size="lg"
          className="h-12"
          onClick={() =>
            run(
              () => setDeviceStatusAction({ locale, loungeId: data.lounge.id, deviceId: device.id, status: "IDLE" }),
              () => dict.manage.deviceAdmin.updated,
            )
          }
          disabled={pending}
        >
          <Power aria-hidden /> {dict.manage.deviceAdmin.backInService}
        </Button>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Running session
// -----------------------------------------------------------------------------

function SessionHome({
  session,
  device,
  now,
  onView,
}: {
  session: PosSession;
  device: PosDevice;
  now: Date;
  onView: (v: View) => void;
}) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const bill = useLiveBill(session, now)!;
  const pricingOf = useDevicePricing();
  const cur = data.lounge.currency;
  const ids = { locale, loungeId: data.lounge.id, bookingId: session.id, version: session.version };
  const overtime = bill.remainingMs !== null && bill.remainingMs < 0;

  const togglePause = () =>
    bill.paused
      ? run(
          () => resumeSessionAction(ids),
          (res) => (res.lostMinutes > 0 ? t(dict.pos.resumedShort, { minutes: res.lostMinutes }) : dict.pos.resumed),
        )
      : run(() => pauseSessionAction(ids), () => dict.pos.paused);

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "grid grid-cols-2 gap-3 rounded-2xl p-4",
          bill.paused ? "bg-violet-500/15" : overtime ? "bg-rose-500/15" : "bg-sky-500/10",
        )}
      >
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            {bill.paused ? dict.pos.state.PAUSED : bill.remainingMs !== null ? (overtime ? dict.manage.session.overtime : dict.manage.session.remaining) : dict.pos.elapsed}
          </div>
          <div dir="ltr" className="text-start font-mono text-4xl font-bold tabular-nums">
            {bill.remainingMs !== null ? formatCountdown(Math.abs(bill.remainingMs)) : formatCountdown(bill.elapsedMs ?? 0)}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-xs">
            <span className="rounded-md bg-muted px-1.5 py-0.5">{dict.pos.mode[session.mode]}</span>
            <span className="rounded-md bg-primary/20 px-1.5 py-0.5 text-primary">{dict.pos.tier[session.priceTier]}</span>
            {session.pausedMinutes > 0 && (
              <span className="rounded-md bg-muted px-1.5 py-0.5">{t(dict.pos.pausedTotal, { minutes: session.pausedMinutes })}</span>
            )}
          </div>
        </div>
        <div className="text-end">
          <div className="text-xs font-medium text-muted-foreground">{dict.pos.currentCharge}</div>
          <div className="text-3xl font-bold tabular-nums">{money(locale, bill.total, cur)}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {dict.booking.playTime} {money(locale, bill.play, cur)}
            {bill.canteen > 0 && ` · ${dict.pos.canteenShort} ${money(locale, bill.canteen, cur)}`}
          </div>
          <div className="mt-1 truncate text-sm">{session.guestLabel ?? dict.manage.session.walkInGuest}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ActionButton icon={ShoppingBag} label={dict.pos.addItems} onClick={() => onView("items")} disabled={pending} />
        <ActionButton
          icon={Layers}
          label={dict.pos.changeTier}
          onClick={() => onView("tier")}
          disabled={pending || availableTiers(pricingOf(device.id)!).length < 2}
        />
        <ActionButton icon={bill.paused ? Play : Pause} label={bill.paused ? dict.pos.resume : dict.pos.pause} onClick={togglePause} disabled={pending} />
        <ActionButton icon={ArrowLeftRight} label={dict.pos.transfer} onClick={() => onView("transfer")} disabled={pending || bill.paused} />
        {session.mode === "FIXED" &&
          EXTEND_OPTIONS.map((m) => (
            <ActionButton
              key={m}
              icon={Clock}
              label={`+${formatDuration(locale, m, dict)}`}
              onClick={() =>
                run(
                  () => extendSessionAction({ ...ids, minutes: m }),
                  (res) => t(dict.manage.session.extended, { price: money(locale, res.price, cur) }),
                )
              }
              disabled={pending}
            />
          ))}
      </div>

      {session.orders.length > 0 && (
        <ul className="divide-y rounded-xl border text-sm">
          {session.orders.map((o) => (
            <li key={o.id} className="flex justify-between gap-2 p-2.5">
              <span className="truncate">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(dict.manage.listSep)}</span>
              <span className="shrink-0 tabular-nums">{money(locale, o.subtotal, cur)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button variant="outline" size="lg" className="h-14" onClick={() => printReceipt(locale, session.id)} title={dict.pos.printBill}>
          <Printer aria-hidden /> <span className="hidden sm:inline">{dict.pos.printBill}</span>
        </Button>
        <Button size="lg" className="h-14 text-lg" onClick={() => onView("checkout")} disabled={pending}>
          <ReceiptText aria-hidden /> {dict.pos.checkout}
        </Button>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Clock;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="secondary" className="h-16 flex-col gap-1 text-sm" onClick={onClick} disabled={disabled}>
      <Icon className="size-5" aria-hidden />
      {label}
    </Button>
  );
}

function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  const { dict } = useI18n();
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h3 className="text-lg font-semibold">{title}</h3>
      <Button variant="ghost" onClick={onBack}>
        {dict.common.back}
      </Button>
    </div>
  );
}

function ItemsView({ session, deviceName, onDone }: { session: PosSession; deviceName: string; onDone: () => void }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const [cart, setCart] = useState<Cart>({});
  const items = cartLines(cart);
  const subtotal = cartSubtotal(cart, data.menuItems);

  return (
    <div>
      <BackBar title={t(dict.manage.canteen.orderFor, { device: deviceName })} onBack={onDone} />
      <MenuPicker cart={cart} onChange={setCart} />
      <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 border-t bg-popover pt-3">
        <span className="text-xl font-bold tabular-nums">{money(locale, subtotal, data.lounge.currency)}</span>
        <Button
          size="lg"
          className="h-14 px-8 text-lg"
          disabled={pending || items.length === 0}
          onClick={() =>
            run(
              () => addSessionOrderAction({ locale, loungeId: data.lounge.id, bookingId: session.id, items }),
              () => {
                onDone();
                return t(dict.manage.canteen.ordered, { device: deviceName });
              },
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          {dict.manage.canteen.addToBill}
        </Button>
      </div>
    </div>
  );
}

function TierView({ session, device, now, onDone }: { session: PosSession; device: PosDevice; now: Date; onDone: () => void }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const rates = useDevicePricing()(device.id)!;
  const [tier, setTier] = useState<PriceTier>(session.priceTier);
  const cur = data.lounge.currency;

  // FIXED: preview the reprice of the remaining booked time.
  const pricing = { timeZone: data.lounge.timezone, rules: data.pricingRules };
  let delta = 0;
  if (session.mode === "FIXED" && tier !== session.priceTier) {
    const from = session.pausedAt ? new Date(session.pausedAt) : now;
    const remaining = Math.max(0, diffMinutes(new Date(session.scheduledEnd), from));
    delta = pricePlay(pricing, rates, tier, now, remaining) - pricePlay(pricing, rates, session.priceTier, now, remaining);
  }

  return (
    <div className="space-y-4">
      <BackBar title={dict.pos.changeTier} onBack={onDone} />
      <TierButtons
        tiers={availableTiers(rates)}
        value={tier}
        onChange={setTier}
        hourlyFor={(t) => pricePlay(pricing, rates, t, now, 60)}
        currency={cur}
      />
      {session.mode === "FIXED" && tier !== session.priceTier && (
        <p className="text-sm text-muted-foreground">
          {t(delta >= 0 ? dict.pos.tierDeltaUp : dict.pos.tierDeltaDown, { amount: money(locale, Math.abs(delta), cur) })}
        </p>
      )}
      {session.mode === "OPEN" && <p className="text-sm text-muted-foreground">{dict.pos.tierFromNow}</p>}
      <Button
        size="lg"
        className="h-14 w-full text-lg"
        disabled={pending || tier === session.priceTier}
        onClick={() =>
          run(
            () => changeTierAction({ locale, loungeId: data.lounge.id, bookingId: session.id, version: session.version, tier }),
            () => {
              onDone();
              return t(dict.pos.tierChanged, { tier: dict.pos.tier[tier] });
            },
          )
        }
      >
        <Layers aria-hidden /> {dict.common.confirm}
      </Button>
    </div>
  );
}

function TransferView({
  session,
  device,
  onDone,
  onBack,
}: {
  session: PosSession;
  device: PosDevice;
  onDone: () => void;
  onBack: () => void;
}) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  const { pending, run } = usePosAction();
  const pricingOf = useDevicePricing();
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const targets = data.devices.filter((d) => {
    const c = categories.get(d.categoryId);
    return (
      d.id !== device.id &&
      (d.status === "IDLE" || d.status === "RESERVED") &&
      !d.currentBookingId &&
      c &&
      c.isActive &&
      c.capacity >= session.players &&
      tierBps(pricingOf(d.id)!, session.priceTier) !== null
    );
  });

  return (
    <div>
      <BackBar title={t(dict.pos.transferFrom, { device: device.name })} onBack={onBack} />
      {targets.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">{dict.pos.noTargets}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {targets.map((d) => {
            const c = categories.get(d.categoryId)!;
            const { icon: Icon, color } = deviceTypeMeta[c.type];
            return (
              <button
                key={d.id}
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(t(dict.pos.confirmTransfer, { from: device.name, to: d.name }))) return;
                  run(
                    () =>
                      transferSessionAction({
                        locale,
                        loungeId: data.lounge.id,
                        bookingId: session.id,
                        version: session.version,
                        targetDeviceId: d.id,
                      }),
                    (res) => {
                      onDone();
                      return t(dict.pos.transferred, { to: res.deviceName });
                    },
                  );
                }}
                className="flex h-20 flex-col items-start justify-center gap-1 rounded-2xl border-2 border-emerald-500/40 bg-card px-3 text-start transition active:scale-[0.98] disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5 font-semibold">
                  <Icon className="size-4" style={{ color }} aria-hidden />
                  {d.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {c.name}
                  {d.status === "RESERVED" && ` · ${dict.deviceStatus.RESERVED}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Checkout
// -----------------------------------------------------------------------------

function CheckoutView({
  session,
  device,
  now,
  onCompleted,
  onBack,
}: {
  session: PosSession;
  device: PosDevice;
  now: Date;
  onCompleted: (c: Completed) => void;
  onBack: () => void;
}) {
  const { dict, locale } = useI18n();
  const { data } = usePos();
  const ctx = useBillContext();
  const { pending, run } = usePosAction();
  const cur = data.lounge.currency;
  const tz = data.lounge.timezone;
  // The bill is frozen when checkout opens, so what the guest sees is what is charged.
  const [billUntil, setBillUntil] = useState(() => now);
  const [discount, setDiscount] = useState<DiscountInput>({ kind: "amount", value: session.discountTotal });
  const [discountOpen, setDiscountOpen] = useState(session.discountTotal > 0);
  const billAt = (at: Date, d: DiscountInput) => {
    const gross = liveBill({ ...session, discountTotal: 0 }, ctx, at);
    const amount = discountAmount(d, gross.play + gross.canteen);
    return { ...liveBill({ ...session, discountTotal: amount }, ctx, at), discount: amount };
  };
  const bill = billAt(billUntil, discount);
  const [rows, setRows] = useState<PaymentRow[]>(() => [{ key: nextRowKey(), method: "CASH", amount: bill.due, tendered: null }]);
  const overDiscounted = bill.total < session.amountPaid;
  const needsShift = bill.due > 0 && !data.shift;
  const balanced = paymentsBalance(rows, bill.due) === 0 && rows.every((r) => r.amount > 0 || bill.due === 0);

  // Any change to the bill resets the payment rows to "all cash" for the new amount.
  const rebillTo = (at: Date, d: DiscountInput) => {
    setRows([{ key: nextRowKey(), method: "CASH", amount: billAt(at, d).due, tendered: null }]);
  };
  const recalc = () => {
    const at = new Date();
    setBillUntil(at);
    rebillTo(at, discount);
  };
  const changeDiscount = (d: DiscountInput) => {
    setDiscount(d);
    rebillTo(billUntil, d);
  };

  const devices = new Map(data.devices.map((d) => [d.id, d.name]));
  const playLines =
    session.mode === "OPEN"
      ? session.segments.map((s) => {
          const end = s.endedAt ? new Date(s.endedAt) : billUntil;
          const minutes = Math.max(0, Math.ceil((end.getTime() - new Date(s.startedAt).getTime()) / 60_000));
          const amount =
            s.amount ??
            pricePlay({ timeZone: tz, rules: data.pricingRules }, ctx.categoryOf(s.deviceId)!, s.priceTier, new Date(s.startedAt), minutes);
          return { key: s.id, label: `${devices.get(s.deviceId) ?? ""} · ${dict.pos.tier[s.priceTier]}`, detail: formatDuration(locale, minutes, dict), amount };
        })
      : [
          {
            key: "fixed",
            label: `${device.name} · ${dict.pos.tier[session.priceTier]}`,
            detail: `${formatTime(locale, session.actualStart ?? session.scheduledStart, tz)} – ${formatTime(locale, session.scheduledEnd, tz)}${session.extensions ? ` · +${session.extensions}` : ""}`,
            amount: session.playSubtotal,
          },
        ];

  const confirm = () =>
    run(
      () =>
        endSessionAction({
          locale,
          loungeId: data.lounge.id,
          bookingId: session.id,
          version: session.version,
          billUntil: session.mode === "OPEN" ? billUntil.toISOString() : undefined,
          discount: bill.discount,
          payments: bill.due > 0
            ? rows
                .filter((r) => r.amount > 0)
                .map((r) => ({
                  method: r.method,
                  amount: r.amount,
                  tendered: r.method === "CASH" && r.tendered !== null && r.tendered >= r.amount ? r.tendered : undefined,
                }))
            : [],
        }),
      (res) => {
        onCompleted({ receiptId: res.bookingId, deviceName: device.name, collected: res.collected });
      },
    );

  return (
    <div className="space-y-4">
      <BackBar title={dict.pos.checkout} onBack={onBack} />

      <div className="rounded-2xl border p-3 text-sm">
        {playLines.map((l) => (
          <div key={l.key} className="flex justify-between gap-3 py-1">
            <span>
              <span className="font-medium">{l.label}</span>
              <span className="block text-xs text-muted-foreground">{l.detail}</span>
            </span>
            <span className="tabular-nums">{money(locale, l.amount, cur)}</span>
          </div>
        ))}
        {session.orders.flatMap((o) =>
          o.items.map((i, idx) => (
            <div key={`${o.id}-${idx}`} className="flex justify-between gap-3 py-1">
              <span>
                {i.quantity}× {i.name}
              </span>
            </div>
          )),
        )}
        {bill.canteen > 0 && (
          <div className="flex justify-between gap-3 border-t py-1 text-muted-foreground">
            <span>{dict.booking.canteen}</span>
            <span className="tabular-nums">{money(locale, bill.canteen, cur)}</span>
          </div>
        )}
        {bill.discount > 0 && (
          <div className="flex justify-between gap-3 py-1 text-emerald-300">
            <span>{dict.receipt.discount}</span>
            <span className="tabular-nums">−{money(locale, bill.discount, cur)}</span>
          </div>
        )}
        {bill.tax > 0 && (
          <div className="flex justify-between gap-3 py-1 text-muted-foreground">
            <span>{dict.booking.tax}</span>
            <span className="tabular-nums">{money(locale, bill.tax, cur)}</span>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t pt-2 text-base font-bold">
          <span>{dict.common.total}</span>
          <span className="tabular-nums">{money(locale, bill.total, cur)}</span>
        </div>
        {session.amountPaid > 0 && (
          <div className="flex justify-between gap-3 py-1 text-muted-foreground">
            <span>{dict.manage.session.paid}</span>
            <span className="tabular-nums">−{money(locale, session.amountPaid, cur)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-primary/15 p-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">{dict.manage.checkout.amountDue}</div>
          <div className="text-3xl font-bold tabular-nums">{money(locale, bill.due, cur)}</div>
        </div>
        {session.mode === "OPEN" && (
          <Button variant="ghost" onClick={recalc} title={dict.pos.recalculate}>
            <RefreshCw aria-hidden /> {formatTime(locale, billUntil, tz)}
          </Button>
        )}
      </div>

      {discountOpen ? (
        <DiscountEditor value={discount} onChange={changeDiscount} currency={cur} />
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setDiscountOpen(true)}>
          <Percent aria-hidden /> {dict.pos.addDiscount}
        </Button>
      )}
      {overDiscounted && <p className="text-sm text-rose-300">{dict.manage.errors.DISCOUNT_INVALID}</p>}

      {bill.due > 0 ? (
        <PaymentSplit rows={rows} onChange={setRows} due={bill.due} currency={cur} />
      ) : (
        <p className="text-center text-sm text-muted-foreground">{dict.manage.checkout.nothingDue}</p>
      )}

      {needsShift && (
        <p className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 text-sm text-amber-200">{dict.shift.requiredToPay}</p>
      )}

      <Button
        size="lg"
        className="h-14 w-full text-lg"
        onClick={confirm}
        disabled={pending || !balanced || overDiscounted || needsShift}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}
        {bill.due > 0 ? dict.manage.checkout.confirm : dict.manage.checkout.confirmNoPay}
      </Button>
    </div>
  );
}

function DoneView({ completed, onClose }: { completed: Completed; onClose: () => void }) {
  const { dict, locale, t } = useI18n();
  const { data } = usePos();
  return (
    <div className="flex flex-col items-center gap-4 p-8 text-center">
      <DialogTitle className="sr-only">{dict.pos.checkoutDone}</DialogTitle>
      <CheckCircle2 className="size-16 text-emerald-400" aria-hidden />
      <div>
        <div className="text-xl font-bold">{dict.pos.checkoutDone}</div>
        <div className="text-muted-foreground">
          {completed.deviceName} · {t(dict.pos.collected, { amount: money(locale, completed.collected, data.lounge.currency) })}
        </div>
      </div>
      <div className="grid w-full max-w-sm grid-cols-2 gap-2">
        <Button size="lg" className="h-14" onClick={() => printReceipt(locale, completed.receiptId)}>
          <Printer aria-hidden /> {dict.pos.printReceipt}
        </Button>
        <Button size="lg" variant="outline" className="h-14" onClick={onClose}>
          {dict.common.close}
        </Button>
      </div>
    </div>
  );
}
