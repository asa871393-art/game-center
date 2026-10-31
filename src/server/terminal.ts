import "server-only";
import { cookies } from "next/headers";
import { authSecret, env } from "@/lib/env";
import { isTerminalToken, normalizeTerminalCode, TERMINAL_COOKIE } from "@/lib/terminal";

/** The branch code, or null when terminals don't need one (any browser may show the keypad). */
export function terminalCode(): string | null {
  return env.POS_TERMINAL_CODE ? normalizeTerminalCode(env.POS_TERMINAL_CODE) : null;
}

/** Whether this browser may see the staff list and sign in by PIN. */
export async function isTrustedTerminal(): Promise<boolean> {
  const code = terminalCode();
  if (!code) return true;
  const store = await cookies();
  return isTerminalToken(store.get(TERMINAL_COOKIE)?.value, code, authSecret);
}
