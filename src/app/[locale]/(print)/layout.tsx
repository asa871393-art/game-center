/**
 * Print documents (80mm thermal receipts): black on white regardless of the
 * app theme, no site chrome. `@page` sizes the paper for roll printers.
 */
export default function PrintLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <div className="receipt-shell min-h-dvh bg-zinc-200 text-black [color-scheme:light] print:bg-white">
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .no-print, [data-sonner-toaster] { display: none !important; }
          .receipt-shell { min-height: 0 !important; }
          .receipt-paper { box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>
      {children}
    </div>
  );
}
