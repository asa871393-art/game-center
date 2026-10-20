"use client";

import { useMemo } from "react";
import { usePos } from "@/components/manage/pos-context";
import { liveBill, type LiveBillContext } from "@/lib/booking/live-bill";
import type { PricedCategory } from "@/lib/booking/session-billing";
import type { PosSession } from "@/server/queries/manage";

/** Pricing context for live bills, built once per board render. */
export function useBillContext(): LiveBillContext {
  const { data } = usePos();
  return useMemo(() => {
    const categories = new Map<string, PricedCategory>(
      data.categories.map((c) => [
        c.id,
        { id: c.id, baseHourlyRate: c.baseHourlyRate, multiTierBps: c.multiTierBps, vipTierBps: c.vipTierBps },
      ]),
    );
    const deviceCategory = new Map(data.devices.map((d) => [d.id, d.categoryId]));
    return {
      timeZone: data.lounge.timezone,
      taxRateBps: data.lounge.taxRateBps,
      rules: data.pricingRules,
      categoryOf: (deviceId) => categories.get(deviceCategory.get(deviceId) ?? ""),
    };
  }, [data]);
}

export function useLiveBill(session: PosSession | null | undefined, now: Date) {
  const ctx = useBillContext();
  return session ? liveBill(session, ctx, now) : null;
}
