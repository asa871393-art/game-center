import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The gateway settings are read when env.ts loads, so set them before any import.
const PORT = 18_991;
const SECRET = "zaincash-integration-secret";
vi.hoisted(() => {
  process.env.ZAINCASH_CLIENT_ID = "integration-client";
  process.env.ZAINCASH_CLIENT_SECRET = "zaincash-integration-secret";
  process.env.ZAINCASH_BASE_URL = "http://127.0.0.1:18991";
});

import { applyBps, toMinor } from "@/lib/money";
import { db } from "@/server/db";
import { getShiftSummary, openShift } from "../shift";
import { counterSale, PosError, type PosContext } from "../pos";
import { cancelZainCash, handleZainCashRedirect, requestZainCash, zainCashStatus } from "../zaincash";

const SLUG = "nexus-downtown";
let ctx: PosContext;
let redBullId: string;
let total: number;
let stockBefore: number;
let shiftId: string;
let server: Server;
/** What the fake gateway answers to inquiries, by ZainCash transaction id. */
const inquiry = new Map<string, string>();
let nextZc = 0;

function jwt(claims: Record<string, unknown>, secret = SECRET) {
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}
const redirectToken = (orderId: string, transactionId: string, status: string, amountIqd: number) =>
  jwt({ data: { currentStatus: status, orderId, transactionId, amount: { value: String(amountIqd), currency: "IQD" } } });

async function expectCode(promise: Promise<unknown>, code: PosError["code"]) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof PosError && e.code === code);
}

async function cleanup() {
  const lounge = await db.lounge.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } });
  const zc = await db.transaction.findMany({ where: { loungeId: lounge.id, provider: "zaincash" }, select: { id: true, canteenOrderId: true } });
  const orderIds = zc.flatMap((t) => (t.canteenOrderId ? [t.canteenOrderId] : []));
  await db.transaction.deleteMany({ where: { OR: [{ id: { in: zc.map((t) => t.id) } }, { canteenOrderId: { in: orderIds } }] } });
  await db.canteenOrder.deleteMany({ where: { id: { in: orderIds } } });
  await db.shift.deleteMany({ where: { loungeId: lounge.id } });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const send = (body: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/oauth2/token") return send({ access_token: "fake-token", expires_in: 3600 });
    if (req.headers.authorization !== "Bearer fake-token") return send({ error: "unauthorized" }, 401);
    if (req.url === "/api/v2/payment-gateway/transaction/init") {
      const id = `zc-${++nextZc}`;
      inquiry.set(id, "PENDING");
      return send({ redirectUrl: `https://pay.example/${id}`, transactionDetails: { transactionId: id } });
    }
    const m = req.url?.match(/^\/api\/v2\/payment-gateway\/transaction\/inquiry\/(.+)$/);
    if (m) return send({ status: inquiry.get(decodeURIComponent(m[1])) ?? "PENDING" });
    send({ error: "not found" }, 404);
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  await cleanup();
  const lounge = await db.lounge.findUniqueOrThrow({ where: { slug: SLUG }, include: { menuItems: true } });
  const staff = await db.user.findUniqueOrThrow({ where: { email: "staff@gamelounge.dev" } });
  ctx = { loungeId: lounge.id, actorId: staff.id };
  const redBull = lounge.menuItems.find((m) => m.sku === "DRK-RB250")!;
  redBullId = redBull.id;
  stockBefore = redBull.stockQuantity ?? 0;
  const subtotal = toMinor(redBull.price);
  total = subtotal + applyBps(subtotal, lounge.taxRateBps);
  shiftId = (await openShift(ctx, { openingFloat: 0, shiftType: "MORNING" })).id;
});

afterAll(async () => {
  await cleanup();
  await db.menuItem.update({ where: { id: redBullId }, data: { stockQuantity: stockBefore } });
  await new Promise((resolve) => server.close(resolve));
  await db.$disconnect();
});

const sale = (payments: Parameters<typeof counterSale>[1]["payments"]) =>
  counterSale(ctx, { items: [{ menuItemId: redBullId, quantity: 1 }], payments });

