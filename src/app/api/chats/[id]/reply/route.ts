import { learnFromReply, type LearnScope } from "@/lib/admin-answer";
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { authorized } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-origin";

const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const BUCKET = "chat-attachments";
const MAX_MESSAGE = 2000;
const MAX_FILES = 5;
// Added at the bottom of every admin reply to a question, so the employee knows
// how to ask for more. Not used in "ติดต่อแอดมิน" chats (already talking to an admin).
// Edit the wording here. The button name should match the LINE menu button.
const REPLY_FOOTER = [
  "หากต้องการทราบข้อมูลเพิ่มเติม กรุณากดปุ่ม “ติดต่อแอดมิน” เพื่อพูดคุยโดยตรง จะได้รับรายละเอียดที่ครบถ้วนยิ่งขึ้นครับ",
  "For more information, please tap the “ติดต่อแอดมิน” (Contact Admin) button to chat directly.",
];
const MAX_IMAGES = 4; // LINE allows 5 messages per push: 1 text + 4 images.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // LINE limit for image messages
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const LINE_TEXT_LIMIT = 4900; // LINE's hard limit is 5000
const LINK_TTL = 60 * 60 * 24 * 30; // links sent to LINE stay valid 30 days
const VIEW_TTL = 60 * 60; // links shown in the dashboard

