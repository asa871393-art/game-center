import Link from "next/link";
import type { ReactNode } from "react";
import { GoogleSignInButton, GoogleSignInUnavailable } from "./auth-forms";

/** Shared frame for the sign-in and sign-up pages. */
export function AuthCard({
  title,
  subtitle,
  googleEnabled,
  callbackUrl,
  orLabel,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  googleEnabled: boolean;
  callbackUrl: string;
  orLabel: string;
  footer: { text: string; linkLabel: string; href: string };
  children: ReactNode;
}) {
  return (
    <div className="w-full max-w-sm space-y-6 rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {(googleEnabled || process.env.NODE_ENV === "development") && (
        <>
          {googleEnabled ? <GoogleSignInButton callbackUrl={callbackUrl} /> : <GoogleSignInUnavailable />}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {orLabel}
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      {children}
      <p className="text-center text-sm text-muted-foreground">
        {footer.text}{" "}
        <Link href={footer.href} className="font-medium text-primary hover:underline">
          {footer.linkLabel}
        </Link>
      </p>
    </div>
  );
}
