import { NextResponse, type NextRequest } from "next/server";

/** Fallback only: the service worker normally catches the share POST. The body is never read. */
export function POST(req: NextRequest) {
  return NextResponse.redirect(new URL("/?shared=0", req.url), 303);
}