describe("ZainCash through the gateway", () => {
  it("refuses ZainCash confirmed by hand, and amounts ZainCash won't take", async () => {
    await expectCode(sale([{ method: "ZAINCASH", amount: total }]), "ZAINCASH_UNPAID");
    await expectCode(requestZainCash(ctx, { amount: 50_000, language: "ar" }), "ZAINCASH_AMOUNT");
    await expectCode(requestZainCash(ctx, { amount: 100_050, language: "ar" }), "ZAINCASH_AMOUNT");
  });

  it("settles a sale with a request paid through the redirect, once", async () => {
    const req = await requestZainCash(ctx, { amount: total, language: "ar" });
    expect(req).toMatchObject({ status: "PENDING", payUrl: "https://pay.example/zc-1" });
    expect(req.qrSvg).toContain("<svg");
    const pending = await db.transaction.findUniqueOrThrow({ where: { id: req.paymentId } });
    expect(pending).toMatchObject({ status: "PENDING", method: "ZAINCASH", providerRef: "zc-1", shiftId: null });

    // Not paid yet.
    await expectCode(sale([{ method: "ZAINCASH", amount: total, zainCashPaymentId: req.paymentId }]), "ZAINCASH_UNPAID");

    // Forged, wrong-amount or someone else's token: ignored.
    expect(await handleZainCashRedirect(jwt({ data: { currentStatus: "SUCCESS", orderId: req.paymentId, transactionId: "zc-1" } }, "nope"))).toBeNull();
    expect(await handleZainCashRedirect(redirectToken(req.paymentId, "zc-1", "SUCCESS", total / 100 + 1))).toBeNull();
    expect(await handleZainCashRedirect(redirectToken(req.paymentId, "zc-999", "SUCCESS", total / 100))).toBeNull();
    expect((await zainCashStatus(ctx, req.paymentId)).status).toBe("PENDING");

    expect(await handleZainCashRedirect(redirectToken(req.paymentId, "zc-1", "SUCCESS", total / 100))).toBe("PAID");
    expect((await zainCashStatus(ctx, req.paymentId)).status).toBe("PAID");

    // The amount must match the request.
    await expectCode(
      sale([
        { method: "ZAINCASH", amount: total - 100, zainCashPaymentId: req.paymentId },
        { method: "CASH", amount: 100 },
      ]),
      "PAYMENT_MISMATCH",
    );
    const { orderId } = await sale([{ method: "ZAINCASH", amount: total, zainCashPaymentId: req.paymentId }]);
    const settled = await db.transaction.findUniqueOrThrow({ where: { id: req.paymentId } });
    expect(settled).toMatchObject({ status: "SUCCEEDED", canteenOrderId: orderId, shiftId });
    expect(await db.transaction.count({ where: { canteenOrderId: orderId } })).toBe(1);

    // Used up: it can't pay for another sale.
    await expectCode(sale([{ method: "ZAINCASH", amount: total, zainCashPaymentId: req.paymentId }]), "ZAINCASH_UNPAID");

    const summary = (await getShiftSummary(shiftId))!;
    expect(summary.byMethod.find((m) => m.method === "ZAINCASH")?.amount).toBe(total);
  });

  it("learns about a payment from ZainCash when the customer never comes back", async () => {
    const req = await requestZainCash(ctx, { amount: total, language: "en" });
    inquiry.set("zc-2", "SUCCESS");
    expect((await zainCashStatus(ctx, req.paymentId)).status).toBe("PAID");
    await sale([{ method: "ZAINCASH", amount: total, zainCashPaymentId: req.paymentId }]);
  });

  it("records failed and cancelled requests, which can't pay", async () => {
    const failed = await requestZainCash(ctx, { amount: total, language: "ar" });
    expect(await handleZainCashRedirect(redirectToken(failed.paymentId, "zc-3", "FAILED", total / 100))).toBe("FAILED");
    // A later success can't revive it.
    expect(await handleZainCashRedirect(redirectToken(failed.paymentId, "zc-3", "SUCCESS", total / 100))).toBe("FAILED");
    expect((await db.transaction.findUniqueOrThrow({ where: { id: failed.paymentId } })).status).toBe("FAILED");
    await expectCode(sale([{ method: "ZAINCASH", amount: total, zainCashPaymentId: failed.paymentId }]), "ZAINCASH_UNPAID");

    const dropped = await requestZainCash(ctx, { amount: total, language: "ar" });
    await cancelZainCash(ctx, dropped.paymentId);
    expect((await db.transaction.findUniqueOrThrow({ where: { id: dropped.paymentId } })).status).toBe("CANCELLED");
    await expectCode(sale([{ method: "ZAINCASH", amount: total, zainCashPaymentId: dropped.paymentId }]), "ZAINCASH_UNPAID");
  });
});
