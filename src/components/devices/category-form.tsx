"use client";

import { Loader2, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DEVICE_TYPES, deviceTypeMeta } from "@/components/lounge/device-type";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DeviceType } from "@/lib/db/types";
import { useI18n } from "@/i18n/client";
import type { Minor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createCategoryAction, updateCategoryAction } from "@/server/actions/devices";
import type { AdminCategory } from "@/server/queries/devices";
import { MoneyInput } from "./money-input";

const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60];

interface FormState {
  name: string;
  type: DeviceType;
  description: string;
  baseRate: Minor | null;
  multiRate: Minor | null;
  vipRate: Minor | null;
  capacity: number;
  minBookingMinutes: number;
  slotIntervalMinutes: number;
  isActive: boolean;
}

function initial(category: AdminCategory | null): FormState {
  return category
    ? {
        name: category.name,
        type: category.type,
        description: category.description ?? "",
        baseRate: category.baseRate,
        multiRate: category.multiRate,
        vipRate: category.vipRate,
        capacity: category.capacity,
        minBookingMinutes: category.minBookingMinutes,
        slotIntervalMinutes: category.slotIntervalMinutes,
        isActive: category.isActive,
      }
    : {
        name: "",
        type: "PC",
        description: "",
        baseRate: null,
        multiRate: null,
        vipRate: null,
        capacity: 1,
        minBookingMinutes: 60,
        slotIntervalMinutes: 30,
        isActive: true,
      };
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  loungeId,
  category,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  loungeId: string;
  category: AdminCategory | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94dvh] flex-col sm:max-w-xl">
        {open && <CategoryForm key={category?.id ?? "new"} loungeId={loungeId} category={category} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({ loungeId, category, onDone }: { loungeId: string; category: AdminCategory | null; onDone: () => void }) {
  const { dict, locale, t } = useI18n();
  const d = dict.devices;
  const [form, setForm] = useState<FormState>(() => initial(category));
  const [pending, start] = useTransition();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    if (form.baseRate === null) return;
    const payload = {
      name: form.name,
      type: form.type,
      description: form.description || null,
      baseRate: form.baseRate,
      multiRate: form.multiRate,
      vipRate: form.vipRate,
      capacity: form.capacity,
      minBookingMinutes: form.minBookingMinutes,
      slotIntervalMinutes: form.slotIntervalMinutes,
      isActive: form.isActive,
    };
    start(async () => {
      const res = category
        ? await updateCategoryAction({ locale, loungeId, categoryId: category.id, category: payload })
        : await createCategoryAction({ locale, loungeId, category: payload });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t(d.categorySaved, { name: form.name }));
      onDone();
    });
  };

  const stepper = (key: "capacity" | "minBookingMinutes", step: number, min: number, max: number) => (
    <div className="flex items-center gap-2">
      <Button size="icon-lg" variant="outline" onClick={() => set(key, Math.max(min, form[key] - step))} aria-label="−">
        −
      </Button>
      <span className="w-14 text-center text-lg font-bold tabular-nums">{form[key]}</span>
      <Button size="icon-lg" variant="outline" onClick={() => set(key, Math.min(max, form[key] + step))} aria-label="+">
        +
      </Button>
    </div>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{category ? t(d.editCategoryTitle, { name: category.name }) : d.addCategoryTitle}</DialogTitle>
        <DialogDescription>{d.categoryHint}</DialogDescription>
      </DialogHeader>

      <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1 pb-1">
        <div className="space-y-1.5">
          <Label htmlFor="cat-name">{d.name}</Label>
          <Input
            id="cat-name"
            className="h-11"
            value={form.name}
            maxLength={40}
            placeholder="PS5 Pro"
            onChange={(e) => set("name", e.target.value)}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label>{d.type}</Label>
          <div className="grid grid-cols-3 gap-2">
            {DEVICE_TYPES.map((type) => {
              const { icon: Icon, color } = deviceTypeMeta[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => set("type", type)}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-xs font-semibold transition",
                    form.type === type ? "border-primary bg-primary/15" : "border-border",
                  )}
                >
                  <Icon className="size-5" style={{ color }} aria-hidden />
                  {dict.deviceType[type]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 rounded-xl border p-3">
          <div className="font-semibold">{d.defaultRates}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-single">{d.rate.single}</Label>
              <MoneyInput id="cat-single" nullable value={form.baseRate} onChange={(v) => set("baseRate", v)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-multi">
                {d.rate.multi} ({dict.common.optional})
              </Label>
              <MoneyInput id="cat-multi" nullable value={form.multiRate} onChange={(v) => set("multiRate", v)} placeholder="—" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-vip">
                {d.rate.vip} ({dict.common.optional})
              </Label>
              <MoneyInput id="cat-vip" nullable value={form.vipRate} onChange={(v) => set("vipRate", v)} placeholder="—" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{d.tierRatesHint}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{d.capacity}</Label>
            {stepper("capacity", 1, 1, 50)}
          </div>
          <div className="space-y-1.5">
            <Label>{d.minBooking}</Label>
            {stepper("minBookingMinutes", 15, 15, 720)}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{d.slotInterval}</Label>
          <div className="flex flex-wrap gap-2">
            {SLOT_INTERVALS.map((m) => (
              <Button key={m} variant={form.slotIntervalMinutes === m ? "default" : "outline"} onClick={() => set("slotIntervalMinutes", m)}>
                {t(dict.common.minutes, { count: m })}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cat-desc">
            {d.description} ({dict.common.optional})
          </Label>
          <Textarea id="cat-desc" value={form.description} maxLength={300} onChange={(e) => set("description", e.target.value)} />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--primary)]"
            checked={form.isActive}
            onChange={(e) => set("isActive", e.target.checked)}
          />
          {d.categoryActive}
        </label>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2 border-t pt-3">
        <Button size="lg" variant="outline" className="h-12" onClick={onDone} disabled={pending}>
          {dict.common.cancel}
        </Button>
        <Button size="lg" className="h-12 text-base" onClick={submit} disabled={pending || !form.name.trim() || form.baseRate === null}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {category ? d.save : d.addCategory}
        </Button>
      </div>
    </>
  );
}
