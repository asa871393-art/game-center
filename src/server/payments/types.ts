import type { CheckoutMethod } from "@/lib/db/types";
import type { Locale } from "@/i18n/config";
import type { Minor } from "@/lib/money";

export type OnlineCheckoutMethod = Exclude<CheckoutMethod, "PAY_AT_LOUNGE">;

export interface CreatePaymentInput {
  /** Our Transaction id; providers echo it back on callback. */
  transactionId: string;
  amount: Minor;
  currency: string;
  description: string;
  locale: Locale;
}

export interface CreatePaymentResult {
  /** Where to send the customer to approve the payment. */
  redirectUrl: string;
  /** The provider's id for this payment, stored on Transaction.providerRef. */
  providerRef: string;
}

/**
 * One implementation per wallet. A real ZainCash/FastPay adapter signs the
 * init request with merchant credentials, returns the hosted payment URL, and
 * verifies the signed callback before calling `settlePayment`.
 */
export interface PaymentProvider {
  method: OnlineCheckoutMethod;
  /** Lower-case name stored in Transaction.provider. */
  name: string;
  isSandbox: boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
}
