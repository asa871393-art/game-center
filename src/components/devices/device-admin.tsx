"use client";

import {
  AlertTriangle,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Cpu,
  Loader2,
  Network,
  Pencil,
  Plus,
  Power,
  Trash2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deviceTypeMeta } from "@/components/devices/device-type";
import { posStatusTone } from "@/components/manage/pos-ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/client";
import { formatDate, money } from "@/i18n/format";
import { cn } from "@/lib/utils";
import {
  deleteCategoryAction,
  removeDeviceAction,
  restoreDeviceAction,
  setDeviceStatusFromAdminAction,
} from "@/server/actions/devices";
import type { AdminCategory, AdminDevice, DeviceAdminData } from "@/server/queries/devices";
import { CategoryFormDialog } from "./category-form";
import { DeviceFormDialog } from "./device-form";

type Editing = { kind: "device"; device: AdminDevice | null; categoryId?: string } | { kind: "category"; category: AdminCategory | null } | null;

export function DeviceAdmin({ data }: { data: DeviceAdminData }) {
  const { dict, href, dir } = useI18n();
  const d = dict.devices;
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<AdminDevice | null>(null);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={href(`/pos/${data.lounge.id}`)} className={buttonVariants({ variant: "ghost", size: "icon-lg" })} title={d.backToPos}>
          <Back aria-hidden />
          <span className="sr-only">{d.backToPos}</span>
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{d.title}</h1>
          <p className="text-sm text-muted-foreground">{data.lounge.name}</p>
        </div>
        <div className="ms-auto flex gap-2">
          <Link href={href(`/pos/${data.lounge.id}/menu`)} className={buttonVariants({ variant: "ghost", size: "lg", className: "h-12" })}>
            {dict.menuAdmin.title}
          </Link>
          <Button size="lg" variant="secondary" className="h-12" onClick={() => setEditing({ kind: "category", category: null })}>
            <Plus aria-hidden /> {d.addCategory}
          </Button>
          <Button
            size="lg"
            className="h-12"
            onClick={() => setEditing({ kind: "device", device: null })}
            disabled={data.categories.length === 0}
          >
            <Plus aria-hidden /> {d.add}
          </Button>
        </div>
      </header>

      <Tabs defaultValue="devices" className="gap-4">
        <TabsList>
          <TabsTrigger value="devices">
            {d.tabs.devices} <Badge variant="secondary">{data.devices.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="categories">
            {d.tabs.categories} <Badge variant="secondary">{data.categories.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="archived">
            {d.tabs.archived} {data.archived.length > 0 && <Badge variant="secondary">{data.archived.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="space-y-6">
          {data.categories.length === 0 && (
            <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">{d.noCategories}</p>
          )}
          {data.categories.map((c) => {
            const devices = data.devices.filter((x) => x.categoryId === c.id);
            const { icon: Icon, color } = deviceTypeMeta[c.type];
            return (
              <section key={c.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Icon className="size-5" style={{ color }} aria-hidden />
                  <h2 className="text-lg font-semibold">{c.name}</h2>
                  <span className="text-sm text-muted-foreground">· {dict.deviceType[c.type]}</span>
                  {!c.isActive && <Badge variant="outline">{d.inactive}</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ms-auto"
                    onClick={() => setEditing({ kind: "device", device: null, categoryId: c.id })}
                  >
                    <Plus aria-hidden /> {d.addToCategory}
                  </Button>
                </div>
                {devices.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{d.emptyCategory}</p>
                ) : (
                  <ul className="grid gap-2 md:grid-cols-2">
                    {devices.map((device) => (
                      <DeviceRow
                        key={device.id}
                        device={device}
                        data={data}
                        onEdit={() => setEditing({ kind: "device", device })}
                        onRemove={() => setRemoving(device)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </TabsContent>

        <TabsContent value="categories">
          <ul className="grid gap-3 md:grid-cols-2">
            {data.categories.map((c) => (
              <CategoryRow key={c.id} category={c} data={data} onEdit={() => setEditing({ kind: "category", category: c })} />
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="archived">
          <ArchivedList data={data} />
        </TabsContent>
      </Tabs>

      <DeviceFormDialog
        open={editing?.kind === "device"}
        onOpenChange={(o) => !o && setEditing(null)}
        data={data}
        device={editing?.kind === "device" ? editing.device : null}
        defaultCategoryId={editing?.kind === "device" ? editing.categoryId : undefined}
      />
      <CategoryFormDialog
        open={editing?.kind === "category"}
        onOpenChange={(o) => !o && setEditing(null)}
        loungeId={data.lounge.id}
        category={editing?.kind === "category" ? editing.category : null}
      />
      <RemoveDialog device={removing} loungeId={data.lounge.id} onClose={() => setRemoving(null)} />
    </div>
  );
}

function RateLine({ data, device }: { data: DeviceAdminData; device: AdminDevice }) {
  const { dict, locale } = useI18n();
  const cur = data.lounge.currency;
  const parts: [string, number | null][] = [
    [dict.pos.tier.SINGLE, device.rates.single],
    [dict.pos.tier.MULTI, device.rates.multi],
    [dict.pos.tier.VIP, device.rates.vip],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {parts
        .filter(([, v]) => v !== null)
        .map(([label, v]) => (
          <span key={label}>
            <span className="text-muted-foreground">{label}:</span>{" "}
            <span className="font-semibold tabular-nums">
              {money(locale, v!, cur)}
              {dict.common.perHour}
            </span>
          </span>
        ))}
    </div>
  );
}

function DeviceRow({
  device,
  data,
  onEdit,
  onRemove,
}: {
  device: AdminDevice;
  data: DeviceAdminData;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { dict, locale, t } = useI18n();
  const d = dict.devices;
  const [pending, start] = useTransition();
  const zone = data.zones.find((z) => z.id === device.zoneId);
  const ownRate = device.overrides.hourlyRate !== null || device.overrides.multiRate !== null || device.overrides.vipRate !== null;

  const setStatus = (status: "IDLE" | "MAINTENANCE" | "OFFLINE") =>
    start(async () => {
      const res = await setDeviceStatusFromAdminAction({ locale, loungeId: data.lounge.id, deviceId: device.id, status });
      if (!res.ok) toast.error(res.error);
      else toast.success(dict.manage.deviceAdmin.updated);
    });

  return (
    <li className="flex flex-col gap-2 rounded-2xl border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">{device.name}</span>
            <span dir="ltr" className="font-mono text-xs text-muted-foreground">
              {device.code}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 pt-0.5">
            <Badge className={cn("border-0", posStatusTone[device.status])}>{dict.deviceStatus[device.status]}</Badge>
            {ownRate && <Badge variant="outline">{d.ownRateBadge}</Badge>}
            {zone && <Badge variant="secondary">{zone.name}</Badge>}
            {device.usage.upcoming > 0 && (
              <Badge className="border-0 bg-amber-500/15 text-amber-200">{t(d.upcomingCount, { count: device.usage.upcoming })}</Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon-lg" variant="ghost" onClick={onEdit} aria-label={d.edit} title={d.edit} disabled={pending}>
            <Pencil />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-lg" variant="ghost" aria-label={d.changeStatus} title={d.changeStatus} disabled={pending} />}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Power />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setStatus("IDLE")} disabled={device.status !== "MAINTENANCE" && device.status !== "OFFLINE"}>
                <Power /> {d.statusOption.ACTIVE}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatus("MAINTENANCE")} disabled={device.usage.active || device.status === "MAINTENANCE"}>
                <Wrench /> {d.statusOption.MAINTENANCE}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatus("OFFLINE")} disabled={device.usage.active || device.status === "OFFLINE"}>
                <AlertTriangle /> {d.statusOption.OFFLINE}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="icon-lg"
            variant="ghost"
            className="text-destructive"
            onClick={onRemove}
            aria-label={d.remove}
            title={d.remove}
            disabled={pending}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <RateLine data={data} device={device} />
      {(device.specs || device.ipAddress || device.macAddress) && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {device.specs && (
            <div className="flex items-center gap-1.5">
              <Cpu className="size-3.5 shrink-0" aria-hidden /> {device.specs}
            </div>
          )}
          {(device.ipAddress || device.macAddress) && (
            <div dir="ltr" className="flex items-center gap-1.5 font-mono">
              <Network className="size-3.5 shrink-0" aria-hidden />
              {[device.ipAddress, device.macAddress].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function RemoveDialog({ device, loungeId, onClose }: { device: AdminDevice | null; loungeId: string; onClose: () => void }) {
  const { dict, locale, t } = useI18n();
  const d = dict.devices;
  const [pending, start] = useTransition();
  const blocked = device ? device.usage.active || device.usage.upcoming > 0 : false;

  const confirm = () =>
    device &&
    start(async () => {
      const res = await removeDeviceAction({ locale, loungeId, deviceId: device.id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t(res.data.result === "ARCHIVED" ? d.archived : d.deleted, { name: device.name }));
      onClose();
    });

  return (
    <Dialog open={!!device} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {device && (
          <>
            <DialogHeader>
              <DialogTitle>{t(d.removeTitle, { name: device.name })}</DialogTitle>
              <DialogDescription>
                {device.usage.hasHistory ? d.removeArchiveHint : d.removeDeleteHint}
              </DialogDescription>
            </DialogHeader>
            {device.usage.active && (
              <p className="flex items-start gap-2 rounded-xl border border-rose-500/50 bg-rose-500/10 p-3 text-sm text-rose-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {d.activeSessionBlock}
              </p>
            )}
            {device.usage.upcoming > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 text-sm text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t(d.upcomingBlock, { count: device.usage.upcoming })}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                {dict.common.cancel}
              </Button>
              <Button variant="destructive" onClick={confirm} disabled={pending || blocked}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                {device.usage.hasHistory ? d.archive : d.deleteForever}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({ category: c, data, onEdit }: { category: AdminCategory; data: DeviceAdminData; onEdit: () => void }) {
  const { dict, locale, t } = useI18n();
  const d = dict.devices;
  const [pending, start] = useTransition();
  const { icon: Icon, color } = deviceTypeMeta[c.type];
  const cur = data.lounge.currency;
  const rate = (v: number | null) => (v === null ? "—" : `${money(locale, v, cur)}${dict.common.perHour}`);

  const remove = () => {
    if (!window.confirm(t(d.confirmDeleteCategory, { name: c.name }))) return;
    start(async () => {
      const res = await deleteCategoryAction({ locale, loungeId: data.lounge.id, categoryId: c.id });
      if (!res.ok) toast.error(res.error);
      else toast.success(t(d.deleted, { name: c.name }));
    });
  };

  return (
    <li className="space-y-2 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-6" style={{ color }} aria-hidden />
          <div>
            <div className="font-semibold">
              {c.name} {!c.isActive && <Badge variant="outline">{d.inactive}</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {dict.deviceType[c.type]} · {t(d.deviceCount, { count: c.deviceCount })}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="icon-lg" variant="ghost" onClick={onEdit} aria-label={d.edit} title={d.edit}>
            <Pencil />
          </Button>
          <Button
            size="icon-lg"
            variant="ghost"
            className="text-destructive"
            onClick={remove}
            disabled={pending || c.deviceCount > 0}
            aria-label={d.remove}
            title={c.deviceCount > 0 ? d.categoryInUseHint : d.remove}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-xs">
        {(
          [
            [dict.pos.tier.SINGLE, rate(c.baseRate)],
            [dict.pos.tier.MULTI, rate(c.multiRate)],
            [dict.pos.tier.VIP, rate(c.vipRate)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg bg-muted/50 p-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="text-xs text-muted-foreground">
        {t(d.categoryFacts, { capacity: c.capacity, min: c.minBookingMinutes, slot: c.slotIntervalMinutes })}
      </div>
    </li>
  );
}

function ArchivedList({ data }: { data: DeviceAdminData }) {
  const { dict, locale, t } = useI18n();
  const d = dict.devices;
  const [pending, start] = useTransition();
  if (data.archived.length === 0) {
    return <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">{d.noArchived}</p>;
  }
  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {data.archived.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 p-3">
          <div>
            <div className="font-medium">
              {a.name}{" "}
              <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                {a.code}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {a.categoryName} · {t(d.archivedOn, { date: formatDate(locale, a.archivedAt, "UTC") })}
            </div>
          </div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await restoreDeviceAction({ locale, loungeId: data.lounge.id, deviceId: a.id });
                if (!res.ok) toast.error(res.error);
                else toast.success(t(d.restored, { name: a.name }));
              })
            }
          >
            <ArchiveRestore aria-hidden /> {d.restore}
          </Button>
        </li>
      ))}
    </ul>
  );
}
