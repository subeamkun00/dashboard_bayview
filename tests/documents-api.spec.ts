import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { NextRequest } from "next/server";
import * as documentUtils from "../src/lib/documents";
import * as requestOrigin from "../src/lib/request-origin";

const id = "11111111-1111-4111-8111-111111111111";
const require = createRequire(resolve("package.json"));
type Result = {
  data?: unknown;
  error?: { code?: string; message: string } | null;
};
type Call = { method: string; args: unknown[] };

// Execute the real route module with a fake session and Supabase transport.
// This exercises request validation, upload dispatch, and deletion ordering
// without writing to the hotel's live database or invoking its real webhook.
async function setup(results: Result[] = [], authenticated = true) {
  const calls: Call[] = [];
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
  };
  const result = () => results.shift() || { data: null, error: null };
  const query = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "eq", "limit"])
      builder[method] = (...args: unknown[]) => {
        record(method, ...args);
        return builder;
      };
    builder.maybeSingle = async () => result();
    builder.then = (
      onFulfilled: (value: Result) => unknown,
      onRejected: (error: unknown) => unknown,
    ) => Promise.resolve(result()).then(onFulfilled, onRejected);
    return builder;
  };
  const supabase = {
    from: (table: string) => {
      record("from", table);
      return query();
    },
    rpc: async (...args: unknown[]) => {
      record("rpc", ...args);
      return result();
    },
    storage: {
      from: (bucket: string) => {
        record("bucket", bucket);
        return {
          upload: async (...args: unknown[]) => {
            record("upload", ...args);
            return result();
          },
          remove: async (...args: unknown[]) => {
            record("remove", ...args);
            return result();
          },
          createSignedUrl: async (...args: unknown[]) => {
            record("signedUrl", ...args);
            return result();
          },
        };
      },
    },
  };
  const source = await readFile(
    resolve("src/app/api/documents/route.ts"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, (request: NextRequest) => Promise<Response>> =
    {};
  new Function("require", "exports", compiled)((name: string) => {
    if (name === "@/lib/supabase/server")
      return {
        authorized: async () =>
          authenticated
            ? { supabase, admin: { id, display_name: "Test administrator" } }
            : null,
      };
    if (name === "@/lib/documents") return documentUtils;
    if (name === "@/lib/request-origin") return requestOrigin;
    return require(name);
  }, exports);
  return { route: exports, calls };
}
function uploadRequest(
  fileName = "policy.txt",
  url = "http://localhost/api/documents",
  headers?: HeadersInit,
  position?: string,
) {
  const body = new FormData();
  body.append(
    "file",
    new File(["Policy contents"], fileName, { type: "text/plain" }),
  );
  body.append("title", "Team policy");
  body.append("document_type", "Policy");
  body.append("department", "HR");
  body.append("description", "Approved policy");
  if (position !== undefined) body.append("position", position);
  return new NextRequest(url, {
    method: "POST",
    body,
    headers,
  });
}
function jsonRequest(method: string, origin?: string) {
  return new NextRequest("http://localhost/api/documents", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ id }),
  });
}
async function withWorkflow(run: () => Promise<void>, configured = true) {
  const originalUrl = process.env.N8N_DOCUMENT_WEBHOOK_URL;
  const originalSecret = process.env.N8N_WEBHOOK_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.N8N_DOCUMENT_WEBHOOK_URL = configured
    ? "https://workflow.test/process"
    : "";
  process.env.N8N_WEBHOOK_SECRET = configured ? "test-secret" : "";
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.N8N_DOCUMENT_WEBHOOK_URL;
    else process.env.N8N_DOCUMENT_WEBHOOK_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.N8N_WEBHOOK_SECRET;
    else process.env.N8N_WEBHOOK_SECRET = originalSecret;
  }
}

test("document API rejects unauthorized uploads and cross-origin mutations", async () => {
  const { route, calls } = await setup([], false);
  expect((await route.POST(uploadRequest())).status).toBe(401);
  expect((await route.PATCH(jsonRequest("PATCH"))).status).toBe(401);
  expect((await route.DELETE(jsonRequest("DELETE"))).status).toBe(401);
  expect(
    (await route.DELETE(jsonRequest("DELETE", "https://foreign.test"))).status,
  ).toBe(403);
  expect(calls).toHaveLength(0);
});
test("document mutations use the browser host rather than the internal listening address", async () => {
  await withWorkflow(async () => {
    globalThis.fetch = async () => new Response("", { status: 202 });
    for (const host of [
      "localhost:3000",
      "127.0.0.1:3000",
      "192.168.1.5:3000",
    ]) {
      const { route } = await setup();
      const response = await route.POST(
        uploadRequest("policy.txt", "http://0.0.0.0:3000/api/documents", {
          host,
          origin: `http://${host}`,
        }),
      );
      expect(response.status).toBe(201);
    }
    for (const method of ["PATCH", "DELETE"]) {
      const { route } = await setup([], false);
      const request = new NextRequest("http://0.0.0.0:3000/api/documents", {
        method,
        headers: { host: "localhost:3000", origin: "http://localhost:3000" },
        body: JSON.stringify({ id }),
      });
      // Passing the origin guard must not bypass administrator authentication.
      expect((await route[method](request)).status).toBe(401);
    }
  });
});

