import { NextResponse } from "next/server";
import { authorized } from "@/lib/supabase/server";
import type { Connection } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await authorized();
  if (!session)
    return NextResponse.json(
      { error: "Administrator access required." },
      { status: 401 },
    );
  async function check(
    name: string,
    url: string | undefined,
    detail: string,
    headers?: Record<string, string>,
  ): Promise<Connection> {
    if (!url)
      return {
        name,
        status: "unconfigured",
        detail: "Credentials not configured",
      };
    try {
      const res = await fetch(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      return {
        name,
        status: res.ok ? "online" : "offline",
        detail: res.ok ? detail : "Service check unsuccessful",
      };
    } catch {
      return {
        name,
        status: "offline",
        detail: "Service could not be reached",
      };
    }
  }
  const [line, n8n, gemini, db] = await Promise.all([
    check(
      "LINE OA",
      process.env.LINE_CHANNEL_ACCESS_TOKEN
        ? "https://api.line.me/v2/bot/info"
        : undefined,
      "Messaging channel",
      { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
    ),
    check("n8n Workflow", process.env.N8N_HEALTH_URL, "Automation engine"),
    check(
      "Gemini AI",
      process.env.GEMINI_API_KEY
        ? "https://generativelanguage.googleapis.com/v1beta/models"
        : undefined,
      "Intelligence & retrieval",
      { "x-goog-api-key": process.env.GEMINI_API_KEY || "" },
    ),
    session.supabase.from("users").select("id", { count: "exact", head: true }),
  ]);
  return NextResponse.json(
    [
      line,
      n8n,
      gemini,
      {
        name: "Supabase",
        status: db.error ? "offline" : "online",
        detail: db.error
          ? "Database query failed"
          : "Database & authentication",
      },
    ],
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
