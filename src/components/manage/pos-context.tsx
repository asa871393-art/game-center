"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/client";
import type { PosActionResult } from "@/server/actions/pos";
import type { PosBoardData } from "@/server/queries/manage";

interface PosValue {
  data: PosBoardData;
  canManageDevices: boolean;
}

const PosContext = createContext<PosValue | null>(null);

export function PosProvider({ value, children }: { value: PosValue; children: ReactNode }) {
  return <PosContext value={value}>{children}</PosContext>;
}

export function usePos(): PosValue {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error("usePos must be used inside <PosProvider>");
  return ctx;
}

/** Ticking clock for countdowns. Starts from the server's render time to avoid a hydration mismatch. */
export function useNow(serverNow: string, intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Re-renders the board from the server every `ms` while the tab is visible, and on refocus. */
export function useAutoRefresh(ms = 15_000) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, ms]);
}

/**
 * Runs a POS server action in a transition and reports the result with a toast.
 * The action itself refreshes the board.
 */
export function usePosAction() {
  const { dict } = useI18n();
  const [pending, startTransition] = useTransition();
  function run<T>(action: () => Promise<PosActionResult<T>>, onSuccess?: (data: T) => string | void) {
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        const message = onSuccess?.(res.data);
        if (message) toast.success(message);
      } catch {
        toast.error(dict.errors.generic);
      }
    });
  }
  return { pending, run };
}
