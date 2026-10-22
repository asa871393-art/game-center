import "server-only";
import QRCode from "qrcode";

/**
 * QR code as inline SVG, rendered on the server so the receipt prints without scripts or
 * network requests. Black modules on white, sized in mm for thermal paper.
 */
export async function ReceiptQr({ value, label, sizeMm = 24 }: { value: string; label: string; sizeMm?: number }) {
  // The SVG comes from the qrcode library for our own URL, so injecting it is safe.
  const svg = await QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  return (
    <div
      role="img"
      aria-label={label}
      className="mx-auto [&>svg]:size-full"
      style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm` }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
