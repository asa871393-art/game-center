"use client";

import { useEffect } from "react";

/**
 * The POS is always dark. The layout wraps its own content in `.dark`, but
 * dialogs and toasts portal to <body>, so the class goes on <html> too while
 * the POS is mounted.
 */
export function ForceDark() {
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    root.style.colorScheme = "dark";
    return () => {
      if (!had) root.classList.remove("dark");
      root.style.colorScheme = "";
    };
  }, []);
  return null;
}
