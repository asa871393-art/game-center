"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { enrollTerminalAction, type EnrollTerminalState } from "@/server/actions/terminal";

/** Shown instead of the keypad on a browser that hasn't entered the branch code yet. */
export function TerminalEnroll() {
  const { dict } = useI18n();
  const t = dict.posTerminal;
  const router = useRouter();
  const [state, action, pending] = useActionState<EnrollTerminalState, FormData>(enrollTerminalAction, null);
  const submitted = useRef(false);

  useEffect(() => {
    // A successful enrolment returns null: reload the page so the keypad shows.
    if (submitted.current && !pending && state === null) router.refresh();
  }, [pending, state, router]);

  return (
    <form
      action={(formData) => {
        submitted.current = true;
        return action(formData);
      }}
      className="space-y-4"
    >
      <div className="space-y-1 text-center">
        <KeyRound className="mx-auto size-6 text-primary" aria-hidden />
        <p className="font-semibold">{t.title}</p>
        <p className="text-sm text-muted-foreground">{t.description}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="terminal-code">{t.code}</Label>
        <Input
          id="terminal-code"
          name="code"
          type="password"
          autoComplete="off"
          required
          maxLength={128}
          aria-invalid={state?.error === "WRONG_CODE"}
        />
        {state?.error === "WRONG_CODE" && (
          <p className="text-sm text-destructive" role="alert">
            {t.wrong}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {t.submit}
      </Button>
    </form>
  );
}
