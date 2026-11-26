"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Badge, Card, CardHeader, Empty } from "./ui";
import { PageHeading } from "./dashboard-pages";
import {
  chatImageMimeTypes,
  maxChatImageBytes,
  type ChatImage,
} from "@/lib/chat-images";

export function ChatImagesPage() {
  const { demo, toast } = useWorkspace();
  const [images, setImages] = useState<ChatImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [uploading, setUploading] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [preview, setPreview] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (demo) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/chat-images");
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load images.");
      setImages(result.images);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unable to load images.");
    } finally {
      setLoading(false);
    }
  }, [demo]);
  useEffect(() => {
    void load();
  }, [load]);

  function choose(next: File | null) {
    if (next && !chatImageMimeTypes[next.type]) {
      toast("Only JPEG or PNG images are supported.", true);
      setInputKey((k) => k + 1);
      return;
    }
    if (next && next.size > maxChatImageBytes) {
      toast("The image must be 1 MB or smaller. Compress it and try again.", true);
      setInputKey((k) => k + 1);
      return;
    }
    setFile(next);
    setPreview("");
    if (next) {
      const reader = new FileReader();
      reader.onload = () => setPreview(String(reader.result));
      reader.readAsDataURL(next);
      if (!title.trim())
        setTitle(next.name.replace(/\.[^.]+$/, "").slice(0, 200));
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return toast("Choose an image first.", true);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("title", title);
      form.set("keywords", keywords);
      const res = await fetch("/api/chat-images", { method: "POST", body: form });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload failed.");
      setImages((list) => [result.image, ...list]);
      setFile(null);
      setPreview("");
      setTitle("");
      setKeywords("");
      setInputKey((k) => k + 1);
      toast("Image uploaded. The assistant can send it from now on.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Upload failed.", true);
    } finally {
      setUploading(false);
    }
  }

  async function toggle(image: ChatImage) {
    const res = await fetch("/api/chat-images", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: image.id, is_active: !image.is_active }),
    });
    if (!res.ok) return toast("Could not update the image.", true);
    setImages((list) =>
      list.map((i) =>
        i.id === image.id ? { ...i, is_active: !i.is_active } : i,
      ),
    );
  }

  async function remove(image: ChatImage) {
    if (!window.confirm(`Delete "${image.title}"? The assistant will stop sending it.`))
      return;
    const res = await fetch(`/api/chat-images?id=${image.id}`, {
      method: "DELETE",
    });
    if (!res.ok) return toast("Could not delete the image.", true);
    setImages((list) => list.filter((i) => i.id !== image.id));
    toast("Image deleted.");
  }

  return (
    <>
      <PageHeading
        eyebrow="ANSWER ATTACHMENTS"
        title="Chat Images"
        subtitle="Pictures the LINE assistant sends together with an answer, such as a folding diagram."
      />
      {demo ? (
        <Card>
          <Empty
            title="Not available in demo mode"
            text="Connect Supabase to upload chat images."
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Add an image"
              subtitle="Sent when an employee's question contains one of the keywords and the assistant finds an answer."
            />
            <form className="chat-images-form" onSubmit={upload}>
              <fieldset disabled={uploading}>
                <div className="chat-images-picker">
                  <input
                    key={inputKey}
                    ref={inputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    aria-label="Image file"
                    className="chat-images-file"
                    onChange={(e) => choose(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    className="button"
                    onClick={() => inputRef.current?.click()}
                  >
                    <ImagePlus size={16} />
                    {file ? "Change image" : "Choose image"}
                  </button>
                  {file ? (
                    <div className="chat-images-chosen">
                      {preview && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preview} alt="Selected image preview" />
                      )}
                      <span>
                        {file.name} ({Math.max(1, Math.round(file.size / 1024))} KB)
                      </span>
                    </div>
                  ) : (
                    <span className="chat-images-hint">
                      No image selected. JPEG or PNG, up to 1 MB.
                    </span>
                  )}
                </div>
                <label>
                  Title
                  <input
                    value={title}
                    maxLength={200}
                    placeholder="Jumping frog folding steps"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  Keywords (comma separated)
                  <input
                    value={keywords}
                    maxLength={500}
                    placeholder="frog, กบ, origami, พับกบ"
                    onChange={(e) => setKeywords(e.target.value)}
                  />
                </label>
                <p className="chat-images-hint">
                  Anyone with the link can view the image, so only upload
                  pictures that are not confidential.
                </p>
                <button className="button primary" type="submit" disabled={!file}>
                  <ImagePlus size={16} />
                  {uploading ? "Uploading..." : "Upload image"}
                </button>
              </fieldset>
            </form>
          </Card>
          <Card>
            <CardHeader
              title="Uploaded images"
              subtitle={`${images.length} image${images.length === 1 ? "" : "s"}`}
            />
            {loading ? (
              <p className="chat-images-hint">Loading...</p>
            ) : loadError ? (
              <Empty title="Could not load images" text={loadError} />
            ) : images.length === 0 ? (
              <Empty
                title="No images yet"
                text="Upload an image above to attach it to answers."
              />
            ) : (
              <div className="chat-images-grid">
                {images.map((image) => (
                  <div className="chat-images-item" key={image.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.image_url} alt={image.title} loading="lazy" />
                    <div className="chat-images-meta">
                      <strong>{image.title}</strong>
                      <span>{image.keywords.split(",").join(", ")}</span>
                      <Badge>{image.is_active ? "Active" : "Paused"}</Badge>
                    </div>
                    <div className="chat-images-actions">
                      <button className="button small" onClick={() => void toggle(image)}>
                        {image.is_active ? "Pause" : "Activate"}
                      </button>
                      <button
                        className="button small destructive"
                        onClick={() => void remove(image)}
                        aria-label={`Delete ${image.title}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
