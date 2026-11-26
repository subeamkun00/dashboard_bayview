// Supabase Edge Function: document-link
//
// Called by the n8n tool "get_document_link" when an employee agrees to receive
// the full file of a document in LINE. It
//   1. checks the shared secret,
//   2. finds the employee by LINE user id and lists the documents that
//      employee may read (same rule as the AI search),
//   3. picks the best match for the file name / keywords,
//   4. returns a temporary download link (the storage bucket stays private).
//
// Deploy: see docs/document-file-links.md. Needs the secret DOCUMENT_LINK_SECRET
// (same value as the n8n header-auth credential). SUPABASE_URL and the secret
// API key (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY) are provided by
// Supabase automatically.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "knowledge-base";
const LINK_SECONDS = 24 * 60 * 60; // the link works for 24 hours
const MAX_FILES = 3;

// --- pure helpers (kept free of Deno APIs so they can be tested) -------------
type Doc = {
  id: string;
  document_name: string | null;
  original_filename: string | null;
  file_url: string;
  file_type: string | null;
};
const IGNORED = new Set([
  "file", "ไฟล์", "เอกสาร", "ฉบับเต็ม", "ฉบับ", "pdf", "txt", "docx", "md", "link", "ลิงก์",
]);
const clean = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9\u0e00-\u0e7f]+/g, " ").trim();
const tokens = (text: string) =>
  clean(text)
    .split(" ")
    .filter((t) => t && !IGNORED.has(t));
const baseName = (doc: Doc) =>
  clean(
    (doc.original_filename || doc.document_name || "").replace(/\.[a-z0-9]{2,5}$/i, ""),
  );
// pdf first: it keeps the original layout and pictures.
const formatRank = (doc: Doc) => {
  const type = (doc.file_type || "").toLowerCase();
  return type === "pdf" ? 0 : type === "docx" ? 1 : 2;
};
export function pickDocuments(docs: Doc[], search: string, limit = MAX_FILES): Doc[] {
  const wanted = tokens(search);
  if (!wanted.length) return [];
  const scored = docs
    .map((doc) => {
      const haystack = clean(`${doc.document_name || ""} ${doc.original_filename || ""}`);
      return { doc, score: wanted.filter((t) => haystack.includes(t)).length };
    })
    .filter((x) => x.score > 0);
  const best = Math.max(0, ...scored.map((x) => x.score));
  // Keep only documents that match about as well as the best one.
  const close = scored.filter((x) => x.score >= Math.max(1, best - 1));
  close.sort(
    (a, b) =>
      b.score - a.score || formatRank(a.doc) - formatRank(b.doc) || a.doc.id.localeCompare(b.doc.id),
  );
  // The same document uploaded as PDF and TXT: offer one file only.
  const seen = new Set<string>();
  const result: Doc[] = [];
  for (const { doc } of close) {
    const key = baseName(doc);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(doc);
    if (result.length >= limit) break;
  }
  return result;
}
// --- end of pure helpers ------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
// Supabase now provides SUPABASE_SECRET_KEYS (a JSON dictionary of secret API
// keys); older projects still have SUPABASE_SERVICE_ROLE_KEY. Use whichever exists.
const secretKey = () => {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const first = Object.values(keys)[0];
    return typeof first === "string" ? first : "";
  } catch {
    return "";
  }
};
const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("DOCUMENT_LINK_SECRET") || "";
  const sent = request.headers.get("x-webhook-secret") || "";
  if (!secret || !sameSecret(sent, secret)) return json({ error: "Unauthorized" }, 401);

  let body: { line_user_id?: unknown; search?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const lineUserId = typeof body.line_user_id === "string" ? body.line_user_id.trim() : "";
  const search = typeof body.search === "string" ? body.search.slice(0, 200) : "";
  if (!lineUserId || !search.trim()) {
    return json({ error: "line_user_id and search are required" }, 400);
  }

  const serviceKey = secretKey();
  if (!serviceKey) return json({ error: "Server key is not available" }, 500);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const { data: user } = await supabase
      .from("users")
      .select("department, position, is_department_head, can_access_all_documents")
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    if (!user?.department) {
      return json({ files: [], message: "Employee not found or has no department." });
    }

    const { data: docs, error } = await supabase.rpc("accessible_documents", {
      p_department: user.department,
      p_position: user.position || "",
      p_head: Boolean(user.is_department_head),
      p_all_access: Boolean(user.can_access_all_documents),
    });
    if (error) throw error;

    const files = [];
    for (const doc of pickDocuments((docs || []) as Doc[], search)) {
      const type = (doc.file_type || "").toLowerCase();
      // PDFs open in the browser; other types (txt, md) are downloaded so that
      // Thai text is not shown with the wrong encoding.
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(
          doc.file_url,
          LINK_SECONDS,
          type === "pdf" ? undefined : { download: doc.original_filename || true },
        );
      if (signed?.signedUrl) {
        files.push({
          name: doc.document_name || doc.original_filename || "document",
          type,
          url: signed.signedUrl,
        });
      }
    }
    return json(
      files.length
        ? { files, link_valid_hours: LINK_SECONDS / 3600 }
        : { files: [], message: "No accessible file matches that name." },
    );
  } catch {
    return json({ error: "Could not create the link" }, 500);
  }
});
