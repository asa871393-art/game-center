import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ReceiptQr } from "@/components/pos/receipt-qr";
import { ReceiptToolbar } from "@/components/pos/receipt-toolbar";
import { localeMeta, localePath, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { format, formatDuration, money } from "@/i18n/format";
import { getDictionary, getLocale } from "@/i18n/server";
import { getReceipt, type Receipt, type ReceiptLine } from "@/server/queries/receipt";
import { env } from "@/lib/env";
import { getSession } from "@/server/session";
import { getLoungeAccess } from "@/server/staff";
import { posLoginHref } from "@/lib/pos-login";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.receipt.title, robots: { index: false } };
}

export default function ReceiptPage({ params }: PageProps<"/[locale]/receipt/[id]">) {
  return (
    <Suspense fallback={null}>
      {params.then(({ id }) => (
        <ReceiptLoader id={id} />
      ))}
    </Suspense>
  );
}

async function ReceiptLoader({ id }: { id: string }) {
  const [locale, session] = await Promise.all([getLocale(), getSession()]);
  if (!session?.user?.id) {
    redirect(posLoginHref(locale, `/receipt/${id}`));
  }
  const receipt = await getReceipt(id);
  // Only staff of that lounge may see its receipts; same 404 for missing and forbidden.
  if (!receipt || !(await getLoungeAccess(session.user.id, receipt.loungeId))) notFound();
  const dict = await getDictionary(locale);
  return (
    <>
      <Suspense>
        <ReceiptToolbar />
      </Suspense>
      <ReceiptPaper receipt={receipt} locale={locale} dict={dict} />
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

function Line({ label, value, bold, sub }: { label: React.ReactNode; value: React.ReactNode; bold?: boolean; sub?: React.ReactNode }) {
  return (
    <div className={bold ? "font-bold" : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 break-words">{label}</span>
        <span className="shrink-0 tabular-nums">{value}</span>
      </div>
      {sub && <div className="text-[10px] leading-tight">{sub}</div>}
    </div>
  );
}

/** 72mm printable width on 80mm paper; sized in mm so it prints 1:1. */
function ReceiptPaper({ receipt: r, locale, dict }: { receipt: Receipt; locale: Locale; dict: Dictionary }) {
  // The lounge's public page, tagged with the receipt number: customers scan it to book again.
  const qrUrl = new URL(localePath(locale, `/lounges/${r.lounge.slug}`), env.NEXT_PUBLIC_APP_URL);
  qrUrl.searchParams.set("ref", r.reference);
  const cur = r.lounge.currency;
  const tz = r.lounge.timezone;
  const m = (v: number) => money(locale, v, cur);
  const playLabel = (l: ReceiptLine) =>
    l.kind === "extension" ? `${dict.receipt.extension} · ${l.label}` : `${l.label}${l.priceTier && l.priceTier !== "SINGLE" ? ` · ${dict.pos.tier[l.priceTier]}` : ""}`;

  return (
    <article
      dir={localeMeta[locale].dir}
      className="receipt-paper mx-auto mb-6 w-[80mm] bg-white px-[4mm] py-[4mm] text-[12px] leading-snug text-black shadow-lg"
    >
      <header className="text-center">
        <div className="text-[20px] leading-tight font-extrabold">{dict.common.appName}</div>
        <div className="text-[14px] font-bold">{r.lounge.name}</div>
        <div className="text-[10px]">
          {r.lounge.addressLine}
          {dict.manage.listSep}
          {r.lounge.city}
        </div>
        {r.lounge.phone && (
          <div dir="ltr" className="text-[10px]">
            {r.lounge.phone}
          </div>
        )}
        <div className="mt-1 text-[13px] font-bold">
          {r.isFinal ? (r.kind === "order" ? dict.receipt.salesReceipt : dict.receipt.title) : dict.receipt.provisional}
        </div>
      </header>

      <Divider />
      <Line label={dict.receipt.number} value={<span dir="ltr">{r.reference}</span>} />
      <Line label={dict.receipt.date} value={dateTime(locale, r.issuedAt, tz)} />
      {r.cashier && <Line label={dict.pos.cashier} value={r.cashier} />}
      {r.guest && <Line label={dict.manage.session.guest} value={r.guest} />}
      {r.startedAt && (
        <Line
          label={dict.receipt.session}
          value={`${r.mode ? dict.pos.mode[r.mode] : ""}`}
          sub={`${dateTime(locale, r.startedAt, tz)}${r.endedAt ? ` → ${dateTime(locale, r.endedAt, tz)}` : ""}${
            r.pausedMinutes ? ` · ${format(dict.pos.pausedTotal, { minutes: r.pausedMinutes })}` : ""
          }`}
        />
      )}

      {r.play.length > 0 && (
        <>
          <Divider />
          <div className="font-bold">{dict.receipt.gaming}</div>
          {r.play.map((l, i) => (
            <Line key={i} label={playLabel(l)} value={m(l.amount)} sub={l.minutes ? formatDuration(locale, l.minutes, dict) : undefined} />
          ))}
        </>
      )}

      {r.items.length > 0 && (
        <>
          <Divider />
          <div className="font-bold">{dict.receipt.canteen}</div>
          {r.items.map((l, i) => (
            <Line
              key={i}
              label={l.label}
              value={m(l.amount)}
              sub={l.quantity && l.unitPrice !== undefined ? `${l.quantity} × ${m(l.unitPrice)}` : undefined}
            />
          ))}
        </>
      )}

      <Divider />
      {r.playSubtotal > 0 && <Line label={dict.receipt.gaming} value={m(r.playSubtotal)} />}
      {r.canteenSubtotal > 0 && <Line label={dict.receipt.canteen} value={m(r.canteenSubtotal)} />}
      {r.discount > 0 && <Line label={dict.receipt.discount} value={`−${m(r.discount)}`} />}
      {r.tax > 0 && <Line label={dict.booking.tax} value={m(r.tax)} />}
      <div className="my-1 text-[15px]">
        <Line label={dict.common.total} value={m(r.total)} bold />
      </div>

      {r.payments.length > 0 && (
        <>
          <Divider />
          {r.payments.map((p, i) => (
            <div key={i}>
              <Line label={dict.receipt.paymentMethod[p.method]} value={m(p.amount)} />
              {p.tendered !== null && (
                <>
                  <Line label={dict.pos.cashGiven} value={m(p.tendered)} />
                  <Line label={dict.pos.change} value={m(p.change ?? 0)} />
                </>
              )}
            </div>
          ))}
        </>
      )}
      {r.total - r.paid > 0 && <Line label={dict.manage.session.due} value={m(r.total - r.paid)} bold />}

      <Divider />
      <footer className="text-center text-[11px]">
        <div>{dict.receipt.thanks}</div>
        <div className="mt-2">
          <ReceiptQr value={qrUrl.toString()} label={dict.receipt.qrLabel} />
          <div className="mt-1 text-[10px]">{dict.receipt.qrLabel}</div>
        </div>
        <div dir="ltr" className="mt-1 font-mono text-[10px] tracking-widest">
          *{r.reference}*
        </div>
      </footer>
    </article>
  );
}
