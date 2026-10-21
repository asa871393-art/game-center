"use client";

import { Loader2, LogIn, Minus, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { MenuThumb } from "@/components/canteen/menu-icons";
import { deviceTypeMeta } from "@/components/lounge/device-type";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { CheckoutMethod } from "@/generated/prisma/enums";
import { useI18n } from "@/i18n/client";
import { formatDuration, formatTime, localName, money } from "@/i18n/format";
import { quoteBooking, type Quote } from "@/lib/booking/pricing";
import { getAvailableSlots, getDurationOptions, type Slot } from "@/lib/booking/schedule";
import { addDays, toLocalIsoDate, zonedTimeToUtc, type IsoDate } from "@/lib/booking/time";
import { cn } from "@/lib/utils";
import { createBookingAction } from "@/server/actions/booking";
import type { DayAvailability, LoungeDetails } from "@/server/queries/lounges";
import { BOOKING_STEPS, useBookingDraft, type BookingStep } from "@/stores/booking-draft";

const ADVANCE_DAYS = 14;

export interface CheckoutOption {
  method: CheckoutMethod;
  isSandbox: boolean;
}

interface BookingDialogProps {
  lounge: LoungeDetails;
  checkoutOptions: CheckoutOption[];
  isSignedIn: boolean;
  /** Bumped when the lounge's availability changes (live feed). */
  liveTick?: number;
}

type AvailabilityState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: DayAvailability };

