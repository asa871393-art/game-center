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
import { createElement } from "react";
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

export function menuIcon(iconName: string | null | undefined, kind: MenuItemCategory): LucideIcon {
  return (iconName && MENU_ICONS[iconName]) || MENU_ICONS[KIND_ICON[kind]];
}

/** Item thumbnail: its image if it has one, else its icon. */
export function MenuThumb({
  imageUrl,
  iconName,
  kind,
  className,
}: {
  imageUrl?: string | null;
  iconName?: string | null;
  kind: MenuItemCategory;
  className?: string;
}) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URLs entered by staff
    return <img src={imageUrl} alt="" className={cn("size-10 shrink-0 rounded-lg object-cover", className)} loading="lazy" />;
  }
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground", className)}>
      {/* A lookup into a static map, not a component defined during render. */}
      {createElement(menuIcon(iconName, kind), { className: "size-5", "aria-hidden": true })}
    </span>
  );
}
