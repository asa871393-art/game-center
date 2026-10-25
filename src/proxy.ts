import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "@/i18n/config";

/**
 * Customer-facing sections (marketplace, booking, checkout, customer accounts). The app runs as
 * a cashier POS only, so these and the home page send visitors to the POS, which asks anyone
 * signed out to sign in at /pos/login.
 */
const CUSTOMER_SECTIONS = new Set(["", "lounges", "bookings", "account", "checkout", "register"]);

/** Sends locale-less URLs to /{locale}/..., preferring the user's saved choice, and customer pages to the POS. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const [, first, section = ""] = pathname.split("/");
  const url = request.nextUrl.clone();

  if (!isLocale(first)) {
    const saved = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isLocale(saved) ? saved : defaultLocale;
    url.pathname = pathname === "/" ? `/${locale}/pos` : `/${locale}${pathname}`;
    return NextResponse.redirect(url);
  }

  // The customer sign-in moved to the cashier one; keep callbackUrl and error.
  if (section === "login") {
    url.pathname = `/${first}/pos/login`;
    return NextResponse.redirect(url);
  }
  if (CUSTOMER_SECTIONS.has(section)) {
    url.pathname = `/${first}/pos`;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip API routes, Next internals and files with an extension.
  // The dot must reach the regex escaped ("\\." in this string literal); a bare "." made the
  // lookahead match every non-empty path, so only "/" was ever redirected.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
