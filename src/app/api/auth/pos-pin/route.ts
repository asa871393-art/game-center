import { AuthError } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { signIn } from "@/auth";
import { isLocale, localePath } from "@/i18n/config";
import { authSecret } from "@/lib/env";
import { PIN_PATTERN } from "@/lib/pin";
import { posCallback } from "@/lib/pos-login";
import { signPinTicket } from "@/lib/pin-ticket";
import { checkStaffPin } from "@/server/services/pos-pin";
import { getPrimaryLoungeId } from "@/server/staff";
import { isTrustedTerminal } from "@/server/terminal";

/**
 * POS PIN sign-in: { userId, pin, locale?, callbackUrl? } from the keypad on /pos/login.
 * The only sign-in: works for members of the branch (the primary lounge) from any browser, so
 * wrong PINs lock the account's PIN sign-in after every fifth, for longer each time.
 *
 * 200 { redirectTo }                   signed in (Auth.js session cookie set)
 * 400 { error: "VALIDATION" }          malformed body
 * 401 { error: "INVALID_PIN", attemptsLeft }
 * 403 { error: "NO_TERMINAL" }         no branch to sign in to, cross-site request, or a browser
 *                                      that hasn't entered the branch code (POS_TERMINAL_CODE)
 * 429 { error: "LOCKED", retryAfter }  with a Retry-After header
 */

const bodySchema = z.object({
  userId: z.string().min(1).max(64),
  pin: z.string().regex(PIN_PATTERN),
  locale: z.string().max(5).optional(),
  callbackUrl: z.string().max(512).optional(),
});

export async function POST(request: NextRequest) {
  // Browsers send Origin on POST; refuse other sites even though the JSON body already needs CORS.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "NO_TERMINAL" }, { status: 403 });

  if (!(await isTrustedTerminal())) return NextResponse.json({ error: "NO_TERMINAL" }, { status: 403 });

  const loungeId = await getPrimaryLoungeId();
  if (!loungeId) return NextResponse.json({ error: "NO_TERMINAL" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const { userId, pin } = parsed.data;
  const locale = isLocale(parsed.data.locale) ? parsed.data.locale : "ar";

  const result = await checkStaffPin({ loungeId, userId, pin });
  if (!result.ok) {
    if (result.reason === "LOCKED") {
      return NextResponse.json(
        { error: "LOCKED", retryAfter: result.retryAfter },
        { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
      );
    }
    return NextResponse.json({ error: "INVALID_PIN", attemptsLeft: result.attemptsLeft }, { status: 401 });
  }

  // Back to the page that asked for sign-in (a POS, dashboard or printout page), else the branch's POS.
  const requested = posCallback(locale, parsed.data.callbackUrl);
  const redirectTo = requested === localePath(locale, "/pos") ? localePath(locale, `/pos/${loungeId}`) : requested;
  try {
    const url = await signIn("pos-pin", { ticket: signPinTicket(result.userId, authSecret), redirect: false, redirectTo });
    if (new URL(url, request.nextUrl.origin).searchParams.has("error")) throw new Error(`PIN sign-in refused: ${url}`);
  } catch (error) {
    console.error("POS PIN sign-in failed", error);
    const status = error instanceof AuthError ? 401 : 500;
    return NextResponse.json({ error: status === 401 ? "INVALID_PIN" : "SERVER" }, { status });
  }
  return NextResponse.json({ redirectTo });
}
