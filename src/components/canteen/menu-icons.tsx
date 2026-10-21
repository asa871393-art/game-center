"use client";

import {
  Beef,
  Candy,
  Citrus,
  Coffee,
  Cookie,
  Croissant,
  CupSoda,
  Flame,
  GlassWater,
  IceCreamCone,
  Milk,
  Package,
  Pizza,
  Popcorn,
  Sandwich,
  Utensils,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { createElement, useState } from "react";
import type { MenuItemCategory } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/** Icons a menu item can use when it has no image (stored as MenuItem.iconName). */
export const MENU_ICONS: Record<string, LucideIcon> = {
  "cup-soda": CupSoda,
  "glass-water": GlassWater,
  zap: Zap,
  coffee: Coffee,
  milk: Milk,
  citrus: Citrus,
  cookie: Cookie,
  popcorn: Popcorn,
  candy: Candy,
  croissant: Croissant,
  sandwich: Sandwich,
  pizza: Pizza,
  beef: Beef,
  "ice-cream": IceCreamCone,
  flame: Flame,
  utensils: Utensils,
  package: Package,
};

export const MENU_ICON_NAMES = Object.keys(MENU_ICONS);

/** Default icon per broad kind. */
export const KIND_ICON: Record<MenuItemCategory, string> = {
  DRINK: "cup-soda",
  SNACK: "cookie",
  MEAL: "pizza",
  DESSERT: "ice-cream",
  HOOKAH: "flame",
  OTHER: "utensils",
};

/** Placeholder tint per kind, so imageless items are still told apart at a glance. */
const KIND_TINT: Record<MenuItemCategory, string> = {
  DRINK: "bg-gradient-to-br from-sky-500/25 to-cyan-500/10 text-sky-500 dark:text-sky-300",
  SNACK: "bg-gradient-to-br from-amber-500/25 to-yellow-500/10 text-amber-600 dark:text-amber-300",
  MEAL: "bg-gradient-to-br from-orange-500/25 to-red-500/10 text-orange-600 dark:text-orange-300",
  DESSERT: "bg-gradient-to-br from-pink-500/25 to-rose-500/10 text-pink-600 dark:text-pink-300",
  HOOKAH: "bg-gradient-to-br from-violet-500/25 to-fuchsia-500/10 text-violet-600 dark:text-violet-300",
  OTHER: "bg-gradient-to-br from-zinc-500/25 to-zinc-500/5 text-zinc-600 dark:text-zinc-300",
};

export function menuIcon(iconName: string | null | undefined, kind: MenuItemCategory): LucideIcon {
  return (iconName && MENU_ICONS[iconName]) || MENU_ICONS[KIND_ICON[kind]];
}

interface ThumbProps {
  imageUrl?: string | null;
  iconName?: string | null;
  kind: MenuItemCategory;
  className?: string;
  /** Icon size class for the placeholder. */
  iconClassName?: string;
  /** Called when the image fails to load (e.g. to warn in the edit form). */
  onBroken?: () => void;
}

/**
 * Item picture. The tinted icon placeholder is always drawn and the image is laid
 * over it, so slow links show the placeholder while loading and broken ones keep it.
 */
export function MenuThumb(props: ThumbProps) {
  // Keyed by URL so a new address gets a fresh load attempt.
  return <Thumb key={props.imageUrl ?? ""} {...props} />;
}

function Thumb({ imageUrl, iconName, kind, className, iconClassName, onBroken }: ThumbProps) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={cn("relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg", KIND_TINT[kind], className)}>
      {/* A lookup into a static map, not a component defined during render. */}
      {createElement(menuIcon(iconName, kind), { className: cn("size-5", iconClassName), "aria-hidden": true })}
      {imageUrl && !broken && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URLs entered by staff
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          draggable={false}
          // Server-rendered images can finish before hydration attaches onLoad/onError.
          ref={(el) => {
            if (!el?.complete) return;
            if (el.naturalWidth > 0) setLoaded(true);
            else {
              setBroken(true);
              onBroken?.();
            }
          }}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setBroken(true);
            onBroken?.();
          }}
          // Opaque once loaded, so transparent PNGs don't show the icon through them.
          className={cn("absolute inset-0 size-full bg-card object-cover transition-opacity", loaded ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  );
}
