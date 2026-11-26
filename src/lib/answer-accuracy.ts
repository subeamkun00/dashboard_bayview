import type { Chat } from "./types";
import { rangeStart } from "./utils";

/** Rows saved for LINE commands and admin contact requests. They are not AI answers. */
const NON_AI_CATEGORIES = new Set(["Contact", "Login", "SOP Guide"]);

/** Requested dashboard metric, not a correctness evaluation of AI answers. */
export function answerAccuracy(
  chats: (Pick<Chat, "created_at" | "response_status"> & {
    category?: string;
  })[],
  days: number,
  now: number,
) {
  const since = rangeStart(days, now);
  let success = 0;
  let fallback = 0;
  for (const chat of chats) {
    if (chat.category && NON_AI_CATEGORIES.has(chat.category)) continue;
    const timestamp = new Date(chat.created_at).getTime();
    if (!Number.isFinite(timestamp) || timestamp < since || timestamp > now)
      continue;
    if (chat.response_status === "success") success += 1;
    if (chat.response_status === "fallback") fallback += 1;
  }
  const total = success + fallback;
  return {
    success,
    fallback,
    total,
    percentage: total ? (success / total) * 100 : null,
  };
}
