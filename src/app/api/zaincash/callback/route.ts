import { type NextRequest } from "next/server";
import { getDictionaryFor } from "@/i18n/server";
import { handleZainCashRedirect } from "@/server/services/zaincash";

/**
 * Where ZainCash sends the customer's phone after paying (or not), with ?token=<signed JWT>.
 * Records the result for the cashier's screen and shows the customer a short message.
 */
export async function GET(request: NextRequest) {
  const status = await handleZainCashRedirect(request.nextUrl.searchParams.get("token"));
  const dict = (await getDictionaryFor("ar")).zainCash;
  const en = (await getDictionaryFor("en")).zainCash;
  const [ar, eng, ok] =
    status === "PAID"
      ? [dict.callbackPaid, en.callbackPaid, true]
      : status === "FAILED"
        ? [dict.callbackFailed, en.callbackFailed, false]
        : status === "PENDING"
          ? [dict.callbackPending, en.callbackPending, false]
          : [dict.callbackInvalid, en.callbackInvalid, false];
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZainCash</title><meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,sans-serif;background:#0b0b0f;color:#f4f4f5;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<main><div style="font-size:56px">${ok ? "✅" : "⚠️"}</div><h1 style="font-size:22px">${escape(ar)}</h1><p dir="ltr" style="color:#a1a1aa">${escape(eng)}</p></main></body></html>`;
  return new Response(html, { status: status ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
