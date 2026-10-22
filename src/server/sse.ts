import "server-only";
import { loungeEvents, type LoungeEvent } from "./realtime";

const HEARTBEAT_MS = 25_000;
/**
 * Streams end after this long; EventSource reconnects on its own, which also
 * re-runs the auth check, so revoked access can't keep a stream open forever.
 */
const MAX_STREAM_MS = 10 * 60_000;

/**
 * Server-Sent Events stream of one lounge's changes. `project` decides what a
 * subscriber may see (return null to drop an event).
 */
export function loungeEventStream(
  signal: AbortSignal,
  loungeId: string,
  project: (event: LoungeEvent) => Record<string, unknown> | null,
): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const unsubscribe = loungeEvents.subscribe(loungeId, (event) => {
        if (event.type === "resync") return send("resync", {});
        const data = project(event);
        if (data) send("change", data);
      });
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      const lifetime = setTimeout(() => cleanup(), MAX_STREAM_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      signal.addEventListener("abort", cleanup, { once: true });

      // Tell the client to retry quickly after a drop, then confirm once the Firestore listener is live.
      write("retry: 3000\n\n");
      loungeEvents.ensureConnected().then(
        () => send("ready", {}),
        () => send("degraded", {}),
      );
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx) so events arrive immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
