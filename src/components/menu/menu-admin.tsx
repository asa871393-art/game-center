"use client";

import { ArchiveRestore, ArrowLeft, ArrowRight, Boxes, Loader2, Minus, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MenuThumb } from "@/components/canteen/menu-icons";
import { useDebouncedRefresh, useLiveEvents } from "@/hooks/use-live-events";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MenuItemCategory } from "@/generated/prisma/enums";
import { useI18n } from "@/i18n/client";
import { formatDate, localName, money } from "@/i18n/format";
import { cn } from "@/lib/utils";
import {
  adjustMenuStockAction,
  createMenuCategoryAction,
  deleteMenuCategoryAction,
  removeMenuItemAction,
  restoreMenuItemAction,
  setMenuItemAvailabilityAction,
  updateMenuCategoryAction,
} from "@/server/actions/menu";
import type { AdminMenuCategory, AdminMenuItem, MenuAdminData, StockState } from "@/server/queries/menu";
import { ItemFormDialog } from "./item-form";

const KINDS: MenuItemCategory[] = ["DRINK", "SNACK", "MEAL", "DESSERT", "HOOKAH", "OTHER"];

const stockTone: Record<StockState, string> = {
  UNLIMITED: "bg-sky-500/15 text-sky-200",
  IN_STOCK: "bg-emerald-500/15 text-emerald-200",
  LOW: "bg-amber-500/20 text-amber-200",
  OUT: "bg-rose-500/20 text-rose-200",
};

type Filter = "ALL" | "LOW" | string;

