import "server-only";
import QRCode from "qrcode";
import { env } from "@/lib/env";
import { fromMinor, toMinor, type Minor } from "@/lib/money";
import { db } from "@/server/db";
import {
  GatewayError,
  initPayment,
  inquire,
  readRedirectToken,
  ZAINCASH_MIN_IQD,
  zainCashConfig,
  type GatewayStatus,
} from "@/server/payments/zaincash";
import { requestMeta, ZAINCASH_PROVIDER, type RequestMeta } from "@/server/payments/zaincash-request";
import { getOpenShift, PosError, type PosContext } from "./pos";

/**
 * ZainCash at the counter, when the gateway is connected. The cashier requests the ZainCash part
 * of a bill; that creates a PENDING ZAINCASH transaction and a ZainCash payment page, shown as a QR
 * code the customer scans and pays. ZainCash's redirect (or an inquiry) marks it paid. Checkout
 * then takes the paid request as that part of the payment: the same transaction row becomes
 * SUCCEEDED and is attached to the booking or counter sale and the shift.
 */


export function isZainCashGatewayEnabled(): boolean {
  return zainCashConfig() !== null;
}

/** Where ZainCash sends the customer back to (it must be the public site URL). */
function redirectUrl(): string {
  return new URL("/api/zaincash/callback", env.NEXT_PUBLIC_APP_URL).toString();
}

export interface ZainCashRequest {
  paymentId: string;
  payUrl: string;
  status: GatewayStatus;
  amount: Minor;
}

/** The payment page as an SVG QR code for the customer to scan. */
export function payUrlQr(payUrl: string): Promise<string> {
  return QRCode.toString(payUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

/** Opens a ZainCash payment of `amount` for the cashier to show as a QR code. */
export async function requestZainCash(ctx: PosContext, input: { amount: Minor; language: "ar" | "en" }): Promise<ZainCashRequest & { qrSvg: string }> {
  const config = zainCashConfig();
  if (!config) throw new PosError("INVALID_STATE");
  if (!Number.isInteger(input.amount) || input.amount % 100 !== 0 || input.amount < ZAINCASH_MIN_IQD * 100) {
    throw new PosError("ZAINCASH_AMOUNT");
  }
  if (!(await getOpenShift(db, ctx.loungeId))) throw new PosError("SHIFT_CLOSED");
  const lounge = await db.lounge.findUniqueOrThrow({ where: { id: ctx.loungeId }, select: { name: true, currency: true } });

  const row = await db.transaction.create({
    data: {
      loungeId: ctx.loungeId,
      processedById: ctx.actorId,
      type: "PAYMENT",
      method: "ZAINCASH",
      status: "PENDING",
      amount: fromMinor(input.amount),
      currency: lounge.currency,
      provider: ZAINCASH_PROVIDER,
      metadata: { gateway: "PENDING", payUrl: null },
    },
    select: { id: true },
  });
  try {
    const { transactionId, payUrl } = await initPayment(config, {
      orderId: row.id,
      amountIqd: input.amount / 100,
      serviceType: lounge.name.slice(0, 50),
      language: input.language,
      redirectUrl: redirectUrl(),
    });
    await db.transaction.update({ where: { id: row.id }, data: { providerRef: transactionId, metadata: { gateway: "PENDING", payUrl } } });
    return { paymentId: row.id, payUrl, status: "PENDING" as const, amount: input.amount, qrSvg: await payUrlQr(payUrl) };
  } catch (error) {
    await db.transaction.update({ where: { id: row.id }, data: { status: "FAILED", metadata: { gateway: "FAILED", payUrl: null } } });
    if (error instanceof GatewayError) {
      console.error(error.message);
      throw new PosError("GATEWAY_ERROR");
    }
    throw error;
  }
}

/**
 * Where a request stands. A pending one is checked with ZainCash (inquiry) so a customer who paid
 * but never reached the redirect page still counts.
 */
export async function zainCashStatus(ctx: PosContext, paymentId: string): Promise<ZainCashRequest> {
  const row = await db.transaction.findFirst({
    where: { id: paymentId, loungeId: ctx.loungeId, provider: ZAINCASH_PROVIDER },
    select: { id: true, status: true, amount: true, providerRef: true, metadata: true },
  });
  if (!row) throw new PosError("NOT_FOUND");
  let meta = requestMeta(row.metadata);
  if (row.status === "PENDING" && meta.gateway === "PENDING" && row.providerRef) {
    const config = zainCashConfig();
    try {
      const status = config ? await inquire(config, row.providerRef) : "PENDING";
      if (status !== "PENDING") meta = await settleRequest(row.id, status);
    } catch (error) {
      // The redirect may still arrive; keep waiting.
      console.error("ZainCash inquiry failed", error);
    }
  }
  const status: GatewayStatus = row.status === "SUCCEEDED" ? "PAID" : row.status === "PENDING" ? meta.gateway : "FAILED";
  return { paymentId: row.id, payUrl: meta.payUrl ?? "", status, amount: toMinor(row.amount) };
}

/** Records ZainCash's verdict on a pending request (once: a settled request doesn't change). */
async function settleRequest(paymentId: string, status: Exclude<GatewayStatus, "PENDING">): Promise<RequestMeta> {
  return db.$transaction(async (tx) => {
    const row = await tx.transaction.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true, metadata: true } });
    const meta = requestMeta(row.metadata);
    if (row.status !== "PENDING" || meta.gateway !== "PENDING") return meta;
    const next = { gateway: status, payUrl: meta.payUrl };
    await tx.transaction.update({
      where: { id: paymentId },
      data: status === "FAILED" ? { status: "FAILED", metadata: next } : { metadata: next },
    });
    return next;
  });
}

/** The customer's browser coming back from ZainCash with ?token=: verify it and record the result. */
export async function handleZainCashRedirect(token: unknown): Promise<GatewayStatus | null> {
  const config = zainCashConfig();
  if (!config) return null;
  const result = readRedirectToken(token, config.clientSecret);
  if (!result?.orderId) return null;
  const row = await db.transaction.findUnique({
    where: { id: result.orderId },
    select: { id: true, provider: true, providerRef: true, amount: true },
  });
  if (!row || row.provider !== ZAINCASH_PROVIDER) return null;
  if (result.transactionId && row.providerRef && result.transactionId !== row.providerRef) return null;
  if (result.status === "PAID" && result.amountIqd !== null && result.amountIqd * 100 !== toMinor(row.amount)) return null;
  if (result.status === "PENDING") return "PENDING";
  return (await settleRequest(row.id, result.status)).gateway;
}

/** Cancels a request the customer hasn't paid (the cashier went back or changed the amount). */
export async function cancelZainCash(ctx: PosContext, paymentId: string) {
  await db.$transaction(async (tx) => {
    const row = await tx.transaction.findFirst({
      where: { id: paymentId, loungeId: ctx.loungeId, provider: ZAINCASH_PROVIDER },
      select: { status: true, metadata: true },
    });
    if (!row || row.status !== "PENDING") return;
    if (requestMeta(row.metadata).gateway === "PAID") return;
    await tx.transaction.update({ where: { id: paymentId }, data: { status: "CANCELLED" } });
  });
}
