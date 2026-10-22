"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { DEVICE_TYPES } from "@/components/lounge/device-type";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";

const ALL = "all";

export interface SearchValues {
  q?: string;
  city?: string;
  type?: string;
}

export function SearchForm({
  cities,
  initial = {},
  className,
  inputId,
}: {
  cities: string[];
  initial?: SearchValues;
  className?: string;
  /** id for the text input, so other controls can focus it. */
  inputId?: string;
}) {
  const { dict, href } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(initial.q ?? "");
  const [city, setCity] = useState(initial.city ?? ALL);
  const [type, setType] = useState(initial.type ?? ALL);

  const cityItems = [{ value: ALL, label: dict.search.allCities }, ...cities.map((c) => ({ value: c, label: c }))];
  const typeItems = [
    { value: ALL, label: dict.search.allTypes },
    ...DEVICE_TYPES.map((t) => ({ value: t, label: dict.deviceType[t] })),
  ];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (city !== ALL) params.set("city", city);
    if (type !== ALL) params.set("type", type);
    const qs = params.toString();
    startTransition(() => router.push(href(`/lounges${qs ? `?${qs}` : ""}`)));
  }

  return (
    <form
      onSubmit={onSubmit}
      role="search"
      className={cn(
        "grid w-full gap-2 rounded-2xl border bg-card p-2 shadow-sm sm:grid-cols-[1fr_auto_auto_auto] sm:items-center",
        className,
      )}
    >
      <label className="relative">
        <span className="sr-only">{dict.search.placeholder}</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id={inputId}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={dict.search.placeholder}
          className="h-10 border-0 ps-9 shadow-none focus-visible:ring-0"
          maxLength={80}
        />
      </label>
      <Select items={cityItems} value={city} onValueChange={(v) => setCity((v as string) ?? ALL)}>
        <SelectTrigger className="h-10 w-full sm:w-40" aria-label={dict.search.city}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {cityItems.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select items={typeItems} value={type} onValueChange={(v) => setType((v as string) ?? ALL)}>
        <SelectTrigger className="h-10 w-full sm:w-48" aria-label={dict.search.deviceType}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {typeItems.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" size="lg" className="h-10 px-5" disabled={pending}>
        <Search aria-hidden />
        {dict.search.submit}
      </Button>
    </form>
  );
}
