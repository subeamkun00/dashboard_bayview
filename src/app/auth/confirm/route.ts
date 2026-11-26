import { type NextRequest, NextResponse } from "next/server";
import { isConfigured, serverClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (token_hash && type === "recovery" && isConfigured) {
    const client = await serverClient();
    const { error } = await client.auth.verifyOtp({
      token_hash,
      type: "recovery",
    });
    if (!error)
      return NextResponse.redirect(new URL("/reset-password", request.url));
  }
  return NextResponse.redirect(
    new URL("/login?error=invalid-link", request.url),
  );
}
