import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { NextRequest } from "next/server";
import * as userUtils from "../src/lib/users";
import * as originUtils from "../src/lib/request-origin";
import { createDemoData } from "../src/lib/demo";

const id = "11111111-1111-4111-8111-111111111111";
const employee = {
  ...createDemoData().users[0],
  id,
  status: "inactive",
  access_enabled: true,
};
const require = createRequire(resolve("package.json"));
type Result = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
};
async function setup(
  results: Result[] = [],
  role: string | null = "admin",
  file = "src/app/api/users/route.ts",
) {
  const calls: { method: string; args: unknown[] }[] = [];
  const result = () => results.shift() || { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of [
    "from",
    "select",
    "eq",
    "order",
    "range",
    "update",
    "insert",
  ])
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  builder.maybeSingle = async () => result();
  builder.single = async () => result();
  builder.rpc = async (...args: unknown[]) => {
    calls.push({ method: "rpc", args });
    return result();
  };
  builder.then = (
    onFulfilled: (value: Result) => unknown,
    onRejected: (error: unknown) => unknown,
  ) => Promise.resolve(result()).then(onFulfilled, onRejected);
  const source = await readFile(resolve(file), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const route: Record<string, (request: NextRequest) => Promise<Response>> = {};
  new Function("require", "exports", compiled)((name: string) => {
    if (name === "@/lib/supabase/server")
      return {
        authorized: async () =>
          role ? { supabase: builder, admin: { id: "admin-id", role } } : null,
      };
    if (name === "@/lib/users") return userUtils;
    if (name === "@/lib/request-origin") return originUtils;
    return require(name);
  }, route);
  return { route, calls };
}
function request(
  body: unknown,
  origin = "http://localhost:3000",
  method = "PATCH",
) {
  return new NextRequest("http://0.0.0.0:3000/api/users", {
    method,
    headers: {
      host: "localhost:3000",
      origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
test("employee mutations reject unauthenticated, non-admin and cross-origin requests", async () => {
  for (const role of [null, "hr", "it", "training"]) {
    const { route, calls } = await setup([], role);
    expect(
      (
        await route.PATCH(
          request({ id, action: "access", access_enabled: false }),
        )
      ).status,
    ).toBe(role ? 403 : 401);
    expect(calls).toHaveLength(0);
  }
  const foreign = await setup();
  expect(
    (
      await foreign.route.PATCH(
        request(
          { id, action: "access", access_enabled: false },
          "https://foreign.test",
        ),
      )
    ).status,
  ).toBe(403);
  expect(foreign.calls).toHaveLength(0);
});
test("employee profile changes use stable IDs and update only department and position", async () => {
  const updated = {
    ...employee,
    department: "Housekeeping",
    position: "Room attendant",
  };
  const { route, calls } = await setup([
    { data: employee },
    { data: [{ department: "Housekeeping", position: "Room attendant" }] },
    { data: updated },
  ]);
  const response = await route.PATCH(
    request({
      id,
      action: "profile",
      department: "Housekeeping",
      position: "Room attendant",
      line_user_id: "spoofed",
      status: "active",
      access_enabled: false,
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).user).toEqual(updated);
  expect(calls.find((call) => call.method === "update")?.args).toEqual([
    { department: "Housekeeping", position: "Room attendant" },
  ]);
  expect(
    calls
      .filter((call) => call.method === "eq")
      .every((call) => call.args[0] === "id" && call.args[1] === id),
  ).toBeTruthy();
});
test("disabling uses one atomic reset and preserves activity, profile fields and history", async () => {
  const disabled = {
    ...employee,
    access_enabled: false,
    auth_user_id: null,
    line_user_id: null,
    email: null,
    claimed_at: null,
    line_id: null,
  };
  const { route, calls } = await setup([
    { data: employee },
    { data: disabled },
  ]);
  const response = await route.PATCH(
    request({
      id,
      action: "access",
      access_enabled: false,
      department: "IT",
      position: "Delete profile",
      status: "active",
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).user).toMatchObject({
    status: "inactive",
    department: employee.department,
    position: employee.position,
    access_enabled: false,
    auth_user_id: null,
    line_user_id: null,
    claimed_at: null,
    line_id: null,
    email: null,
  });
  expect(calls.filter((call) => call.method === "rpc")).toEqual([
    {
      method: "rpc",
      args: ["disable_employee_and_reset_link", { p_user_id: id }],
    },
  ]);
  expect(calls.some((call) => call.method === "update")).toBe(false);
  expect(
    calls
      .filter((call) => call.method === "from")
      .every((call) => call.args[0] === "users"),
  ).toBeTruthy();
});

test("enabling changes access only and never restores a previous LINE or email link", async () => {
  const unlinked = {
    ...employee,
    access_enabled: false,
    line_user_id: null,
    claimed_at: null,
    email: null,
  };
  const { route, calls } = await setup([
    { data: unlinked },
    { data: { ...unlinked, access_enabled: true } },
  ]);
  const response = await route.PATCH(
    request({ id, action: "access", access_enabled: true }),
  );
  expect(response.status).toBe(200);
  const { user } = await response.json();
  expect(userUtils.employeeAccessStatus(user)).toBe("unverified");
  expect(calls.find((call) => call.method === "update")?.args).toEqual([
    { access_enabled: true },
  ]);
  expect(calls.some((call) => call.method === "rpc")).toBe(false);
});

test("disable fails closed without a partial update when reset migration or permission is missing", async () => {
  for (const [code, status] of [
    ["42883", 503],
    ["PGRST202", 503],
    ["42501", 403],
    ["P0002", 404],
    ["XX000", 503],
  ] as const) {
    const { route, calls } = await setup([
      { data: employee },
      { error: { code, message: "RPC failed" } },
    ]);
    const response = await route.PATCH(
      request({ id, action: "access", access_enabled: false }),
    );
    expect(response.status).toBe(status);
    if (code === "42883" || code === "PGRST202")
      expect((await response.json()).error).toContain("migration 018");
    expect(calls.some((call) => call.method === "update")).toBe(false);
  }
});
test("employee mutations validate IDs, actions and actual recorded position options", async () => {
  for (const body of [
    null,
    {},
    { id: "user-1", action: "access" },
    { id, action: "delete" },
  ]) {
    const { route, calls } = await setup();
    expect((await route.PATCH(request(body))).status).toBe(400);
    expect(calls).toHaveLength(0);
  }
  for (const body of [
    { id, action: "access", access_enabled: "false" },
    { id, action: "profile", department: "", position: "Room attendant" },
    {
      id,
      action: "profile",
      department: "Housekeeping",
      position: "Unrecorded title",
    },
  ]) {
    const { route, calls } = await setup([
      { data: employee },
      { data: [{ department: "Housekeeping", position: "Room attendant" }] },
    ]);
    expect((await route.PATCH(request(body))).status).toBe(400);
    expect(calls.some((call) => call.method === "update")).toBe(false);
  }
});
test("employee mutations report missing schema, missing users and failed saves", async () => {
  for (const [results, expected] of [
    [[{ error: { message: "Missing column" } }], 503],
    [[{ data: null }], 404],
    [[{ data: employee }, { error: { message: "Update failed" } }], 503],
  ] as [Result[], number][]) {
    const { route } = await setup(results);
    expect(
      (
        await route.PATCH(
          request({ id, action: "access", access_enabled: false }),
        )
      ).status,
    ).toBe(expected);
  }
  // The organization-chart positions are always available, so a title that is
  // neither in the chart nor recorded for an employee is simply refused.
  const noPositions = await setup([
    { data: employee },
    { data: [{ department: "Housekeeping", position: null }] },
  ]);
  const response = await noPositions.route.PATCH(
    request({
      id,
      action: "profile",
      department: "Housekeeping",
      position: "Room attendant",
    }),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("no longer available");
});
test("employee access is independent of recent activity", () => {
  const base = createDemoData().users[0];
  expect(
    userUtils.assistantAccess({
      ...base,
      status: "inactive",
      access_enabled: true,
    }),
  ).toBe(true);
  expect(
    userUtils.assistantAccess({
      ...base,
      status: "active",
      access_enabled: false,
    }),
  ).toBe(false);
  expect(
    userUtils.employeeDepartment({ ...base, department: "Team member" }),
  ).toBe("");
});

const newEmployee = {
  first_name: "สมชาย",
  last_name: "ใจดี",
  employee_id: "E100",
  phone: "",
  department: "Front Office Department",
  position: "Asst. Front Office Manger",
};
const post = (body: unknown, origin?: string) => request(body, origin, "POST");
test("creating an employee requires an administrator on the same origin", async () => {
  expect(
    (await (await setup([], null)).route.POST(post(newEmployee))).status,
  ).toBe(401);
  expect(
    (await (await setup([], "hr")).route.POST(post(newEmployee))).status,
  ).toBe(403);
  expect(
    (
      await (
        await setup()
      ).route.POST(post(newEmployee, "https://evil.example"))
    ).status,
  ).toBe(403);
});
test("creating an employee validates names, phone and the department/position pair", async () => {
  for (const bad of [
    { ...newEmployee, first_name: "Som3" },
    { ...newEmployee, last_name: "" },
    { ...newEmployee, employee_id: "" },
    { ...newEmployee, phone: "12" },
    { ...newEmployee, department: "Nowhere" },
    { ...newEmployee, position: "Chief Wizard" },
  ]) {
    const { route } = await setup([{ data: [] }]);
    const response = await route.POST(post(bad));
    expect(response.status, JSON.stringify(bad)).toBe(400);
  }
});
test("creating an employee saves the roster row and returns a one-time invite code", async () => {
  const { route, calls } = await setup([
    { data: [] },
    { data: { id, employee_id: "E100" } },
    { data: "ABCD-EFGH" },
  ]);
  const response = await route.POST(post(newEmployee));
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.invite_code).toBe("ABCD-EFGH");
  expect(body.warning).toBeUndefined();
  const insert = calls.find((call) => call.method === "insert")!
    .args[0] as Record<string, unknown>;
  expect(insert).toMatchObject({
    employee_id: "E100",
    display_name: "สมชาย ใจดี",
    phone: null,
    access_enabled: true,
  });
  const rpc = calls.find((call) => call.method === "rpc")!;
  expect(rpc.args).toEqual([
    "issue_employee_invite",
    { p_user_id: id, p_reset: false },
  ]);
});
test("creating an employee reports duplicates and a missing invite function", async () => {
  const duplicate = await setup([
    { data: [] },
    { error: { message: "duplicate key", code: "23505" } },
  ]);
  expect((await duplicate.route.POST(post(newEmployee))).status).toBe(409);
  const noInvite = await setup([
    { data: [] },
    { data: { id } },
    { error: { message: "function does not exist" } },
  ]);
  const response = await noInvite.route.POST(post(newEmployee));
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.invite_code).toBeNull();
  expect(body.warning).toContain("008");
});

const inviteFile = "src/app/api/users/invite/route.ts";
const getInvite = (value = id) =>
  new NextRequest(`http://0.0.0.0:3000/api/users/invite?id=${value}`, {
    headers: { host: "localhost:3000" },
  });
test("viewing an invite code is limited to administrators and returns null when none is active", async () => {
  expect(
    (await (await setup([], null, inviteFile)).route.GET(getInvite())).status,
  ).toBe(401);
  expect(
    (await (await setup([], "hr", inviteFile)).route.GET(getInvite())).status,
  ).toBe(403);
  expect(
    (await (await setup([], "admin", inviteFile)).route.GET(getInvite("nope")))
      .status,
  ).toBe(400);
  const found = await setup(
    [{ data: { code: "ABCD-EFGH", expires_at: "2026-10-22T00:00:00Z" } }],
    "admin",
    inviteFile,
  );
  const response = await found.route.GET(getInvite());
  expect(response.status).toBe(200);
  expect((await response.json()).invite.code).toBe("ABCD-EFGH");
  expect(found.calls.find((c) => c.method === "rpc")!.args).toEqual([
    "get_employee_invite",
    { p_user_id: id },
  ]);
  const none = await setup([{ data: null }], "admin", inviteFile);
  expect((await (await none.route.GET(getInvite())).json()).invite).toBeNull();
  const broken = await setup(
    [{ error: { message: "function does not exist" } }],
    "admin",
    inviteFile,
  );
  expect((await broken.route.GET(getInvite())).status).toBe(503);
});
test("issuing an invite code needs an administrator and can reset the LINE link", async () => {
  const post = (body: unknown) => request(body, undefined, "POST");
  expect(
    (await (await setup([], null, inviteFile)).route.POST(post({ id }))).status,
  ).toBe(401);
  expect(
    (await (await setup([], "hr", inviteFile)).route.POST(post({ id }))).status,
  ).toBe(403);
  expect(
    (await (await setup([], "admin", inviteFile)).route.POST(post({ id: "x" })))
      .status,
  ).toBe(400);
  const ok = await setup([{ data: "WXYZ-2345" }], "admin", inviteFile);
  const response = await ok.route.POST(post({ id, reset: true }));
  expect(response.status).toBe(200);
  expect((await response.json()).invite_code).toBe("WXYZ-2345");
  expect(ok.calls.find((c) => c.method === "rpc")!.args).toEqual([
    "issue_employee_invite",
    { p_user_id: id, p_reset: true },
  ]);
  const missing = await setup(
    [{ error: { message: "not found", code: "P0002" } }],
    "admin",
    inviteFile,
  );
  expect((await missing.route.POST(post({ id }))).status).toBe(404);
});

test("a department head flag is saved only when it changes and must be a boolean", async () => {
  const records = {
    data: [
      { department: "Housekeeping Department", position: "Room Attendant" },
    ],
  };
  const profile = (extra: object) =>
    request({
      id,
      action: "profile",
      department: "Housekeeping Department",
      position: "Room Attendant",
      ...extra,
    });
  const on = await setup([
    { data: employee },
    records,
    { data: { ...employee, is_department_head: true } },
  ]);
  const response = await on.route.PATCH(profile({ is_department_head: true }));
  expect(response.status).toBe(200);
  expect((await response.json()).user.is_department_head).toBe(true);
  expect(on.calls.find((call) => call.method === "update")!.args[0]).toEqual({
    department: "Housekeeping Department",
    position: "Room Attendant",
    is_department_head: true,
  });
  // Not sent -> not written (keeps working before migration 013).
  const unchanged = await setup([
    { data: employee },
    records,
    { data: employee },
  ]);
  await unchanged.route.PATCH(profile({}));
  expect(
    Object.keys(
      unchanged.calls.find((call) => call.method === "update")!
        .args[0] as object,
    ),
  ).toEqual(["department", "position"]);
  const bad = await setup([{ data: employee }, records]);
  expect(
    (await bad.route.PATCH(profile({ is_department_head: "yes" }))).status,
  ).toBe(400);
  const missing = await setup([
    { data: employee },
    records,
    {
      error: {
        code: "42703",
        message: "column is_department_head does not exist",
      },
    },
  ]);
  const failed = await missing.route.PATCH(
    profile({ is_department_head: true }),
  );
  expect(failed.status).toBe(503);
  expect((await failed.json()).error).toContain("013");
});
