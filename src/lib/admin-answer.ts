import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_REPLY_CATEGORY } from "./documents";
import { canonicalDepartment, WHOLE_HOTEL } from "./organization";

// Turns an admin reply into a knowledge document so the AI can answer the same
// question next time. It goes through the normal document pipeline (storage
// file + document_files row + n8n processing), so access rules, search,
// editing and deletion all work like any uploaded document. They are listed in
// the "Admin replies" group on the Documents page.
//
// The text file always starts with the marker below. The n8n prompt tells the
// assistant that content with this marker is an answer already confirmed by an
// admin.
export const ADMIN_ANSWER_MARKER = "คำตอบจากแอดมิน";

export type LearnScope = "department" | "hotel";
export type LearnResult = {
  status: "saved" | "updated" | "skipped" | "failed";
  message: string;
};

type Admin = { id: string; display_name: string };
type Chat = { id: string; user_id: string; question: string };

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

async function dispatch(
  supabase: SupabaseClient,
  id: string,
): Promise<LearnResult> {
  const fail = async (message: string): Promise<LearnResult> => {
    await supabase
      .from("document_files")
      .update({ processing_status: "failed", processing_error: message })
      .eq("id", id)
      .eq("processing_status", "processing");
    return { status: "failed", message };
  };
  if (!process.env.N8N_DOCUMENT_WEBHOOK_URL || !process.env.N8N_WEBHOOK_SECRET)
    return fail(
      "Saved, but the document workflow is not configured, so the assistant cannot use it yet. Reprocess it from the Documents page.",
    );
  try {
    const response = await fetch(process.env.N8N_DOCUMENT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ document_id: id, action: "reprocess" }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("rejected");
    return { status: "saved", message: "" };
  } catch {
    return fail(
      "Saved, but the processing workflow could not be reached. Reprocess it from the Documents page.",
    );
  }
}

export async function learnFromReply(
  supabase: SupabaseClient,
  admin: Admin,
  chat: Chat,
  scope: LearnScope,
): Promise<LearnResult> {
  try {
    // Needs migration 021; the reply itself is already delivered either way.
    const { data: link, error: linkError } = await supabase
      .from("chat_logs")
      .select("learned_document_id")
      .eq("id", chat.id)
      .maybeSingle();
    if (linkError)
      return {
        status: "failed",
        message:
          "The reply was sent, but it could not be saved for the assistant. Apply migration 021 in Supabase.",
      };

    const { data: employee } = await supabase
      .from("users")
      .select("department")
      .eq("id", chat.user_id)
      .maybeSingle();
    const department = canonicalDepartment(employee?.department || "");
    if (!department)
      return {
        status: "skipped",
        message:
          "The reply was sent, but this employee has no department, so it was not saved for the assistant.",
      };

    // Every text reply of the conversation, oldest first.
    const { data: rows } = await supabase
      .from("chat_replies")
      .select("message")
      .eq("chat_id", chat.id)
      .order("created_at", { ascending: true });
    const answers = (rows || [])
      .map((r) => String(r.message || "").trim())
      .filter(Boolean);
    if (!answers.length) return { status: "skipped", message: "" };

    const question = oneLine(chat.question);
    const body = [
      `${ADMIN_ANSWER_MARKER} (Admin-confirmed answer)`,
      "",
      `คำถาม (Question): ${question}`,
      "",
      "คำตอบ (Answer):",
      answers.join("\n\n"),
      "",
    ].join("\n");
    const bytes = new TextEncoder().encode(body);

    const hotel = scope === "hotel";
    const access = {
      department: hotel ? WHOLE_HOTEL : department,
      position: null,
      list_department: hotel ? department : null,
      list_position: null,
    };
    const name = `${ADMIN_ANSWER_MARKER}: ${question.slice(0, 60)}${question.length > 60 ? "…" : ""}.txt`;
    const description = `Answer by ${admin.display_name} to a question the assistant could not answer.`;
    const now = new Date().toISOString();

    let id = link?.learned_document_id as string | null | undefined;
    let existing = false;
    if (id) {
      const { data: doc } = await supabase
        .from("document_files")
        .select("id, file_url")
        .eq("id", id)
        .maybeSingle();
      existing = Boolean(doc);
      if (!doc) id = null;
    }

    if (id && existing) {
      const path = `${id}/original.txt`;
      // Replace the stored text (there is no storage update policy, so
      // remove it first and upload again).
      await supabase.storage.from("knowledge-base").remove([path]);
      const { error: uploadError } = await supabase.storage
        .from("knowledge-base")
        .upload(path, bytes, { contentType: "text/plain", upsert: false });
      if (uploadError)
        return {
          status: "failed",
          message:
            "The reply was sent, but the saved answer could not be updated. Check the knowledge-base storage bucket.",
        };
      const { error } = await supabase
        .from("document_files")
        .update({
          document_name: name,
          description,
          file_url: path,
          file_size: bytes.length,
          ...access,
          processing_status: "processing",
          processing_error: null,
          processing_started_at: now,
        })
        .eq("id", id);
      if (error)
        return {
          status: "failed",
          message:
            "The reply was sent, but the saved answer could not be updated.",
        };
      const result = await dispatch(supabase, id);
      return result.status === "failed"
        ? result
        : {
            status: "updated",
            message:
              "Reply sent. The assistant's saved answer for this question was updated.",
          };
    }

    const newId = crypto.randomUUID();
    const path = `${newId}/original.txt`;
    const { error: uploadError } = await supabase.storage
      .from("knowledge-base")
      .upload(path, bytes, { contentType: "text/plain", upsert: false });
    if (uploadError)
      return {
        status: "failed",
        message:
          "The reply was sent, but it could not be saved for the assistant. Check the knowledge-base storage bucket.",
      };
    const { error: insertError } = await supabase
      .from("document_files")
      .insert({
        id: newId,
        document_name: name,
        original_filename: "admin-answer.txt",
        document_type: ADMIN_REPLY_CATEGORY,
        description,
        file_type: "txt",
        file_url: path,
        file_size: bytes.length,
        uploaded_by: admin.id,
        uploaded_by_name: admin.display_name,
        processing_status: "processing",
        processing_started_at: now,
        embeddings_count: 0,
        chunks_count: 0,
        rag_source_id: newId,
        ...access,
      });
    if (insertError) {
      await supabase.storage.from("knowledge-base").remove([path]);
      return {
        status: "failed",
        message:
          "The reply was sent, but it could not be saved for the assistant. Apply migrations 010, 020 and 022 in Supabase.",
      };
    }
    await supabase
      .from("chat_logs")
      .update({ learned_document_id: newId })
      .eq("id", chat.id);
    const result = await dispatch(supabase, newId);
    return result.status === "failed"
      ? result
      : {
          status: "saved",
          message: hotel
            ? "Reply sent. The assistant will use it for anyone who asks the same question."
            : `Reply sent. The assistant will use it when someone in ${department} asks the same question.`,
        };
  } catch {
    return {
      status: "failed",
      message:
        "The reply was sent, but it could not be saved for the assistant.",
    };
  }
}
