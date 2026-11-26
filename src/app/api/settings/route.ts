import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-origin";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
export async function GET() {
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const { data, error } = await session.supabase
    .from("system_settings")
    .select("hotel_name, response_language, retrieval_limit")
    .eq("id", 1)
    .single();
  if (error) return fail("Unable to load system configuration.", 503);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  try {
    const body = await request.json();
    const { supabase, admin } = session;
    if (body.action === "profile") {
      if (
        typeof body.display_name !== "string" ||
        body.display_name.trim().length < 2 ||
        body.display_name.length > 80
      )
        return fail("Name must be between 2 and 80 characters.");
      const { error } = await supabase
        .from("admins")
        .update({ display_name: body.display_name.trim() })
        .eq("id", admin.id);
      if (error) return fail("Unable to update your profile.", 503);
    } else if (body.action === "configuration") {
      if (admin.role !== "admin")
        return fail("Only administrators can change configuration.", 403);
      if (
        typeof body.hotel_name !== "string" ||
        !body.hotel_name.trim() ||
        body.hotel_name.length > 100 ||
        !["Match the employee’s language", "English", "Thai"].includes(
          body.response_language,
        ) ||
        !Number.isInteger(body.retrieval_limit) ||
        body.retrieval_limit < 1 ||
        body.retrieval_limit > 20
      )
        return fail("Invalid configuration values.");
      const { error } = await supabase
        .from("system_settings")
        .update({
          hotel_name: body.hotel_name.trim(),
          response_language: body.response_language,
          retrieval_limit: body.retrieval_limit,
        })
        .eq("id", 1);
      if (error) return fail("Unable to save configuration.", 503);
    } else if (body.action === "role") {
      if (admin.role !== "admin")
        return fail("Only administrators can manage roles.", 403);
      if (body.id === admin.id)
        return fail("You cannot change your own workspace role.");
      if (
        typeof body.id !== "string" ||
        !["admin", "head"].includes(body.role)
      )
        return fail("Invalid role.");
      // A department head belongs to one department (the one they may add employees to).
      const department =
        body.role === "head" && typeof body.department === "string"
          ? body.department.trim()
          : "";
      if (body.role === "head" && (!department || department.length > 100))
        return fail("Choose the department this head belongs to.");
      const { data, error } = await supabase
        .from("admins")
        .update({ role: body.role, department: department || null })
        .eq("id", body.id)
        .select("id")
        .single();
      if (error || !data)
        return fail(
          "Unable to update role. The user may no longer exist.",
          409,
        );
    } else return fail("Unknown settings action.");
    return NextResponse.json({ success: true });
  } catch {
    return fail("Invalid request.");
  }
}
