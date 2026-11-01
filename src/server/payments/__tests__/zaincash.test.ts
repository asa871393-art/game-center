import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const SECRET = "zc-test-secret";

function jwt(claims: Record<string, unknown>, secret = SECRET, alg = "HS256") {
  const head = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

async function load() {
  vi.resetModules();
  process.env.AUTH_SECRET = "x".repeat(32);
  process.env.ZAINCASH_CLIENT_ID = "client";
  process.env.ZAINCASH_CLIENT_SECRET = SECRET;
  process.env.ZAINCASH_BASE_URL = "https://zc.test";
  return import("../zaincash");
}

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

describe("redirect token", () => {
  it("reads the result from a token signed with the client secret", async () => {
    const { readRedirectToken } = await load();
    const token = jwt({
      eventType: "STATUS_CHANGED",
      data: { currentStatus: "SUCCESS", transactionId: "zc-1", orderId: "tx-1", amount: { value: "5000", currency: "IQD" } },
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(readRedirectToken(token, SECRET)).toEqual({ orderId: "tx-1", transactionId: "zc-1", status: "PAID", amountIqd: 5000 });
  });

  it("rejects forged, expired, unsigned and malformed tokens", async () => {
    const { readRedirectToken } = await load();
    const claims = { data: { currentStatus: "SUCCESS", orderId: "tx-1" } };
    expect(readRedirectToken(jwt(claims, "other-secret"), SECRET)).toBeNull();
    expect(readRedirectToken(jwt({ ...claims, exp: Math.floor(Date.now() / 1000) - 10 }), SECRET)).toBeNull();
    expect(readRedirectToken(jwt(claims, SECRET, "none"), SECRET)).toBeNull();
    expect(readRedirectToken("a.b", SECRET)).toBeNull();
    expect(readRedirectToken(undefined, SECRET)).toBeNull();
  });

  it("maps ZainCash statuses", async () => {
    const { toGatewayStatus } = await load();
    expect(toGatewayStatus("SUCCESS")).toBe("PAID");
    expect(toGatewayStatus("completed")).toBe("PAID");
    expect(toGatewayStatus("FAILED")).toBe("FAILED");
    expect(toGatewayStatus("EXPIRED")).toBe("FAILED");
    expect(toGatewayStatus("PENDING")).toBe("PENDING");
    expect(toGatewayStatus(undefined)).toBe("PENDING");
  });
});

describe("gateway calls", () => {
  let calls: { url: string; init: RequestInit }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
        if (url.endsWith("/transaction/init")) return Response.json({ redirectUrl: "https://pay.zc/abc", transactionDetails: { transactionId: "zc-9" } });
        if (url.includes("/transaction/inquiry/")) return Response.json({ status: "SUCCESS" });
        return new Response("nope", { status: 404 });
      }),
    );
  });

  it("gets a token, then starts a payment in whole dinars and inquires with the bearer token", async () => {
    const { initPayment, inquire, zainCashConfig } = await load();
    const config = zainCashConfig()!;
    const res = await initPayment(config, { orderId: "tx-1", amountIqd: 5000, serviceType: "Lounge", language: "ar", redirectUrl: "https://site/cb" });
    expect(res).toEqual({ transactionId: "zc-9", payUrl: "https://pay.zc/abc" });
    expect(await inquire(config, "zc-9")).toBe("PAID");

    const token = calls[0];
    expect(token.url).toBe("https://zc.test/oauth2/token");
    expect(String(token.init.body)).toContain("grant_type=client_credentials");
    const init = calls[1];
    expect(init.url).toBe("https://zc.test/api/v2/payment-gateway/transaction/init");
    expect((init.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.init.body))).toMatchObject({
      orderId: "tx-1",
      amount: { value: "5000", currency: "IQD" },
      redirectUrls: { successUrl: "https://site/cb", failureUrl: "https://site/cb" },
    });
    // The token is reused.
    expect(calls.filter((c) => c.url.endsWith("/oauth2/token"))).toHaveLength(1);
  });

  it("is off without credentials", async () => {
    const mod = await load();
    delete process.env.ZAINCASH_CLIENT_ID;
    vi.resetModules();
    const again = await import("../zaincash");
    expect(mod.zainCashConfig()).not.toBeNull();
    expect(again.zainCashConfig()).toBeNull();
  });
});
