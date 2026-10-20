"use client";

import { Printer, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useI18n } from "@/i18n/client";

/**
 * Screen-only controls for the receipt page. With ?print=1 the print dialog
 * opens automatically; with ?embed=1 (hidden iframe from the POS) the parent prints.
 */
export function ReceiptToolbar() {
  const { dict } = useI18n();
  const params = useSearchParams();
  const embedded = params.get("embed") === "1";
  const autoPrint = params.get("print") === "1";

  useEffect(() => {
    if (!autoPrint) return;
    let cancelled = false;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
    };
  }, [autoPrint]);

  if (embedded) return null;
  return (
    <div className="no-print mx-auto flex w-[80mm] justify-between gap-2 py-3">
      <button
        type="button"
        onClick={() => window.print()}
        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-black px-4 font-semibold text-white"
      >
        <Printer className="size-4" aria-hidden /> {dict.pos.printReceipt}
      </button>
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? window.history.back() : window.close())}
        className="flex h-11 items-center justify-center rounded-lg border border-black/30 bg-white px-4"
        aria-label={dict.common.close}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