// Only these types may be attached. The server decides the stored type from
// the extension; it never trusts the browser's MIME value.
const TYPES: Record<string, { mime: string; image?: boolean }> = {
  jpg: { mime: "image/jpeg", image: true },
  jpeg: { mime: "image/jpeg", image: true },
  png: { mime: "image/png", image: true },
  gif: { mime: "image/gif" },
  webp: { mime: "image/webp" },
  pdf: { mime: "application/pdf" },
  doc: { mime: "application/msword" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xls: { mime: "application/vnd.ms-excel" },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ppt: { mime: "application/vnd.ms-powerpoint" },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  csv: { mime: "text/csv" },
  txt: { mime: "text/plain" },
};
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() || "";

type Stored = {
  name: string;
  kind: "image" | "file";
  mime: string;
  size: number;
  path: string;
  preview_path: string | null;
};

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const { id } = await context.params;
  if (!UUID.test(id)) return fail("Invalid conversation.", 404);
  const { supabase } = session;
  // Messages the employee sent on LINE after pressing "ติดต่อแอดมิน".
  const { data: followups, error: followupError } = await supabase
    .from("chat_logs")
    .select("id, question, created_at")
    .eq("thread_id", id)
    .order("created_at", { ascending: true });
  if (followupError) return fail("Unable to load the conversation.", 503);
  const { data, error } = await supabase
    .from("chat_replies")
    .select("id, admin_name, message, attachments, created_at")
    .eq("chat_id", id)
    .order("created_at", { ascending: true });
  if (error) return fail("Unable to load replies.", 503);
  const rows = data || [];
  const paths = rows.flatMap((r) =>
    ((r.attachments || []) as Stored[]).flatMap((a) =>
      [a.path, a.preview_path].filter((p): p is string => Boolean(p)),
    ),
  );
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, VIEW_TTL);
    for (const s of signed || [])
      if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const replies = rows.map((r) => ({
    id: r.id,
    admin_name: r.admin_name,
    message: r.message,
    created_at: r.created_at,
    attachments: ((r.attachments || []) as Stored[]).map((a) => ({
      name: a.name,
      kind: a.kind,
      mime: a.mime,
      size: a.size,
      url: urls.get(a.path) || "",
      preview_url: a.preview_path ? urls.get(a.preview_path) || null : null,
    })),
  }));
  const messages = (followups || []).map((m) => ({
    id: m.id,
    message: m.question,
    created_at: m.created_at,
  }));
  return NextResponse.json(
    { replies, messages },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const { id } = await context.params;
  if (!UUID.test(id)) return fail("Invalid conversation.", 404);

  let message = "";
  let learn = false;
  let learnScope: LearnScope = "department";
  let files: File[] = [];
  try {
    const form = await request.formData();
    message = String(form.get("message") ?? "").trim();
    learn = form.get("learn") === "1";
    learnScope = form.get("learn_scope") === "hotel" ? "hotel" : "department";
    files = form
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);
  } catch {
    return fail("Invalid request body.");
  }
  if (!message && !files.length)
    return fail("Please type a reply or attach a file.");
  if (message.length > MAX_MESSAGE)
    return fail(
      `Reply must be ${MAX_MESSAGE.toLocaleString()} characters or fewer.`,
    );
  if (files.length > MAX_FILES)
    return fail(`Attach at most ${MAX_FILES} files per reply.`);
  let total = 0;
  let images = 0;
  for (const f of files) {
    const type = TYPES[extOf(f.name)];
    if (!type) return fail(`"${f.name}" is not an allowed file type.`);
    if (type.image) {
      images += 1;
      if (f.size > MAX_IMAGE_BYTES)
        return fail(`"${f.name}" is larger than 10 MB (LINE's image limit).`);
    }
    if (f.size > MAX_FILE_BYTES)
      return fail(`"${f.name}" is larger than 20 MB.`);
    total += f.size;
  }
  if (images > MAX_IMAGES)
    return fail(`Attach at most ${MAX_IMAGES} JPG/PNG images per reply.`);
  if (total > MAX_TOTAL_BYTES)
    return fail("Attachments are larger than 20 MB in total.");

  const { supabase, admin } = session;
  const { data: chat, error: chatError } = await supabase
    .from("chat_logs")
    .select("id, user_id, question, category, response_status")
    .eq("id", id)
    .maybeSingle();
  if (chatError) return fail("Unable to load this conversation.", 503);
  if (!chat) return fail("Conversation not found.", 404);
  if (!["fallback", "replied"].includes(chat.response_status))
    return fail("Only fallback conversations can be replied to.", 409);

  // Record why delivery failed so the dashboard can show it. The admin's text
  // and files stay in their browser, so nothing is lost.
  const recordFailure = async (reason: string) => {
    await supabase
      .from("chat_logs")
      .update({ reply_delivery: "failed", reply_error: reason.slice(0, 300) })
      .eq("id", id);
  };

  const { data: employee, error: userError } = await supabase
    .from("users")
    .select("line_user_id")
    .eq("id", chat.user_id)
    .maybeSingle();
  if (userError) return fail("Unable to load the employee.", 503);
  if (!employee?.line_user_id) {
    const reason = "This employee has not linked a LINE account yet.";
    await recordFailure(reason);
    return fail(`${reason} Nothing was sent.`, 422);
  }
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    const reason = "LINE_CHANNEL_ACCESS_TOKEN is not configured on the server.";
    await recordFailure(reason);
    return fail(`${reason} Nothing was sent.`, 503);
  }

  // ---- Upload attachments to the private bucket -------------------------
  const stored: Stored[] = [];
  const uploaded: string[] = [];
  const cleanup = async () => {
    if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded);
  };
  for (const f of files) {
    const ext = extOf(f.name);
    const type = TYPES[ext];
    const folder = `${id}/${crypto.randomUUID()}`;
    // Storage keys must be plain ASCII, so the display name is kept in the
    // metadata and the stored object is called "file.<ext>".
    const path = `${folder}/file.${ext}`;
    const buffer = Buffer.from(await f.arrayBuffer());
    let previewPath: string | null = null;
    let mime = type.mime;
    if (type.image) {
      try {
        const meta = await sharp(buffer).metadata();
        if (meta.format !== "jpeg" && meta.format !== "png") throw new Error();
        mime = meta.format === "png" ? "image/png" : "image/jpeg";
        const preview = await sharp(buffer)
          .rotate()
          .resize(480, 480, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 72 })
          .toBuffer();
        previewPath = `${folder}/preview.jpg`;
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(previewPath, preview, { contentType: "image/jpeg" });
        if (error) throw error;
        uploaded.push(previewPath);
      } catch {
        await cleanup();
        return fail(`"${f.name}" is not a valid JPG or PNG image.`);
      }
    }
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: mime });
    if (error) {
      await cleanup();
      return fail(
        "Unable to upload the attachments. Check the chat-attachments storage bucket.",
        503,
      );
    }
    uploaded.push(path);
    stored.push({
      name: f.name,
      kind: type.image ? "image" : "file",
      mime,
      size: f.size,
      path,
      preview_path: previewPath,
    });
  }

  // ---- Build the LINE messages ------------------------------------------
  const links = new Map<string, string>();
  if (uploaded.length) {
    const { data: signed, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(uploaded, LINK_TTL);
    if (error) {
      await cleanup();
      return fail("Unable to create download links for the attachments.", 503);
    }
    for (const s of signed || [])
      if (s.path && s.signedUrl) links.set(s.path, s.signedUrl);
  }
  const { count } = await supabase
    .from("chat_replies")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", id);
  // Contact threads read like a LINE chat, so no need to quote a question.
  const first = !count && chat.category !== "Contact";
  const question = chat.question.replace(/\s+/g, " ").trim();
  const lines = ["💬 ข้อความจากแอดมิน (Admin reply)"];
  if (first)
    lines.push(
      "",
      `คำถามของคุณ: “${question.length > 120 ? `${question.slice(0, 117)}...` : question}”`,
    );
  if (message) lines.push("", message);
  const fileLinks = stored.filter((s) => s.kind === "file");
  if (fileLinks.length) {
    lines.push("", "📎 ไฟล์แนบ (ลิงก์ใช้ได้ 30 วัน):");
    for (const s of fileLinks)
      lines.push(`${s.name}\n${links.get(s.path) || ""}`);
  }
  lines.push("", `— ${admin.display_name}`);
  if (chat.category !== "Contact") lines.push("", "─────────", ...REPLY_FOOTER);
  const text = lines.join("\n");
  if (text.length > LINE_TEXT_LIMIT) {
    await cleanup();
    return fail(
      "The reply is too long once the file links are added. Shorten the message or attach fewer files.",
    );
  }
  const messages: unknown[] = [{ type: "text", text }];
  for (const s of stored.filter((s) => s.kind === "image"))
    messages.push({
      type: "image",
      originalContentUrl: links.get(s.path),
      previewImageUrl: links.get(s.preview_path || s.path),
    });

  // ---- Send ----------------------------------------------------------------
  let pushError = "";
  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Line-Retry-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ to: employee.line_user_id, messages }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const detail = await res
        .json()
        .then((r: { message?: string }) => r.message)
        .catch(() => undefined);
      pushError = `LINE returned ${res.status}${detail ? `: ${detail}` : ""}`;
    }
  } catch {
    pushError = "Could not reach LINE (network error or timeout)";
  }
  if (pushError) {
    await cleanup();
    await recordFailure(pushError);
    return fail(`${pushError}. Nothing was sent.`, 502);
  }

  // ---- Save the thread entry and update the conversation -------------------
  const { error: insertError } = await supabase.from("chat_replies").insert({
    chat_id: id,
    admin_id: admin.id,
    admin_name: admin.display_name,
    message,
    attachments: stored,
  });
  const { error: updateError } = await supabase
    .from("chat_logs")
    .update({
      response_status: "replied",
      admin_reply: message || stored.map((s) => s.name).join(", "),
      replied_by: admin.id,
      replied_by_name: admin.display_name,
      replied_at: new Date().toISOString(),
      reply_delivery: "sent",
      reply_error: null,
    })
    .eq("id", id);
  if (insertError || updateError)
    return fail(
      "The message was delivered on LINE, but saving it failed. Do not send it again; refresh the page.",
      500,
    );
  // Optionally teach the assistant this answer. The reply is already
  // delivered, so a problem here is only reported, never an error.
  const learned =
    learn && message && chat.category !== "Contact"
      ? await learnFromReply(supabase, admin, chat, learnScope)
      : null;
  return NextResponse.json(
    { ok: true, learned },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
