"use client";

import { create } from "zustand";
import type { CheckoutMethod } from "@/lib/db/types";
import type { IsoDate } from "@/lib/booking/time";

export type BookingStep = "time" | "addons" | "checkout";
export const BOOKING_STEPS: readonly BookingStep[] = ["time", "addons", "checkout"];

interface BookingDraftState {
  open: boolean;
  step: BookingStep;
  deviceId: string | null;
  date: IsoDate | null;
  /** Selected slot start, ISO string. */
  start: string | null;
  durationMinutes: number | null;
  players: number;
  /** menuItemId -> quantity */
  addOns: Record<string, number>;
  checkoutMethod: CheckoutMethod;
  notes: string;

  openFor: (deviceId: string, date: IsoDate) => void;
  setOpen: (open: boolean) => void;
  setStep: (step: BookingStep) => void;
  setDate: (date: IsoDate) => void;
  setStart: (start: string | null, defaultDuration: number | null) => void;
  setDuration: (minutes: number) => void;
  setPlayers: (players: number) => void;
  setQuantity: (menuItemId: string, quantity: number) => void;
  setCheckoutMethod: (method: CheckoutMethod) => void;
  setNotes: (notes: string) => void;
}

const empty = {
  step: "time" as BookingStep,
  date: null,
  start: null,
  durationMinutes: null,
  players: 1,
  addOns: {},
  checkoutMethod: "PAY_AT_LOUNGE" as CheckoutMethod,
  notes: "",
};

export const useBookingDraft = create<BookingDraftState>()((set) => ({
  open: false,
  deviceId: null,
  ...empty,

  openFor: (deviceId, date) =>
    set((s) =>
      // Reopening the same device keeps the draft (e.g. after closing by accident).
      s.deviceId === deviceId && s.date ? { open: true } : { ...empty, open: true, deviceId, date },
    ),
  setOpen: (open) => set({ open }),
  setStep: (step) => set({ step }),
  setDate: (date) => set({ date, start: null, durationMinutes: null }),
  setStart: (start, defaultDuration) => set({ start, durationMinutes: defaultDuration }),
  setDuration: (durationMinutes) => set({ durationMinutes }),
  setPlayers: (players) => set({ players }),
  setQuantity: (menuItemId, quantity) =>
    set((s) => {
      const addOns = { ...s.addOns };
      if (quantity <= 0) delete addOns[menuItemId];
      else addOns[menuItemId] = Math.min(quantity, 20);
      return { addOns };
    }),
  setCheckoutMethod: (checkoutMethod) => set({ checkoutMethod }),
  setNotes: (notes) => set({ notes: notes.slice(0, 500) }),
}));
