import { NextResponse } from "next/server";
import { authorized } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await authorized();
  if (!session)
    return NextResponse.json(
      { error: "Administrator access required." },
      { status: 401 },
    );
  const { supabase } = session;
  // Supabase limits each request to 1,000 rows. Page through all records so totals
  // and exports remain accurate instead of silently showing truncated results.
  async function all(table: string, order: string, headsOnly = false) {
    const result: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = supabase.from(table).select("*");
      // Follow-up messages of a "ติดต่อแอดมิน" conversation belong to their
      // thread head; they are shown inside its details, not as separate questions.
      if (headsOnly) query = query.is("thread_id", null);
      const { data, error } = await query
        .order(order, { ascending: false })
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      result.push(...data);
      if (data.length < 1000) return result;
    }
  }
  try {
    const [users, chats, documents, admins] = await Promise.all([
      all("users", "created_at"),
      all("chat_logs", "created_at", true),
      all("document_files", "uploaded_at"),
      all("admins", "created_at"),
    ]);
    return NextResponse.json(
      { users, chats, documents, admins },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Unable to load workspace data. Check your Supabase connection and database migration.",
      },
      { status: 503 },
    );
  }
}