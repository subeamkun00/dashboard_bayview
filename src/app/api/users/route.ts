import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-origin";
import { employeeOptions } from "@/lib/users";
import {
  CATALOG_POSITIONS,
  isValidPersonName,
  isValidPhone,
} from "@/lib/employee-creation";
import type { Employee } from "@/lib/types";

const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const migrationError =
  "User management is not configured yet. Apply the user management migration in Supabase.";
// Validates the contact details an administrator or department head may correct.
function contactFields(body: {
  first_name?: unknown;
  last_name?: unknown;
  phone?: unknown;
}) {
  const first = typeof body.first_name === "string" ? body.first_name.trim() : "";
  const last = typeof body.last_name === "string" ? body.last_name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!first || !last || first.length > 100 || last.length > 100)
    return { error: "Enter a first and last name (up to 100 characters each)." };
  if (phone.length > 30 || !/^[0-9+\-().\s]*$/.test(phone))
    return { error: "Enter a valid phone number." };
  return {
    first_name: first,
    last_name: last,
    display_name: `${first} ${last}`,
    phone: phone || null,
  };
}

const sameDepartment = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const isAdmin = session.admin.role === "admin";
  const isHead = session.admin.role === "head";
  if (!isAdmin && !isHead)
    return fail(
      "Only administrators and department heads can manage employees.",
      403,
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request body.");
  }
  if (!body || !uuid(body.id) || !["profile", "access", "contact"].includes(body.action))
    return fail("A valid user ID and action are required.");
  const { supabase } = session;
  const { data: current, error: readError } = await supabase
    .from("users")
    .select("id,department,position,access_enabled,nickname,is_department_head")
    .eq("id", body.id)
    .maybeSingle();
  if (readError) return fail(migrationError, 503);
  if (!current) return fail("User not found.", 404);
  if (isHead) {
    // Department heads: contact details and access (enable / disable) of people in
    // their own department; department, position and the head flags stay with administrators.
    if (body.action === "profile")
      return fail("Only administrators can change this.", 403);
    if (
      !session.admin.department ||
      !sameDepartment(current.department ?? "", session.admin.department)
    )
      return fail("You can only edit employees of your own department.", 403);
    if (body.action === "access" && current.is_department_head)
      return fail(
        "Only administrators can change a department head's access.",
        403,
      );
  }
  let changes:
    | {
        department: string;
        position: string;
        is_department_head?: boolean;
        can_access_all_documents?: boolean;
        first_name?: string;
        last_name?: string;
        display_name?: string;
        phone?: string | null;
      }
    | { access_enabled: boolean }
    | {
        first_name: string;
        last_name: string;
        display_name: string;
        phone: string | null;
      };
  if (body.action === "access") {
    if (typeof body.access_enabled !== "boolean")
      return fail("Choose Enabled or Disabled.");
    if (!body.access_enabled) {
      // A single transaction prevents disabling access without unlinking LINE
      // (or unlinking it while accidentally leaving access enabled).
      const { data: user, error } = await supabase.rpc(
        "disable_employee_and_reset_link",
        { p_user_id: body.id },
      );
      if (error) {
        if (error.code === "42501")
          return fail(
            isHead
              ? "You can only disable employees of your own department who are not department heads."
              : "Only administrators can manage employees.",
            403,
          );
        if (error.code === "P0002") return fail("User not found.", 404);
        return fail(
          error.code === "42883" || error.code === "PGRST202"
            ? "Disable and reset is not configured yet. Apply migration 018 in Supabase."
            : "Unable to disable and unlink this user. No changes were saved. Please try again.",
          503,
        );
      }
      if (!user) return fail("User not found.", 404);
      return NextResponse.json(
        { user },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    changes = { access_enabled: body.access_enabled };
  } else if (body.action === "contact") {
    const parsed = contactFields(body);
    if ("error" in parsed) return fail(parsed.error);
    changes = parsed;
  } else {
    if (
      typeof body.department !== "string" ||
      typeof body.position !== "string" ||
      !body.department.trim() ||
      !body.position.trim() ||
      body.department.length > 100 ||
      body.position.length > 120
    )
      return fail("Choose a valid department and position.");
    const records: Pick<Employee, "department" | "position">[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("users")
        .select("department,position")
        .order("id")
        .range(offset, offset + 999);
      if (error)
        return fail("Unable to load department and position options.", 503);
      records.push(...data);
      if (data.length < 1000) break;
    }
    const options = employeeOptions(records);
    if (!options.positions.length)
      return fail(
        "No employee positions are configured. Add the real position list before saving.",
        503,
      );
    if (
      !options.departments.includes(body.department.trim()) ||
      !options.positions.includes(body.position.trim())
    )
      return fail(
        "The department or position is no longer available. Refresh and try again.",
      );
    if (
      body.is_department_head !== undefined &&
      typeof body.is_department_head !== "boolean"
    )
      return fail("Choose whether this employee is a department head.");
    if (
      body.can_access_all_documents !== undefined &&
      typeof body.can_access_all_documents !== "boolean"
    )
      return fail("Choose whether this employee has all-department document access.");
    const contact = body.first_name !== undefined ? contactFields(body) : null;
    if (contact && "error" in contact) return fail(contact.error);
    changes = {
      ...(contact && !("error" in contact) && contact),
      department: body.department.trim(),
      position: body.position.trim(),
      // Only sent when it changes, so editing department/position keeps
      // working before migration 013 is applied.
      ...(body.is_department_head !== undefined && {
        is_department_head: body.is_department_head,
      }),
      // Same idea: only sent when it changes (needs migration 024).
      ...(body.can_access_all_documents !== undefined && {
        can_access_all_documents: body.can_access_all_documents,
      }),
    };
  }
  const { data: user, error } = await supabase
    .from("users")
    .update(changes)
    .eq("id", body.id)
    .select("*")
    .maybeSingle();
  if (error)
    return fail(
      error.code === "42501"
        ? "You do not have permission to edit this employee."
        : error.code === "42703" || error.code === "PGRST204"
        ? "Department head or all-documents access is not configured yet. Apply migrations 013 and 024 in Supabase."
        : "Unable to save this user. Please try again.",
      503,
    );
  if (!user) return fail("User not found.", 404);
  return NextResponse.json(
    { user },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

// Create a roster employee and issue their one-time invite code.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const isAdmin = session.admin.role === "admin";
  const isHead = session.admin.role === "head";
  if (!isAdmin && !isHead)
    return fail(
      "Only administrators and department heads can add employees.",
      403,
    );
  if (isHead && !session.admin.department)
    return fail(
      "Your account is not linked to a department. Ask an administrator.",
      403,
    );
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request body.");
  }
  const text = (key: string) =>
    typeof body[key] === "string" ? (body[key] as string).trim() : "";
  const first = text("first_name");
  const last = text("last_name");
  const employeeId = text("employee_id");
  const phone = text("phone");
  const department = text("department");
  const position = text("position");
  if (
    !first ||
    !last ||
    !isValidPersonName(first) ||
    !isValidPersonName(last) ||
    first.length > 100 ||
    last.length > 100
  )
    return fail("Enter a valid first and last name (letters only).");
  if (
    !employeeId ||
    employeeId.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(employeeId)
  )
    return fail("Enter a valid employee ID (100 characters or fewer).");
  if (phone && !isValidPhone(phone))
    return fail("Enter a valid phone number (9–15 digits).");
  if (
    !department ||
    !position ||
    department.length > 100 ||
    position.length > 120
  )
    return fail("Choose a valid department and position.");
  if (isHead && !sameDepartment(department, session.admin.department!))
    return fail("You can only add employees to your own department.", 403);

  const { supabase } = session;
  // The department/position pair must exist in the organization chart or the data.
  const allowed = new Set(CATALOG_POSITIONS.map(([d, p]) => `${d}\u0000${p}`));
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("users")
      .select("department,position")
      .order("id")
      .range(offset, offset + 999);
    if (error) return fail(migrationError, 503);
    for (const row of data)
      if (row.department && row.position)
        allowed.add(`${row.department}\u0000${row.position}`);
    if (data.length < 1000) break;
  }
  if (!allowed.has(`${department}\u0000${position}`))
    return fail(
      "The department or position is not available. Refresh and try again.",
    );

  const { data: user, error } = await supabase
    .from("users")
    .insert({
      employee_id: employeeId,
      first_name: first,
      last_name: last,
      display_name: `${first} ${last}`,
      department,
      position,
      phone: phone || null,
      access_enabled: true,
      status: "inactive",
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505")
      return fail("This employee ID already exists.", 409);
    if (error.code === "42501" && isHead)
      return fail("You can only add employees to your own department.", 403);
    if (
      error.code === "42501" ||
      error.code === "42703" ||
      error.code === "PGRST204"
    )
      return fail(
        "Employee management is not fully configured. Apply migrations 003, 006 and 008 in Supabase.",
        503,
      );
    return fail("Unable to add this employee. Please try again.", 503);
  }

  const { data: code, error: inviteError } = await supabase.rpc(
    "issue_employee_invite",
    { p_user_id: user.id, p_reset: false },
  );
  return NextResponse.json(
    {
      user,
      invite_code: inviteError ? null : (code as string),
      ...(inviteError && {
        warning:
          'The employee was saved, but the invite code could not be created (apply migration 008). Open the employee and use "Generate invite code".',
      }),
    },
    { status: 201, headers: { "Cache-Control": "private, no-store" } },
  );
}
