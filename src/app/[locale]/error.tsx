"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";

/** Localized fallback for unexpected errors below the root layout. */
export default function LocaleError({ error, retry }: { error: unknown; retry: () => void }) {
  const { dict, href } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-7" aria-hidden />
      </span>
      <h1 className="text-xl font-bold">{dict.errors.pageTitle}</h1>
      <p className="text-muted-foreground">{dict.errors.pageBody}</p>
      {digest && (
        <p dir="ltr" className="font-mono text-xs text-muted-foreground">
          {digest}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw aria-hidden /> {dict.common.retry}
        </Button>
        <Link href={href("/")} className={buttonVariants({ variant: "outline" })}>
          {dict.nav.home}
        </Link>
      </div>
    </main>
  );
}
