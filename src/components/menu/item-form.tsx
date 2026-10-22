"use client";

import { Check, ImageUp, Infinity as InfinityIcon, Loader2, Plus, Save, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { MENU_ICON_NAMES, MENU_ICONS, MenuThumb } from "@/components/canteen/menu-icons";
import { MoneyInput } from "@/components/devices/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MenuItemCategory } from "@/lib/db/types";
import { useI18n } from "@/i18n/client";
import { localName, money } from "@/i18n/format";
import type { Minor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createMenuCategoryAction, createMenuItemAction, updateMenuItemAction, uploadMenuImageAction } from "@/server/actions/menu";
import type { AdminMenuItem, MenuAdminData } from "@/server/queries/menu";

const KINDS: MenuItemCategory[] = ["DRINK", "SNACK", "MEAL", "DESSERT", "HOOKAH", "OTHER"];
const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
/** Mirrors MAX_PRODUCT_IMAGE_BYTES (server-only module). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface FormState {
  name: string;
  nameEn: string;
  description: string;
  menuCategoryId: string;
  price: Minor | null;
  costPrice: Minor | null;
  unlimited: boolean;
  stock: string;
  lowStockAt: string;
  imageUrl: string;
  iconName: string | null;
  sku: string;
  isAvailable: boolean;
}

function initial(data: MenuAdminData, item: AdminMenuItem | null, categoryId?: string): FormState {
  if (!item) {
    return {
      name: "",
      nameEn: "",
      description: "",
      menuCategoryId: categoryId ?? data.categories[0]?.id ?? "",
      price: null,
      costPrice: null,
      unlimited: false,
      stock: "0",
      lowStockAt: "5",
      imageUrl: "",
      iconName: null,
      sku: "",
      isAvailable: true,
    };
  }
  return {
    name: item.name,
    nameEn: item.nameEn ?? "",
    description: item.description ?? "",
    menuCategoryId: item.menuCategoryId,
    price: item.price,
    costPrice: item.costPrice,
    unlimited: item.stock === null,
    stock: String(item.stock ?? 0),
    lowStockAt: String(item.lowStockAt),
    imageUrl: item.imageUrl ?? "",
    iconName: item.iconName,
    sku: item.sku ?? "",
    isAvailable: item.isAvailable,
  };
}

export function ItemFormDialog({
  open,
  onOpenChange,
  data,
  item,
  defaultCategoryId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  data: MenuAdminData;
  item: AdminMenuItem | null;
  defaultCategoryId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94dvh] flex-col sm:max-w-2xl">
        {open && (
          <ItemForm key={item?.id ?? "new"} data={data} item={item} defaultCategoryId={defaultCategoryId} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemForm({
  data,
  item,
  defaultCategoryId,
  onDone,
}: {
  data: MenuAdminData;
  item: AdminMenuItem | null;
  defaultCategoryId?: string;
  onDone: () => void;
}) {
  const { dict, locale, t } = useI18n();
  const m = dict.menuAdmin;
  const [form, setForm] = useState<FormState>(() => initial(data, item, defaultCategoryId));
  const [pending, start] = useTransition();
  const [newCategory, setNewCategory] = useState<{ name: string; nameEn: string; kind: MenuItemCategory } | null>(null);
  // Categories created from this form, before the page data refreshes.
  const [extraCategories, setExtraCategories] = useState<{ id: string; name: string; nameEn: string | null; kind: MenuItemCategory }[]>([]);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const cur = data.lounge.currency;
  const categories = [...data.categories, ...extraCategories.filter((c) => !data.categories.some((d) => d.id === c.id))];
  const category = categories.find((c) => c.id === form.menuCategoryId);
  const imageUrl = form.imageUrl.trim();
  // Matches the server rule; a broken link is only a warning (the POS falls back to the icon).
  const imageInvalid = imageUrl !== "" && !/^https?:\/\/\S+$/i.test(imageUrl);
  const imageOk = imageUrl !== "" && !imageInvalid;
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();

  // Checked again (by content, not name) on the server; this just saves a pointless round trip.
  const upload = (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(m.uploadErrors.TOO_LARGE);
      return;
    }
    const body = new FormData();
    body.set("locale", locale);
    body.set("loungeId", data.lounge.id);
    body.set("file", file);
    startUpload(async () => {
      const res = await uploadMenuImageAction(body);
      if (!res.ok) toast.error(res.error);
      else if ("error" in res.data) toast.error(m.uploadErrors[res.data.error]);
      else {
        set("imageUrl", res.data.url);
        toast.success(m.uploaded);
      }
    });
  };
  const imageBroken = imageOk && brokenUrl === imageUrl;
  const margin =
    form.price !== null && form.costPrice !== null && form.price > 0 ? Math.round(((form.price - form.costPrice) / form.price) * 100) : null;

  const addCategory = () => {
    if (!newCategory?.name.trim()) return;
    start(async () => {
      const res = await createMenuCategoryAction({
        locale,
        loungeId: data.lounge.id,
        category: { name: newCategory.name, nameEn: newCategory.nameEn || null, kind: newCategory.kind },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setExtraCategories((c) => [...c, { id: res.data.id, name: newCategory.name.trim(), nameEn: newCategory.nameEn.trim() || null, kind: newCategory.kind }]);
      set("menuCategoryId", res.data.id);
      setNewCategory(null);
    });
  };

  const submit = () => {
    if (form.price === null) return;
    const payload = {
      name: form.name,
      nameEn: form.nameEn || null,
      description: form.description || null,
      menuCategoryId: form.menuCategoryId,
      price: form.price,
      costPrice: form.costPrice,
      stockQuantity: form.unlimited ? null : Math.max(0, Math.floor(Number(form.stock) || 0)),
      lowStockAt: Math.max(0, Math.floor(Number(form.lowStockAt) || 0)),
      imageUrl: imageUrl || null,
      iconName: form.iconName,
      sku: form.sku || null,
      isAvailable: form.isAvailable,
    };
    start(async () => {
      const res = item
        ? await updateMenuItemAction({ locale, loungeId: data.lounge.id, itemId: item.id, item: payload, expectedStock: item.stock })
        : await createMenuItemAction({ locale, loungeId: data.lounge.id, item: payload });
      if (!res.ok) {
        toast.error(res.code === "STALE" ? m.stockChanged : res.error);
        return;
      }
      toast.success(t(item ? m.saved : m.created, { name: form.name }));
      onDone();
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? t(m.editTitle, { name: item.name }) : m.addTitle}</DialogTitle>
        <DialogDescription>{m.formHint}</DialogDescription>
      </DialogHeader>

      <div className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1 pb-1">
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label={m.nameAr} htmlFor="mi-name">
            <Input id="mi-name" dir="rtl" className="h-11" value={form.name} maxLength={60} onChange={(e) => set("name", e.target.value)} autoFocus />
          </Field>
          <Field label={`${m.nameEn} (${dict.common.optional})`} htmlFor="mi-name-en">
            <Input id="mi-name-en" dir="ltr" className="h-11" value={form.nameEn} maxLength={60} onChange={(e) => set("nameEn", e.target.value)} />
          </Field>
        </section>

        <section className="space-y-2">
          <Label>{m.category}</Label>
          {newCategory ? (
            <div className="grid gap-2 rounded-xl border p-2.5 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                dir="rtl"
                className="h-11"
                placeholder={m.nameAr}
                value={newCategory.name}
                maxLength={40}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                autoFocus
              />
              <Input
                dir="ltr"
                className="h-11"
                placeholder={m.nameEn}
                value={newCategory.nameEn}
                maxLength={40}
                onChange={(e) => setNewCategory({ ...newCategory, nameEn: e.target.value })}
              />
              <Select
                items={KINDS.map((k) => ({ value: k, label: dict.menuCategory[k] }))}
                value={newCategory.kind}
                onValueChange={(v) => v && setNewCategory({ ...newCategory, kind: v as MenuItemCategory })}
              >
                <SelectTrigger className="h-11 w-full sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {dict.menuCategory[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2 sm:col-span-3">
                <Button onClick={addCategory} disabled={pending || !newCategory.name.trim()}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} {m.createCategory}
                </Button>
                <Button variant="ghost" onClick={() => setNewCategory(null)} disabled={pending}>
                  {dict.common.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Select
                items={categories.map((c) => ({ value: c.id, label: localName(locale, c) }))}
                value={form.menuCategoryId}
                onValueChange={(v) => v && set("menuCategoryId", String(v))}
              >
                <SelectTrigger className="h-11 flex-1">
                  <SelectValue placeholder={m.pickCategory} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {localName(locale, c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" className="h-11" onClick={() => setNewCategory({ name: "", nameEn: "", kind: category?.kind ?? "DRINK" })}>
                <Plus aria-hidden /> {m.newCategory}
              </Button>
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-xl border p-3 sm:grid-cols-3">
          <Field label={m.price} htmlFor="mi-price">
            <MoneyInput id="mi-price" nullable value={form.price} onChange={(v) => set("price", v)} className="text-lg font-bold" />
          </Field>
          <Field label={`${m.cost} (${dict.common.optional})`} htmlFor="mi-cost">
            <MoneyInput id="mi-cost" nullable value={form.costPrice} onChange={(v) => set("costPrice", v)} />
          </Field>
          <div className="space-y-1.5">
            <Label>{m.margin}</Label>
            <div
              className={cn(
                "flex h-11 items-center justify-center rounded-lg border text-lg font-bold tabular-nums",
                margin === null ? "text-muted-foreground" : margin < 0 ? "text-rose-300" : "text-emerald-300",
              )}
            >
              {margin === null
                ? "—"
                : `${margin}% · ${money(locale, (form.price ?? 0) - (form.costPrice ?? 0), cur)}`}
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{m.stock}</span>
            <button
              type="button"
              onClick={() => set("unlimited", !form.unlimited)}
              aria-pressed={form.unlimited}
              className={cn(
                "flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition",
                form.unlimited ? "border-primary bg-primary/15" : "border-border",
              )}
            >
              <InfinityIcon className="size-4" aria-hidden /> {m.unlimited}
            </button>
          </div>
          {form.unlimited ? (
            <p className="text-xs text-muted-foreground">{m.unlimitedHint}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label={m.quantity} htmlFor="mi-stock">
                <Input
                  id="mi-stock"
                  inputMode="numeric"
                  dir="ltr"
                  className="h-11 text-center text-lg font-semibold tabular-nums"
                  value={form.stock}
                  onChange={(e) => set("stock", e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label={m.lowStockAt} htmlFor="mi-low">
                <Input
                  id="mi-low"
                  inputMode="numeric"
                  dir="ltr"
                  className="h-11 text-center tabular-nums"
                  value={form.lowStockAt}
                  onChange={(e) => set("lowStockAt", e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <Label>{m.icon}</Label>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
            {MENU_ICON_NAMES.map((name) => {
              const Icon = MENU_ICONS[name];
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => set("iconName", form.iconName === name ? null : name)}
                  aria-label={name}
                  aria-pressed={form.iconName === name}
                  className={cn(
                    "grid h-11 place-items-center rounded-lg border-2 transition",
                    form.iconName === name ? "border-primary bg-primary/15" : "border-border",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <Label htmlFor="mi-image">
            {m.image} <span className="font-normal text-muted-foreground">({dict.common.optional})</span>
          </Label>
          <div className="flex gap-3">
            {/* Live preview, the same square the POS cards use. */}
            <MenuThumb
              imageUrl={imageOk ? imageUrl : null}
              iconName={form.iconName}
              kind={category?.kind ?? "OTHER"}
              onBroken={() => setBrokenUrl(imageUrl)}
              className="size-28 rounded-2xl border"
              iconClassName="size-12"
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex gap-2">
                <Input
                  id="mi-image"
                  dir="ltr"
                  type="url"
                  inputMode="url"
                  className="h-11 flex-1"
                  placeholder="https://…/image.jpg"
                  value={form.imageUrl}
                  maxLength={500}
                  aria-invalid={imageInvalid || imageBroken}
                  onChange={(e) => set("imageUrl", e.target.value)}
                />
                {form.imageUrl && (
                  <Button variant="outline" size="icon" className="size-11" onClick={() => set("imageUrl", "")} aria-label={m.removeImage}>
                    <X />
                  </Button>
                )}
              </div>
              <p className={cn("text-xs", imageInvalid || imageBroken ? "text-destructive" : "text-muted-foreground")}>
                {imageInvalid ? m.imageInvalid : imageBroken ? m.imageBroken : m.imageHint}
              </p>
              {data.imageUploads && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept={UPLOAD_ACCEPT}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) upload(file);
                    }}
                  />
                  <Button variant="secondary" className="h-11" disabled={uploading || pending} onClick={() => fileInput.current?.click()}>
                    {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <ImageUp aria-hidden />}
                    {uploading ? m.uploading : m.uploadImage}
                  </Button>
                  <span className="text-xs text-muted-foreground">{m.uploadHint}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label={`${m.sku} (${dict.common.optional})`} htmlFor="mi-sku">
            <Input id="mi-sku" dir="ltr" className="h-11 font-mono uppercase" value={form.sku} maxLength={30} onChange={(e) => set("sku", e.target.value)} />
          </Field>
          <div className="space-y-1.5">
            <Label>{m.availability}</Label>
            <div className="grid grid-cols-2 gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => set("isAvailable", v)}
                  className={cn(
                    "h-11 rounded-xl border-2 text-sm font-semibold transition",
                    form.isAvailable === v ? (v ? "border-emerald-500 bg-emerald-500/15" : "border-zinc-400 bg-zinc-500/15") : "border-border",
                  )}
                >
                  {v ? m.available : m.unavailable}
                </button>
              ))}
            </div>
          </div>
          <Field label={`${m.description} (${dict.common.optional})`} htmlFor="mi-desc" className="sm:col-span-2">
            <Textarea id="mi-desc" value={form.description} maxLength={300} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </section>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2 border-t pt-3">
        <Button size="lg" variant="outline" className="h-12" onClick={onDone} disabled={pending}>
          {dict.common.cancel}
        </Button>
        <Button
          size="lg"
          className="h-12 text-base"
          onClick={submit}
          disabled={pending || !form.name.trim() || form.price === null || !form.menuCategoryId || !!newCategory || imageInvalid}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {item ? m.save : m.add}
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
