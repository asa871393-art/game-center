"use client";

import { useState } from "react";
import { BookingDialog, type CheckoutOption } from "@/components/booking/booking-dialog";
import { useDebouncedRefresh, useLiveEvents } from "@/hooks/use-live-events";
import { toLocalIsoDate } from "@/lib/booking/time";
import type { LoungeDetails } from "@/server/queries/lounges";
import { useBookingDraft } from "@/stores/booking-draft";
import { FloorPlan } from "./floor-plan";

export function LoungeBooking(props: {
  lounge: LoungeDetails;
  checkoutOptions: CheckoutOption[];
  isSignedIn: boolean;
}) {
  const openFor = useBookingDraft((s) => s.openFor);
  const { lounge } = props;

  // Live availability: re-render device statuses and refetch the open dialog's free slots.
  const [liveTick, setLiveTick] = useState(0);
  const refresh = useDebouncedRefresh(500, () => setLiveTick((t) => t + 1));
  useLiveEvents(`/api/lounges/${encodeURIComponent(lounge.slug)}/events`, { onChange: refresh, onResync: refresh });

  return (
    <>
      <FloorPlan lounge={lounge} onSelect={(deviceId) => openFor(deviceId, toLocalIsoDate(new Date(), lounge.timezone))} />
      <BookingDialog {...props} liveTick={liveTick} />
    </>
  );
}
