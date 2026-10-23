import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Full-page card for a lounge board that can't be shown (missing lounge, data layer down). */
export function LoungeFallback({
  icon: Icon,
  tone = "muted",
  title,
  hint,
  actions,
}: {
  icon: LucideIcon;
  tone?: "muted" | "destructive";
  title: string;
  hint: string;
  actions: { href: string; label: string; primary?: boolean }[];
}) {
  return (
    <Card className="mx-auto mt-10 w-full max-w-md text-center">
      <CardHeader className="items-center justify-items-center gap-3">
        <span
          className={cn(
            "grid size-14 place-items-center rounded-2xl",
            tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-7" aria-hidden />
        </span>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap justify-center gap-2">
        {actions.map((a) => (
          <Link key={a.href} href={a.href} className={buttonVariants({ variant: a.primary ? "default" : "outline" })}>
            {a.label}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
