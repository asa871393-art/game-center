import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { loungeEvents, parseLoungeChange, type LoungeEvent } from "../realtime";

const SLUG = "nexus-downtown";
let loungeId: string;
let otherLoungeId: string;
let deviceId: string;

/** Collects events for a lounge; `next()` resolves with the next one or rejects after `ms`. */
function collect(id: string) {
  const events: LoungeEvent[] = [];
  const waiters: ((e: LoungeEvent) => void)[] = [];
  const unsubscribe = loungeEvents.subscribe(id, (e) => {
    const waiter = waiters.shift();
    if (waiter) waiter(e);
    else events.push(e);
  });
  return {
    events,
    unsubscribe,
    next(ms = 5_000) {
      const queued = events.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise<LoungeEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no event")), ms);
        waiters.push((e) => {
          clearTimeout(timer);
          resolve(e);
        });
      });
    },
  };
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const lounges = await db.lounge.findMany({ select: { id: true, slug: true, devices: { take: 1, select: { id: true } } } });
  const main = lounges.find((l) => l.slug === SLUG)!;
  loungeId = main.id;
  deviceId = main.devices[0].id;
  otherLoungeId = lounges.find((l) => l.slug !== SLUG)!.id;
  await loungeEvents.ensureConnected();
});

afterAll(async () => {
  await db.device.update({ where: { id: deviceId }, data: { notes: null } });
  await loungeEvents.close();
  await db.$disconnect();
});

describe("parseLoungeChange", () => {
  it("accepts trigger payloads and rejects junk", () => {
    expect(parseLoungeChange('{"loungeId":"l1","table":"Booking","op":"INSERT","id":"b1","status":"PENDING","source":"ONLINE"}')).toEqual({
      type: "change",
      loungeId: "l1",
      table: "Booking",
      op: "INSERT",
      id: "b1",
      status: "PENDING",
      source: "ONLINE",
    });
    expect(parseLoungeChange("not json")).toBeNull();
    expect(parseLoungeChange('{"table":"Booking"}')).toBeNull();
    expect(parseLoungeChange(undefined)).toBeNull();
  });
});

describe("lounge event hub (Firestore loungeEvents)", () => {
  it("delivers committed device changes to that lounge's subscribers only", async () => {
    const mine = collect(loungeId);
    const other = collect(otherLoungeId);
    try {
      await db.device.update({ where: { id: deviceId }, data: { notes: `realtime ${Date.now()}` } });
      const event = await mine.next();
      expect(event).toMatchObject({ type: "change", loungeId, table: "Device", op: "UPDATE", id: deviceId });
      await settle();
      expect(other.events).toHaveLength(0);
    } finally {
      mine.unsubscribe();
      other.unsubscribe();
    }
  });

  it("says nothing about rolled-back or no-op writes", async () => {
    const mine = collect(loungeId);
    try {
      await db
        .$transaction(async (tx) => {
          await tx.device.update({ where: { id: deviceId }, data: { notes: "rolled back" } });
          throw new Error("rollback");
        })
        .catch(() => {});
      const current = await db.device.findUniqueOrThrow({ where: { id: deviceId } });
      await db.device.update({ where: { id: deviceId }, data: { notes: current.notes, updatedAt: current.updatedAt } });
      await settle(800);
      expect(mine.events).toHaveLength(0);
    } finally {
      mine.unsubscribe();
    }
  });

  it("announces menu changes too (tables without a status column)", async () => {
    const mine = collect(loungeId);
    try {
      const item = await db.menuItem.findFirstOrThrow({ where: { loungeId } });
      await db.menuItem.update({ where: { id: item.id }, data: { isAvailable: !item.isAvailable } });
      expect(await mine.next()).toMatchObject({ type: "change", loungeId, table: "MenuItem", op: "UPDATE", id: item.id, status: "" });
      await db.menuItem.update({ where: { id: item.id }, data: { isAvailable: item.isAvailable } });
    } finally {
      mine.unsubscribe();
    }
  });

  it("stops delivering after unsubscribe", async () => {
    const mine = collect(loungeId);
    mine.unsubscribe();
    await db.device.update({ where: { id: deviceId }, data: { notes: `after ${Date.now()}` } });
    await settle();
    expect(mine.events).toHaveLength(0);
  });
});
