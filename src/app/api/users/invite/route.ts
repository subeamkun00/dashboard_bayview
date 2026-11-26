import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-origin";

const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read the pending invite code of one employee (null when there is none).
export async function GET(request: NextRequest) {
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  if (session.admin.role !== "admin" && session.admin.role !== "head")
    return fail(
      "Only administrators and department heads can view invite codes.",
      403,
    );
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!UUID.test(id)) return fail("A valid employee ID is required.");
  const { data, error } = await session.supabase.rpc("get_employee_invite", {
    p_user_id: id,
  });
  if (error) {
    if (error.code === "42501")
      return fail(
        "You can only manage employees of your own department who are not department heads.",
        403,
      );
    return fail("Unable to load the invite code. Apply migration 009 in Supabase.", 503);
  }
  return NextResponse.json(
    { invite: (data as { code: string; expires_at: string } | null) ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

// Issue a new one-time invite code. With reset=true the employee's LINE link
// and email are cleared first so they can sign up again.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const role = session.admin.role;
  if (role !== "admin" && role !== "head")
    return fail(
      "Only administrators and department heads can issue invite codes.",
      403,
    );
  let body: { id?: unknown; reset?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request body.");
  }
  if (typeof body.id !== "string" || !UUID.test(body.id))
    return fail("A valid employee ID is required.");
  const { data, error } = await session.supabase.rpc("issue_employee_invite", {
    p_user_id: body.id,
    p_reset: body.reset === true,
  });
  if (error) {
    if (error.code === "P0002") return fail("Employee not found.", 404);
    if (error.code === "42501")
      return fail(
        "You can only manage employees of your own department who are not department heads.",
        403,
      );
    return fail(
      "Unable to issue an invite code. Apply migration 008 in Supabase.",
      503,
    );
  }
  return NextResponse.json(
    { invite_code: data as string },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
