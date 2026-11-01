import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * ZainCash payment gateway (API v2): OAuth2 client credentials, then
 * POST /api/v2/payment-gateway/transaction/init returns a payment page URL the customer opens
 * (we show it as a QR code). After paying, ZainCash sends the customer's browser to our
 * redirect URL with ?token=<JWT, HS256 signed with the client secret> carrying the result, and
 * /transaction/inquiry/{id} reports the status when the customer never comes back.
 */

const UAT_URL = "https://pg-api-uat.zaincash.iq";
const LIVE_URL = "https://pg-api.zaincash.iq";
const SCOPE = "payment:read payment:write";
/** ZainCash refuses smaller payments. */
export const ZAINCASH_MIN_IQD = 1000;

export type GatewayStatus = "PENDING" | "PAID" | "FAILED";

export interface ZainCashConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

/** The gateway settings, or null when ZainCash isn't connected (the cashier confirms transfers by hand). */
export function zainCashConfig(): ZainCashConfig | null {
  if (!env.ZAINCASH_CLIENT_ID || !env.ZAINCASH_CLIENT_SECRET) return null;
  return {
    baseUrl: env.ZAINCASH_BASE_URL ?? (env.ZAINCASH_ENV === "live" ? LIVE_URL : UAT_URL),
    clientId: env.ZAINCASH_CLIENT_ID,
    clientSecret: env.ZAINCASH_CLIENT_SECRET,
  };
}

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayError";
  }
}

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

async function accessToken(config: ZainCashConfig): Promise<string> {
  const key = `${config.baseUrl}|${config.clientId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const res = await fetch(`${config.baseUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: SCOPE,
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !body?.access_token) throw new GatewayError(`ZainCash token request failed (${res.status})`);
  // Renew a minute early.
  const ttl = Math.max(60, (body.expires_in ?? 300) - 60) * 1000;
  cachedToken = { key, token: body.access_token, expiresAt: Date.now() + ttl };
  return body.access_token;
}

async function call(config: ZainCashConfig, path: string, init: { method: "GET" | "POST"; body?: unknown }) {
  const token = await accessToken(config);
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) throw new GatewayError(`ZainCash ${path} failed (${res.status})`);
  return body;
}

export interface InitInput {
  /** Our reference (the pending transaction's id), echoed back in the result. */
  orderId: string;
  amountIqd: number;
  serviceType: string;
  language: "ar" | "en";
  redirectUrl: string;
}

/** Starts a payment; returns ZainCash's transaction id and the page the customer pays on. */
export async function initPayment(config: ZainCashConfig, input: InitInput): Promise<{ transactionId: string; payUrl: string }> {
  const body = await call(config, "/api/v2/payment-gateway/transaction/init", {
    method: "POST",
    body: {
      language: input.language,
      externalReferenceId: input.orderId,
      orderId: input.orderId,
      amount: { value: String(input.amountIqd), currency: "IQD" },
      serviceType: input.serviceType,
      redirectUrls: { successUrl: input.redirectUrl, failureUrl: input.redirectUrl },
    },
  });
  const payUrl = typeof body.redirectUrl === "string" ? body.redirectUrl : null;
  const transactionId = pickString(body, ["transactionId", "id"]) ?? pickString(body.transactionDetails, ["transactionId", "id"]);
  if (!payUrl || !transactionId) throw new GatewayError("ZainCash init returned no payment URL");
  return { transactionId, payUrl };
}

/** The status ZainCash reports for a transaction. */
export async function inquire(config: ZainCashConfig, transactionId: string): Promise<GatewayStatus> {
  const body = await call(config, `/api/v2/payment-gateway/transaction/inquiry/${encodeURIComponent(transactionId)}`, { method: "GET" });
  const status =
    pickString(body, ["currentStatus", "status"]) ??
    pickString(body.data, ["currentStatus", "status"]) ??
    pickString(body.transactionDetails, ["currentStatus", "status"]);
  return toGatewayStatus(status);
}

/** ZainCash statuses: SUCCESS/COMPLETED mean paid; FAILED/EXPIRED/CANCELLED/REJECTED end it; anything else is still pending. */
export function toGatewayStatus(status: string | null | undefined): GatewayStatus {
  const s = (status ?? "").toUpperCase();
  if (s === "SUCCESS" || s === "SUCCEEDED" || s === "COMPLETED" || s === "PAID") return "PAID";
  if (["FAILED", "FAILURE", "EXPIRED", "CANCELLED", "CANCELED", "REJECTED", "DECLINED", "REVERSED"].includes(s)) return "FAILED";
  return "PENDING";
}

export interface RedirectResult {
  orderId: string | null;
  transactionId: string | null;
  status: GatewayStatus;
  amountIqd: number | null;
}

/** Verifies the ?token= JWT ZainCash sends the customer back with; null when forged, expired or malformed. */
export function readRedirectToken(token: unknown, secret: string, now = Date.now()): RedirectResult | null {
  const claims = verifyHs256(token, secret, now);
  if (!claims) return null;
  const data = (typeof claims.data === "object" && claims.data ? claims.data : claims) as Record<string, unknown>;
  const amount = data.amount as { value?: unknown } | number | string | undefined;
  const rawAmount = typeof amount === "object" && amount ? amount.value : amount;
  const amountIqd = rawAmount === undefined || rawAmount === null || rawAmount === "" ? null : Number(rawAmount);
  return {
    orderId: pickString(data, ["orderId", "orderid"]),
    transactionId: pickString(data, ["transactionId", "id"]),
    status: toGatewayStatus(pickString(data, ["currentStatus", "status"])),
    amountIqd: Number.isFinite(amountIqd) ? amountIqd : null,
  };
}

/** HS256 JWT verification: the claims, or null. */
export function verifyHs256(token: unknown, secret: string, now = Date.now()): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString()) as { alg?: unknown };
    if (header.alg !== "HS256") return null;
    const expected = Buffer.from(createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url"));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    if (typeof claims.exp === "number" && claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}

function pickString(source: unknown, keys: string[]): string | null {
  if (!source || typeof source !== "object") return null;
  for (const k of keys) {
    const v = (source as Record<string, unknown>)[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}
