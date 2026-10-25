import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ReceiptToolbar } from "@/components/pos/receipt-toolbar";
import { localeMeta, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { money } from "@/i18n/format";
import { shiftTypeEmoji } from "@/lib/shift-type";
import { getDictionary, getLocale } from "@/i18n/server";
import { getSession } from "@/server/session";
import { getShiftSummary, type ShiftSummary } from "@/server/services/shift";
import { getLoungeAccess } from "@/server/staff";
import { posLoginHref } from "@/lib/pos-login";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.shift.reportTitle, robots: { index: false } };
}

export default function ShiftReportPage({ params }: PageProps<"/[locale]/shift-report/[id]">) {
  return (
    <Suspense fallback={null}>
      {params.then(({ id }) => (
        <ReportLoader id={id} />
      ))}
    </Suspense>
  );
}

async function ReportLoader({ id }: { id: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(posLoginHref(locale, `/shift-report/${id}`));
  }
  const summary = await getShiftSummary(id);
  // Same 404 for missing and for another lounge's shift.
  if (!summary || !(await getLoungeAccess(session.user.id, summary.loungeId))) notFound();
  const dict = await getDictionary(locale);
  return (
    <>
      <Suspense>
        <ReceiptToolbar />
      </Suspense>
      <Report s={summary} locale={locale} dict={dict} />
    </>
  );
}

function dateTime(locale: Locale, iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(localeMeta[locale].intl, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function Divider() {
  return <div className="my-1.5 border-t border-dashed border-black" aria-hidden />;
}

function Line({ label, value, bold }: { label: React.ReactNode; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${bold ? "font-bold" : ""}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

/** Z-report style shift summary on 80mm paper. */
function Report({ s, locale, dict }: { s: ShiftSummary; locale: Locale; dict: Dictionary }) {
  const m = (v: number) => money(locale, v, s.lounge.currency);
  const tz = s.lounge.timezone;
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${m(Math.abs(v))}`;
  return (
    <article
      dir={localeMeta[locale].dir}
      className="receipt-paper mx-auto mb-6 w-[80mm] bg-white px-[4mm] py-[4mm] text-[12px] leading-snug text-black shadow-lg"
    >
      <header className="text-center">
        <div className="text-[20px] leading-tight font-extrabold">{dict.common.appName}</div>
        <div className="text-[14px] font-bold">{s.lounge.name}</div>
        <div className="mt-1 text-[13px] font-bold">
          {dict.shift.reportTitle}
          {s.status === "OPEN" && ` (${dict.shift.stillOpen})`}
        </div>
        <div className="mt-0.5 text-[14px] font-extrabold">
          {dict.shift.types[s.shiftType]} {shiftTypeEmoji[s.shiftType]}
        </div>
      </header>
      <Divider />
      <Line label={dict.shift.shiftNo} value={<span dir="ltr">{s.id.slice(-8).toUpperCase()}</span>} />
      <Line label={dict.shift.type} value={dict.shift.typeShort[s.shiftType]} />
      <Line label={dict.pos.cashier} value={s.cashier} />
      <Line label={dict.shift.openedAt} value={dateTime(locale, s.openedAt, tz)} />
      {s.closedAt && <Line label={dict.shift.closedAt} value={dateTime(locale, s.closedAt, tz)} />}
      {s.closedBy && s.closedBy !== s.cashier && <Line label={dict.shift.closedBy} value={s.closedBy} />}

      <Divider />
      <div className="font-bold">{dict.shift.revenue}</div>
      <Line label={`${dict.shift.sessions}`} value={s.sessions} />
      <Line label={`${dict.shift.counterSales}`} value={s.counterSales} />
      <Line label={dict.receipt.gaming} value={m(s.gaming)} />
      <Line label={dict.receipt.canteen} value={m(s.canteen)} />
      <Line label={dict.common.total} value={m(s.gaming + s.canteen)} bold />
      {s.discounts > 0 && <Line label={dict.receipt.discount} value={`−${m(s.discounts)}`} />}
      {s.tax > 0 && <Line label={dict.booking.tax} value={m(s.tax)} />}

      <Divider />
      <div className="font-bold">{dict.shift.byMethod}</div>
      {s.byMethod.length === 0 && <div>{dict.shift.noPayments}</div>}
      {s.byMethod.map((r) => (
        <Line key={r.method} label={`${dict.receipt.paymentMethod[r.method]} ×${r.count}`} value={m(r.amount)} />
      ))}
      <Line label={dict.shift.totalCollected} value={m(s.totalCollected)} bold />

      <Divider />
      <div className="font-bold">{dict.shift.drawer}</div>
      <Line label={dict.shift.openingFloat} value={m(s.openingFloat)} />
      <Line label={`+ ${dict.shift.cashGaming}`} value={m(s.cashGaming)} />
      <Line label={`+ ${dict.shift.cashCanteen}`} value={m(s.cashCanteen)} />
      <Line label={`− ${dict.shift.cashExpenses}`} value={m(s.expensesTotal)} />
      {s.expenses
        .filter((x) => !x.voided)
        .map((x) => (
          <div key={x.id} className="ps-3 text-[11px]">
            <Line label={`${x.reason} (${x.by})`} value={`−${m(x.amount)}`} />
          </div>
        ))}
      <Line label={`= ${dict.shift.expected}`} value={m(s.expectedCash)} bold />
      {s.countedCash !== null && <Line label={dict.shift.counted} value={m(s.countedCash)} />}
      {s.variance !== null && (
        <div className="my-1 text-[14px]">
          <Line
            label={`${dict.shift.variance} (${s.variance === 0 ? dict.shift.balanced : s.variance > 0 ? dict.shift.over : dict.shift.short})`}
            value={signed(s.variance)}
            bold
          />
        </div>
      )}
      {s.notes && (
        <>
          <Divider />
          <div className="whitespace-pre-wrap">{s.notes}</div>
        </>
      )}

      <Divider />
      <div className="mt-6 grid grid-cols-2 gap-4 text-center text-[10px]">
        <div className="border-t border-black pt-1">{dict.shift.cashierSignature}</div>
        <div className="border-t border-black pt-1">{dict.shift.managerSignature}</div>
      </div>
    </article>
  );
}
