"use client";

import { ArrowLeft, ArrowRight, Loader2, Pencil, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/client";
import type { LoungeMemberRole } from "@/lib/db/types";
import { canManageMember } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import { addStaffAction, revokeStaffAction, updateStaffAction } from "@/server/actions/staff";
import type { LoungeStaffRow } from "@/server/services/staff-access";

export interface StaffManagerData {
  lounge: { id: string; name: string };
  members: LoungeStaffRow[];
  viewer: { userId: string; role: LoungeMemberRole };
}

type GrantRole = "STAFF" | "MANAGER";
type Dialogs = { kind: "add" } | { kind: "edit"; member: LoungeStaffRow } | null;

const roleTone: Record<LoungeMemberRole, string> = {
  OWNER: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  MANAGER: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  STAFF: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const PHONE = /^\+?[\d\s()-]{6,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const label = (m: LoungeStaffRow) => m.name ?? m.email ?? "";

/** Dashboard staff screen: the lounge's team with role and shift status, and the add/edit/unassign actions. */
export function StaffManager({ data }: { data: StaffManagerData }) {
  const { dict, href, dir, locale, t } = useI18n();
  const s = dict.staffManage;
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const isOwner = data.viewer.role === "OWNER";
  const base = { locale, loungeId: data.lounge.id };

  const canEdit = (m: LoungeStaffRow) => m.accountActive && canManageMember(data.viewer.role, m.role, m.userId === data.viewer.userId);
  const canUnassign = (m: LoungeStaffRow) =>
    m.userId !== data.viewer.userId && m.role !== "OWNER" && (m.role === "STAFF" || isOwner);

  const unassign = (m: LoungeStaffRow) => {
    if (!window.confirm(t(s.confirmUnassign, { name: label(m) }))) return;
    setBusyId(m.memberId);
    startTransition(async () => {
      const res = await revokeStaffAction({ ...base, memberId: m.memberId });
      setBusyId(null);
      if (!res.ok) toast.error(res.error);
      else toast.success(s.unassigned);
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={href(`/manage/${data.lounge.id}`)} className={buttonVariants({ variant: "ghost", size: "icon" })} title={s.backToDashboard}>
          <Back aria-hidden />
          <span className="sr-only">{s.backToDashboard}</span>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{s.title}</h1>
          <p className="text-sm text-muted-foreground">
            {data.lounge.name} · {t(s.count, { count: data.members.length })}
          </p>
        </div>
        <Button size="lg" onClick={() => setDialog({ kind: "add" })}>
          <UserPlus aria-hidden />
          {s.add}
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">{s.subtitle}</p>

      <div className="rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{s.member}</TableHead>
              <TableHead>{s.role}</TableHead>
              <TableHead>{s.shift}</TableHead>
              <TableHead className="text-end">{s.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((m) => (
              <TableRow key={m.memberId}>
                <TableCell className="max-w-64">
                  <div className="truncate font-medium">
                    {label(m)}
                    {m.userId === data.viewer.userId && <span className="ms-1 text-xs text-muted-foreground">({s.you})</span>}
                  </div>
                  {m.name && (
                    <div dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                      {m.email}
                    </div>
                  )}
                  {m.phone && (
                    <div dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                      {m.phone}
                    </div>
                  )}
                  {!m.accountActive && (
                    <Badge variant="destructive" className="mt-1">
                      {s.disabled}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", roleTone[m.role])}>{s.roles[m.role]}</span>
                </TableCell>
                <TableCell>
                  {m.onShift ? (
                    <Badge className="bg-emerald-600 text-white">{s.onShift}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">{s.offShift}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {canEdit(m) && (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog({ kind: "edit", member: m })}>
                        <Pencil aria-hidden />
                        {s.edit}
                      </Button>
                    )}
                    {canUnassign(m) && (
                      <Button variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => unassign(m)}>
                        {busyId === m.memberId ? <Loader2 className="animate-spin" aria-hidden /> : <UserMinus aria-hidden />}
                        {s.unassign}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          {dialog?.kind === "add" && <AddForm loungeId={data.lounge.id} isOwner={isOwner} onDone={() => setDialog(null)} />}
          {dialog?.kind === "edit" && (
            <EditForm
              loungeId={data.lounge.id}
              member={dialog.member}
              // Owners change roles, except their own and other owners'.
              canChangeRole={isOwner && dialog.member.role !== "OWNER" && dialog.member.userId !== data.viewer.userId}
              onDone={() => setDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddForm({ loungeId, isOwner, onDone }: { loungeId: string; isOwner: boolean; onDone: () => void }) {
  const { dict, locale, t } = useI18n();
  const s = dict.staffManage;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<GrantRole>("STAFF");
  const [pending, startTransition] = useTransition();
  const valid = name.trim().length > 0 && EMAIL.test(email.trim()) && (!phone.trim() || PHONE.test(phone.trim()));

  const submit = () =>
    startTransition(async () => {
      const res = await addStaffAction({
        locale,
        loungeId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        role,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t(s.added, { name: name.trim() }));
      onDone();
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !pending) submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{s.add}</DialogTitle>
        <DialogDescription>{s.addHint}</DialogDescription>
      </DialogHeader>
      <Field id="staff-name" label={s.fullName}>
        <Input id="staff-name" required maxLength={80} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="staff-email" label={s.email}>
        <Input
          id="staff-email"
          type="email"
          inputMode="email"
          dir="ltr"
          required
          maxLength={254}
          autoComplete="off"
          placeholder="cashier@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field id="staff-phone" label={`${s.phone} (${s.optional})`}>
        <Input id="staff-phone" type="tel" inputMode="tel" dir="ltr" maxLength={32} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <RolePicker value={role} onChange={setRole} managerAllowed={isOwner} />
      <DialogFooter>
        <Button type="submit" disabled={!valid || pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
          {s.add}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditForm({
  loungeId,
  member,
  canChangeRole,
  onDone,
}: {
  loungeId: string;
  member: LoungeStaffRow;
  canChangeRole: boolean;
  onDone: () => void;
}) {
  const { dict, locale, t } = useI18n();
  const s = dict.staffManage;
  const [name, setName] = useState(member.name ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [role, setRole] = useState<GrantRole>(member.role === "MANAGER" ? "MANAGER" : "STAFF");
  const [pending, startTransition] = useTransition();
  const valid = name.trim().length > 0 && (!phone.trim() || PHONE.test(phone.trim()));

  const submit = () =>
    startTransition(async () => {
      const res = await updateStaffAction({
        locale,
        loungeId,
        memberId: member.memberId,
        name: name.trim(),
        phone: phone.trim() || null,
        // An owner's role isn't editable; send the current one so it is left alone.
        role: canChangeRole ? role : member.role === "MANAGER" ? "MANAGER" : "STAFF",
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(s.updated);
      onDone();
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !pending) submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(s.editTitle, { name: label(member) })}</DialogTitle>
        <DialogDescription dir="ltr" className="text-start">
          {member.email}
        </DialogDescription>
      </DialogHeader>
      <Field id="edit-name" label={s.fullName}>
        <Input id="edit-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="edit-phone" label={`${s.phone} (${s.optional})`}>
        <Input id="edit-phone" type="tel" inputMode="tel" dir="ltr" maxLength={32} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {canChangeRole && <RolePicker value={role} onChange={setRole} managerAllowed />}
      <DialogFooter>
        <Button type="submit" disabled={!valid || pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {s.save}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function RolePicker({ value, onChange, managerAllowed }: { value: GrantRole; onChange: (r: GrantRole) => void; managerAllowed: boolean }) {
  const { dict } = useI18n();
  const s = dict.staffManage;
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{s.role}</span>
      <div role="radiogroup" aria-label={s.role} className="grid grid-cols-2 gap-2">
        {(["STAFF", "MANAGER"] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            disabled={r === "MANAGER" && !managerAllowed}
            onClick={() => onChange(r)}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-40",
              value === r ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {s.roles[r]}
          </button>
        ))}
      </div>
      {!managerAllowed && <p className="text-xs text-muted-foreground">{s.managerOwnerOnly}</p>}
    </div>
  );
}
