"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { FileText, Paperclip, Send, X } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Avatar } from "./ui";
import { date } from "@/lib/utils";
import type { Chat, ChatReply, Employee, ThreadMessage } from "@/lib/types";

const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png,.gif,.webp";
const ALLOWED = ACCEPT.replace(/\./g, "").split(",");
const LINE_IMAGES = ["jpg", "jpeg", "png"];
const MAX_FILES = 5;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() || "";
const sizeText = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

type Pending = { id: string; file: File; url: string | null };

const POLL_MS = 8000;

export function ReplyThread({ chat, user }: { chat: Chat; user?: Employee }) {
  const { demo, admin, setData, refresh, toast } = useWorkspace();
  const [replies, setReplies] = useState<ChatReply[]>([]);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  // Save the answer so the assistant can reuse it (not for "ติดต่อแอดมิน" chats).
  const [learn, setLearn] = useState(true);
  const [learnScope, setLearnScope] = useState<"department" | "hotel">(
    "department",
  );
  const picker = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const canReply =
    chat.response_status === "fallback" || chat.response_status === "replied";
  const isContact = chat.category === "Contact";
  const hasThread =
    chat.response_status === "replied" ||
    replies.length > 0 ||
    messages.length > 0;
  const endRef = useRef<HTMLDivElement>(null);
  const seen = useRef<number | null>(null);

  // `silent` is used by the automatic refresh so it never shows a spinner or
  // an error toast while admins are reading or typing.
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/chats/${chat.id}/reply`, {
          cache: "no-store",
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || "Unable to load replies.");
        setReplies(result.replies || []);
        setMessages(result.messages || []);
      } catch (e) {
        if (!silent)
          toast(
            e instanceof Error ? e.message : "Unable to load replies.",
            true,
          );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [chat.id, toast],
  );

  // Load the conversation when it opens, whenever the dashboard learns that the
  // employee wrote again (realtime updates last_message_at), and every few
  // seconds as a safety net while the window is open and visible.
  useEffect(() => {
    if (!demo && canReply) void load();
  }, [demo, canReply, load, chat.last_message_at, chat.response_status]);
  useEffect(() => {
    if (demo || !canReply) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [demo, canReply, load]);
  // Free the preview URLs of picked images when the panel closes.
  useEffect(
    () => () => urls.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );

  // One chat, oldest first: the employee's LINE messages and admin replies.
  const timeline = useMemo(
    () =>
      [
        ...messages.map((m) => ({
          kind: "employee" as const,
          at: m.created_at,
          m,
        })),
        ...replies.map((r) => ({
          kind: "admin" as const,
          at: r.created_at,
          r,
        })),
      ].sort((a, b) => a.at.localeCompare(b.at)),
    [messages, replies],
  );
  // Like LINE: jump to the newest message, but never pull the page away from
  // someone who scrolled up to read older ones.
  useEffect(() => {
    const previous = seen.current;
    seen.current = timeline.length;
    if (!timeline.length || previous === timeline.length) return;
    const box = endRef.current?.closest("dialog");
    const nearBottom =
      !box || box.scrollHeight - box.scrollTop - box.clientHeight < 240;
    if (previous === null || nearBottom)
      endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [timeline.length]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...pending];
    let total = next.reduce((sum, p) => sum + p.file.size, 0);
    let images = next.filter((p) =>
      LINE_IMAGES.includes(extOf(p.file.name)),
    ).length;
    for (const file of Array.from(list)) {
      const ext = extOf(file.name);
      const isImage = LINE_IMAGES.includes(ext);
      const problem = !ALLOWED.includes(ext)
        ? "is not an allowed file type"
        : next.length >= MAX_FILES
          ? `would exceed the limit of ${MAX_FILES} files`
          : isImage && images >= MAX_IMAGES
            ? `would exceed the limit of ${MAX_IMAGES} images`
            : isImage && file.size > MAX_IMAGE_BYTES
              ? "is larger than 10 MB (LINE's image limit)"
              : file.size > MAX_FILE_BYTES
                ? "is larger than 20 MB"
                : total + file.size > MAX_TOTAL_BYTES
                  ? "would exceed 20 MB in total"
                  : "";
      if (problem) {
        toast(`"${file.name}" ${problem}.`, true);
        continue;
      }
      const url = isImage ? URL.createObjectURL(file) : null;
      if (url) urls.current.push(url);
      if (isImage) images += 1;
      total += file.size;
      next.push({ id: crypto.randomUUID(), file, url });
    }
    setPending(next);
    if (picker.current) picker.current.value = "";
  }
  function removeFile(id: string) {
    setPending((list) => {
      const gone = list.find((p) => p.id === id);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return list.filter((p) => p.id !== id);
    });
  }

  async function send() {
    const message = text.trim();
    if (busy) return;
    if (!message && !pending.length) {
      toast("Please type a reply or attach a file.", true);
      return;
    }
    setBusy(true);
    try {
      if (demo) {
        setReplies((list) => [
          ...list,
          {
            id: crypto.randomUUID(),
            admin_name: admin.display_name,
            message,
            created_at: new Date().toISOString(),
            attachments: pending.map((p) => ({
              name: p.file.name,
              kind: p.url ? "image" : "file",
              mime: p.file.type,
              size: p.file.size,
              url: p.url || "",
              preview_url: p.url,
            })),
          },
        ]);
        setData((prev) => ({
          ...prev,
          chats: prev.chats.map((c) =>
            c.id === chat.id
              ? { ...c, response_status: "replied" as const }
              : c,
          ),
        }));
        toast(
          "Demo mode: reply kept on screen only, nothing was sent to LINE.",
        );
        setPending([]);
      } else {
        const form = new FormData();
        form.set("message", message);
        pending.forEach((p) => form.append("files", p.file));
        if (!isContact && learn && message) {
          form.set("learn", "1");
          form.set("learn_scope", learnScope);
        }
        const res = await fetch(`/api/chats/${chat.id}/reply`, {
          method: "POST",
          body: form,
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(result.error || "Unable to send the reply.");
        pending.forEach((p) => p.url && URL.revokeObjectURL(p.url));
        setPending([]);
        await Promise.all([load(), refresh()]);
        const learned = result.learned as {
          status: string;
          message: string;
        } | null;
        if (learned?.message)
          toast(learned.message, learned.status === "failed");
        else toast("Reply sent to the employee on LINE.");
      }
      setText("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Unable to send the reply.", true);
      if (!demo) void refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!canReply) return null;
  const id = `reply-${chat.id}`;
  const name = user?.display_name || "Team member";
  return (
    <>
      {loading && !timeline.length && (
        <p className="reply-note" role="status">
          Loading messages...
        </p>
      )}
      {timeline.map((item) =>
        item.kind === "employee" ? (
          <div key={`m-${item.m.id}`} className="chat-message user-message">
            <Avatar name={name} image={user?.profile_image_url} />
            <div>
              <strong>
                {name}
                <small className="chat-time">
                  {date(item.m.created_at, true)}
                </small>
              </strong>
              <p className="chat-text">{item.m.message}</p>
            </div>
          </div>
        ) : (
          <div key={`r-${item.r.id}`} className="chat-message admin-message">
            <div>
              <strong>
                {item.r.admin_name}
                <small className="chat-time">
                  {date(item.r.created_at, true)}
                </small>
              </strong>
              {item.r.message && <p className="chat-text">{item.r.message}</p>}
              {item.r.attachments.length > 0 && (
                <div className="reply-attachments">
                  {item.r.attachments.map((a, i) =>
                    a.kind === "image" && (a.preview_url || a.url) ? (
                      <a
                        key={i}
                        href={a.url || a.preview_url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="reply-image"
                        title={a.name}
                      >
                        <Image
                          src={a.preview_url || a.url}
                          alt={a.name}
                          width={160}
                          height={120}
                          unoptimized
                        />
                      </a>
                    ) : (
                      <a
                        key={i}
                        href={a.url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="reply-file"
                      >
                        <FileText size={15} />
                        <span>{a.name}</span>
                        <small>{sizeText(a.size)}</small>
                      </a>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        ),
      )}
      <div ref={endRef} />
      <section className="reply-thread" aria-label="Replies to this employee">
        <div className="reply-thread-head">
          <h3>Replies to this employee</h3>
          <small>
            {isContact
              ? "This employee is chatting with an admin on LINE. New messages appear here automatically. Each reply is sent to the employee on LINE."
              : hasThread
                ? "You can keep replying. Each message is sent to the employee on LINE."
                : "The assistant could not answer. Your message will be sent to the employee on LINE."}
          </small>
        </div>
        {chat.response_status === "fallback" &&
          chat.reply_delivery === "failed" && (
            <p className="reply-error" role="alert">
              The last attempt could not be delivered
              {chat.reply_error ? `: ${chat.reply_error}` : "."}
            </p>
          )}
        <label htmlFor={id} className="sr-only">
          Reply message
        </label>
        <textarea
          id={id}
          rows={4}
          maxLength={2000}
          value={text}
          disabled={busy}
          placeholder={
            hasThread ? "Write another reply..." : "Type your answer here..."
          }
          onChange={(e) => setText(e.target.value)}
        />
        {pending.length > 0 && (
          <ul className="reply-pending" aria-label="Files to send">
            {pending.map((p) => (
              <li key={p.id}>
                {p.url ? (
                  <Image
                    src={p.url}
                    alt=""
                    width={36}
                    height={36}
                    unoptimized
                  />
                ) : (
                  <FileText size={18} />
                )}
                <span>{p.file.name}</span>
                <small>{sizeText(p.file.size)}</small>
                <button
                  type="button"
                  aria-label={`Remove ${p.file.name}`}
                  disabled={busy}
                  onClick={() => removeFile(p.id)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!isContact && (
          <div className="reply-learn">
            <label>
              <input
                type="checkbox"
                checked={learn}
                disabled={busy}
                onChange={(e) => setLearn(e.target.checked)}
              />
              <span>Use this answer when the same question is asked again</span>
            </label>
            {learn && (
              <select
                aria-label="Who the assistant may use this answer for"
                value={learnScope}
                disabled={busy}
                onChange={(e) =>
                  setLearnScope(e.target.value as "department" | "hotel")
                }
              >
                <option value="department">
                  Only the employee&apos;s department
                </option>
                <option value="hotel">Whole hotel</option>
              </select>
            )}
          </div>
        )}
        <div className="reply-actions">
          <div className="reply-tools">
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              aria-label="Reply attachments"
              accept={ACCEPT}
              onChange={(e) => addFiles(e.target.files)}
            />
            <button
              type="button"
              className="button reply-attach-button"
              disabled={busy || pending.length >= MAX_FILES}
              onClick={() => picker.current?.click()}
            >
              <Paperclip size={15} />
              Attach
            </button>
            <small aria-label="Reply character count" aria-live="polite">
              {text.length}/2000
            </small>
          </div>
          <button
            type="button"
            className="button primary reply-send-button"
            disabled={busy || (!text.trim() && !pending.length)}
            onClick={() => void send()}
          >
            <Send size={15} />
            {busy ? "Sending..." : "Send reply"}
          </button>
        </div>
        <small className="reply-note">
          JPG/PNG images are sent as pictures (up to 4). Other files are sent as
          download links valid for 30 days. Up to 5 files, 20 MB in total.
        </small>
      </section>
    </>
  );
}
