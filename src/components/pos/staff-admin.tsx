"use client";

import { ArrowLeft, ArrowRight, Copy, Loader2, Mail, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import type { LoungeMemberRole } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { grantStaffAction, revokeStaffAction } from "@/server/actions/staff";
import type { LoungeStaffRow } from "@/server/services/staff-access";

const roleTone: Record<LoungeMemberRole, string> = {
  OWNER: "bg-violet-500/20 text-violet-200",
  MANAGER: "bg-sky-500/20 text-sky-200",
  STAFF: "bg-emerald-500/20 text-emerald-200",
};

export interface StaffAdminData {
  lounge: { id: string; name: string };
  members: LoungeStaffRow[];
  viewer: { userId: string; role: LoungeMemberRole };
  /** Absolute cashier sign-in URL for this lounge, to send to new cashiers. */
  loginUrl: string;
}

export function StaffAdmin({ data }: { data: StaffAdminData }) {
  const { dict, href, dir, locale, t } = useI18n();
  const s = dict.staffAdmin;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"STAFF" | "MANAGER">("STAFF");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const isOwner = data.viewer.role === "OWNER";
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const grant = () =>
    startTransition(async () => {
      const address = email.trim().toLowerCase();
      const res = await grantStaffAction({ locale, loungeId: data.lounge.id, email: address, role });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t(s.added, { email: address }));
      setEmail("");
    });

  const revoke = (m: LoungeStaffRow) => {
    if (!window.confirm(t(s.confirmRemove, { email: m.email ?? m.name ?? "" }))) return;
    setBusyId(m.memberId);
    startTransition(async () => {
      const res = await revokeStaffAction({ locale, loungeId: data.lounge.id, memberId: m.memberId });
      setBusyId(null);
      if (!res.ok) toast.error(res.error);
      else toast.success(s.removed);
    });
  };

  const canRemove = (m: LoungeStaffRow) =>
    m.userId !== data.viewer.userId && m.role !== "OWNER" && (m.role === "STAFF" || isOwner);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={href(`/pos/${data.lounge.id}`)} className={buttonVariants({ variant: "ghost", size: "icon-lg" })} title={dict.devices.backToPos}>
          <Back aria-hidden />
          <span className="sr-only">{dict.devices.backToPos}</span>
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{s.title}</h1>
          <p className="text-sm text-muted-foreground">{data.lounge.name}</p>
        </div>
      </header>

      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">{s.hint}</p>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (validEmail && !pending) grant();
          }}
        >
          <label className="flex-1">
            <span className="sr-only">{s.email}</span>
            <Input
              type="email"
              inputMode="email"
              dir="ltr"
              autoComplete="off"
              className="h-12 text-base"
              placeholder={s.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {isOwner && (
            <div role="radiogroup" aria-label={s.role} className="flex rounded-xl border p-1">
              {(["STAFF", "MANAGER"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "rounded-lg px-3 text-sm font-medium",
                    role === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {s.roles[r]}
                </button>
              ))}
            </div>
          )}
          <Button type="submit" size="lg" className="h-12" disabled={!validEmail || pending}>
            {pending && !busyId ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
            {s.add}
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-2 text-sm">
          <span className="font-medium">{s.loginLink}:</span>
          <code dir="ltr" className="min-w-0 flex-1 truncate text-xs">
            {data.loginUrl}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(data.loginUrl).then(() => toast.success(s.copied), () => {})}
          >
            <Copy aria-hidden /> {s.copy}
          </Button>
          <p className="w-full text-xs text-muted-foreground">{s.loginLinkHint}</p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">{t(s.members, { count: data.members.length })}</h2>
        <ul className="space-y-2">
          {data.members.map((m) => (
            <li key={m.memberId} className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  <span className="truncate">{m.name ?? m.email}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", roleTone[m.role])}>{s.roles[m.role]}</span>
                  {m.userId === data.viewer.userId && <span className="text-xs text-muted-foreground">({s.you})</span>}
                </div>
                {m.name && (
                  <div dir="ltr" className="truncate text-start text-sm text-muted-foreground">
                    {m.email}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  <Tag icon={<Mail className="size-3" aria-hidden />} tone={m.googleLinked ? "ok" : "wait"}>
                    {m.googleLinked ? s.google : s.pendingGoogle}
                  </Tag>
                  {!m.accountActive && <Tag tone="bad">{s.disabled}</Tag>}
                </div>
              </div>
              {canRemove(m) && (
                <Button variant="ghost" className="h-11 text-destructive" disabled={pending} onClick={() => revoke(m)}>
                  {busyId === m.memberId ? <Loader2 className="animate-spin" aria-hidden /> : <UserMinus aria-hidden />}
                  {s.remove}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tag({ children, icon, tone }: { children: React.ReactNode; icon?: React.ReactNode; tone?: "ok" | "wait" | "bad" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        tone === "ok" && "border-emerald-500/40 text-emerald-300",
        tone === "wait" && "border-amber-500/40 text-amber-300",
        tone === "bad" && "border-rose-500/40 text-rose-300",
        !tone && "text-muted-foreground",
      )}
    >
      {icon}
      {children}
    </span>
  );
}
