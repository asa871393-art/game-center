import type { Dictionary } from "@/i18n/dictionaries/ar";
import type { PinLounge } from "@/server/services/pos-pin";
import { PinKeypad } from "./pin-keypad";

/** The sign-in panel: the PIN keypad, or why nobody can sign in yet. */
export function PinSignIn({ lounge, callbackUrl, dict }: { lounge: PinLounge | null; callbackUrl: string; dict: Dictionary }) {
  const l = dict.posLock;
  if (!lounge?.staffCount) {
    return <p className="rounded-2xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">{l.noStaff}</p>;
  }
  return (
    <div className="space-y-3">
      <PinKeypad callbackUrl={callbackUrl} />
      <p className="text-center text-xs text-muted-foreground">{l.shiftKept}</p>
    </div>
  );
}