function useAvailability(slug: string, date: IsoDate | null, liveTick: number) {
  const [version, setVersion] = useState(0);
  // The result is tagged with the request it answers; anything else means "loading".
  const [result, setResult] = useState<{ key: string; state: AvailabilityState } | null>(null);
  const key = date ? `${slug}|${date}|${version}` : null;

  // `liveTick` refetches without changing `key`, so the current slots stay on screen until fresh ones arrive.
  useEffect(() => {
    if (!key || !date) return;
    const controller = new AbortController();
    fetch(`/api/lounges/${encodeURIComponent(slug)}/availability?date=${date}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setResult({ key, state: { status: "ready", data: (await res.json()) as DayAvailability } });
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setResult({ key, state: { status: "error" } });
      });
    return () => controller.abort();
  }, [key, slug, date, liveTick]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const state: AvailabilityState = !key
    ? { status: "idle" }
    : result?.key === key
      ? result.state
      : { status: "loading" };
  return [state, refresh] as const;
}

export function BookingDialog({ lounge, checkoutOptions, isSignedIn, liveTick = 0 }: BookingDialogProps) {
  const { dict, locale, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const draft = useBookingDraft();
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const device = lounge.devices.find((d) => d.id === draft.deviceId);
  const category = lounge.categories.find((c) => c.id === device?.categoryId);
  const [availability, refreshAvailability] = useAvailability(lounge.slug, draft.open ? draft.date : null, liveTick);

  const slots: Slot[] = useMemo(() => {
    if (availability.status !== "ready" || !availability.data.window || !device || !category) return [];
    const { window, busy } = availability.data;
    return getAvailableSlots({
      window: { start: new Date(window.start), end: new Date(window.end) },
      slotIntervalMinutes: category.slotIntervalMinutes,
      minDurationMinutes: category.minBookingMinutes,
      busy: (busy[device.id] ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
      now: new Date(),
      leadTimeMinutes: 5,
    });
  }, [availability, device, category]);

  const selectedSlot = slots.find((s) => s.start.toISOString() === draft.start);
  const durationOptions = useMemo(
    () => (selectedSlot && category ? getDurationOptions(category.minBookingMinutes, selectedSlot.maxDurationMinutes) : []),
    [selectedSlot, category],
  );

  const quote: Quote | null = useMemo(() => {
    if (!category || !draft.start || !draft.durationMinutes) return null;
    const addOns = Object.entries(draft.addOns).flatMap(([id, quantity]) => {
      const item = lounge.menuItems.find((m) => m.id === id);
      return item ? [{ unitPrice: item.price, quantity }] : [];
    });
    return quoteBooking({
      start: new Date(draft.start),
      durationMinutes: draft.durationMinutes,
      timeZone: lounge.timezone,
      categoryId: category.id,
      baseHourlyRate: device?.hourlyRate ?? category.baseHourlyRate,
      rules: lounge.pricingRules,
      taxRateBps: lounge.taxRateBps,
      addOns,
    });
  }, [category, device, draft.start, draft.durationMinutes, draft.addOns, lounge]);

  if (!device || !category) return null;

  const stepIndex = BOOKING_STEPS.indexOf(draft.step);
  const timeComplete = Boolean(selectedSlot && draft.durationMinutes);
  const { icon: Icon, color } = deviceTypeMeta[category.type];
  const isOnline = draft.checkoutMethod !== "PAY_AT_LOUNGE";

  function goTo(step: BookingStep) {
    setError(null);
    draft.setStep(step);
  }

  function submit() {
    if (!draft.start || !draft.durationMinutes || !device) return;
    setError(null);
    startSubmit(async () => {
      const result = await createBookingAction({
        locale,
        loungeSlug: lounge.slug,
        deviceId: device.id,
        start: draft.start!,
        durationMinutes: draft.durationMinutes!,
        players: draft.players,
        addOns: Object.entries(draft.addOns).map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
        checkoutMethod: draft.checkoutMethod,
        notes: draft.notes || undefined,
      });
      if (result.ok) {
        draft.setOpen(false);
        useBookingDraft.setState({ deviceId: null });
        router.push(result.data.redirectUrl);
        return;
      }
      setError(result.error);
      if (result.code === "SLOT_TAKEN" || result.code === "OUTSIDE_HOURS" || result.code === "TOO_SOON") {
        toast.error(result.error);
        draft.setStart(null, null);
        refreshAvailability();
        draft.setStep("time");
      }
    });
  }

  return (
    <Dialog open={draft.open} onOpenChange={(open) => draft.setOpen(open)}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="gap-1 border-b p-4 pe-12">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Icon className="size-5" style={{ color }} aria-hidden />
            {t(dict.booking.title, { device: device.name })}
          </DialogTitle>
          <DialogDescription>
            {category.name} · {lounge.name}
          </DialogDescription>
          <ol className="mt-2 grid grid-cols-3 gap-1.5" aria-label="steps">
            {BOOKING_STEPS.map((step, i) => (
              <li key={step} className="space-y-1">
                <div className={cn("h-1 rounded-full", i <= stepIndex ? "bg-primary" : "bg-muted")} />
                <span className={cn("text-xs", i === stepIndex ? "font-semibold" : "text-muted-foreground")}>
                  {step === "time" ? dict.booking.stepTime : step === "addons" ? dict.booking.stepAddOns : dict.booking.stepCheckout}
                </span>
              </li>
            ))}
          </ol>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {draft.step === "time" && (
            <TimeStep
              lounge={lounge}
              category={category}
              availability={availability}
              slots={slots}
              durationOptions={durationOptions}
              onRetry={refreshAvailability}
            />
          )}
          {draft.step === "addons" && <AddOnsStep lounge={lounge} />}
          {draft.step === "checkout" && quote && (
            <CheckoutStep lounge={lounge} quote={quote} checkoutOptions={checkoutOptions} />
          )}
          {error && (
            <Alert variant="destructive" className="mt-4">
              <TriangleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="m-0 flex-row items-center justify-between gap-2 border-t bg-muted/40 p-4 sm:justify-between">
          <div className="text-sm">
            {quote ? (
              <>
                <span className="text-muted-foreground">{dict.common.total}: </span>
                <span className="font-bold">{money(locale, quote.total, lounge.currency)}</span>
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button variant="outline" onClick={() => goTo(BOOKING_STEPS[stepIndex - 1])} disabled={submitting}>
                {dict.common.back}
              </Button>
            )}
            {draft.step !== "checkout" ? (
              <Button onClick={() => goTo(BOOKING_STEPS[stepIndex + 1])} disabled={!timeComplete}>
                {dict.common.next}
              </Button>
            ) : isSignedIn ? (
              <Button onClick={submit} disabled={submitting || !timeComplete}>
                {submitting && <Loader2 className="animate-spin" aria-hidden />}
                {submitting ? dict.booking.submitting : isOnline ? dict.booking.submitAndPay : dict.booking.submit}
              </Button>
            ) : (
              <Link
                href={`/${locale}/login?callbackUrl=${encodeURIComponent(pathname)}`}
                className={buttonVariants()}
              >
                <LogIn aria-hidden />
                {dict.booking.signInToBook}
              </Link>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Category = LoungeDetails["categories"][number];

function TimeStep({
  lounge,
  category,
  availability,
  slots,
  durationOptions,
  onRetry,
}: {
  lounge: LoungeDetails;
  category: Category;
  availability: AvailabilityState;
  slots: Slot[];
  durationOptions: number[];
  onRetry: () => void;
}) {
  const { dict, locale, intl } = useI18n();
  const draft = useBookingDraft();
  const [today] = useState(() => toLocalIsoDate(new Date(), lounge.timezone));
  const days = useMemo(() => Array.from({ length: ADVANCE_DAYS }, (_, i) => addDays(today, i)), [today]);
  const [weekdayFmt, dayFmt] = useMemo(
    () => [
      new Intl.DateTimeFormat(intl, { timeZone: lounge.timezone, weekday: "short" }),
      // Day number only: Arabic month names ("تشرين الأول") don't fit a chip.
      new Intl.DateTimeFormat(intl, { timeZone: lounge.timezone, day: "numeric" }),
    ],
    [intl, lounge.timezone],
  );

  const durationItems = durationOptions.map((m) => ({ value: String(m), label: formatDuration(locale, m, dict) }));
  const playerItems = Array.from({ length: category.capacity }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold">{dict.booking.date}</h3>
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
          {days.map((d) => {
            const noon = zonedTimeToUtc(d, 12 * 60, lounge.timezone);
            const active = draft.date === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => draft.setDate(d)}
                aria-pressed={active}
                className={cn(
                  "flex min-w-16 snap-start flex-col items-center rounded-xl border px-3 py-2 text-sm transition",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary",
                )}
              >
                <span className="text-xs opacity-80">{weekdayFmt.format(noon)}</span>
                <span className="whitespace-nowrap font-semibold">{dayFmt.format(noon)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{dict.booking.startTime}</h3>
        {availability.status === "loading" || availability.status === "idle" ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label={dict.booking.loadingSlots}>
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-9 rounded-lg" />
            ))}
          </div>
        ) : availability.status === "error" ? (
          <div className="flex items-center gap-3 text-sm text-destructive">
            {dict.errors.generic}
            <Button size="sm" variant="outline" onClick={onRetry}>
              {dict.common.retry}
            </Button>
          </div>
        ) : !availability.data.window ? (
          <p className="text-sm text-muted-foreground">{dict.booking.closedThatDay}</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.booking.noSlots}</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {slots.map((slot) => {
              const iso = slot.start.toISOString();
              const active = draft.start === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  aria-pressed={active}
                  onClick={() => draft.setStart(iso, category.minBookingMinutes)}
                  className={cn(
                    "h-9 rounded-lg border text-sm tabular-nums transition",
                    active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary",
                  )}
                >
                  {formatTime(locale, slot.start, lounge.timezone)}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{dict.booking.duration}</Label>
          <Select
            items={durationItems}
            value={draft.durationMinutes ? String(draft.durationMinutes) : null}
            onValueChange={(v) => v && draft.setDuration(Number(v))}
            disabled={durationItems.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {durationItems.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{dict.booking.players}</Label>
          <Select
            items={playerItems}
            value={String(draft.players)}
            onValueChange={(v) => v && draft.setPlayers(Number(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {playerItems.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  );
}

function AddOnsStep({ lounge }: { lounge: LoungeDetails }) {
  const { dict, locale } = useI18n();
  const { addOns, setQuantity } = useBookingDraft();
  const groups = lounge.menuCategories
    .map((c) => ({ category: c, items: lounge.menuItems.filter((m) => m.menuCategoryId === c.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{dict.booking.addOnsTitle}</h3>
        <p className="text-sm text-muted-foreground">{dict.booking.addOnsHint}</p>
      </div>
      {groups.map(({ category, items }) => (
        <section key={category.id}>
          <h4 className="mb-2 text-sm font-semibold text-muted-foreground">{localName(locale, category)}</h4>
          <ul className="divide-y rounded-xl border">
            {items.map((item) => {
              const qty = addOns[item.id] ?? 0;
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <MenuThumb imageUrl={item.imageUrl} iconName={item.iconName} kind={item.category} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{localName(locale, item)}</p>
                      <p className="text-sm text-muted-foreground">{money(locale, item.price, lounge.currency)}</p>
                    </div>
                  </div>
                  {item.soldOut ? (
                    <Badge variant="outline">{dict.booking.soldOut}</Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label="−"
                        disabled={qty === 0}
                        onClick={() => setQuantity(item.id, qty - 1)}
                      >
                        <Minus />
                      </Button>
                      <span className="w-5 text-center tabular-nums" aria-live="polite">
                        {qty}
                      </span>
                      <Button size="icon-sm" variant="outline" aria-label="+" onClick={() => setQuantity(item.id, qty + 1)}>
                        <Plus />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CheckoutStep({
  lounge,
  quote,
  checkoutOptions,
}: {
  lounge: LoungeDetails;
  quote: Quote;
  checkoutOptions: CheckoutOption[];
}) {
  const { dict, locale, intl } = useI18n();
  const draft = useBookingDraft();
  const items = Object.entries(draft.addOns).flatMap(([id, quantity]) => {
    const item = lounge.menuItems.find((m) => m.id === id);
    return item ? [{ ...item, quantity }] : [];
  });
  const fmt = (minor: number) => money(locale, minor, lounge.currency);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border p-4">
        <h3 className="mb-3 font-semibold">{dict.booking.summary}</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{dict.confirmation.when}</dt>
            <dd className="text-end">
              {new Intl.DateTimeFormat(intl, {
                timeZone: lounge.timezone,
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(new Date(draft.start!))}
              {" · "}
              {formatTime(locale, draft.start!, lounge.timezone)} ({formatDuration(locale, draft.durationMinutes!, dict)})
            </dd>
          </div>
          {quote.segments.map((s, i) => (
            <div key={i} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                {dict.booking.playTime} · {formatDuration(locale, s.minutes, dict)} × {fmt(s.hourlyRate)}
                {dict.common.perHour}
              </dt>
              <dd className="tabular-nums">{fmt(Math.round((s.hourlyRate * s.minutes) / 60))}</dd>
            </div>
          ))}
          {items.map((item) => (
            <div key={item.id} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                {localName(locale, item)} × {item.quantity}
              </dt>
              <dd className="tabular-nums">{fmt(item.price * item.quantity)}</dd>
            </div>
          ))}
          {quote.taxTotal > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{dict.booking.tax}</dt>
              <dd className="tabular-nums">{fmt(quote.taxTotal)}</dd>
            </div>
          )}
          <Separator />
          <div className="flex justify-between gap-4 text-base font-bold">
            <dt>{dict.common.total}</dt>
            <dd className="tabular-nums">{fmt(quote.total)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">{dict.payment.method}</h3>
        <RadioGroup
          value={draft.checkoutMethod}
          onValueChange={(v) => draft.setCheckoutMethod(v as CheckoutMethod)}
          className="gap-2"
        >
          {checkoutOptions.map(({ method, isSandbox }) => (
            <Label
              key={method}
              className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal has-data-checked:border-primary has-data-checked:bg-primary/5"
            >
              <RadioGroupItem value={method} className="mt-0.5" />
              <span className="flex-1">
                <span className="flex items-center gap-2 font-medium">
                  {dict.payment[method]}
                  {isSandbox && <Badge variant="outline">{dict.payment.sandbox}</Badge>}
                </span>
                <span className="block text-sm text-muted-foreground">{dict.payment[`${method}_hint`]}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </section>

      <section className="space-y-1.5">
        <Label htmlFor="booking-notes">
          {dict.booking.notes} <span className="text-muted-foreground">({dict.common.optional})</span>
        </Label>
        <Textarea
          id="booking-notes"
          value={draft.notes}
          onChange={(e) => draft.setNotes(e.target.value)}
          placeholder={dict.booking.notesPlaceholder}
          maxLength={500}
          rows={2}
        />
      </section>
    </div>
  );
}
