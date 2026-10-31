"use client";

import { ChevronDown, Loader2, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { money } from "@/i18n/format";
import type { Minor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createDeviceAction, updateDeviceAction } from "@/server/actions/devices";
import type { AdminDevice, DeviceAdminData } from "@/server/queries/devices";
import { MoneyInput } from "./money-input";

type FormStatus = "ACTIVE" | "MAINTENANCE" | "OFFLINE";

interface FormState {
  name: string;
  code: string;
  categoryId: string;
  zoneId: string;
  status: FormStatus;
  isBookableOnline: boolean;
  ownRates: boolean;
  hourlyRate: Minor | null;
  multiRate: Minor | null;
  vipRate: Minor | null;
  specs: string;
  ipAddress: string;
  macAddress: string;
  notes: string;
  posX: string;
  posY: string;
  width: string;
  height: string;
}

const NO_ZONE = "__none__";

function initialState(data: DeviceAdminData, device: AdminDevice | null, categoryId?: string): FormState {
  if (!device) {
    return {
      name: "",
      code: "",
      categoryId: categoryId ?? data.categories.find((c) => c.isActive)?.id ?? data.categories[0]?.id ?? "",
      zoneId: NO_ZONE,
      status: "ACTIVE",
      isBookableOnline: true,
      ownRates: false,
      hourlyRate: null,
      multiRate: null,
      vipRate: null,
      specs: "",
      ipAddress: "",
      macAddress: "",
      notes: "",
      posX: "",
      posY: "",
      width: "",
      height: "",
    };
  }
  const o = device.overrides;
  return {
    name: device.name,
    code: device.code,
    categoryId: device.categoryId,
    zoneId: device.zoneId ?? NO_ZONE,
    status: device.status === "MAINTENANCE" || device.status === "OFFLINE" ? device.status : "ACTIVE",
    isBookableOnline: device.isBookableOnline,
    ownRates: o.hourlyRate !== null || o.multiRate !== null || o.vipRate !== null,
    hourlyRate: o.hourlyRate,
    multiRate: o.multiRate,
    vipRate: o.vipRate,
    specs: device.specs ?? "",
    ipAddress: device.ipAddress ?? "",
    macAddress: device.macAddress ?? "",
    notes: device.notes ?? "",
    posX: String(device.posX),
    posY: String(device.posY),
    width: String(device.width),
    height: String(device.height),
  };
}

const intOrUndefined = (v: string) => (v.trim() === "" ? undefined : Math.max(0, Math.floor(Number(v) || 0)));

export function DeviceFormDialog({
  open,
  onOpenChange,
  data,
  device,
  defaultCategoryId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  data: DeviceAdminData;
  device: AdminDevice | null;
  defaultCategoryId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94dvh] flex-col sm:max-w-2xl">
        {open && (
          <DeviceForm
            key={device?.id ?? "new"}
            data={data}
            device={device}
            defaultCategoryId={defaultCategoryId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeviceForm({
  data,
  device,
  defaultCategoryId,
  onDone,
}: {
  data: DeviceAdminData;
  device: AdminDevice | null;
  defaultCategoryId?: string;
  onDone: () => void;
}) {
  const { dict, locale, t } = useI18n();
  const [form, setForm] = useState<FormState>(() => initialState(data, device, defaultCategoryId));
  const [showPlacement, setShowPlacement] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const category = data.categories.find((c) => c.id === form.categoryId);
  const cur = data.lounge.currency;
  const busy = device?.usage.active ?? false;
  const d = dict.devices;

  const submit = () => {
    const payload = {
      name: form.name,
      code: form.code || undefined,
      categoryId: form.categoryId,
      zoneId: form.zoneId === NO_ZONE ? null : form.zoneId,
      status: form.status,
      isBookableOnline: form.isBookableOnline,
      hourlyRate: form.ownRates ? form.hourlyRate : null,
      multiRate: form.ownRates ? form.multiRate : null,
      vipRate: form.ownRates ? form.vipRate : null,
      specs: form.specs || null,
      ipAddress: form.ipAddress || null,
      macAddress: form.macAddress || null,
      notes: form.notes || null,
      posX: intOrUndefined(form.posX),
      posY: intOrUndefined(form.posY),
      width: intOrUndefined(form.width),
      height: intOrUndefined(form.height),
    };
    start(async () => {
      const res = device
        ? await updateDeviceAction({ locale, loungeId: data.lounge.id, deviceId: device.id, device: payload })
        : await createDeviceAction({ locale, loungeId: data.lounge.id, device: payload });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t(device ? d.saved : d.created, { name: form.name }));
      onDone();
    });
  };

  const rateHint = (v: number | null) => (v === null ? d.tierNotOffered : `${money(locale, v, cur)}${dict.common.perHour}`);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{device ? t(d.editTitle, { name: device.name }) : d.addTitle}</DialogTitle>
        <DialogDescription>{d.formHint}</DialogDescription>
      </DialogHeader>

      <div className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1 pb-1">
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label={d.name} htmlFor="dev-name">
            <Input
              id="dev-name"
              className="h-11"
              value={form.name}
              maxLength={40}
              placeholder="PC-11"
              onChange={(e) => set("name", e.target.value)}
              autoFocus
            />
          </Field>
          <Field label={`${d.code} (${dict.common.optional})`} htmlFor="dev-code">
            <Input
              id="dev-code"
              dir="ltr"
              className="h-11 font-mono uppercase"
              value={form.code}
              maxLength={20}
              placeholder={form.name.toUpperCase().replace(/[^A-Z0-9-]/g, "") || "PC11"}
              onChange={(e) => set("code", e.target.value)}
            />
          </Field>
          <Field label={d.category}>
            <Select
              items={data.categories.map((c) => ({ value: c.id, label: c.name }))}
              value={form.categoryId}
              onValueChange={(v) => v && set("categoryId", String(v))}
              disabled={busy}
            >
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {dict.deviceType[c.type]}
                    {!c.isActive && ` (${d.inactive})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={`${d.zone} (${dict.common.optional})`}>
            <Select
              items={[{ value: NO_ZONE, label: d.noZone }, ...data.zones.map((z) => ({ value: z.id, label: z.name }))]}
              value={form.zoneId}
              onValueChange={(v) => v && set("zoneId", String(v))}
            >
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ZONE}>{d.noZone}</SelectItem>
                {data.zones.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </section>

        <section className="space-y-2">
          <Label>{d.status}</Label>
          <div className="grid grid-cols-3 gap-2">
            {(["ACTIVE", "MAINTENANCE", "OFFLINE"] as const).map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy && s !== "ACTIVE"}
                onClick={() => set("status", s)}
                className={cn(
                  "h-12 rounded-xl border-2 text-sm font-semibold transition disabled:opacity-40",
                  form.status === s ? "border-primary bg-primary/15" : "border-border",
                )}
              >
                {d.statusOption[s]}
              </button>
            ))}
          </div>
          {busy && <p className="text-xs text-amber-300">{d.busyHint}</p>}
        </section>

        <section className="space-y-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{d.pricing}</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-[var(--primary)]"
                checked={form.ownRates}
                onChange={(e) => set("ownRates", e.target.checked)}
              />
              {d.ownRates}
            </label>
          </div>
          {category && (
            <p className="text-xs text-muted-foreground">
              {t(d.categoryRates, {
                category: category.name,
                single: rateHint(category.baseRate),
                multi: rateHint(category.multiRate),
                vip: rateHint(category.vipRate),
              })}
            </p>
          )}
          {form.ownRates && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={d.rate.single} htmlFor="rate-single">
                <MoneyInput
                  id="rate-single"
                  nullable
                  value={form.hourlyRate}
                  onChange={(v) => set("hourlyRate", v)}
                  placeholder={category ? String(category.baseRate / 100) : ""}
                />
              </Field>
              <Field label={d.rate.multi} htmlFor="rate-multi">
                <MoneyInput
                  id="rate-multi"
                  nullable
                  value={form.multiRate}
                  onChange={(v) => set("multiRate", v)}
                  placeholder={category?.multiRate !== null && category ? String(category.multiRate / 100) : "—"}
                />
              </Field>
              <Field label={d.rate.vip} htmlFor="rate-vip">
                <MoneyInput
                  id="rate-vip"
                  nullable
                  value={form.vipRate}
                  onChange={(v) => set("vipRate", v)}
                  placeholder={category?.vipRate !== null && category ? String(category.vipRate / 100) : "—"}
                />
              </Field>
              <p className="text-xs text-muted-foreground sm:col-span-3">{d.ratesHint}</p>
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label={`${d.specs} (${dict.common.optional})`} htmlFor="dev-specs" className="sm:col-span-2">
            <Textarea
              id="dev-specs"
              value={form.specs}
              maxLength={300}
              placeholder={d.specsPlaceholder}
              onChange={(e) => set("specs", e.target.value)}
            />
          </Field>
          <Field label={`${d.ip} (${dict.common.optional})`} htmlFor="dev-ip">
            <Input
              id="dev-ip"
              dir="ltr"
              className="h-11 font-mono"
              value={form.ipAddress}
              maxLength={45}
              placeholder="192.168.1.21"
              onChange={(e) => set("ipAddress", e.target.value)}
            />
          </Field>
          <Field label={`${d.mac} (${dict.common.optional})`} htmlFor="dev-mac">
            <Input
              id="dev-mac"
              dir="ltr"
              className="h-11 font-mono uppercase"
              value={form.macAddress}
              maxLength={17}
              placeholder="AA:BB:CC:DD:EE:FF"
              onChange={(e) => set("macAddress", e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">{d.networkHint}</p>
          <Field label={`${d.notes} (${dict.common.optional})`} htmlFor="dev-notes" className="sm:col-span-2">
            <Input id="dev-notes" className="h-11" value={form.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </section>

        <section>
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground"
            onClick={() => setShowPlacement((s) => !s)}
            aria-expanded={showPlacement}
          >
            <ChevronDown className={cn("size-4 transition", showPlacement && "rotate-180")} aria-hidden />
            {d.placement}
          </button>
          {showPlacement && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                {t(d.placementHint, { width: data.lounge.floorPlan.width, height: data.lounge.floorPlan.height })}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {(["posX", "posY", "width", "height"] as const).map((k) => (
                  <Field key={k} label={d.place[k]} htmlFor={`dev-${k}`}>
                    <Input
                      id={`dev-${k}`}
                      inputMode="numeric"
                      dir="ltr"
                      className="h-11 text-center tabular-nums"
                      value={form[k]}
                      placeholder={d.auto}
                      onChange={(e) => set(k, e.target.value.replace(/\D/g, ""))}
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2 border-t pt-3">
        <Button size="lg" variant="outline" className="h-12" onClick={onDone} disabled={pending}>
          {dict.common.cancel}
        </Button>
        <Button size="lg" className="h-12 text-base" onClick={submit} disabled={pending || !form.name.trim() || !form.categoryId}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {device ? d.save : d.add}
        </Button>
      </div>
    </>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
