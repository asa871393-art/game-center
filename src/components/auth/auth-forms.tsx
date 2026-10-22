"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import {
  registerWithCredentials,
  signInWithCredentials,
  signInWithGoogle,
  type AuthFormState,
} from "@/server/actions/auth";

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  ...input
}: React.ComponentProps<typeof Input> & { id: string; label: string; error?: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-invalid={!!error} aria-describedby={`${id}-help`} className="h-10" {...input} />
      {(error || hint) && (
        <p id={`${id}-help`} className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function SignInForm({ callbackUrl, initialError }: { callbackUrl: string; initialError?: string }) {
  const { dict, locale } = useI18n();
  const [state, action] = useActionState<AuthFormState, FormData>(signInWithCredentials, { error: initialError });

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <FormError message={state.error} />
      <Field
        id="email"
        type="email"
        label={dict.auth.email}
        autoComplete="email"
        dir="ltr"
        required
        defaultValue={state.values?.email}
      />
      <Field id="password" type="password" label={dict.auth.password} autoComplete="current-password" dir="ltr" required />
      <SubmitButton>{dict.auth.submitSignIn}</SubmitButton>
    </form>
  );
}

export function SignUpForm({ callbackUrl }: { callbackUrl: string }) {
  const { dict, locale } = useI18n();
  const [state, action] = useActionState<AuthFormState, FormData>(registerWithCredentials, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <FormError message={state.error} />
      <Field
        id="name"
        label={dict.auth.name}
        autoComplete="name"
        required
        defaultValue={state.values?.name}
        error={state.fieldErrors?.name}
      />
      <Field
        id="email"
        type="email"
        label={dict.auth.email}
        autoComplete="email"
        dir="ltr"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <Field
        id="password"
        type="password"
        label={dict.auth.password}
        autoComplete="new-password"
        dir="ltr"
        minLength={8}
        required
        hint={dict.auth.passwordHint}
        error={state.fieldErrors?.password}
      />
      <SubmitButton>{dict.auth.submitSignUp}</SubmitButton>
    </form>
  );
}

export function GoogleSignInButton({
  callbackUrl,
  className,
  label,
  size,
}: {
  callbackUrl: string;
  className?: string;
  label?: string;
  size?: "lg" | "xl";
}) {
  const { dict, locale } = useI18n();
  return (
    <form action={signInWithGoogle} className={className}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <GoogleSubmit label={label ?? dict.auth.continueWithGoogle} pendingLabel={dict.auth.redirectingToGoogle} size={size} />
    </form>
  );
}

/** Shown when no Google keys are configured, so the missing setup is obvious. */
export function GoogleSignInUnavailable({ label, note, size }: { label?: string; note?: string; size?: "lg" | "xl" }) {
  const { dict } = useI18n();
  return (
    <div className="space-y-2">
      <GoogleButtonFace label={label ?? dict.auth.continueWithGoogle} disabled size={size} />
      <p className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
        {note ?? dict.auth.googleNotConfigured}
      </p>
    </div>
  );
}

function GoogleSubmit({ label, pendingLabel, size }: { label: string; pendingLabel: string; size?: "lg" | "xl" }) {
  const { pending } = useFormStatus();
  return <GoogleButtonFace type="submit" label={pending ? pendingLabel : label} pending={pending} disabled={pending} size={size} />;
}

/** Google-branded button: white face, official "G" mark. */
function GoogleButtonFace({
  label,
  pending = false,
  disabled,
  type = "button",
  size = "lg",
}: {
  label: string;
  pending?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  /** "xl" is the touchscreen size used on the cashier sign-in. */
  size?: "lg" | "xl";
}) {
  return (
    <Button
      type={type}
      size="lg"
      disabled={disabled}
      aria-busy={pending}
      className={cn(
        "w-full gap-3 border border-zinc-300 bg-white font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-70 dark:border-zinc-600",
        size === "xl" ? "h-16 rounded-2xl text-lg [&_svg]:size-6" : "h-12 text-base",
      )}
    >
      {pending ? (
        <Loader2 className="size-5 animate-spin" aria-hidden />
      ) : (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
          <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
        </svg>
      )}
      {label}
    </Button>
  );
}
