import "server-only";
import { Client } from "pg";
import { env } from "@/lib/env";

/**
 * Fan-out of Postgres NOTIFY "lounge_events" (see the realtime migration) to
 * in-process subscribers. One LISTEN connection per server process; every
 * process hears every commit, so this works across multiple instances.
 */

export const LOUNGE_EVENTS_CHANNEL = "lounge_events";

export interface LoungeChange {
  type: "change";
  loungeId: string;
  table: "Booking" | "Device" | "CanteenOrder" | "Shift";
  op: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  status: string;
  source?: string;
}

/** Sent after the LISTEN connection (re)connects: events may have been missed, so reload. */
export interface LoungeResync {
  type: "resync";
}

export type LoungeEvent = LoungeChange | LoungeResync;
type Listener = (event: LoungeEvent) => void;

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function parseLoungeChange(payload: string | undefined): LoungeChange | null {
  if (!payload) return null;
  try {
    const raw = JSON.parse(payload) as Partial<LoungeChange>;
    if (typeof raw.loungeId !== "string" || typeof raw.table !== "string" || typeof raw.op !== "string") return null;
    return {
      type: "change",
      loungeId: raw.loungeId,
      table: raw.table,
      op: raw.op,
      id: String(raw.id ?? ""),
      status: String(raw.status ?? ""),
      ...(raw.source ? { source: String(raw.source) } : {}),
    };
  } catch {
    return null;
  }
}

class LoungeEventHub {
  private listeners = new Map<string, Set<Listener>>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private retryMs = RECONNECT_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnectedBefore = false;

  constructor(private readonly connectionString: string) {}

  subscribe(loungeId: string, listener: Listener): () => void {
    let set = this.listeners.get(loungeId);
    if (!set) this.listeners.set(loungeId, (set = new Set()));
    set.add(listener);
    void this.ensureConnected();
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(loungeId);
    };
  }

  /** Resolves once LISTEN is active (rejects if the first attempt fails; retries continue in the background). */
  ensureConnected(): Promise<void> {
    if (this.client) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  get subscriberCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: this.connectionString, application_name: "lounge-events" });
    client.on("notification", (msg) => {
      if (msg.channel !== LOUNGE_EVENTS_CHANNEL) return;
      const event = parseLoungeChange(msg.payload);
      if (event) this.emit(event.loungeId, event);
    });
    client.on("error", (error) => this.handleDisconnect(client, error));
    client.on("end", () => this.handleDisconnect(client));

    try {
      await client.connect();
      await client.query(`LISTEN ${LOUNGE_EVENTS_CHANNEL}`);
    } catch (error) {
      client.removeAllListeners();
      await client.end().catch(() => {});
      this.scheduleReconnect(error);
      throw error;
    }

    this.client = client;
    this.retryMs = RECONNECT_MIN_MS;
    if (this.hasConnectedBefore) this.emitAll({ type: "resync" });
    this.hasConnectedBefore = true;
  }

  private handleDisconnect(client: Client, error?: unknown) {
    if (this.client !== client) return;
    this.client = null;
    client.removeAllListeners();
    client.end().catch(() => {});
    this.scheduleReconnect(error);
  }

  private scheduleReconnect(error?: unknown) {
    if (this.retryTimer) return;
    if (error) console.warn(`[realtime] LISTEN connection lost, retrying in ${this.retryMs} ms`, (error as Error).message);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // Reconnect only while someone is listening; the next subscribe() reconnects otherwise.
      if (this.subscriberCount > 0) this.ensureConnected().catch(() => {});
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS);
  }

  private emit(loungeId: string, event: LoungeEvent) {
    for (const listener of this.listeners.get(loungeId) ?? []) {
      try {
        listener(event);
      } catch (error) {
        console.error("[realtime] listener failed", error);
      }
    }
  }

  private emitAll(event: LoungeEvent) {
    for (const loungeId of this.listeners.keys()) this.emit(loungeId, event);
  }

  async close() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const client = this.client;
    this.client = null;
    this.listeners.clear();
    if (client) {
      client.removeAllListeners();
      await client.end().catch(() => {});
    }
  }
}

// One hub per process, surviving dev hot reloads.
const globalForHub = globalThis as unknown as { loungeEventHub?: LoungeEventHub };
export const loungeEvents = (globalForHub.loungeEventHub ??= new LoungeEventHub(env.DATABASE_URL));
