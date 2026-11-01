"use client";

import { ArrowLeft, ArrowRight, Copy, Grid3x3, Loader2, Pencil, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EditForm } from "@/components/manage/staff-manager";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import type { LoungeMemberRole } from "@/lib/db/types";
import { PIN_MAX_LENGTH, PIN_PATTERN } from "@/lib/pin";
import { canManageMember } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import { grantStaffAction, revokeStaffAction, setStaffPinAction } from "@/server/actions/staff";
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
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState<LoungeStaffRow | null>(null);
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

  const savePin = (m: LoungeStaffRow, value: string | null) => {
    if (value === null && !window.confirm(t(s.confirmRemovePin, { name: m.name ?? m.email ?? "" }))) return;
    setBusyId(m.memberId);
    startTransition(async () => {
      const res = await setStaffPinAction({ locale, loungeId: data.lounge.id, memberId: m.memberId, pin: value });
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(value === null ? s.pinRemoved : s.pinSaved);
      setPinFor(null);
      setPin("");
    });
  };

  const canPin = (m: LoungeStaffRow) => m.accountActive && canManageMember(data.viewer.role, m.role, m.userId === data.viewer.userId);

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
                {m.phone && (
                  <div dir="ltr" className="truncate text-start text-sm text-muted-foreground">
                    {m.phone}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  <Tag icon={<Grid3x3 className="size-3" aria-hidden />} tone={m.hasPin ? "ok" : "wait"}>
                    {m.hasPin ? s.pinSet : s.pinMissing}
                  </Tag>
                  {!m.accountActive && <Tag tone="bad">{s.disabled}</Tag>}
                </div>
              </div>
              {canPin(m) && pinFor !== m.memberId && (
                <div className="flex gap-1">
                  <Button variant="outline" className="h-11" disabled={pending} onClick={() => setEditing(m)}>
                    <Pencil aria-hidden />
                    {dict.staffManage.edit}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11"
                    disabled={pending}
                    onClick={() => {
                      setPinFor(m.memberId);
                      setPin("");
                    }}
                  >
                    <Grid3x3 aria-hidden />
                    {m.hasPin ? s.changePin : s.setPin}
                  </Button>
                  {m.hasPin && (
                    <Button variant="ghost" className="h-11 text-muted-foreground" disabled={pending} onClick={() => savePin(m, null)}>
                      {s.removePin}
                    </Button>
                  )}
                </div>
              )}
              {canRemove(m) && (
                <Button variant="ghost" className="h-11 text-destructive" disabled={pending} onClick={() => revoke(m)}>
                  {busyId === m.memberId ? <Loader2 className="animate-spin" aria-hidden /> : <UserMinus aria-hidden />}
                  {s.remove}
                </Button>
              )}
              {pinFor === m.memberId && (
                <form
                  className="flex w-full flex-wrap items-center gap-2 border-t pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (PIN_PATTERN.test(pin) && !pending) savePin(m, pin);
                  }}
                >
                  <label className="flex-1">
                    <span className="mb-1 block text-sm font-medium">{t(s.newPin, { name: m.name ?? m.email ?? "" })}</span>
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      dir="ltr"
                      autoFocus
                      maxLength={PIN_MAX_LENGTH}
                      className="h-12 text-center font-mono text-xl tracking-[0.5em]"
                      placeholder={s.pinPlaceholder}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX_LENGTH))}
                    />
                  </label>
                  <Button type="submit" size="lg" className="h-12 self-end" disabled={!PIN_PATTERN.test(pin) || pending}>
                    {busyId === m.memberId ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    {s.savePin}
                  </Button>
                  <Button type="button" size="lg" variant="ghost" className="h-12 self-end" onClick={() => setPinFor(null)}>
                    {s.cancel}
                  </Button>
                  <p className="w-full text-xs text-muted-foreground">{s.pinHint}</p>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <EditForm
              loungeId={data.lounge.id}
              member={editing}
              // Owners change roles, except their own and other owners'.
              canChangeRole={isOwner && editing.role !== "OWNER" && editing.userId !== data.viewer.userId}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
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
