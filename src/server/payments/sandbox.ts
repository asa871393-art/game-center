import "server-only";
import { randomUUID } from "node:crypto";
import { localePath } from "@/i18n/config";
import type { OnlineCheckoutMethod, PaymentProvider } from "./types";

/**
 * In-app stand-in for a wallet gateway: "redirects" to our own checkout page,
 * where the customer can simulate approval or decline.
 */
export function createSandboxProvider(method: OnlineCheckoutMethod): PaymentProvider {
  const name = method.toLowerCase();
  return {
    method,
    name,
    isSandbox: true,
    async createPayment({ transactionId, locale }) {
      return {
        redirectUrl: localePath(locale, `/checkout/${transactionId}`),
        providerRef: `sandbox_${name}_${randomUUID()}`,
      };
    },
  };
}
