"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { browserClient, isConfigured } from "@/lib/supabase/client";
import { createDemoData } from "@/lib/demo";
import type { Admin, Workspace } from "@/lib/types";
import { useRouter } from "next/navigation";

type Context = {
  now: number;
  data: Workspace;
  setData: React.Dispatch<React.SetStateAction<Workspace>>;
  demo: boolean;
  loading: boolean;
  error: string;
  admin: Admin;
  refresh: () => Promise<void>;
  toast: (message: string, error?: boolean) => void;
};
const WorkspaceContext = createContext<Context | null>(null);
const empty: Workspace = { users: [], chats: [], documents: [], admins: [] };
export function WorkspaceProvider({
  children,
  admin: initialAdmin,
}: {
  children: React.ReactNode;
  admin?: Admin;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [data, setData] = useState<Workspace>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const toast = useCallback(
    (message: string, isError = false) =>
      setNotice({ message, error: isError }),
    [],
  );
  const refresh = useCallback(async () => {
    if (!isConfigured) return;
    try {
      const res = await fetch("/api/dashboard");
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load workspace");
      setData(result);
      setNow(Date.now());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load workspace");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!isConfigured) {
      const demo = createDemoData();
      try {
        const saved = localStorage.getItem("bayview-demo-documents");
        if (saved) demo.documents = JSON.parse(saved);
        const employees = localStorage.getItem("bayview-demo-users");
        if (employees) demo.users = JSON.parse(employees);
        const profile = localStorage.getItem("bayview-demo-profile");
        if (profile) demo.admins[0] = JSON.parse(profile);
      } catch {
        /* Start with fresh demo data when local storage is unavailable. */
      }
      setData(demo);
      setNow(Date.now());
      setLoading(false);
      return;
    }
    void refresh();
    const supabase = browserClient()!;
    let timeout: ReturnType<typeof setTimeout>;
    const channel = supabase
      .channel("workspace-changes")
      .on("postgres_changes", { event: "*", schema: "public" }, () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => void refresh(), 400);
      })
      .subscribe();
    const auth = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "SIGNED_OUT") {
        router.replace("/login");
        router.refresh();
      }
    });
    return () => {
      clearTimeout(timeout);
      void supabase.removeChannel(channel);
      auth.data.subscription.unsubscribe();
    };
  }, [refresh, router]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!isConfigured && !loading) {
      try {
        localStorage.setItem(
          "bayview-demo-documents",
          JSON.stringify(data.documents),
        );
        localStorage.setItem("bayview-demo-users", JSON.stringify(data.users));
      } catch {
        /* Session still works without persistence. */
      }
    }
  }, [data.documents, data.users, loading]);
  const admin = data.admins.find((a) => a.id === initialAdmin?.id) ||
    initialAdmin ||
    data.admins[0] || {
      id: "demo-admin",
      email: "admin@bayview.com",
      display_name: "Alex Morgan",
      role: "admin" as const,
      created_at: "",
    };
  return (
    <WorkspaceContext.Provider
      value={{
        now,
        data,
        setData,
        demo: !isConfigured,
        loading,
        error,
        admin,
        refresh,
        toast,
      }}
    >
      {children}
      {notice && (
        <div
          className={`toast ${notice.error ? "toast-error" : ""}`}
          role="status"
        >
          <span>{notice.error ? "!" : "✓"}</span>
          {notice.message}
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace provider missing");
  return context;
}
