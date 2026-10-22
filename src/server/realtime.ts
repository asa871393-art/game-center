import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { EVENTS_COLLECTION } from "@/server/db/constraints";

/**
 * Fan-out of lounge change events to in-process subscribers. Every write
 * transaction of the data layer adds a `loungeEvents` document for each
 * booking, device, canteen order, shift, expense or menu change it commits
 * (atomically, so rolled-back work announces nothing). This hub keeps one
 * Firestore listener per lounge with subscribers, so every server instance
 * hears every commit.
 */

export interface LoungeChange {
  type: "change";
  loungeId: string;
  table: "Booking" | "Device" | "CanteenOrder" | "Shift" | "ShiftExpense" | "MenuItem" | "MenuCategory";
  op: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  status: string;
  source?: string;
}

/** Sent after a listener is re-established: events may have been missed, so reload. */
export interface LoungeResync {
  type: "resync";
}

export type LoungeEvent = LoungeChange | LoungeResync;
type Listener = (event: LoungeEvent) => void;

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Listen slightly into the past to absorb clock skew between this server and Firestore. */
const SKEW_MS = 5_000;

/** Validates an event (a `loungeEvents` document or its JSON). */
export function parseLoungeChange(payload: string | Record<string, unknown> | undefined): LoungeChange | null {
  if (!payload) return null;
  try {
    const raw = (typeof payload === "string" ? JSON.parse(payload) : payload) as Partial<LoungeChange>;
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

interface Watch {
  stop: () => void;
  ready: Promise<void>;
}

class LoungeEventHub {
  private listeners = new Map<string, Set<Listener>>();
  private watches = new Map<string, Watch>();
  private retryMs = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  subscribe(loungeId: string, listener: Listener): () => void {
    let set = this.listeners.get(loungeId);
    if (!set) this.listeners.set(loungeId, (set = new Set()));
    set.add(listener);
    if (!this.watches.has(loungeId) && !this.retryTimers.has(loungeId)) this.watch(loungeId, false);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(loungeId) === set) {
        this.listeners.delete(loungeId);
        this.unwatch(loungeId);
      }
    };
  }

  /** Resolves once every subscribed lounge's listener is live (rejects if Firestore is unreachable or not configured). */
  async ensureConnected(): Promise<void> {
    getAdminDb();
    await Promise.all([...this.watches.values()].map((w) => w.ready));
  }

  get subscriberCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  private watch(loungeId: string, isRetry: boolean) {
    let stop = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      let first = true;
      try {
        const startedAt = Date.now();
        const since = Timestamp.fromMillis(startedAt - SKEW_MS);
        const query = getAdminDb().collection(EVENTS_COLLECTION).where("loungeId", "==", loungeId).where("at", ">", since);
        stop = query.onSnapshot(
          (snap) => {
            for (const change of snap.docChanges()) {
              if (change.type !== "added") continue;
              const data = change.doc.data();
              // The first snapshot also holds events from just before this listener started; skip those
              // (subscribers loaded their data after them) but keep the ones committed since.
              if (first && !(data.at instanceof Timestamp && data.at.toMillis() >= startedAt)) continue;
              const event = parseLoungeChange(data);
              if (event) this.emit(loungeId, event);
            }
            if (first) {
              first = false;
              this.retryMs.delete(loungeId);
              if (isRetry) this.emit(loungeId, { type: "resync" });
              resolve();
            }
          },
          (error) => {
            if (first) reject(error);
            this.handleError(loungeId, error);
          },
        );
      } catch (error) {
        reject(error);
        this.handleError(loungeId, error);
      }
    });
    ready.catch(() => {});
    if (!this.retryTimers.has(loungeId)) this.watches.set(loungeId, { stop: () => stop(), ready });
  }

  private unwatch(loungeId: string) {
    this.watches.get(loungeId)?.stop();
    this.watches.delete(loungeId);
    const timer = this.retryTimers.get(loungeId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(loungeId);
    this.retryMs.delete(loungeId);
  }

  private handleError(loungeId: string, error: unknown) {
    this.watches.get(loungeId)?.stop();
    this.watches.delete(loungeId);
    if (this.retryTimers.has(loungeId)) return;
    const wait = this.retryMs.get(loungeId) ?? RECONNECT_MIN_MS;
    console.warn(`[realtime] listener for lounge ${loungeId} failed, retrying in ${wait} ms`, (error as Error)?.message);
    this.retryMs.set(loungeId, Math.min(wait * 2, RECONNECT_MAX_MS));
    this.retryTimers.set(
      loungeId,
      setTimeout(() => {
        this.retryTimers.delete(loungeId);
        // Re-listen only while someone is subscribed; the next subscribe() starts one otherwise.
        if (this.listeners.has(loungeId)) this.watch(loungeId, true);
      }, wait),
    );
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

  async close() {
    for (const loungeId of new Set([...this.watches.keys(), ...this.retryTimers.keys()])) this.unwatch(loungeId);
    this.listeners.clear();
  }
}

// One hub per process, surviving dev hot reloads.
const globalForHub = globalThis as unknown as { loungeEventHub?: LoungeEventHub };
export const loungeEvents = (globalForHub.loungeEventHub ??= new LoungeEventHub());
