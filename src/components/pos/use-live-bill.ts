"use client";

import { useMemo } from "react";
import { usePos } from "@/components/manage/pos-context";
import { liveBill, type LiveBillContext } from "@/lib/booking/live-bill";
import { withDeviceRates, type PricedCategory } from "@/lib/booking/session-billing";
import type { PosSession } from "@/server/queries/manage";

/** Effective pricing per device id (device overrides on top of its category), built once per board render. */
export function useDevicePricing(): (deviceId: string) => PricedCategory | undefined {
  const { data } = usePos();
  return useMemo(() => {
    const categories = new Map(data.categories.map((c) => [c.id, c]));
    const byDevice = new Map<string, PricedCategory>();
    for (const d of data.devices) {
      const c = categories.get(d.categoryId);
      if (!c) continue;
      byDevice.set(
        d.id,
        withDeviceRates(
          { id: c.id, baseHourlyRate: c.baseHourlyRate, multiTierBps: c.multiTierBps, vipTierBps: c.vipTierBps },
          d,
        ),
      );
    }
    return (deviceId: string) => byDevice.get(deviceId);
  }, [data]);
}

/** Pricing context for live bills. */
export function useBillContext(): LiveBillContext {
  const { data } = usePos();
  const categoryOf = useDevicePricing();
  return useMemo(
    () => ({ timeZone: data.lounge.timezone, taxRateBps: data.lounge.taxRateBps, rules: data.pricingRules, categoryOf }),
    [data, categoryOf],
  );
}

export function useLiveBill(session: PosSession | null | undefined, now: Date) {
  const ctx = useBillContext();
  return session ? liveBill(session, ctx, now) : null;
}
