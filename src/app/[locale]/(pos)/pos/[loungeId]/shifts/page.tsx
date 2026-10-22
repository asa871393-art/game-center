import { ArrowLeft, ArrowRight, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ManagersOnly } from "@/components/pos/managers-only";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { localeMeta, localePath, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { format, formatNumber, money } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { posLoginHref } from "@/lib/pos-login";
import type { ShiftType } from "@/lib/db/types";
import { SHIFT_TYPES, shiftTypeEmoji } from "@/lib/shift-type";
import { cn } from "@/lib/utils";
import { getShiftHistory, type ShiftHistory, type ShiftTypeTotals } from "@/server/queries/shifts";
import { getSession } from "@/server/session";
import { getLoungeAccess, hasLoungeRole, loungeExists } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.shift.history.title, robots: { index: false } };
}

export default function ShiftsPage({ params, searchParams }: PageProps<"/[locale]/pos/[loungeId]/shifts">) {
  return (
    <Suspense fallback={<HistorySkeleton />}>
      {Promise.all([params, searchParams]).then(([{ loungeId }, sp]) => (
        <Shifts loungeId={loungeId} type={SHIFT_TYPES.find((t) => t === sp.type)} />
      ))}
    </Suspense>
  );
}

async function Shifts({ loungeId, type }: { loungeId: string; type?: ShiftType }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  const path = `/pos/${loungeId}/shifts`;
  if (!session?.user?.id) {
    redirect(posLoginHref(locale, path));
  }
  // Cash variances per cashier are a manager matter, like the other admin screens.
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access || !hasLoungeRole(access, "MANAGER")) {
    if (!(await loungeExists(loungeId))) notFound();
    return <ManagersOnly locale={locale} loungeId={loungeId} email={session.user.email ?? ""} path={path} />;
  }
  const data = await getShiftHistory(loungeId, type);
  if (!data) notFound();
  return <History data={data} locale={locale} type={type} />;
}

