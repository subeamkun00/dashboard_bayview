import { canonicalDepartment, isWholeHotel } from "@/lib/organization";

const cleanText = (value: unknown, max: number) =>
  typeof value === "string" &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : null;
import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-origin";
import {
  documentCategories,
  documentMimeTypes,
  validateDocumentFile,
} from "@/lib/documents";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const workflowConfigured = () =>
  Boolean(
    process.env.N8N_DOCUMENT_WEBHOOK_URL && process.env.N8N_WEBHOOK_SECRET,
  );
const migrationError =
  "Document management is not configured yet. Apply the document management migration in Supabase.";

async function markFailed(
  supabase: SupabaseClient,
  id: string,
  message: string,
) {
  const { error } = await supabase
    .from("document_files")
    .update({ processing_status: "failed", processing_error: message })
    .eq("id", id)
    .eq("processing_status", "processing");
  if (error)
    throw new Error(
      "Document saved, but its processing status could not be updated. Refresh and check before retrying.",
    );
}
async function dispatch(supabase: SupabaseClient, id: string) {
  if (!workflowConfigured()) {
    const message =
      "Document saved, but processing is unavailable. Configure the document workflow, then reprocess this document.";
    await markFailed(supabase, id, message);
    return { processing_status: "failed", message };
  }
  try {
    const response = await fetch(process.env.N8N_DOCUMENT_WEBHOOK_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET!,
      },
      // Preserve the existing webhook contract; metadata is read by document_id.
      body: JSON.stringify({ document_id: id, action: "reprocess" }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Workflow rejected the document.");
    return {
      processing_status: "processing",
      message: "Document uploaded and queued for processing.",
    };
  } catch {
    const message =
      "Document saved, but the processing workflow could not be reached. Check the document status before using Reprocess.";
    await markFailed(supabase, id, message);
    return { processing_status: "failed", message };
  }
}
export async function GET(request: NextRequest) {
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const id = request.nextUrl.searchParams.get("id");
  if (!validId(id)) return fail("A valid document ID is required.");
  const { data: doc, error: readError } = await session.supabase
    .from("document_files")
    .select("file_url")
    .eq("id", id)
    .maybeSingle();
  if (readError) return fail("Unable to load the document.", 503);
  if (!doc) return fail("Document not found.", 404);
  const { data, error } = await session.supabase.storage
    .from("knowledge-base")
    .createSignedUrl(doc.file_url, 120);
  return error
    ? fail("Unable to download the document.", 503)
    : NextResponse.json(
        { url: data.signedUrl },
        { headers: { "Cache-Control": "private, no-store" } },
      );
}
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  try {
    const form = await request.formData();
    const file = form.get("file");
    const category = form.get("document_type");
    const title = form.get("title") ?? "";
    const department = form.get("department");
    const description = form.get("description") ?? "";
    const position = form.get("position") ?? "";
    const listDepartment = cleanText(form.get("list_department") ?? "", 100);
    const listPosition = cleanText(form.get("list_position") ?? "", 120);
    if (
      !(file instanceof File) ||
      typeof category !== "string" ||
      !documentCategories.some((value) => value === category)
    )
      return fail("Choose a file and valid document category.");
    const validation = validateDocumentFile(file);
    if (validation) return fail(validation);
    if (
      typeof title !== "string" ||
      title.length > 200 ||
      typeof department !== "string" ||
      !department.trim() ||
      department.length > 100 ||
      typeof description !== "string" ||
      description.length > 2000 ||
      typeof position !== "string" ||
      position.length > 120 ||
      /[\u0000-\u001f\u007f]/.test(position)
    )
      return fail("Enter a department and valid document metadata.");
    // A whole-hotel document must say which list it belongs to.
    if (listDepartment === null || listPosition === null)
      return fail("Enter a valid department and position for the list.");
    if (isWholeHotel(department) && !listDepartment)
      return fail("Choose the department this document is listed under.");
    // Preflight the migration before writing Storage; never discard metadata.
    const { error: schemaError } = await session.supabase
      .from("document_files")
      .select("original_filename,department,processing_error")
      .limit(0);
    if (schemaError) return fail(migrationError, 503);
    if (listDepartment) {
      const { error: listError } = await session.supabase
        .from("document_files")
        .select("list_department")
        .limit(0);
      if (listError)
        return fail(
          "Document lists are not configured yet. Apply migration 020 in Supabase.",
          503,
        );
    }
    if (position.trim()) {
      const { error: positionError } = await session.supabase
        .from("document_files")
        .select("position")
        .limit(0);
      if (positionError)
        return fail(
          "Document positions are not configured yet. Apply migration 010 in Supabase.",
          503,
        );
    }
    const extension = file.name.split(".").pop()!.toLowerCase();
    const id = crypto.randomUUID();
    const path = `${id}/original.${extension}`;
    const { error: uploadError } = await session.supabase.storage
      .from("knowledge-base")
      .upload(path, file, {
        contentType: documentMimeTypes[extension],
        upsert: false,
      });
    if (uploadError)
      return fail(
        "Upload failed. Check the private knowledge-base storage bucket and try again.",
        503,
      );
    const { error } = await session.supabase.from("document_files").insert({
      id,
      document_name: title.trim() || file.name,
      original_filename: file.name,
      document_type: category,
      department: canonicalDepartment(department),
      ...(position.trim() &&
        !isWholeHotel(department) && { position: position.trim() }),
      ...(isWholeHotel(department) && {
        list_department: canonicalDepartment(listDepartment),
        list_position: listPosition || null,
      }),
      description: description.trim(),
      file_type: extension,
      file_url: path,
      file_size: file.size,
      uploaded_by: session.admin.id,
      uploaded_by_name: session.admin.display_name,
      processing_status: "processing",
      processing_started_at: new Date().toISOString(),
      embeddings_count: 0,
      chunks_count: 0,
      rag_source_id: id,
    });
    if (error) {
      const { error: cleanupError } = await session.supabase.storage
        .from("knowledge-base")
        .remove([path]);
      return fail(
        cleanupError
          ? "Unable to save document metadata. The uploaded file also needs storage cleanup by an administrator."
          : "Unable to save document metadata. Please try again.",
        503,
      );
    }
    try {
      const result = await dispatch(session.supabase, id);
      return NextResponse.json({ id, ...result }, { status: 201 });
    } catch (problem) {
      // The original is persisted: do not encourage retrying the upload itself.
      return NextResponse.json(
        {
          id,
          processing_status: "failed",
          message:
            problem instanceof Error
              ? problem.message
              : "Document saved; processing could not start.",
        },
        { status: 201 },
      );
    }
  } catch {
    return fail("Unable to read the upload request.");
  }
}
// Move a document to another department / position. The database then
// re-tags every chunk of the document, so the AI follows immediately.
export async function PUT(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  let body: {
    id?: unknown;
    department?: unknown;
    position?: unknown;
    list_department?: unknown;
    list_position?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request body.");
  }
  if (!validId(body.id)) return fail("A valid document ID is required.");
  const department =
    typeof body.department === "string" ? body.department.trim() : "";
  const position =
    typeof body.position === "string" ? body.position.trim() : "";
  const listDepartment = cleanText(body.list_department ?? "", 100);
  const listPosition = cleanText(body.list_position ?? "", 120);
  if (
    !department ||
    department.length > 100 ||
    position.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(position) ||
    listDepartment === null ||
    listPosition === null
  )
    return fail("Choose a department and a valid position.");
  if (isWholeHotel(department) && !listDepartment)
    return fail("Choose the department this document is listed under.");
  const { data, error } = await session.supabase
    .from("document_files")
    .update({
      department: canonicalDepartment(department),
      position: isWholeHotel(department) ? null : position || null,
      list_department: isWholeHotel(department)
        ? canonicalDepartment(listDepartment)
        : null,
      list_position: isWholeHotel(department) ? listPosition || null : null,
    })
    .eq("id", body.id)
    .select("id")
    .maybeSingle();
  if (error)
    return fail(
      error.code === "42703" || error.code === "PGRST204"
        ? "Document lists are not configured yet. Apply migrations 010 and 020 in Supabase."
        : "Unable to update this document.",
      503,
    );
  if (!data) return fail("Document not found.", 404);
  return NextResponse.json({ success: true });
}
export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  let id: unknown;
  try {
    ({ id } = await request.json());
  } catch {
    return fail("Invalid request body.");
  }
  if (!validId(id)) return fail("A valid document ID is required.");
  if (!workflowConfigured())
    return fail(
      "Document processing is unavailable. Configure the document workflow before reprocessing.",
      503,
    );
  const { data: current, error: readError } = await session.supabase
    .from("document_files")
    .select("id,processing_status")
    .eq("id", id)
    .maybeSingle();
  if (readError) return fail("Unable to load the document.", 503);
  if (!current) return fail("Document not found.", 404);
  if (current.processing_status === "processing")
    return fail(
      "This document is already processing. Please wait for it to finish.",
      409,
    );
  // Claim exactly one job, retaining counts until the workflow replaces vectors.
  const { data: claimed, error } = await session.supabase
    .from("document_files")
    .update({
      processing_status: "processing",
      processing_error: null,
      processing_started_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("processing_status", current.processing_status)
    .select("id")
    .maybeSingle();
  if (error) return fail(migrationError, 503);
  if (!claimed)
    return fail(
      "This document is already processing. Refresh its status.",
      409,
    );
  try {
    const result = await dispatch(session.supabase, id);
    return result.processing_status === "failed"
      ? fail(result.message, 503)
      : NextResponse.json({ success: true, ...result });
  } catch (problem) {
    return fail(
      problem instanceof Error
        ? problem.message
        : "Unable to reprocess document.",
      503,
    );
  }
}
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  let id: unknown;
  try {
    ({ id } = await request.json());
  } catch {
    return fail("Invalid request body.");
  }
  if (!validId(id)) return fail("A valid document ID is required.");
  // Atomically remove metadata and vectors; never fall back to metadata-only.
  const { data: path, error } = await session.supabase.rpc(
    "delete_knowledge_document",
    { p_document_id: id },
  );
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883")
      return fail(migrationError, 503);
    if (error.message?.includes("not linked"))
      return fail(
        "This legacy document must be linked to its knowledge base source before deletion. Ask your administrator to set its source ID.",
        409,
      );
    if (error.message?.includes("Document not found"))
      return fail("Document not found.", 404);
    return fail(
      "Unable to remove the document from the knowledge base. No file was deleted.",
      503,
    );
  }
  // Vectors are gone even if original-file cleanup fails.
  if (path) {
    const { error: cleanupError } = await session.supabase.storage
      .from("knowledge-base")
      .remove([path]);
    if (cleanupError)
      return NextResponse.json({
        success: true,
        warning: true,
        message:
          "Document removed from the AI knowledge base. The original file needs storage cleanup by an administrator.",
      });
  }
  return NextResponse.json({
    success: true,
    message: "Document removed from the AI knowledge base.",
  });
}
