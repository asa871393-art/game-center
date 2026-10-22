import "server-only";
import type { CheckoutMethod } from "@/lib/db/types";
import { env } from "@/lib/env";
import { createSandboxProvider } from "./sandbox";
import type { OnlineCheckoutMethod, PaymentProvider } from "./types";

const ONLINE_METHODS: readonly OnlineCheckoutMethod[] = ["ZAINCASH", "FASTPAY"];

export function isOnlineMethod(method: CheckoutMethod): method is OnlineCheckoutMethod {
  return (ONLINE_METHODS as readonly string[]).includes(method);
}

export function getPaymentProvider(method: OnlineCheckoutMethod): PaymentProvider | null {
  if (env.PAYMENTS_MODE === "mock") return createSandboxProvider(method);
  return null;
}

/** Checkout options to show customers, in display order. */
export function getAvailableCheckoutMethods(): { method: CheckoutMethod; isSandbox: boolean }[] {
  return [
    { method: "PAY_AT_LOUNGE", isSandbox: false },
    ...ONLINE_METHODS.flatMap((method) => {
      const provider = getPaymentProvider(method);
      return provider ? [{ method, isSandbox: provider.isSandbox }] : [];
    }),
  ];
}

export type { OnlineCheckoutMethod, PaymentProvider } from "./types";
