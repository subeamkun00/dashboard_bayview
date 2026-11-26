import type { NextRequest } from "next/server";

export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  // Next.js may construct nextUrl using the listening address (0.0.0.0),
  // not the hostname the browser used. Host retains that request authority.
  // Do not trust arbitrary x-forwarded-host values as additional allowed hosts.
  const host = request.headers.get("host") || request.nextUrl.host;
  try {
    return origin === new URL(`${request.nextUrl.protocol}//${host}`).origin;
  } catch {
    return false;
  }
}