test("document upload rejects foreign origins, mismatched ports and forwarded-host spoofing", async () => {
  for (const origin of [
    "https://foreign.test",
    "http://localhost:3001",
    "https://localhost:3000",
    "http://0.0.0.0:3000",
    "null",
    "not-a-url",
  ]) {
    const { route, calls } = await setup();
    const response = await route.POST(
      uploadRequest("policy.txt", "http://0.0.0.0:3000/api/documents", {
        host: "localhost:3000",
        origin,
        "x-forwarded-host": origin.replace(/^https?:\/\//, ""),
      }),
    );
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  }
});

test("document upload validates files and migration before writing storage", async () => {
  const invalid = await setup();
  expect((await invalid.route.POST(uploadRequest("policy.csv"))).status).toBe(
    400,
  );
  expect(invalid.calls).toHaveLength(0);
  const missingSchema = await setup([
    { error: { code: "42703", message: "Missing column" } },
  ]);
  expect((await missingSchema.route.POST(uploadRequest())).status).toBe(503);
  expect(missingSchema.calls.some((call) => call.method === "upload")).toBe(
    false,
  );
});
test("document upload preserves metadata and dispatches existing workflow contract", async () => {
  await withWorkflow(async () => {
    let payload: unknown;
    globalThis.fetch = async (_input, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response("", { status: 202 });
    };
    const { route, calls } = await setup();
    const response = await route.POST(uploadRequest());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.processing_status).toBe("processing");
    expect(payload).toEqual({ document_id: body.id, action: "reprocess" });
    expect(calls.find((call) => call.method === "bucket")?.args[0]).toBe(
      "knowledge-base",
    );
    expect(
      calls.find((call) => call.method === "insert")?.args[0],
    ).toMatchObject({
      document_name: "Team policy",
      original_filename: "policy.txt",
      document_type: "Policy",
      department: "HR",
      description: "Approved policy",
      uploaded_by: id,
      uploaded_by_name: "Test administrator",
      rag_source_id: body.id,
    });
  });
});
test("saved uploads report failed processing when workflow is missing or rejects", async () => {
  for (const configured of [false, true])
    await withWorkflow(async () => {
      globalThis.fetch = async () => new Response("", { status: 503 });
      const { route, calls } = await setup();
      const response = await route.POST(uploadRequest());
      expect(response.status).toBe(201);
      expect((await response.json()).processing_status).toBe("failed");
      expect(
        calls.find((call) => call.method === "update")?.args[0],
      ).toMatchObject({ processing_status: "failed" });
    }, configured);
});
test("failed metadata insert cleans up the uploaded original", async () => {
  const { route, calls } = await setup([
    {},
    {},
    { error: { message: "Insert failed" } },
    {},
  ]);
  expect((await route.POST(uploadRequest())).status).toBe(503);
  const path = calls.find((call) => call.method === "upload")?.args[0];
  expect(calls.find((call) => call.method === "remove")?.args).toEqual([
    [path],
  ]);
});
test("reprocessing prevents duplicate concurrent jobs", async () => {
  await withWorkflow(async () => {
    let dispatched = false;
    globalThis.fetch = async () => {
      dispatched = true;
      return new Response("");
    };
    const { route } = await setup([
      { data: { id, processing_status: "processing" } },
    ]);
    expect((await route.PATCH(jsonRequest("PATCH"))).status).toBe(409);
    expect(dispatched).toBe(false);
    const racing = await setup([
      { data: { id, processing_status: "ready" } },
      { data: null },
    ]);
    expect((await racing.route.PATCH(jsonRequest("PATCH"))).status).toBe(409);
    expect(dispatched).toBe(false);
  });
});
test("deletion uses atomic vector cleanup and never deletes originals on RPC failure", async () => {
  const { route, calls } = await setup([
    { error: { code: "PGRST202", message: "Missing function" } },
  ]);
  expect((await route.DELETE(jsonRequest("DELETE"))).status).toBe(503);
  expect(calls).toEqual([
    {
      method: "rpc",
      args: ["delete_knowledge_document", { p_document_id: id }],
    },
  ]);
  const success = await setup([{ data: `${id}/original.txt` }, {}]);
  expect((await success.route.DELETE(jsonRequest("DELETE"))).status).toBe(200);
  expect(success.calls.map((call) => call.method)).toEqual([
    "rpc",
    "bucket",
    "remove",
  ]);
});
test("storage cleanup warning keeps successful knowledge base deletion explicit", async () => {
  const { route } = await setup([
    { data: `${id}/original.txt` },
    { error: { message: "Storage unavailable" } },
  ]);
  const response = await route.DELETE(jsonRequest("DELETE"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, warning: true });
});

