import type { JsonValue } from "@/lib/db/types";
import type { GatewayStatus } from "./zaincash";

/** A ZainCash request is a PENDING ZAINCASH transaction with this provider; metadata tracks the gateway's verdict. */
export const ZAINCASH_PROVIDER = "zaincash";

export interface RequestMeta {
  gateway: GatewayStatus;
  payUrl: string | null;
}

export function requestMeta(metadata: JsonValue | null): RequestMeta {
  const m = (metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}) as Record<string, JsonValue>;
  const gateway = m.gateway === "PAID" || m.gateway === "FAILED" ? m.gateway : "PENDING";
  return { gateway, payUrl: typeof m.payUrl === "string" ? m.payUrl : null };
}

/** Whether a stored ZainCash request is paid and still free to settle a bill. */
export function isPaidRequest(row: { status: string; provider: string | null; metadata: JsonValue | null }): boolean {
  return row.provider === ZAINCASH_PROVIDER && row.status === "PENDING" && requestMeta(row.metadata).gateway === "PAID";
}
