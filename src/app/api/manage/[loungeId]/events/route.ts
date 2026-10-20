import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { loungeEventStream } from "@/server/sse";
import { getLoungeAccess } from "@/server/staff";

/** Live change feed for the staff board. Staff see which row changed and how. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/manage/[loungeId]/events">) {
  const { loungeId } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return loungeEventStream(request.signal, loungeId, (event) =>
    event.type === "change" ? { table: event.table, op: event.op, id: event.id, status: event.status, source: event.source } : null,
  );
}
