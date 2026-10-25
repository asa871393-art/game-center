import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { signIn } from "@/auth";
import { isLocale, localePath } from "@/i18n/config";
import { authSecret } from "@/lib/env";
import { PIN_PATTERN } from "@/lib/pin";
import { posCallback } from "@/lib/pos-login";
import { POS_TERMINAL_COOKIE, readTerminal, signPinTicket } from "@/lib/pos-terminal";
import { checkStaffPin } from "@/server/services/pos-pin";
import { getPrimaryLoungeId } from "@/server/staff";

/**
 * POS PIN sign-in: { userId, pin, locale?, callbackUrl? } from the keypad on /pos/login.
 * Works only from a registered cashier terminal (signed cookie naming the lounge, which must be
 * the branch's primary lounge), for members of that lounge, and five wrong PINs in a row lock the account's PIN sign-in for a minute.
 *
 * 200 { redirectTo }                   signed in (Auth.js session cookie set)
 * 400 { error: "VALIDATION" }          malformed body
 * 401 { error: "INVALID_PIN", attemptsLeft }
 * 403 { error: "NO_TERMINAL" }         this browser isn't a lounge terminal, or cross-site request
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

  const loungeId = readTerminal((await cookies()).get(POS_TERMINAL_COOKIE)?.value, authSecret);
  if (!loungeId || loungeId !== (await getPrimaryLoungeId())) return NextResponse.json({ error: "NO_TERMINAL" }, { status: 403 });

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

  // Back to the POS page that was locked when it belongs to this terminal's lounge, else its main screen.
  const home = localePath(locale, `/pos/${loungeId}`);
  const requested = posCallback(locale, parsed.data.callbackUrl);
  const redirectTo = requested === home || requested.startsWith(`${home}/`) || requested.startsWith(`${home}?`) ? requested : home;
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
