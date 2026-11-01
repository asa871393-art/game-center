import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { PosError } from "@/server/services/pos";
import { zainCashStatus } from "@/server/services/zaincash";
import { getLoungeAccess } from "@/server/staff";

/** The POS polls this while the customer pays: { status: PENDING | PAID | FAILED, payUrl, amount }. */
export async function GET(_request: Request, ctx: RouteContext<"/api/manage/[loungeId]/zaincash/[paymentId]">) {
  const { loungeId, paymentId } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const access = await getLoungeAccess(session.user.id, loungeId);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const result = await zainCashStatus({ loungeId: access.loungeId, actorId: session.user.id }, paymentId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PosError) return NextResponse.json({ error: error.code }, { status: 404 });
    throw error;
  }
}
