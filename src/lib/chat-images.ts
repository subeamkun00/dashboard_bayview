export const maxChatImageBytes = 1024 * 1024; // LINE preview images must be <= 1 MB
export const chatImageMimeTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};
export type ChatImage = {
  id: string;
  title: string;
  keywords: string;
  image_url: string;
  is_active: boolean;
  created_at: string;
};
/** "Frog, กบ ,origami" -> "frog,กบ,origami" (max 20 keywords, 500 characters). */
export function normalizeKeywords(input: string) {
  const unique = Array.from(
    new Set(
      input
        .split(/[,\n]/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 20);
  const joined = unique.join(",");
  return joined.length <= 500 ? joined : "";
}
