"use client";

import { localePath, type Locale } from "@/i18n/config";

/**
 * Prints a print page (receipt, shift report) without leaving the POS: loads
 * it in a hidden iframe and opens the print dialog from it (same origin). If
 * the iframe can't print (some kiosk browsers), the page opens in a new tab.
 */
export function printPage(locale: Locale, path: string) {
  const url = `${localePath(locale, path)}?embed=1`;
  const fallback = () => window.open(url.replace("embed=1", "print=1"), "_blank");
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = url;

  const cleanup = () => setTimeout(() => frame.remove(), 1_000);
  frame.addEventListener("load", () => {
    const win = frame.contentWindow;
    if (!win) {
      fallback();
      return cleanup();
    }
    win.addEventListener("afterprint", cleanup, { once: true });
    // Give fonts a moment so the first print isn't in a fallback face.
    void (win.document.fonts?.ready ?? Promise.resolve()).then(() => {
      try {
        win.focus();
        win.print();
      } catch {
        fallback();
        cleanup();
      }
    });
  });
  document.body.appendChild(frame);
  // Safety net if afterprint never fires.
  setTimeout(() => frame.remove(), 120_000);
}

export function printReceipt(locale: Locale, receiptId: string) {
  printPage(locale, `/receipt/${encodeURIComponent(receiptId)}`);
}

export function printShiftReport(locale: Locale, shiftId: string) {
  printPage(locale, `/shift-report/${encodeURIComponent(shiftId)}`);
}
