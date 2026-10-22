import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { loungeEventStream } from "@/server/sse";

/**
 * Public "something changed" feed for a lounge page, so the floor plan and
 * free slots stay current. Carries no ids or statuses: customers learn only
 * that availability may have changed, never whose booking it was.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/lounges/[slug]/events">) {
  const { slug } = await ctx.params;
  const lounge = await db.lounge.findFirst({ where: { slug, status: "ACTIVE" }, select: { id: true } });
  if (!lounge) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return loungeEventStream(request.signal, lounge.id, (event) =>
    event.type === "change" && (event.table === "Booking" || event.table === "Device") ? { scope: "availability" } : null,
  );
}