export function MenuAdmin({ data }: { data: MenuAdminData }) {
  const { dict, href, dir, locale } = useI18n();
  const m = dict.menuAdmin;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [editing, setEditing] = useState<{ item: AdminMenuItem | null; categoryId?: string } | null>(null);
  const [categoryEditing, setCategoryEditing] = useState<AdminMenuCategory | null | "new">(null);
  const [stockItem, setStockItem] = useState<AdminMenuItem | null>(null);
  const [removing, setRemoving] = useState<AdminMenuItem | null>(null);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  // Sales on the POS change stock; keep the numbers live.
  const refresh = useDebouncedRefresh(500);
  useLiveEvents<{ table: string }>(`/api/manage/${data.lounge.id}/events`, {
    onChange: (e) => (e.table === "MenuItem" || e.table === "MenuCategory") && refresh(),
    onResync: refresh,
  });

  const q = query.trim().toLowerCase();
  const matches = (i: AdminMenuItem) =>
    (!q || i.name.toLowerCase().includes(q) || i.nameEn?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q)) &&
    (filter === "ALL" || (filter === "LOW" ? i.stockState === "LOW" || i.stockState === "OUT" : i.menuCategoryId === filter));
  const visible = data.items.filter(matches);
  const lowCount = data.items.filter((i) => i.stockState === "LOW" || i.stockState === "OUT").length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={href(`/pos/${data.lounge.id}`)} className={buttonVariants({ variant: "ghost", size: "icon-lg" })} title={dict.devices.backToPos}>
          <Back aria-hidden />
          <span className="sr-only">{dict.devices.backToPos}</span>
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{m.title}</h1>
          <p className="text-sm text-muted-foreground">{data.lounge.name}</p>
        </div>
        <div className="ms-auto flex gap-2">
          <Link href={href(`/pos/${data.lounge.id}/devices`)} className={buttonVariants({ variant: "ghost", size: "lg", className: "h-12" })}>
            {dict.devices.title}
          </Link>
          <Button size="lg" variant="secondary" className="h-12" onClick={() => setCategoryEditing("new")}>
            <Plus aria-hidden /> {m.addCategory}
          </Button>
          <Button size="lg" className="h-12" onClick={() => setEditing({ item: null })} disabled={data.categories.length === 0}>
            <Plus aria-hidden /> {m.add}
          </Button>
        </div>
      </header>

      <Tabs defaultValue="items" className="gap-4">
        <TabsList>
          <TabsTrigger value="items">
            {m.tabs.items} <Badge variant="secondary">{data.items.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="categories">
            {m.tabs.categories} <Badge variant="secondary">{data.categories.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="archived">
            {m.tabs.archived} {data.archived.length > 0 && <Badge variant="secondary">{data.archived.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              className="h-12 ps-10 text-base"
              placeholder={m.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={m.search}
            />
          </div>
          <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={m.category}>
            <Chip active={filter === "ALL"} onClick={() => setFilter("ALL")} label={m.all} count={data.items.length} />
            {data.categories.map((c) => (
              <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)} label={localName(locale, c)} count={c.itemCount} />
            ))}
            <Chip active={filter === "LOW"} onClick={() => setFilter("LOW")} label={m.lowOrOut} count={lowCount} warn={lowCount > 0} />
          </nav>

          {visible.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
              {data.categories.length === 0 ? m.noCategories : m.noResults}
            </p>
          ) : (
            data.categories.map((c) => {
              const items = visible.filter((i) => i.menuCategoryId === c.id);
              if (items.length === 0) return null;
              return (
                <section key={c.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{localName(locale, c)}</h2>
                    <span className="text-sm text-muted-foreground">· {dict.menuCategory[c.kind]}</span>
                    <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setEditing({ item: null, categoryId: c.id })}>
                      <Plus aria-hidden /> {dict.devices.addToCategory}
                    </Button>
                  </div>
                  <ul className="grid gap-2 md:grid-cols-2">
                    {items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        data={data}
                        onEdit={() => setEditing({ item })}
                        onStock={() => setStockItem(item)}
                        onRemove={() => setRemoving(item)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="categories">
          {data.categories.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">{m.noCategories}</p>
          ) : (
            <ul className="divide-y rounded-2xl border bg-card">
              {data.categories.map((c) => (
                <CategoryRow key={c.id} category={c} loungeId={data.lounge.id} onEdit={() => setCategoryEditing(c)} />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="archived">
          <ArchivedList data={data} />
        </TabsContent>
      </Tabs>

      <ItemFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        data={data}
        item={editing?.item ?? null}
        defaultCategoryId={editing?.categoryId}
      />
      <CategoryDialog
        category={categoryEditing}
        loungeId={data.lounge.id}
        nextSort={data.categories.length}
        onClose={() => setCategoryEditing(null)}
      />
      <StockDialog item={stockItem} loungeId={data.lounge.id} onClose={() => setStockItem(null)} />
      <RemoveDialog item={removing} loungeId={data.lounge.id} onClose={() => setRemoving(null)} />
    </div>
  );
}

function Chip({ active, onClick, label, count, warn }: { active: boolean; onClick: () => void; label: string; count: number; warn?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/60",
        warn && !active && "border-amber-400/60",
      )}
    >
      {label}
      <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-primary-foreground/20" : "bg-muted")}>{count}</span>
    </button>
  );
}

function ItemRow({
  item,
  data,
  onEdit,
  onStock,
  onRemove,
}: {
  item: AdminMenuItem;
  data: MenuAdminData;
  onEdit: () => void;
  onStock: () => void;
  onRemove: () => void;
}) {
  const { dict, locale, t } = useI18n();
  const m = dict.menuAdmin;
  const [pending, start] = useTransition();
  const cur = data.lounge.currency;

  const toggle = () =>
    start(async () => {
      const res = await setMenuItemAvailabilityAction({ locale, loungeId: data.lounge.id, itemId: item.id, isAvailable: !item.isAvailable });
      if (!res.ok) toast.error(res.error);
    });

  return (
    <li className={cn("flex gap-3 rounded-2xl border bg-card p-3", !item.isAvailable && "opacity-70")}>
      <MenuThumb imageUrl={item.imageUrl} iconName={item.iconName} kind={item.kind} className="size-14" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-bold">{item.name}</div>
            {item.nameEn && (
              <div dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                {item.nameEn}
              </div>
            )}
          </div>
          <div className="text-end">
            <div className="text-lg font-bold tabular-nums">{money(locale, item.price, cur)}</div>
            {item.costPrice !== null && (
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {m.cost}: {money(locale, item.costPrice, cur)}
                {item.marginPct !== null && ` · ${item.marginPct}%`}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge className={cn("border-0", stockTone[item.stockState])}>
            {item.stockState === "UNLIMITED" ? m.state.UNLIMITED : `${m.state[item.stockState]} · ${item.stock}`}
          </Badge>
          {!item.isAvailable && <Badge variant="outline">{m.unavailable}</Badge>}
          {item.sold30d > 0 && <span className="text-[11px] text-muted-foreground">{t(m.sold, { count: item.sold30d, days: data.salesWindowDays })}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <Button
            size="sm"
            variant={item.isAvailable ? "outline" : "default"}
            className="h-9"
            onClick={toggle}
            disabled={pending}
            aria-pressed={item.isAvailable}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {item.isAvailable ? m.markUnavailable : m.markAvailable}
          </Button>
          {item.stock !== null && (
            <Button size="sm" variant="outline" className="h-9" onClick={onStock}>
              <Boxes aria-hidden /> {m.adjustStock}
            </Button>
          )}
          <div className="ms-auto flex gap-1">
            <Button size="icon-lg" variant="ghost" onClick={onEdit} aria-label={dict.devices.edit} title={dict.devices.edit}>
              <Pencil />
            </Button>
            <Button
              size="icon-lg"
              variant="ghost"
              className="text-destructive"
              onClick={onRemove}
              aria-label={dict.devices.remove}
              title={dict.devices.remove}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

function StockDialog({ item, loungeId, onClose }: { item: AdminMenuItem | null; loungeId: string; onClose: () => void }) {
  const { dict, locale, t } = useI18n();
  const m = dict.menuAdmin;
  const [delta, setDelta] = useState(0);
  const [pending, start] = useTransition();
  const close = () => {
    setDelta(0);
    onClose();
  };
  const apply = () =>
    item &&
    start(async () => {
      const res = await adjustMenuStockAction({ locale, loungeId, itemId: item.id, delta });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t(m.stockUpdated, { name: item.name, count: res.data.stock ?? 0 }));
      close();
    });

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>{t(m.adjustTitle, { name: item.name })}</DialogTitle>
              <DialogDescription>{m.adjustHint}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center gap-3">
              <Button size="icon-lg" variant="outline" className="size-14" onClick={() => setDelta((d) => d - 1)} aria-label="−">
                <Minus />
              </Button>
              <div className="w-28 text-center">
                <div className={cn("text-4xl font-bold tabular-nums", delta > 0 ? "text-emerald-300" : delta < 0 ? "text-rose-300" : "")}>
                  {delta > 0 ? `+${delta}` : delta}
                </div>
                <div className="text-sm text-muted-foreground tabular-nums">
                  {item.stock} → {Math.max(0, (item.stock ?? 0) + delta)}
                </div>
              </div>
              <Button size="icon-lg" variant="outline" className="size-14" onClick={() => setDelta((d) => d + 1)} aria-label="+">
                <Plus />
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[6, 12, 24, 48].map((n) => (
                <Button key={n} variant="secondary" className="h-11" onClick={() => setDelta((d) => d + n)}>
                  +{n}
                </Button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={pending}>
                {dict.common.cancel}
              </Button>
              <Button onClick={apply} disabled={pending || delta === 0 || (item.stock ?? 0) + delta < 0}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                {dict.devices.save}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ item, loungeId, onClose }: { item: AdminMenuItem | null; loungeId: string; onClose: () => void }) {
  const { dict, locale, t } = useI18n();
  const m = dict.menuAdmin;
  const [pending, start] = useTransition();
  const confirm = () =>
    item &&
    start(async () => {
      const res = await removeMenuItemAction({ locale, loungeId, itemId: item.id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t(res.data.result === "ARCHIVED" ? m.archived : m.deleted, { name: item.name }));
      onClose();
    });

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>{t(m.removeTitle, { name: item.name })}</DialogTitle>
              <DialogDescription>{item.hasHistory ? m.removeArchiveHint : m.removeDeleteHint}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                {dict.common.cancel}
              </Button>
              <Button variant="destructive" onClick={confirm} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                {item.hasHistory ? m.archive : dict.devices.deleteForever}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({ category: c, loungeId, onEdit }: { category: AdminMenuCategory; loungeId: string; onEdit: () => void }) {
  const { dict, locale, t } = useI18n();
  const m = dict.menuAdmin;
  const [pending, start] = useTransition();
  const remove = () => {
    if (!window.confirm(t(dict.devices.confirmDeleteCategory, { name: c.name }))) return;
    start(async () => {
      const res = await deleteMenuCategoryAction({ locale, loungeId, categoryId: c.id });
      if (!res.ok) toast.error(res.error);
      else toast.success(t(m.deleted, { name: c.name }));
    });
  };
  return (
    <li className="flex items-center justify-between gap-3 p-3">
      <div>
        <div className="font-semibold">
          {c.name}
          {c.nameEn && (
            <span dir="ltr" className="ms-2 text-sm font-normal text-muted-foreground">
              {c.nameEn}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {dict.menuCategory[c.kind]} · {t(m.itemCount, { count: c.itemCount })} · {t(m.order, { n: c.sortOrder + 1 })}
        </div>
      </div>
      <div className="flex gap-1">
        <Button size="icon-lg" variant="ghost" onClick={onEdit} aria-label={dict.devices.edit} title={dict.devices.edit}>
          <Pencil />
        </Button>
        <Button
          size="icon-lg"
          variant="ghost"
          className="text-destructive"
          onClick={remove}
          disabled={pending || c.totalCount > 0}
          aria-label={dict.devices.remove}
          title={c.totalCount > 0 ? m.categoryInUse : dict.devices.remove}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
      </div>
    </li>
  );
}

function CategoryDialog({
  category,
  loungeId,
  nextSort,
  onClose,
}: {
  category: AdminMenuCategory | null | "new";
  loungeId: string;
  nextSort: number;
  onClose: () => void;
}) {
  return (
    <Dialog open={category !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {category !== null && (
          <CategoryForm
            key={category === "new" ? "new" : category.id}
            category={category === "new" ? null : category}
            loungeId={loungeId}
            nextSort={nextSort}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  category,
  loungeId,
  nextSort,
  onDone,
}: {
  category: AdminMenuCategory | null;
  loungeId: string;
  nextSort: number;
  onDone: () => void;
}) {
  const { dict, locale, t } = useI18n();
  const m = dict.menuAdmin;
  const [name, setName] = useState(category?.name ?? "");
  const [nameEn, setNameEn] = useState(category?.nameEn ?? "");
  const [kind, setKind] = useState<MenuItemCategory>(category?.kind ?? "DRINK");
  const [order, setOrder] = useState(String((category?.sortOrder ?? nextSort) + 1));
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const payload = { name, nameEn: nameEn || null, kind, sortOrder: Math.max(0, (Number(order) || 1) - 1) };
      const res = category
        ? await updateMenuCategoryAction({ locale, loungeId, categoryId: category.id, category: payload })
        : await createMenuCategoryAction({ locale, loungeId, category: payload });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t(m.categorySaved, { name }));
      onDone();
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{category ? t(m.editCategoryTitle, { name: category.name }) : m.addCategory}</DialogTitle>
        <DialogDescription>{m.categoryHint}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="mc-name">{m.nameAr}</Label>
          <Input id="mc-name" dir="rtl" className="h-11" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mc-name-en">
            {m.nameEn} ({dict.common.optional})
          </Label>
          <Input id="mc-name-en" dir="ltr" className="h-11" value={nameEn} maxLength={40} onChange={(e) => setNameEn(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{m.kind}</Label>
            <Select
              items={KINDS.map((k) => ({ value: k, label: dict.menuCategory[k] }))}
              value={kind}
              onValueChange={(v) => v && setKind(v as MenuItemCategory)}
            >
              <SelectTrigger className="h-11 w-full">
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mc-order">{m.position}</Label>
            <Input
              id="mc-order"
              inputMode="numeric"
              dir="ltr"
              className="h-11 text-center tabular-nums"
              value={order}
              onChange={(e) => setOrder(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          {dict.common.cancel}
        </Button>
        <Button onClick={save} disabled={pending || !name.trim()}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {dict.devices.save}
        </Button>
      </DialogFooter>
    </>
  );
}

function ArchivedList({ data }: { data: MenuAdminData }) {
  const { dict, locale, t } = useI18n();
  const m = dict.menuAdmin;
  const [pending, start] = useTransition();
  if (data.archived.length === 0) {
    return <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">{m.noArchived}</p>;
  }
  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {data.archived.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-3">
            <MenuThumb kind={a.kind} />
            <div>
              <div className="font-medium">{localName(locale, a)}</div>
              <div className="text-xs text-muted-foreground">
                {money(locale, a.price, data.lounge.currency)} · {t(dict.devices.archivedOn, { date: formatDate(locale, a.archivedAt, "UTC") })}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await restoreMenuItemAction({ locale, loungeId: data.lounge.id, itemId: a.id });
                if (!res.ok) toast.error(res.error);
                else toast.success(t(m.restored, { name: a.name }));
              })
            }
          >
            <ArchiveRestore aria-hidden /> {dict.devices.restore}
          </Button>
        </li>
      ))}
    </ul>
  );
}
