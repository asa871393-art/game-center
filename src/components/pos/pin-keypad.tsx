"use client";

import { Delete, Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "@/lib/pin";
import { cn } from "@/lib/utils";

type Status = { kind: "idle" } | { kind: "wrong"; attemptsLeft: number } | { kind: "shared" } | { kind: "locked"; until: number } | { kind: "error" };

/** "0:45", "12:00", "3:05:00": how long a PIN lock still lasts. */
function formatWait(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * The sign-in keypad: type your PIN on the keypad (or a keyboard); the PIN alone says who you are.
 * Posts to /api/auth/pos-pin, which finds whose PIN it is, checks the lockout and sets the session.
 */
export function PinKeypad({ callbackUrl }: { callbackUrl: string }) {
  const { dict, locale, t } = useI18n();
  const p = dict.posLock;
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const lockedFor = status.kind === "locked" ? Math.max(0, Math.ceil((status.until - now) / 1000)) : 0;
  const blocked = busy || lockedFor > 0;

  useEffect(() => {
    if (status.kind !== "locked") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [status.kind]);

  const submit = async (value: string) => {
    if (blocked || value.length < PIN_MIN_LENGTH) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/pos-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value, locale, callbackUrl }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; redirectTo?: string; attemptsLeft?: number; retryAfter?: number };
      if (res.ok && body.redirectTo) {
        // Full navigation so the new session cookie is used everywhere.
        window.location.assign(body.redirectTo);
        return;
      }
      setPin("");
      if (res.status === 429) {
        setNow(Date.now());
        setStatus({ kind: "locked", until: Date.now() + (body.retryAfter ?? 60) * 1000 });
      } else if (res.status === 409 && body.error === "SHARED_PIN") setStatus({ kind: "shared" });
      else if (res.status === 401) setStatus({ kind: "wrong", attemptsLeft: body.attemptsLeft ?? 0 });
      else if (res.status === 403) router.refresh();
      else setStatus({ kind: "error" });
    } catch {
      setPin("");
      setStatus({ kind: "error" });
    }
    setBusy(false);
  };

  const press = (digit: string) => {
    if (blocked || pin.length >= PIN_MAX_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (status.kind !== "locked") setStatus({ kind: "idle" });
    if (next.length === PIN_MAX_LENGTH) void submit(next);
  };

  const keyHandler = (e: KeyboardEvent) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") setPin((v) => v.slice(0, -1));
    else if (e.key === "Enter") void submit(pin);
    else if (e.key === "Escape") setPin("");
  };

  useEffect(() => {
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  });

  const message =
    lockedFor > 0
      ? t(p.locked, { time: formatWait(lockedFor) })
      : status.kind === "wrong"
        ? t(p.wrongPin, { count: status.attemptsLeft })
        : status.kind === "shared"
          ? p.sharedPin
          : status.kind === "error"
            ? p.error
            : null;

  return (
    <div className="space-y-4">
      <div className="text-center font-semibold">{p.enterPin}</div>

      <div dir="ltr" className="flex h-8 items-center justify-center gap-3" role="status" aria-label={p.pin}>
        {Array.from({ length: Math.max(PIN_MIN_LENGTH, pin.length) }, (_, i) => (
          <span key={i} className={cn("size-4 rounded-full border-2 border-primary", i < pin.length && "bg-primary")} />
        ))}
      </div>

      <p className={cn("min-h-5 text-center text-sm", lockedFor > 0 || status.kind !== "idle" ? "text-destructive" : "")} aria-live="polite">
        {lockedFor > 0 && <Lock className="me-1 inline size-4" aria-hidden />}
        {message}
      </p>

      <div dir="ltr" className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <KeyButton key={d} onClick={() => press(d)} disabled={blocked}>
            {d}
          </KeyButton>
        ))}
        <KeyButton onClick={() => setPin("")} disabled={blocked || !pin} className="text-base">
          {p.clear}
        </KeyButton>
        <KeyButton onClick={() => press("0")} disabled={blocked}>
          0
        </KeyButton>
        <KeyButton onClick={() => setPin((v) => v.slice(0, -1))} disabled={blocked || !pin} title={p.backspace}>
          <Delete className="size-6" aria-hidden />
          <span className="sr-only">{p.backspace}</span>
        </KeyButton>
      </div>

      <Button size="lg" className="h-14 w-full text-lg" disabled={blocked || pin.length < PIN_MIN_LENGTH} onClick={() => void submit(pin)}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {p.submit}
      </Button>
    </div>
  );
}

function KeyButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-16 items-center justify-center rounded-2xl border bg-muted/30 text-2xl font-semibold tabular-nums hover:bg-muted active:scale-[0.97] disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
