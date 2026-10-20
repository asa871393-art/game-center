"use client";

import { localePath, type Locale } from "@/i18n/config";

/**
 * Prints a receipt without leaving the POS: loads the 80mm receipt page in a
 * hidden iframe and opens the print dialog from it (same origin). If the
 * iframe can't print (some kiosk browsers), the receipt opens in a new tab.
 */
export function printReceipt(locale: Locale, receiptId: string) {
  const url = `${localePath(locale, `/receipt/${encodeURIComponent(receiptId)}`)}?embed=1`;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = url;

  const cleanup = () => setTimeout(() => frame.remove(), 1_000);
  frame.addEventListener("load", () => {
    const win = frame.contentWindow;
    if (!win) {
      window.open(url.replace("embed=1", "print=1"), "_blank");
      return cleanup();
    }
    win.addEventListener("afterprint", cleanup, { once: true });
    // Give fonts a moment so the first print isn't in a fallback face.
    void (win.document.fonts?.ready ?? Promise.resolve()).then(() => {
      try {
        win.focus();
        win.print();
      } catch {
        window.open(url.replace("embed=1", "print=1"), "_blank");
        cleanup();
      }
    });
  });
  document.body.appendChild(frame);
  // Safety net if afterprint never fires.
  setTimeout(() => frame.remove(), 120_000);
}
