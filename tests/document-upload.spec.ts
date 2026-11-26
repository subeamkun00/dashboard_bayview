import { test, expect } from "@playwright/test";
import { uploadWithProgress } from "../src/lib/document-upload";

test("document upload reports transfer progress and preserves server success or failure", async () => {
  const original = globalThis.XMLHttpRequest;
  let transport: MockRequest;
  class MockRequest {
    responseType = "";
    timeout = 0;
    status = 0;
    response: unknown;
    upload: {
      onprogress?: (event: {
        loaded: number;
        total: number;
        lengthComputable: boolean;
      }) => void;
    } = {};
    onload?: () => void;
    onerror?: () => void;
    ontimeout?: () => void;
    onabort?: () => void;
    method = "";
    url = "";
    body?: FormData;
    constructor() {
      transport = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    send(form: FormData) {
      this.body = form;
    }
  }
  globalThis.XMLHttpRequest = MockRequest as unknown as typeof XMLHttpRequest;
  try {
    const progress: (number | null)[] = [];
    const form = new FormData();
    form.append("department", "Front Office");
    const request = uploadWithProgress(form, (value) => progress.push(value));
    expect(transport!.method).toBe("POST");
    expect(transport!.url).toBe("/api/documents");
    expect(transport!.body).toBe(form);
    expect(transport!.timeout).toBe(120000);
    transport!.upload.onprogress?.({
      loaded: 5,
      total: 10,
      lengthComputable: true,
    });
    transport!.upload.onprogress?.({
      loaded: 10,
      total: 10,
      lengthComputable: true,
    });
    transport!.upload.onprogress?.({
      loaded: 0,
      total: 0,
      lengthComputable: false,
    });
    expect(progress).toEqual([50, 100, null]);
    transport!.status = 201;
    transport!.response = {
      id: "document-id",
      processing_status: "processing",
      message: "Queued",
    };
    transport!.onload?.();
    await expect(request).resolves.toMatchObject({
      id: "document-id",
      processing_status: "processing",
    });
    const rejected = uploadWithProgress(form, () => {});
    transport!.status = 503;
    transport!.response = { error: "Storage temporarily unavailable" };
    transport!.onload?.();
    await expect(rejected).rejects.toThrow("Storage temporarily unavailable");
    for (const event of ["onerror", "ontimeout", "onabort"] as const) {
      const failed = uploadWithProgress(form, () => {});
      transport![event]?.();
      await expect(failed).rejects.toThrow(
        "Check the document list before retrying",
      );
    }
  } finally {
    if (original === undefined)
      delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    else globalThis.XMLHttpRequest = original;
  }
});
