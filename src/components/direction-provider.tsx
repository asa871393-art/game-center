"use client";

import { DirectionProvider as BaseDirectionProvider } from "@base-ui/react/direction-provider";
import type { ReactNode } from "react";

/** Tells Base UI popups (menus, selects, sheets) which way to open. */
export function DirectionProvider({ direction, children }: { direction: "rtl" | "ltr"; children: ReactNode }) {
  return <BaseDirectionProvider direction={direction}>{children}</BaseDirectionProvider>;
}
