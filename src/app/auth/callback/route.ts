import { NextResponse, type NextRequest } from "next/server";
import { isConfigured, serverClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code && isConfigured) {
    const supabase = await serverClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const next =
        request.nextUrl.searchParams.get("next") === "/reset-password"
          ? "/reset-password"
          : "/";
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(
    new URL("/login?error=invalid-link", request.url),
  );
}
