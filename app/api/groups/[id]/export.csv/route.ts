import { NextResponse, type NextRequest } from "next/server";
import { exportCsv } from "@/lib/db/tenant";
import { needUser } from "@/lib/server/api";
import { fail } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await needUser(req);
  if (u instanceof Response) return u;
  const r = await exportCsv(u.id, (await ctx.params).id);
  if (!r) return fail("Ye khata nahi mila.", 404);
  const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
  return new NextResponse("﻿" + r.csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="khata-${slug}.csv"`, "Cache-Control": "no-store" },
  });
}
