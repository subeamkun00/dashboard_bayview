import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Admin } from "@/lib/types";
export const isConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
export async function serverClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) =>
              store.set(name, value, options),
            );
          } catch {
            /* Server component cookies are refreshed by proxy. */
          }
        },
      },
    },
  );
}
// Department heads must sign in with an emailed code. A session opened with a
// password only is not accepted for them. (Fail-open on purpose: if the sign-in
// method cannot be read, the session is not rejected.)
async function openedWithPasswordOnly(
  supabase: Awaited<ReturnType<typeof serverClient>>,
) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    const methods: string[] = Array.isArray(payload.amr)
      ? payload.amr.map((a: { method?: string }) => String(a?.method ?? ""))
      : [];
    return (
      methods.includes("password") &&
      !methods.some((m) => ["otp", "magiclink", "email", "email_otp"].includes(m))
    );
  } catch {
    return false;
  }
}
export async function authorized() {
  if (!isConfigured) return null;
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("admins")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!data) return null;
  if (data.role === "head" && (await openedWithPasswordOnly(supabase)))
    return null;
  return { supabase, admin: data as Admin };
}
