import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
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
import type { PaymentMethod } from "@/lib/db/types";
import { posLoginHref } from "@/lib/pos-login";
import { addMonths, isIsoMonth, type DayReport } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { getMonthReport, type MonthReportData } from "@/server/queries/reports";
import { getSession } from "@/server/session";
import { getLoungeAccess, hasLoungeRole, loungeExists } from "@/server/staff";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.reports.title, robots: { index: false } };
}

/** Daily and monthly revenue for managers: ?month=YYYY-MM, the current month by default. */
export default function ReportsPage({ params, searchParams }: PageProps<"/[locale]/pos/[loungeId]/reports">) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      {Promise.all([params, searchParams]).then(([{ loungeId }, sp]) => (
        <Reports loungeId={loungeId} month={isIsoMonth(sp.month) ? sp.month : undefined} />
      ))}
    </Suspense>
  );
}

async function Reports({ loungeId, month }: { loungeId: string; month?: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  const path = `/pos/${loungeId}/reports`;
  if (!session?.user?.id) redirect(posLoginHref(locale, path));
  // Revenue is a manager matter, like the shift history.
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access || !hasLoungeRole(access, "MANAGER")) {
    if (!(await loungeExists(loungeId))) notFound();
    return <ManagersOnly locale={locale} loungeId={loungeId} email={session.user.email ?? ""} path={path} />;
  }
  const data = await getMonthReport(loungeId, month);
  if (!data) notFound();
  return <Report data={data} locale={locale} />;
}

const METHOD_ORDER: PaymentMethod[] = ["CASH", "CARD", "ZAINCASH", "FASTPAY", "WALLET", "ONLINE"];

async function Report({ data, locale }: { data: MonthReportData; locale: Locale }) {
  const dict = await getDictionary(locale);
  const r = dict.reports;
  const { lounge, report, currentMonth, today } = data;
  const { totals } = report;
  const m = (v: number) => money(locale, v, lounge.currency);
  const intl = localeMeta[locale].intl;
  const rtl = localeMeta[locale].dir === "rtl";
  const Back = rtl ? ArrowRight : ArrowLeft;
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const monthLabel = new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${report.month}-01T00:00:00Z`),
  );
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat(intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const monthHref = (month: string) => localePath(locale, `/pos/${lounge.id}/reports${month === currentMonth ? "" : `?month=${month}`}`);
  const isCurrent = report.month === currentMonth;
  // Days still to come this month have nothing to show.
  const days = report.days.filter((d) => d.date <= today || report.month < currentMonth).reverse();
  const max = Math.max(1, ...days.map((d) => d.net));
  const methods = METHOD_ORDER.filter((k) => totals.byMethod[k]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={localePath(locale, `/pos/${lounge.id}`)} className={buttonVariants({ variant: "ghost", size: "icon-lg" })}>
          <Back aria-hidden />
          <span className="sr-only">{dict.devices.backToPos}</span>
        </Link>
        <div className="me-auto">
          <h1 className="text-2xl font-bold">{r.title}</h1>
          <p className="text-sm text-muted-foreground">{lounge.name}</p>
        </div>
        <nav aria-label={r.month} className="flex items-center gap-1 rounded-xl border bg-card p-1">
          <Link href={monthHref(addMonths(report.month, -1))} className={buttonVariants({ variant: "ghost", size: "icon" })}>
            <Prev aria-hidden />
            <span className="sr-only">{r.previous}</span>
          </Link>
          <span className="min-w-36 text-center font-semibold">{monthLabel}</span>
          {isCurrent ? (
            <span className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "pointer-events-none opacity-30")} aria-hidden>
              <Next />
            </span>
          ) : (
            <Link href={monthHref(addMonths(report.month, 1))} className={buttonVariants({ variant: "ghost", size: "icon" })}>
              <Next aria-hidden />
              <span className="sr-only">{r.next}</span>
            </Link>
          )}
        </nav>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Summary label={r.revenue} value={m(totals.net)} hint={totals.refunds ? format(r.afterRefunds, { amount: m(totals.refunds) }) : undefined} strong />
        <Summary label={dict.receipt.gaming} value={m(totals.gaming)} hint={format(r.sessions, { count: formatNumber(locale, totals.sessions) })} />
        <Summary
          label={dict.receipt.canteen}
          value={m(totals.canteen)}
          hint={format(r.counterSales, { count: formatNumber(locale, totals.counterSales) })}
        />
        <Summary
          label={r.dailyAverage}
          value={m(totals.activeDays ? Math.round(totals.net / totals.activeDays) : 0)}
          hint={format(r.activeDays, { count: formatNumber(locale, totals.activeDays) })}
        />
        <Summary label={dict.shift.cashExpenses} value={totals.expenses ? `−${m(totals.expenses)}` : "—"} />
        <Summary label={r.netAfterExpenses} value={m(totals.net - totals.expenses)} />
        <Summary
          label={r.bestDay}
          value={report.bestDay ? dayLabel(report.bestDay) : "—"}
          hint={report.bestDay ? m(report.days.find((d) => d.date === report.bestDay)!.net) : undefined}
        />
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground">{r.byMethod}</div>
          {methods.length === 0 ? (
            <div className="text-xl font-bold">—</div>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {methods.map((k) => (
                <li key={k} className="flex justify-between gap-2">
                  <span>{dict.receipt.paymentMethod[k]}</span>
                  <span className="font-semibold tabular-nums">{m(totals.byMethod[k]!)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-card">
        <h2 className="border-b p-4 font-bold">{r.daily}</h2>
        {days.every((d) => !d.collected && !d.refunds && !d.expenses) ? (
          <p className="p-10 text-center text-muted-foreground">{r.empty}</p>
        ) : (
          <ul className="divide-y">
            {days.map((d) => (
              <DayRow key={d.date} day={d} label={dayLabel(d.date)} today={d.date === today} max={max} m={m} dict={dict} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DayRow({
  day,
  label,
  today,
  max,
  m,
  dict,
}: {
  day: DayReport;
  label: string;
  today: boolean;
  max: number;
  m: (v: number) => string;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  const r = dict.reports;
  const idle = !day.collected && !day.refunds && !day.expenses;
  return (
    <li className={cn("grid gap-2 p-3 sm:grid-cols-[12rem_1fr_repeat(3,7rem)] sm:items-center", idle && "text-muted-foreground")}>
      <div className="font-semibold">
        {label}
        {today && <span className="ms-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{r.today}</span>}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.round((day.net / max) * 100))}%` }} />
        </div>
        <span className="w-28 text-end font-bold tabular-nums">{idle ? "—" : m(day.net)}</span>
      </div>
      <Cell label={dict.receipt.gaming} value={idle ? "—" : m(day.gaming)} />
      <Cell label={dict.receipt.canteen} value={idle ? "—" : m(day.canteen)} />
      <Cell label={dict.shift.cashExpenses} value={day.expenses ? `−${m(day.expenses)}` : "—"} />
    </li>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Summary({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", strong && "border-primary/50 bg-primary/10")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5">
      <Skeleton className="h-12 w-72" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}