function dateTime(locale: Locale, iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(localeMeta[locale].intl, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

async function History({ data, locale, type }: { data: ShiftHistory; locale: Locale; type?: ShiftType }) {
  const dict = await getDictionary(locale);
  const h = dict.shift.history;
  const { lounge, rows, totals, byType } = data;
  const m = (v: number) => money(locale, v, lounge.currency);
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${m(Math.abs(v))}`;
  const Back = localeMeta[locale].dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={localePath(locale, `/pos/${lounge.id}`)} className={buttonVariants({ variant: "ghost", size: "icon-lg" })}>
          <Back aria-hidden />
          <span className="sr-only">{dict.devices.backToPos}</span>
        </Link>
        <div className="me-auto">
          <h1 className="text-2xl font-bold">{h.title}</h1>
          <p className="text-sm text-muted-foreground">{lounge.name}</p>
        </div>
        <nav aria-label={h.filter} className="flex rounded-xl border bg-card p-1">
          {[undefined, ...SHIFT_TYPES].map((t) => (
            <Link
              key={t ?? "all"}
              href={localePath(locale, `/pos/${lounge.id}/shifts${t ? `?type=${t}` : ""}`)}
              aria-current={t === type ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                t === type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t ? `${shiftTypeEmoji[t]} ${dict.shift.typeShort[t]}` : h.all}
            </Link>
          ))}
        </nav>
      </header>

      <TypeComparison byType={byType} selected={type} locale={locale} currency={lounge.currency} dict={dict} />

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Summary label={format(h.shifts, { count: formatNumber(locale, rows.length) })} value={m(totals.collected)} hint={h.collected} />
        <Summary label={h.shortShifts} value={formatNumber(locale, totals.shortCount)} tone={totals.shortCount ? "short" : undefined} />
        <Summary label={h.overShifts} value={formatNumber(locale, totals.overCount)} tone={totals.overCount ? "over" : undefined} />
        <Summary
          label={h.totalVariance}
          value={signed(totals.netVariance)}
          tone={totals.netVariance === 0 ? "ok" : totals.netVariance > 0 ? "over" : "short"}
        />
      </section>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">{h.empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className={cn(
                "grid gap-3 rounded-2xl border bg-card p-3 sm:grid-cols-[1.4fr_repeat(5,1fr)_auto] sm:items-center",
                r.status === "OPEN" && "border-amber-500/60",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold">
                  <ShiftTypePill type={r.shiftType} label={dict.shift.typeShort[r.shiftType]} />
                  {r.cashier}
                  {r.status === "OPEN" && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">{h.open}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {dateTime(locale, r.openedAt, lounge.timezone)}
                  {r.closedAt && ` ${localeMeta[locale].dir === "rtl" ? "←" : "→"} ${dateTime(locale, r.closedAt, lounge.timezone)}`}
                </div>
              </div>
              <Cell label={h.collected} value={m(r.collected)} />
              <Cell label={`${dict.receipt.gaming} / ${dict.receipt.canteen}`} value={m(r.gaming)} hint={m(r.canteen)} />
              <Cell label={dict.shift.cashExpenses} value={r.expensesTotal ? `−${m(r.expensesTotal)}` : "—"} />
              <Cell label={dict.shift.expected} value={m(r.expectedCash)} />
              <Cell
                label={dict.shift.variance}
                value={r.variance === null ? "—" : signed(r.variance)}
                className={cn(
                  r.variance !== null && r.variance < 0 && "text-rose-400",
                  r.variance !== null && r.variance > 0 && "text-sky-400",
                  r.variance === 0 && "text-emerald-400",
                )}
                hint={r.countedCash === null ? undefined : `${dict.shift.counted}: ${m(r.countedCash)}`}
              />
              <a
                href={localePath(locale, `/shift-report/${r.id}`)}
                target="_blank"
                rel="noopener"
                className={buttonVariants({ variant: "outline", className: "h-11" })}
              >
                <Printer aria-hidden /> {h.print}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ShiftTypePill({ type, label }: { type: ShiftType; label: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold",
        type === "MORNING" ? "bg-amber-400/20 text-amber-300" : "bg-indigo-400/20 text-indigo-300",
      )}
    >
      {shiftTypeEmoji[type]} {label}
    </span>
  );
}

/** Morning vs evening revenue side by side, split into gaming and canteen. */
function TypeComparison({
  byType,
  selected,
  locale,
  currency,
  dict,
}: {
  byType: Record<ShiftType, ShiftTypeTotals>;
  selected?: ShiftType;
  locale: Locale;
  currency: string;
  dict: Dictionary;
}) {
  const h = dict.shift.history;
  const m = (v: number) => money(locale, v, currency);
  const grand = SHIFT_TYPES.reduce((s, t) => s + byType[t].gaming + byType[t].canteen, 0);
  const max = Math.max(1, ...SHIFT_TYPES.flatMap((t) => [byType[t].gaming, byType[t].canteen]));
  const percent = new Intl.NumberFormat(localeMeta[locale].intl, { style: "percent" });
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="font-bold">{h.compareTitle}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{h.compareHint}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SHIFT_TYPES.map((t) => {
          const v = byType[t];
          const total = v.gaming + v.canteen;
          return (
            <div
              key={t}
              className={cn(
                "space-y-2 rounded-xl border p-3",
                selected === t && (t === "MORNING" ? "border-amber-400/70 bg-amber-400/5" : "border-indigo-400/70 bg-indigo-400/5"),
                selected && selected !== t && "opacity-60",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {shiftTypeEmoji[t]} {dict.shift.types[t]}
                </span>
                <span className="text-xs text-muted-foreground">{format(h.shifts, { count: formatNumber(locale, v.shifts) })}</span>
              </div>
              {v.shifts === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{h.none}</p>
              ) : (
                <>
                  <Bar label={dict.receipt.gaming} value={m(v.gaming)} ratio={v.gaming / max} className="bg-violet-500" />
                  <Bar label={dict.receipt.canteen} value={m(v.canteen)} ratio={v.canteen / max} className="bg-emerald-500" />
                  <div className="flex justify-between border-t pt-2 text-sm">
                    <span className="text-muted-foreground">{h.revenueTotal}</span>
                    <span className="font-bold tabular-nums">{m(total)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {h.perShift}: <span className="tabular-nums">{m(Math.round(total / v.shifts))}</span>
                    </span>
                    {grand > 0 && <span>{format(h.share, { percent: percent.format(total / grand) })}</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Bar({ label, value, ratio, className }: { label: string; value: string; ratio: number; className: string }) {
  return (
    <div className="text-sm">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", className)} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}

function Cell({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className="text-sm">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("font-semibold tabular-nums", className)}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground tabular-nums">{hint}</div>}
    </div>
  );
}

function Summary({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ok" | "over" | "short" }) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3",
        tone === "ok" && "border-emerald-500/50 bg-emerald-500/10",
        tone === "over" && "border-sky-500/50 bg-sky-500/10",
        tone === "short" && "border-rose-500/50 bg-rose-500/10",
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5">
      <Skeleton className="h-12 w-72" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-20 rounded-2xl" />
      ))}
    </div>
  );
}