test("an upload can be written for one position and keeps working without one", async () => {
  await withWorkflow(async () => {
    globalThis.fetch = async () => new Response("", { status: 202 });
    const none = await setup();
    expect((await none.route.POST(uploadRequest())).status).toBe(201);
    expect(
      Object.keys(
        none.calls.find((call) => call.method === "insert")!.args[0] as object,
      ),
    ).not.toContain("position");
    const withPosition = await setup();
    const response = await withPosition.route.POST(
      uploadRequest("sop.txt", "http://localhost/api/documents", undefined, " Guest Service Agent "),
    );
    expect(response.status).toBe(201);
    expect(
      withPosition.calls.find((call) => call.method === "insert")!.args[0],
    ).toMatchObject({ position: "Guest Service Agent" });
    const tooLong = await setup();
    expect(
      (
        await tooLong.route.POST(
          uploadRequest("sop.txt", "http://localhost/api/documents", undefined, "x".repeat(121)),
        )
      ).status,
    ).toBe(400);
  });
});
test("a position upload explains that migration 010 is missing", async () => {
  const { route } = await setup([
    { data: [] },
    { error: { code: "42703", message: "column position does not exist" } },
  ]);
  const response = await route.POST(
    uploadRequest("sop.txt", "http://localhost/api/documents", undefined, "Night Auditor"),
  );
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain("010");
});
const move = (body: unknown, origin?: string) =>
  new NextRequest("http://localhost/api/documents", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
test("moving a document updates its department and position for administrators only", async () => {
  expect((await (await setup([], false)).route.PUT(move({ id, department: "Front Office" }))).status).toBe(401);
  expect((await (await setup()).route.PUT(move({ id, department: "Front Office" }, "https://evil.example"))).status).toBe(403);
  expect((await (await setup()).route.PUT(move({ id: "x", department: "Front Office" }))).status).toBe(400);
  expect((await (await setup()).route.PUT(move({ id, department: "" }))).status).toBe(400);
  const ok = await setup([{ data: { id } }]);
  const response = await ok.route.PUT(move({ id, department: "Front Office", position: "Night Auditor" }));
  expect(response.status).toBe(200);
  expect(ok.calls.find((call) => call.method === "update")!.args[0]).toEqual({
    department: "Front Office Department",
    position: "Night Auditor",
  });
  const toAll = await setup([{ data: { id } }]);
  await toAll.route.PUT(move({ id, department: "Front Office", position: "" }));
  expect(toAll.calls.find((call) => call.method === "update")!.args[0]).toEqual({
    department: "Front Office Department",
    position: null,
  });
  const missing = await setup([{ data: null }]);
  expect((await missing.route.PUT(move({ id, department: "Front Office" }))).status).toBe(404);
});
test("a whole-hotel document never keeps a position", async () => {
  await withWorkflow(async () => {
    globalThis.fetch = async () => new Response("", { status: 202 });
    const upload = await setup();
    const form = uploadRequest("handbook.txt", "http://localhost/api/documents", undefined, "Night Auditor");
    const body = await form.formData();
    body.set("department", "Whole hotel");
    const request = new NextRequest("http://localhost/api/documents", { method: "POST", body });
    expect((await upload.route.POST(request)).status).toBe(201);
    const insert = upload.calls.find((call) => call.method === "insert")!.args[0] as Record<string, unknown>;
    expect(insert.department).toBe("All departments");
    expect(insert).not.toHaveProperty("position");
  });
  const moved = await setup([{ data: { id } }]);
  await moved.route.PUT(move({ id, department: "All departments", position: "Night Auditor" }));
  expect(moved.calls.find((call) => call.method === "update")!.args[0]).toEqual({
    department: "All departments",
    position: null,
  });
});
