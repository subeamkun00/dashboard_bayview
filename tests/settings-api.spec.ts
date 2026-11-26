import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { NextRequest } from "next/server";
import * as requestOrigin from "../src/lib/request-origin";

const adminId = "11111111-1111-4111-8111-111111111111";
const require = createRequire(resolve("package.json"));

// Exercise the real API without changing any live administrator profile.
async function setup(
  authenticated = true,
  databaseError = false,
  role = "admin",
) {
  const calls: { method: string; args: unknown[] }[] = [];
  const result = {
    data: { id: adminId },
    error: databaseError ? { message: "Database error" } : null,
  };
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "update", "eq", "select"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.single = async () => result;
  builder.then = (
    onFulfilled: (value: typeof result) => unknown,
    onRejected: (error: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  const source = await readFile(
    resolve("src/app/api/settings/route.ts"),
    "utf8",
  );
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
          authenticated
            ? { supabase: builder, admin: { id: adminId, role } }
            : null,
      };
    if (name === "@/lib/request-origin") return requestOrigin;
    return require(name);
  }, route);
  return { route, calls };
}

function profileRequest(
  origin = "http://localhost:3000",
  host = "localhost:3000",
  displayName: unknown = "  Updated name  ",
  url = "http://0.0.0.0:3000/api/settings",
) {
  return new NextRequest(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      host,
      origin,
      "x-forwarded-host": "foreign.test",
    },
    body: JSON.stringify({
      action: "profile",
      display_name: displayName,
      id: "someone-else",
    }),
  });
}

test("settings profile accepts the browser host and updates only the signed-in administrator", async () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "192.168.1.5:3000"]) {
    const { route, calls } = await setup();
    const response = await route.PATCH(profileRequest(`http://${host}`, host));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(calls).toEqual([
      { method: "from", args: ["admins"] },
      { method: "update", args: [{ display_name: "Updated name" }] },
      { method: "eq", args: ["id", adminId] },
    ]);
  }
  const secure = await setup();
  expect(
    (
      await secure.route.PATCH(
        profileRequest(
          "https://bayview.test",
          "bayview.test",
          "Updated name",
          "https://0.0.0.0:3000/api/settings",
        ),
      )
    ).status,
  ).toBe(200);
});

test("settings profile still rejects cross-origin requests and spoofed forwarded hosts", async () => {
  for (const origin of [
    "https://foreign.test",
    "http://localhost:3001",
    "https://localhost:3000",
    "http://0.0.0.0:3000",
    "null",
    "not-a-url",
  ]) {
    const { route, calls } = await setup();
    const response = await route.PATCH(profileRequest(origin));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid request origin." });
    expect(calls).toHaveLength(0);
  }
});

test("settings profile still requires authentication and validates names", async () => {
  const unauthorized = await setup(false);
  expect((await unauthorized.route.PATCH(profileRequest())).status).toBe(401);
  expect(unauthorized.calls).toHaveLength(0);
  for (const name of ["", " ", "A", "A".repeat(81), 123]) {
    const { route, calls } = await setup();
    expect(
      (await route.PATCH(profileRequest(undefined, undefined, name))).status,
    ).toBe(400);
    expect(calls).toHaveLength(0);
  }
  const failedSave = await setup(true, true);
  const response = await failedSave.route.PATCH(profileRequest());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Unable to update your profile.",
  });
});

test("non-administrator settings requests retain configuration and role restrictions", async () => {
  for (const action of ["configuration", "role"]) {
    const { route, calls } = await setup(true, false, "hr");
    const request = profileRequest();
    const restricted = new NextRequest(request.url, {
      method: "PATCH",
      headers: request.headers,
      body: JSON.stringify({ action }),
    });
    expect((await route.PATCH(restricted)).status).toBe(403);
    expect(calls).toHaveLength(0);
  }
});
