import { ArrowLeft, ArrowRight, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ManagersOnly } from "@/components/pos/managers-only";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { localeMeta, localePath, type Locale } from "@/i18n/config";
import { format, formatNumber, money } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { getShiftHistory, type ShiftHistory } from "@/server/queries/shifts";
import { getSession } from "@/server/session";
import { getLoungeAccess, hasLoungeRole, loungeExists } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.shift.history.title, robots: { index: false } };
}

export default function ShiftsPage({ params }: PageProps<"/[locale]/pos/[loungeId]/shifts">) {
  return (
    <Suspense fallback={<HistorySkeleton />}>
      {params.then(({ loungeId }) => (
        <Shifts loungeId={loungeId} />
      ))}
    </Suspense>
  );
}

async function Shifts({ loungeId }: { loungeId: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  const path = `/pos/${loungeId}/shifts`;
  if (!session?.user?.id) {
    redirect(`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, path))}`);
  }
  // Cash variances per cashier are a manager matter, like the other admin screens.
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access || !hasLoungeRole(access, "MANAGER")) {
    if (!(await loungeExists(loungeId))) notFound();
    return <ManagersOnly locale={locale} loungeId={loungeId} email={session.user.email ?? ""} path={path} />;
  }
  const data = await getShiftHistory(loungeId);
  if (!data) notFound();
  return <History data={data} locale={locale} />;
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

async function History({ data, locale }: { data: ShiftHistory; locale: Locale }) {
  const dict = await getDictionary(locale);
  const h = dict.shift.history;
  const { lounge, rows, totals } = data;
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
      </header>

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
                "grid gap-3 rounded-2xl border bg-card p-3 sm:grid-cols-[1.4fr_repeat(4,1fr)_auto] sm:items-center",
                r.status === "OPEN" && "border-amber-500/60",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold">
                  {r.cashier}
                  {r.status === "OPEN" && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">{h.open}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {dateTime(locale, r.openedAt, lounge.timezone)}
                  {r.closedAt && ` ${localeMeta[locale].dir === "rtl" ? "←" : "→"} ${dateTime(locale, r.closedAt, lounge.timezone)}`}
                </div>
              </div>
              <Cell label={h.collected} value={m(r.collected)} />
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
