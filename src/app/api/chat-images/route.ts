import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-origin";
import {
  chatImageMimeTypes,
  maxChatImageBytes,
  normalizeKeywords,
} from "@/lib/chat-images";

export const dynamic = "force-dynamic";
const bucket = "line-images";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const migrationError =
  "Chat images are not configured yet. Apply migration 016 in Supabase.";

export async function GET() {
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const { data, error } = await session.supabase
    .from("chat_images")
    .select("id,title,keywords,image_url,is_active,created_at")
    .order("created_at", { ascending: false });
  if (error) return fail(migrationError, 503);
  return NextResponse.json(
    { images: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const form = await request.formData();
  const file = form.get("file");
  const title = form.get("title");
  const keywordsInput = form.get("keywords");
  if (!(file instanceof File)) return fail("Choose an image file.");
  const extension = chatImageMimeTypes[file.type];
  if (!extension) return fail("Only JPEG or PNG images are supported.");
  if (file.size === 0 || file.size > maxChatImageBytes)
    return fail("The image must be 1 MB or smaller (LINE preview limit).");
  if (typeof title !== "string" || !title.trim() || title.length > 200)
    return fail("Enter a title (up to 200 characters).");
  const keywords =
    typeof keywordsInput === "string" ? normalizeKeywords(keywordsInput) : "";
  if (!keywords) return fail("Enter at least one keyword (up to 500 characters).");

  // Preflight the migration before writing Storage.
  const { error: schemaError } = await session.supabase
    .from("chat_images")
    .select("id")
    .limit(0);
  if (schemaError) return fail(migrationError, 503);

  const path = `${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await session.supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError)
    return fail(
      "Could not upload the image. Check that the line-images bucket exists.",
      503,
    );
  const { data: publicUrl } = session.supabase.storage
    .from(bucket)
    .getPublicUrl(path);
  const { data, error } = await session.supabase
    .from("chat_images")
    .insert({
      title: title.trim(),
      keywords,
      file_path: path,
      image_url: publicUrl.publicUrl,
      created_by: session.admin.id,
    })
    .select("id,title,keywords,image_url,is_active,created_at")
    .single();
  if (error) {
    await session.supabase.storage.from(bucket).remove([path]);
    return fail("The image was uploaded but could not be saved. Try again.", 503);
  }
  return NextResponse.json({ image: data });
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.id) || typeof body.is_active !== "boolean")
    return fail("A valid image and status are required.");
  const { error } = await session.supabase
    .from("chat_images")
    .update({ is_active: body.is_active })
    .eq("id", body.id);
  if (error) return fail("Could not update the image.", 503);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  const session = await authorized();
  if (!session) return fail("Administrator access required.", 401);
  const id = request.nextUrl.searchParams.get("id");
  if (!validId(id)) return fail("A valid image ID is required.");
  const { data: row, error: readError } = await session.supabase
    .from("chat_images")
    .select("file_path")
    .eq("id", id)
    .maybeSingle();
  if (readError) return fail("Could not load the image.", 503);
  if (!row) return fail("Image not found.", 404);
  const { error } = await session.supabase
    .from("chat_images")
    .delete()
    .eq("id", id);
  if (error) return fail("Could not delete the image.", 503);
  // Best effort: the row is already gone, so the assistant stops sending it.
  await session.supabase.storage.from(bucket).remove([row.file_path]);
  return NextResponse.json({ ok: true });
}
