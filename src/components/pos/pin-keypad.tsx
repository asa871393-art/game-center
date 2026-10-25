"use client";

import { ArrowLeft, ArrowRight, Delete, Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "@/lib/pin";
import { cn } from "@/lib/utils";
import type { PinStaffMember } from "@/server/services/pos-pin";

type Status = { kind: "idle" } | { kind: "wrong"; attemptsLeft: number } | { kind: "locked"; until: number } | { kind: "error" };

/** "0:45", "12:00", "3:05:00": how long a PIN lock still lasts. */
function formatWait(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * The sign-in keypad: pick your name, type your PIN on the keypad (or a keyboard). Posts to
 * /api/auth/pos-pin, which checks the PIN and its lockout and sets the session.
 */
export function PinKeypad({ staff, callbackUrl }: { staff: PinStaffMember[]; callbackUrl: string }) {
  const { dict, locale, dir, t } = useI18n();
  const p = dict.posLock;
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(staff.length === 1 ? staff[0].userId : null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const selected = staff.find((s) => s.userId === userId) ?? null;
  const lockedFor = status.kind === "locked" ? Math.max(0, Math.ceil((status.until - now) / 1000)) : 0;
  const blocked = busy || lockedFor > 0;
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  useEffect(() => {
    if (status.kind !== "locked") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [status.kind]);

  const submit = async (value: string) => {
    if (!selected || blocked || value.length < PIN_MIN_LENGTH) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/pos-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selected.userId, pin: value, locale, callbackUrl }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirectTo?: string; attemptsLeft?: number; retryAfter?: number };
      if (res.ok && body.redirectTo) {
        // Full navigation so the new session cookie is used everywhere.
        window.location.assign(body.redirectTo);
        return;
      }
      setPin("");
      if (res.status === 429) {
        setNow(Date.now());
        setStatus({ kind: "locked", until: Date.now() + (body.retryAfter ?? 60) * 1000 });
      } else if (res.status === 401) setStatus({ kind: "wrong", attemptsLeft: body.attemptsLeft ?? 0 });
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
    if (!selected) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") setPin((v) => v.slice(0, -1));
    else if (e.key === "Enter") void submit(pin);
    else if (e.key === "Escape") setPin("");
  };

  useEffect(() => {
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  });

  if (!selected) {
    return (
      <div className="space-y-3">
        <p className="text-center text-sm text-muted-foreground">{p.chooseStaff}</p>
        <ul className="grid grid-cols-2 gap-2">
          {staff.map((s) => (
            <li key={s.userId}>
              <button
                type="button"
                onClick={() => {
                  setUserId(s.userId);
                  setPin("");
                  setStatus({ kind: "idle" });
                }}
                className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-2xl border bg-muted/30 px-2 text-center hover:bg-muted active:scale-[0.98]"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
                  {s.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="w-full truncate text-sm font-semibold">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const message =
    lockedFor > 0
      ? t(p.locked, { time: formatWait(lockedFor) })
      : status.kind === "wrong"
        ? t(p.wrongPin, { count: status.attemptsLeft })
        : status.kind === "error"
          ? p.error
          : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {staff.length > 1 && (
          <Button variant="ghost" size="icon-lg" onClick={() => setUserId(null)} title={p.switchStaff} disabled={busy}>
            <Back aria-hidden />
            <span className="sr-only">{p.switchStaff}</span>
          </Button>
        )}
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate font-semibold">{t(p.hello, { name: selected.name })}</div>
          <div className="text-sm text-muted-foreground">{p.enterPin}</div>
        </div>
        {staff.length > 1 && <span className="size-10" aria-hidden />}
      </div>

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
