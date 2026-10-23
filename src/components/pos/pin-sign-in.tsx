import { MonitorSmartphone } from "lucide-react";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { format } from "@/i18n/format";
import type { TerminalLounge } from "@/server/services/pos-pin";
import { PinKeypad } from "./pin-keypad";

/**
 * The quick PIN panel of the sign-in pages: this terminal's staff and keypad, or, on a browser
 * that isn't a cashier terminal, how to make it one (PIN sign-in only works on terminals).
 */
export function PinSignIn({ terminal, callbackUrl, dict }: { terminal: TerminalLounge | null; callbackUrl: string; dict: Dictionary }) {
  const l = dict.posLock;
  if (!terminal) {
    return (
      <div className="space-y-2 rounded-2xl bg-muted/40 p-4 text-center">
        <MonitorSmartphone className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <p className="font-semibold">{l.notTerminalTitle}</p>
        <p className="text-sm text-muted-foreground">{l.notTerminal}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-center text-sm font-medium text-primary">{format(l.terminalOf, { name: terminal.name })}</p>
      {terminal.staff.length > 0 ? (
        <PinKeypad staff={terminal.staff} callbackUrl={callbackUrl} />
      ) : (
        <p className="rounded-2xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">{l.noStaff}</p>
      )}
      <p className="text-center text-xs text-muted-foreground">{l.shiftKept}</p>
    </div>
  );
}
