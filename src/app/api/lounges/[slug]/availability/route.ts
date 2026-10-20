import { NextResponse, type NextRequest } from "next/server";
import { isIsoDate } from "@/lib/booking/time";
import { getDayAvailability } from "@/server/queries/lounges";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/lounges/[slug]/availability">) {
  const { slug } = await ctx.params;
  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!isIsoDate(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

  const availability = await getDayAvailability(slug, date);
  if (!availability) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(availability, { headers: { "Cache-Control": "no-store" } });
}
