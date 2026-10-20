"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type LiveStatus = "connecting" | "live" | "offline";

interface LiveHandlers<T> {
  onChange?: (data: T) => void;
  /** The feed (re)connected after a gap; anything may have changed meanwhile. */
  onResync?: () => void;
}

/**
 * Subscribes to a Server-Sent Events feed (see src/server/sse.ts).
 * EventSource reconnects by itself; this tracks the connection state and asks
 * for a resync whenever a dropped connection comes back.
 */
export function useLiveEvents<T = Record<string, unknown>>(url: string | null, handlers: LiveHandlers<T>): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!url || typeof EventSource === "undefined") return;
    const source = new EventSource(url);
    let dropped = false;

    source.addEventListener("ready", () => {
      setStatus("live");
      if (dropped) handlersRef.current.onResync?.();
      dropped = false;
    });
    source.addEventListener("resync", () => handlersRef.current.onResync?.());
    source.addEventListener("degraded", () => setStatus("offline"));
    source.addEventListener("change", (e) => {
      try {
        handlersRef.current.onChange?.(JSON.parse((e as MessageEvent<string>).data) as T);
      } catch {
        // Ignore malformed frames.
      }
    });
    source.onerror = () => {
      dropped = true;
      setStatus("offline");
    };

    return () => source.close();
  }, [url]);

  return status;
}

/** router.refresh(), coalescing bursts (one checkout touches several rows) into one re-render. */
export function useDebouncedRefresh(delayMs = 300, after?: () => void) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterRef = useRef(after);
  useEffect(() => {
    afterRef.current = after;
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
      afterRef.current?.();
    }, delayMs);
  }, [router, delayMs]);
}
