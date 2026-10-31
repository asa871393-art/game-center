"use server";

import { cookies } from "next/headers";
import { authSecret } from "@/lib/env";
import { matchesTerminalCode, TERMINAL_COOKIE, TERMINAL_MAX_AGE_SECONDS, terminalToken } from "@/lib/terminal";
import { terminalCode } from "@/server/terminal";

export type EnrollTerminalState = { error: "WRONG_CODE" } | null;

/** Slows down guessing the branch code from one browser. */
const WRONG_CODE_DELAY_MS = 1500;

/** "Register this device": checks the branch code and remembers this browser as a terminal. */
export async function enrollTerminalAction(_prev: EnrollTerminalState, formData: FormData): Promise<EnrollTerminalState> {
  const code = terminalCode();
  if (!code) return null;
  if (!matchesTerminalCode(formData.get("code"), code, authSecret)) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_CODE_DELAY_MS));
    return { error: "WRONG_CODE" };
  }
  const store = await cookies();
  store.set(TERMINAL_COOKIE, terminalToken(code, authSecret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TERMINAL_MAX_AGE_SECONDS,
  });
  return null;
}
